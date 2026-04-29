use std::collections::HashSet;
use std::path::Path;

use crate::models::MiseToolSuggestionDto;
use crate::task_config::mise::find_mise_config;

/// Analyze project files and suggest mise tools that should be pinned.
/// Detects ALL applicable (nested) runtimes, not just the primary stack.
/// Returns only tools NOT already present in the project's mise.toml.
pub fn suggest_tools_for_project(
    project_path: &Path,
    stack: &str,
    _runtime_hint: Option<&str>,
) -> Vec<MiseToolSuggestionDto> {
    let mut suggestions: Vec<MiseToolSuggestionDto> = Vec::new();

    // Primary stack first — then nested runtimes
    match stack {
        "deno" => suggestions.push(detect_deno_version(project_path)),
        "typescript" | "javascript" => {
            suggestions.push(detect_node_version(project_path));
            if let Some(pm) = detect_package_manager(project_path) {
                suggestions.push(pm);
            }
        }
        "go" => suggestions.push(detect_go_version(project_path)),
        "rust" => suggestions.push(suggest_tool("rust", "latest", "Rust project detected")),
        "dotnet" => suggestions.push(detect_dotnet_version(project_path)),
        "php" => suggestions.push(detect_php_version(project_path)),
        "ruby" => suggestions.push(detect_ruby_version(project_path)),
        "elixir" => suggestions.push(detect_elixir_version(project_path)),
        "kotlin" | "java" => suggestions.push(detect_java_version(project_path)),
        "swift" => suggestions.push(suggest_tool("swift", "latest", "Swift project detected")),
        "python" => suggestions.push(detect_python_version(project_path)),
        _ => {}
    }

    // Collect all nested detections first, then filter.
    // Recursively scan subdirectories so monorepo children with different
    // stacks (e.g. a .NET backend inside a JS frontend) are detected.
    let nested = scan_for_runtimes_recursive(project_path, 3);

    for s in nested {
        suggestions.push(s);
    }

    // Deduplicate by tool name (keep first / primary-stack entry)
    let mut seen: HashSet<String> = HashSet::new();
    suggestions.retain(|s| {
        if s.name.is_empty() || seen.contains(&s.name) {
            return false;
        }
        seen.insert(s.name.clone());
        true
    });

    // Filter out already-pinned tools
    let pinned = read_pinned_tools(project_path);
    suggestions.retain(|s| !pinned.contains(&s.name));

    suggestions
}

/// Write suggested tools to the project's mise.toml.
/// Creates the file if it doesn't exist.
pub fn pin_tools_to_mise(project_path: &Path, tools: &[MiseToolSuggestionDto]) -> Result<(), String> {
    let mise_path = find_mise_config(project_path)
        .unwrap_or_else(|| project_path.join("mise.toml"));

    let content = match std::fs::read_to_string(&mise_path) {
        Ok(c) => c,
        Err(_) => {
            let doc = toml_edit::DocumentMut::new();
            doc.to_string()
        }
    };

    let mut doc: toml_edit::DocumentMut = content
        .parse()
        .map_err(|e| format!("failed to parse mise.toml: {}", e))?;

    // Ensure [tools] section exists
    if !doc.contains_key("tools") {
        doc["tools"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    let tools_table = doc["tools"]
        .as_table_mut()
        .ok_or("tools is not a table")?;

    for tool in tools {
        let version = if tool.version == "latest" {
            "latest".to_string()
        } else {
            tool.version.clone()
        };
        tools_table.insert(&tool.name, toml_edit::Item::Value(toml_edit::Value::from(version)));
    }

    std::fs::write(&mise_path, doc.to_string())
        .map_err(|e| format!("failed to write mise.toml: {}", e))?;

    Ok(())
}

fn read_pinned_tools(project_path: &Path) -> HashSet<String> {
    let mut pinned = HashSet::new();

    let Some(mise_path) = find_mise_config(project_path) else {
        return pinned;
    };

    let content = match std::fs::read_to_string(&mise_path) {
        Ok(c) => c,
        Err(_) => return pinned,
    };

    let doc: toml::Value = match toml::from_str(&content) {
        Ok(d) => d,
        Err(_) => return pinned,
    };

    if let Some(tools) = doc.get("tools").and_then(|v| v.as_table()) {
        for name in tools.keys() {
            pinned.insert(name.clone());
        }
    }

    pinned
}

fn detect_dotnet_version(project_path: &Path) -> MiseToolSuggestionDto {
    // Check global.json first
    if let Some(raw) = read_utf8(&project_path.join("global.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(ver) = v
                .get("sdk")
                .and_then(|s| s.get("version"))
                .and_then(|v| v.as_str())
            {
                let major = ver.split('.').next().unwrap_or(ver);
                return suggest_tool("dotnet", major, "from global.json");
            }
        }
    }

    // Discover .csproj files — either from .sln references or by scanning
    let csproj_paths = discover_csproj_paths(project_path);
    for csproj in &csproj_paths {
        if let Some(raw) = read_utf8(csproj) {
            for line in raw.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("<TargetFramework>") {
                    if let Some(tf) = rest.strip_suffix("</TargetFramework>") {
                        let ver = normalize_dotnet_version(tf.trim());
                        if !ver.is_empty() {
                            return suggest_tool("dotnet", &ver, "from .csproj");
                        }
                    }
                }
                if let Some(rest) = t.strip_prefix("<TargetFrameworks>") {
                    if let Some(tf) = rest.strip_suffix("</TargetFrameworks>") {
                        let first = tf.split(';').next().unwrap_or(tf).trim();
                        let ver = normalize_dotnet_version(first);
                        if !ver.is_empty() {
                            return suggest_tool("dotnet", &ver, "from .csproj");
                        }
                    }
                }
            }
        }
    }
    suggest_tool("dotnet", "latest", ".NET project detected")
}

/// Parse .sln files to find referenced .csproj paths, or fall back to scanning.
fn discover_csproj_paths(project_path: &Path) -> Vec<std::path::PathBuf> {
    let mut paths: Vec<std::path::PathBuf> = Vec::new();

    // Try to extract .csproj paths from any .sln files
    if let Ok(rd) = std::fs::read_dir(project_path) {
        for e in rd.flatten() {
            let n = e.file_name();
            let n = n.to_string_lossy();
            if n.ends_with(".sln") && e.path().is_file() {
                if let Some(raw) = read_utf8(&e.path()) {
                    for line in raw.lines() {
                        // Example line:
                        // Project("{...}") = "Name", "relative\path.csproj", "{...}"
                        if let Some(start) = line.find(".csproj") {
                            if let Some(q) = line[..start].rfind('"') {
                                let rel = &line[q + 1..start + 7];
                                let abs = project_path.join(rel);
                                if abs.is_file() {
                                    paths.push(abs);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if !paths.is_empty() {
        return paths;
    }

    // No .sln or no valid refs — scan root and one level of subdirectories
    scan_csproj_recursive(project_path, project_path, 2, &mut paths);
    paths
}

fn scan_csproj_recursive(
    root: &Path,
    current: &Path,
    depth_remaining: usize,
    out: &mut Vec<std::path::PathBuf>,
) {
    if depth_remaining == 0 {
        return;
    }
    if let Ok(rd) = std::fs::read_dir(current) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() {
                if p.extension().and_then(|s| s.to_str()) == Some("csproj") {
                    out.push(p);
                }
            } else if p.is_dir() {
                // Avoid descending into common dependency / output folders
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    let lower = name.to_lowercase();
                    if lower == "node_modules"
                        || lower == "bin"
                        || lower == "obj"
                        || lower == ".git"
                        || lower == "target"
                        || lower == "dist"
                        || lower == "build"
                    {
                        continue;
                    }
                }
                scan_csproj_recursive(root, &p, depth_remaining - 1, out);
            }
        }
    }
}

fn normalize_dotnet_version(v: &str) -> String {
    let t = v.trim();
    if t.starts_with("net") {
        let rest = &t[3..];
        if rest.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return rest.split('.').next().unwrap_or(rest).to_string();
        }
    }
    String::new()
}

fn has_csproj(project_path: &Path) -> bool {
    if let Ok(rd) = std::fs::read_dir(project_path) {
        for e in rd.flatten() {
            let n = e.file_name();
            if n.to_string_lossy().ends_with(".csproj") && e.path().is_file() {
                return true;
            }
        }
    }
    false
}

fn has_sln(project_path: &Path) -> bool {
    if let Ok(rd) = std::fs::read_dir(project_path) {
        for e in rd.flatten() {
            let n = e.file_name();
            if n.to_string_lossy().ends_with(".sln") && e.path().is_file() {
                return true;
            }
        }
    }
    false
}

fn suggest_tool(name: &str, version: &str, reason: &str) -> MiseToolSuggestionDto {
    MiseToolSuggestionDto {
        name: name.to_string(),
        version: version.to_string(),
        reason: reason.to_string(),
    }
}

fn detect_node_version(project_path: &Path) -> MiseToolSuggestionDto {
    // Check .nvmrc first
    if let Some(v) = read_version_file(project_path, ".nvmrc") {
        return suggest_tool("node", &normalize_node_version(&v), "from .nvmrc");
    }
    // Check .node-version
    if let Some(v) = read_version_file(project_path, ".node-version") {
        return suggest_tool("node", &normalize_node_version(&v), "from .node-version");
    }
    // Check package.json engines.node
    if let Some(v) = read_package_json_node_version(project_path) {
        return suggest_tool("node", &normalize_node_version(&v), "from package.json engines");
    }
    suggest_tool("node", "latest", "JavaScript/TypeScript project detected")
}

fn detect_package_manager(project_path: &Path) -> Option<MiseToolSuggestionDto> {
    if project_path.join("bun.lockb").is_file() || project_path.join("bun.lock").is_file() {
        return Some(suggest_tool("bun", "latest", "from bun.lock"));
    }
    if project_path.join("pnpm-lock.yaml").is_file() {
        return Some(suggest_tool("pnpm", "latest", "from pnpm-lock.yaml"));
    }
    if project_path.join("yarn.lock").is_file() {
        return Some(suggest_tool("yarn", "latest", "from yarn.lock"));
    }
    None
}

fn detect_go_version(project_path: &Path) -> MiseToolSuggestionDto {
    if let Some(raw) = read_utf8(&project_path.join("go.mod")) {
        for line in raw.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("go ") {
                let ver = rest.trim().to_string();
                if !ver.is_empty() {
                    return suggest_tool("go", &ver, "from go.mod");
                }
            }
        }
    }
    suggest_tool("go", "latest", "Go project detected")
}

fn detect_deno_version(project_path: &Path) -> MiseToolSuggestionDto {
    if let Some(raw) = read_utf8(&project_path.join("deno.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                return suggest_tool("deno", ver, "from deno.json");
            }
        }
    }
    suggest_tool("deno", "latest", "Deno project detected")
}

/// Recursively scan subdirectories for runtime markers and collect suggestions.
/// Depth-limited to avoid walking huge dependency trees.
fn scan_for_runtimes_recursive(root: &Path, max_depth: usize) -> Vec<MiseToolSuggestionDto> {
    let mut out: Vec<MiseToolSuggestionDto> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    fn walk(
        dir: &Path,
        depth: usize,
        max_depth: usize,
        out: &mut Vec<MiseToolSuggestionDto>,
        seen: &mut HashSet<String>,
    ) {
        if depth > max_depth {
            return;
        }

        let mut push = |s: MiseToolSuggestionDto| {
            if !s.name.is_empty() && seen.insert(s.name.clone()) {
                out.push(s);
            }
        };

        // Root-level checks at the current directory
        if dir.join("package.json").is_file() {
            push(detect_node_version(dir));
            if let Some(pm) = detect_package_manager(dir) {
                push(pm);
            }
        }
        if dir.join("pyproject.toml").is_file()
            || dir.join("requirements.txt").is_file()
            || dir.join("Pipfile").is_file()
            || dir.join(".python-version").is_file()
        {
            push(detect_python_version(dir));
        }
        if dir.join("go.mod").is_file() {
            push(detect_go_version(dir));
        }
        if dir.join("Cargo.toml").is_file() {
            push(suggest_tool("rust", "latest", "Rust project detected"));
        }
        if has_csproj(dir)
            || dir.join("global.json").is_file()
            || has_sln(dir)
        {
            push(detect_dotnet_version(dir));
        }
        if dir.join("composer.json").is_file() {
            push(detect_php_version(dir));
        }
        if dir.join("Gemfile").is_file()
            || dir.join(".ruby-version").is_file()
        {
            push(detect_ruby_version(dir));
        }
        if dir.join("mix.exs").is_file() {
            push(detect_elixir_version(dir));
        }
        if dir.join("pom.xml").is_file()
            || dir.join("build.gradle").is_file()
            || dir.join("build.gradle.kts").is_file()
        {
            push(detect_java_version(dir));
        }
        if dir.join("Package.swift").is_file() {
            push(suggest_tool("swift", "latest", "Swift project detected"));
        }
        if dir.join("deno.json").is_file() {
            push(detect_deno_version(dir));
        }

        if depth == max_depth {
            return;
        }

        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let lower = name.to_lowercase();
            if lower == "node_modules"
                || lower == ".git"
                || lower == "target"
                || lower == "dist"
                || lower == "build"
                || lower == "bin"
                || lower == "obj"
                || lower == ".next"
                || lower == "out"
                || lower == "vendor"
            {
                continue;
            }
            walk(&p, depth + 1, max_depth, out, seen);
        }
    }

    walk(root, 0, max_depth, &mut out, &mut seen);
    out
}

fn detect_python_version(project_path: &Path) -> MiseToolSuggestionDto {
    // Check .python-version
    if let Some(v) = read_version_file(project_path, ".python-version") {
        return suggest_tool("python", &v, "from .python-version");
    }
    // Check pyproject.toml requires-python
    if let Some(raw) = read_utf8(&project_path.join("pyproject.toml")) {
        if let Ok(t) = toml::from_str::<toml::Value>(&raw) {
            if let Some(req) = t
                .get("project")
                .and_then(|p| p.get("requires-python"))
                .and_then(|r| r.as_str())
            {
                // Convert >=3.11 to 3.11 or ~=3.11 to 3.11
                let ver = normalize_python_version(req);
                if !ver.is_empty() {
                    return suggest_tool("python", &ver, "from pyproject.toml");
                }
            }
        }
    }
    suggest_tool("python", "latest", "Python project detected")
}

fn detect_php_version(project_path: &Path) -> MiseToolSuggestionDto {
    if let Some(raw) = read_utf8(&project_path.join("composer.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(req) = v
                .get("require")
                .and_then(|r| r.get("php"))
                .and_then(|x| x.as_str())
            {
                let ver = normalize_php_version(req);
                if !ver.is_empty() {
                    return suggest_tool("php", &ver, "from composer.json");
                }
            }
        }
    }
    suggest_tool("php", "latest", "PHP project detected")
}

fn detect_ruby_version(project_path: &Path) -> MiseToolSuggestionDto {
    if let Some(v) = read_version_file(project_path, ".ruby-version") {
        return suggest_tool("ruby", &v, "from .ruby-version");
    }
    if let Some(raw) = read_utf8(&project_path.join("Gemfile")) {
        for line in raw.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("ruby '") {
                if let Some(ver) = rest.strip_suffix('\'') {
                    return suggest_tool("ruby", ver, "from Gemfile");
                }
            } else if let Some(rest) = t.strip_prefix("ruby \"") {
                if let Some(ver) = rest.strip_suffix('"') {
                    return suggest_tool("ruby", ver, "from Gemfile");
                }
            }
        }
    }
    suggest_tool("ruby", "latest", "Ruby project detected")
}

fn detect_elixir_version(project_path: &Path) -> MiseToolSuggestionDto {
    if let Some(raw) = read_utf8(&project_path.join("mix.exs")) {
    for line in raw.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("elixir: \"") {
            if let Some(ver) = rest.split('"').next() {
                return suggest_tool("elixir", ver, "from mix.exs");
            }
        } else if let Some(rest) = t.strip_prefix("elixir: '") {
            if let Some(ver) = rest.split('\'').next() {
                return suggest_tool("elixir", ver, "from mix.exs");
            }
        }
    }
    }
    suggest_tool("elixir", "latest", "Elixir project detected")
}

fn detect_java_version(project_path: &Path) -> MiseToolSuggestionDto {
    // Check pom.xml for maven.compiler.source
    if let Some(raw) = read_utf8(&project_path.join("pom.xml")) {
        // Simple string search for java version
        for line in raw.lines() {
            let t = line.trim();
            if t.contains("<maven.compiler.source>") {
                if let Some(ver) = t
                    .strip_prefix("<maven.compiler.source>")
                    .and_then(|s| s.strip_suffix("</maven.compiler.source>"))
                {
                    return suggest_tool("java", ver.trim(), "from pom.xml");
                }
            }
            if t.contains("<java.version>") {
                if let Some(ver) = t
                    .strip_prefix("<java.version>")
                    .and_then(|s| s.strip_suffix("</java.version>"))
                {
                    return suggest_tool("java", ver.trim(), "from pom.xml");
                }
            }
        }
    }
    // Check build.gradle for sourceCompatibility
    for name in &["build.gradle", "build.gradle.kts"] {
        if let Some(raw) = read_utf8(&project_path.join(name)) {
            for line in raw.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("sourceCompatibility = '") {
                    if let Some(ver) = rest.strip_suffix('\'') {
                        return suggest_tool("java", ver.trim(), "from build.gradle");
                    }
                }
                if let Some(rest) = t.strip_prefix("sourceCompatibility = \"") {
                    if let Some(ver) = rest.strip_suffix('"') {
                        return suggest_tool("java", ver.trim(), "from build.gradle");
                    }
                }
                if let Some(rest) = t.strip_prefix("sourceCompatibility = JavaVersion.VERSION_") {
                    let ver = rest.replace("_", ".");
                    return suggest_tool("java", &ver, "from build.gradle");
                }
            }
        }
    }
    suggest_tool("java", "latest", "Java/Kotlin project detected")
}

fn read_version_file(project_path: &Path, name: &str) -> Option<String> {
    let p = project_path.join(name);
    if !p.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(&p).ok()?;
    let v = raw.lines().next()?.trim().to_string();
    if v.is_empty() {
        return None;
    }
    Some(v)
}

fn read_utf8(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn read_package_json_node_version(project_path: &Path) -> Option<String> {
    let raw = read_utf8(&project_path.join("package.json"))?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("engines")
        .and_then(|e| e.get("node"))
        .and_then(|n| n.as_str())
        .map(|s| s.trim().to_string())
}

fn normalize_node_version(v: &str) -> String {
    let t = v.trim();
    // Handle "^18.0.0" or ">=18.0.0" → "18"
    let t = t.trim_start_matches('^')
        .trim_start_matches('~')
        .trim_start_matches('>')
        .trim_start_matches('=')
        .trim_start_matches(">=")
        .trim_start_matches(">")
        .trim_start_matches("<=");
    // "18.0.0" → "18", "20.11.0" → "20"
    t.split('.').next().unwrap_or(t).to_string()
}

fn normalize_python_version(v: &str) -> String {
    let t = v.trim()
        .trim_start_matches('^')
        .trim_start_matches('~')
        .trim_start_matches('=')
        .trim_start_matches(">=")
        .trim_start_matches(">");
    // ">=3.11" → "3.11"
    t.split(',').next().unwrap_or(t).trim().to_string()
}

fn normalize_php_version(v: &str) -> String {
    let t = v.trim()
        .trim_start_matches('^')
        .trim_start_matches('~')
        .trim_start_matches('=')
        .trim_start_matches(">=")
        .trim_start_matches(">");
    // "^8.1" → "8.1"
    t.split(',').next().unwrap_or(t).trim().to_string()
}
