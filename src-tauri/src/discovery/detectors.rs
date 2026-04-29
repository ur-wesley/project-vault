use std::fs;
use std::path::Path;

use serde_json::Value as JsonValue;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use crate::models::TaskDto;

fn dirname_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".into())
}

fn read_utf8(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn deps_has_package(v: &JsonValue, pkg: &str) -> bool {
    for key in [
        "devDependencies",
        "dependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(o) = v.get(key).and_then(|x| x.as_object()) else {
            continue;
        };
        if o.contains_key(pkg) {
            return true;
        }
    }
    false
}

fn root_has_tsconfig_json(root: &Path) -> bool {
    let Ok(read) = fs::read_dir(root) else {
        return false;
    };
    for e in read.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let osname = e.file_name();
        let Some(name) = osname.to_str() else {
            continue;
        };
        if name.starts_with("tsconfig") && name.ends_with(".json") {
            return true;
        }
    }
    false
}

fn dir_has_typescript_source_file(dir: &Path) -> bool {
    const EXT: [&str; 4] = ["ts", "tsx", "mts", "cts"];
    let Ok(read) = fs::read_dir(dir) else {
        return false;
    };
    for e in read.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if let Some(ext) = e.path().extension().and_then(|x| x.to_str()) {
            if EXT.contains(&ext) {
                return true;
            }
        }
    }
    false
}

fn package_json_types_entry_is_ts(v: &JsonValue) -> bool {
    for key in ["types", "typings"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            let t = s.trim();
            if t.ends_with(".d.ts")
                || t.ends_with(".ts")
                || t.ends_with(".tsx")
                || t.ends_with(".mts")
                || t.ends_with(".cts")
            {
                return true;
            }
        }
    }
    false
}

fn project_looks_typescript(v: &JsonValue, root: &Path) -> bool {
    if root_has_tsconfig_json(root) {
        return true;
    }
    if dir_has_typescript_source_file(root) {
        return true;
    }
    if dir_has_typescript_source_file(&root.join("src")) {
        return true;
    }
    if package_json_types_entry_is_ts(v) {
        return true;
    }
    if deps_has_package(v, "typescript") {
        return true;
    }
    false
}

fn package_json_stack(v: &JsonValue, root: &Path) -> String {
    if project_looks_typescript(v, root) {
        return "typescript".into();
    }
    "javascript".into()
}

fn package_json_looks_real(v: &JsonValue) -> bool {
    let Some(o) = v.as_object() else {
        return false;
    };
    if o.is_empty() {
        return false;
    }
    // If it has scripts or dependencies, we definitely want it
    if o.get("scripts").is_some()
        || o.get("dependencies").is_some()
        || o.get("devDependencies").is_some()
    {
        return true;
    }
    // A workspace manifest is always a real project (monorepo root)
    if o.get("workspaces").is_some() {
        return true;
    }
    // Otherwise, check if it has at least 1 common key to avoid random JSON files
    let common_keys = [
        "name",
        "version",
        "description",
        "main",
        "type",
        "author",
        "license",
        "private",
        "packageManager",
    ];
    let count = o
        .keys()
        .filter(|k| common_keys.contains(&k.as_str()))
        .count();
    count >= 1
}

fn requirements_txt_has_package_line(s: &str) -> bool {
    s.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with('#') && t.chars().any(|c| c.is_ascii_alphanumeric())
    })
}

fn script_task(id: &str, label: &str, argv: Vec<String>) -> TaskDto {
    TaskDto {
        id: id.to_string(),
        label: label.to_string(),
        argv,
        kind: "script".into(),
        cwd: None,
        description: None,
        depends: Vec::new(),
        source: None,
    }
}

pub struct MiseDetector;

impl ProjectDetector for MiseDetector {
    fn id(&self) -> &'static str {
        "mise"
    }

    fn priority(&self) -> i32 {
        110 // High priority to discover mise tasks
    }

    fn markers(&self) -> &'static [&'static str] {
        &["mise.toml", ".mise.toml", "mise.local.toml", ".mise.local.toml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let config_path = crate::task_config::mise::find_mise_config(path)?;
        let tasks = crate::task_config::mise::read_mise_tasks(&config_path);

        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "mise".into(),
            runtime_hint: None,
            tasks,
            tags: vec!["mise".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct JustfileDetector;

impl ProjectDetector for JustfileDetector {
    fn id(&self) -> &'static str {
        "justfile"
    }

    fn priority(&self) -> i32 {
        105
    }

    fn markers(&self) -> &'static [&'static str] {
        &["justfile", "Justfile", ".justfile", ".Justfile"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let justfile_path = crate::task_config::justfile::find_justfile(path)?;
        let tasks = crate::task_config::justfile::read_justfile_tasks(&justfile_path);

        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "justfile".into(),
            runtime_hint: None,
            tasks,
            tags: vec!["justfile".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct PackageJsonDetector;

impl ProjectDetector for PackageJsonDetector {
    fn id(&self) -> &'static str {
        "package.json"
    }

    fn priority(&self) -> i32 {
        100
    }

    fn markers(&self) -> &'static [&'static str] {
        &["package.json"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let pj = path.join("package.json");
        if !pj.is_file() {
            return None;
        }
        let raw = read_utf8(&pj)?;
        let v: JsonValue = serde_json::from_str(&raw).ok()?;
        if !package_json_looks_real(&v) {
            return None;
        }
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dirname_name(path));

        let package_manager = v.get("packageManager").and_then(|x| x.as_str());
        let (pm, run_args): (&str, &[&str]) = if let Some(pm_str) = package_manager {
            if pm_str.starts_with("bun") {
                ("bun", &["run"])
            } else if pm_str.starts_with("pnpm") {
                ("pnpm", &["run"])
            } else if pm_str.starts_with("yarn") {
                ("yarn", &["run"])
            } else {
                ("npm", &["run"])
            }
        } else if path.join("bun.lockb").is_file() || path.join("bun.lock").is_file() || path.join("bunfig.toml").is_file() {
            ("bun", &["run"])
        } else if path.join("pnpm-lock.yaml").is_file() {
            ("pnpm", &["run"])
        } else if path.join("yarn.lock").is_file() {
            ("yarn", &["run"])
        } else {
            // Check if any script starts with bun
            let mut uses_bun = false;
            if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                for v in scripts.values() {
                    if let Some(s) = v.as_str() {
                        if s.trim().starts_with("bun ") {
                            uses_bun = true;
                            break;
                        }
                    }
                }
            }
            if uses_bun {
                ("bun", &["run"])
            } else {
                ("npm", &["run"])
            }
        };

        let mut tasks = Vec::new();
        if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
            let preferred = ["dev", "start", "test", "build", "lint"];
            for key in preferred {
                if scripts.contains_key(key) {
                    let argv = vec![pm.to_string(), run_args[0].to_string(), key.to_string()];
                    tasks.push(script_task(&format!("js-{key}"), key, argv));
                }
            }
            let mut rest: Vec<_> = scripts.keys().map(String::as_str).collect();
            rest.sort_unstable();
            for key in rest {
                if preferred.contains(&key) {
                    continue;
                }
                let argv = vec![pm.to_string(), run_args[0].to_string(), key.to_string()];
                tasks.push(script_task(&format!("js-{key}"), key, argv));
            }
        }
        let hint = match pm {
            "bun" => "bun",
            _ => "node",
        };
        let stack = package_json_stack(&v, path);
        let mut tags = vec![self.id().into()];
        if v.get("workspaces").is_some() || path.join("pnpm-workspace.yaml").is_file() {
            tags.push("monorepo".into());
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack,
            runtime_hint: Some(hint.to_string()),
            tasks,
            tags,
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

/// Detects pnpm workspace roots that lack a `package.json` (or have one that
/// `PackageJsonDetector` rejects). Ensures `pnpm-workspace.yaml` drives
/// workspace discovery even when no root package manifest is present.
pub struct PnpmWorkspaceDetector;

impl ProjectDetector for PnpmWorkspaceDetector {
    fn id(&self) -> &'static str {
        "pnpm-workspace"
    }

    fn priority(&self) -> i32 {
        98 // Just below PackageJsonDetector (100)
    }

    fn markers(&self) -> &'static [&'static str] {
        &["pnpm-workspace.yaml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let ws = path.join("pnpm-workspace.yaml");
        if !ws.is_file() {
            return None;
        }
        // Only match when PackageJsonDetector did NOT already match.
        // If package.json exists, PackageJsonDetector (priority 100) already
        // handled this directory and merged in the monorepo tag.
        if path.join("package.json").is_file() {
            return None;
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "javascript".into(),
            runtime_hint: Some("pnpm".into()),
            tasks: Vec::new(),
            tags: vec![self.id().into(), "monorepo".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct GitDetector;

impl ProjectDetector for GitDetector {
    fn id(&self) -> &'static str {
        "git"
    }

    fn priority(&self) -> i32 {
        0
    }

    fn markers(&self) -> &'static [&'static str] {
        &[".git"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let git_dir = path.join(".git");
        if !git_dir.exists() {
            return None;
        }

        let mut owner = None;
        let mut repo = None;

        // Try to resolve github remote
        let config_path = if git_dir.is_dir() {
            Some(git_dir.join("config"))
        } else if git_dir.is_file() {
            // Handle git-worktree or submodules (gitdir: ...)
            read_utf8(&git_dir).and_then(|text| {
                text.lines().find_map(|l| {
                    l.trim().strip_prefix("gitdir: ").map(|rest| {
                        let p = Path::new(rest.trim());
                        if p.is_absolute() {
                            p.join("config")
                        } else {
                            path.join(p).join("config")
                        }
                    })
                })
            })
        } else {
            None
        };

        if let Some(cp) = config_path {
            if let Some(config) = read_utf8(&cp) {
                if let Some(url) = find_github_url(&config) {
                    if let Some((o, r)) = parse_github_owner_repo(&url) {
                        owner = Some(o);
                        repo = Some(r);
                    }
                }
            }
        }

        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "git".into(),
            runtime_hint: None,
            tasks: Vec::new(),
            tags: vec!["git".into()],
            github_owner: owner,
            github_repo: repo,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

fn find_github_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t == r#"[remote "origin"]"#;
            continue;
        }
        if in_origin {
            if let Some(rest) = t.strip_prefix("url = ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    None
}

fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let tail = if let Some(rest) = u.strip_prefix("git@github.com:") {
        Some(rest)
    } else if let Some(rest) = u.strip_prefix("ssh://git@github.com/") {
        Some(rest)
    } else {
        u.rfind("github.com/")
            .map(|idx| &u[idx + "github.com/".len()..])
    };

    let t = tail?.trim().trim_end_matches('/').trim_end_matches(".git");
    let (a, b) = t.split_once('/')?;
    if a.is_empty() || b.is_empty() {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

pub struct GoModDetector;

impl ProjectDetector for GoModDetector {
    fn id(&self) -> &'static str {
        "go.mod"
    }

    fn priority(&self) -> i32 {
        95
    }

    fn markers(&self) -> &'static [&'static str] {
        &["go.mod"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let g = path.join("go.mod");
        if !g.is_file() {
            return None;
        }
        let raw = read_utf8(&g)?;
        let mut module_name = None;
        let mut go_ver = None;
        for line in raw.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("module ") {
                module_name = Some(rest.trim().to_string());
            } else if let Some(rest) = t.strip_prefix("go ") {
                go_ver = Some(rest.trim().to_string());
            }
        }
        let name = module_name
            .as_deref()
            .and_then(|m| m.rsplit('/').next())
            .map(String::from)
            .unwrap_or_else(|| dirname_name(path));
        let mut tasks = vec![
            script_task(
                "go-build",
                "build",
                vec!["go".into(), "build".into(), "./...".into()],
            ),
            script_task(
                "go-test",
                "test",
                vec!["go".into(), "test".into(), "./...".into()],
            ),
        ];
        tasks.push(script_task(
            "go-mod-tidy",
            "mod tidy",
            vec!["go".into(), "mod".into(), "tidy".into()],
        ));
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "go".into(),
            runtime_hint: go_ver,
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct CargoTomlDetector;

impl ProjectDetector for CargoTomlDetector {
    fn id(&self) -> &'static str {
        "Cargo.toml"
    }

    fn priority(&self) -> i32 {
        90
    }

    fn markers(&self) -> &'static [&'static str] {
        &["Cargo.toml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let c = path.join("Cargo.toml");
        if !c.is_file() {
            return None;
        }
        let raw = read_utf8(&c)?;
        let t: toml::Value = toml::from_str(&raw).ok()?;
        let pkg_name = t
            .get("package")
            .and_then(|p| p.get("name"))
            .and_then(|n| n.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let name = pkg_name
            .map(String::from)
            .unwrap_or_else(|| dirname_name(path));
        if pkg_name.is_none() {
            if t.get("workspace").is_none() {
                return None;
            }
        }
        let tasks = vec![
            script_task("cargo-build", "build", vec!["cargo".into(), "build".into()]),
            script_task("cargo-test", "test", vec!["cargo".into(), "test".into()]),
            script_task("cargo-run", "run", vec!["cargo".into(), "run".into()]),
        ];
        let mut tags = vec![self.id().into()];
        if t.get("workspace").is_some() {
            tags.push("monorepo".into());
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "rust".into(),
            runtime_hint: Some("cargo".into()),
            tasks,
            tags,
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct SolutionDetector;

impl ProjectDetector for SolutionDetector {
    fn id(&self) -> &'static str {
        "dotnet-sln"
    }

    fn priority(&self) -> i32 {
        78
    }

    fn markers(&self) -> &'static [&'static str] {
        &[".sln"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let rd = fs::read_dir(path).ok()?;
        let mut sln: Option<String> = None;
        for e in rd.flatten() {
            let n = e.file_name();
            let n = n.to_string_lossy();
            if n.ends_with(".sln") && e.path().is_file() {
                if let Some(hdr) = read_utf8(&e.path()) {
                    if hdr.contains("Microsoft Visual Studio Solution File") {
                        sln = Some(n.trim_end_matches(".sln").to_string());
                        break;
                    }
                }
            }
        }
        let name = sln?;
        let tasks = vec![
            script_task(
                "dotnet-build",
                "build",
                vec!["dotnet".into(), "build".into()],
            ),
            script_task("dotnet-test", "test", vec!["dotnet".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "dotnet".into(),
            runtime_hint: Some("dotnet".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct CsProjDetector;

impl ProjectDetector for CsProjDetector {
    fn id(&self) -> &'static str {
        "dotnet-csproj"
    }

    fn priority(&self) -> i32 {
        74
    }

    fn markers(&self) -> &'static [&'static str] {
        &[".csproj"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let rd = fs::read_dir(path).ok()?;
        let mut csproj: Option<String> = None;
        for e in rd.flatten() {
            let n = e.file_name();
            let n = n.to_string_lossy();
            if n.ends_with(".csproj") && e.path().is_file() {
                if read_utf8(&e.path()).map(|s| s.to_lowercase().contains("<project")) == Some(true)
                {
                    csproj = Some(n.trim_end_matches(".csproj").to_string());
                    break;
                }
            }
        }
        let name = csproj?;
        let tasks = vec![
            script_task(
                "dotnet-build",
                "build",
                vec!["dotnet".into(), "build".into()],
            ),
            script_task("dotnet-test", "test", vec!["dotnet".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "dotnet".into(),
            runtime_hint: Some("dotnet".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct DenoDetector;

impl ProjectDetector for DenoDetector {
    fn id(&self) -> &'static str {
        "deno.json"
    }

    fn priority(&self) -> i32 {
        99
    }

    fn markers(&self) -> &'static [&'static str] {
        &["deno.json"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let mut tasks = vec![
            script_task(
                "deno-run",
                "run",
                vec!["deno".into(), "run".into(), "-A".into(), "main.ts".into()],
            ),
            script_task(
                "deno-test",
                "test",
                vec!["deno".into(), "test".into(), "-A".into()],
            ),
        ];
        let deno_json = path.join("deno.json");
        if !deno_json.is_file() {
            return None;
        }
        let raw = read_utf8(&deno_json)?;
        let v: JsonValue = serde_json::from_str(&raw).ok()?;
        if !v.is_object() {
            return None;
        }
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dirname_name(path));
        if let Some(scripts) = v.get("tasks").and_then(|s| s.as_object()) {
            for (k, _) in scripts.iter() {
                tasks.push(script_task(
                    &format!("deno-task-{k}"),
                    k,
                    vec!["deno".into(), "task".into(), k.clone()],
                ));
            }
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "deno".into(),
            runtime_hint: Some("deno".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct ComposerDetector;

impl ProjectDetector for ComposerDetector {
    fn id(&self) -> &'static str {
        "composer.json"
    }

    fn priority(&self) -> i32 {
        88
    }

    fn markers(&self) -> &'static [&'static str] {
        &["composer.json"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let c = path.join("composer.json");
        if !c.is_file() {
            return None;
        }
        let raw = read_utf8(&c)?;
        let v: JsonValue = serde_json::from_str(&raw).ok()?;
        let Some(o) = v.as_object() else {
            return None;
        };
        let has_body = o.contains_key("name")
            || o.contains_key("require")
            || o.contains_key("require-dev")
            || o.contains_key("autoload")
            || o.contains_key("repositories")
            || o.contains_key("type")
            || o.contains_key("config");
        if !has_body {
            return None;
        }
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dirname_name(path));
        let tasks = vec![
            script_task(
                "composer-install",
                "install",
                vec!["composer".into(), "install".into()],
            ),
            script_task(
                "composer-test",
                "test",
                vec!["composer".into(), "test".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "php".into(),
            runtime_hint: Some("composer".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct GemfileDetector;

impl ProjectDetector for GemfileDetector {
    fn id(&self) -> &'static str {
        "Gemfile"
    }

    fn priority(&self) -> i32 {
        86
    }

    fn markers(&self) -> &'static [&'static str] {
        &["Gemfile"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let gf = path.join("Gemfile");
        if !gf.is_file() {
            return None;
        }
        let raw = read_utf8(&gf)?;
        if !raw.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("gem ") || t.starts_with("source ")
        }) {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "bundle-install",
                "bundle install",
                vec!["bundle".into(), "install".into()],
            ),
            script_task(
                "rake-test",
                "rake test",
                vec!["bundle".into(), "exec".into(), "rake".into(), "test".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "ruby".into(),
            runtime_hint: Some("bundle".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct MixExsDetector;

impl ProjectDetector for MixExsDetector {
    fn id(&self) -> &'static str {
        "mix.exs"
    }

    fn priority(&self) -> i32 {
        85
    }

    fn markers(&self) -> &'static [&'static str] {
        &["mix.exs"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let mx = path.join("mix.exs");
        if !mx.is_file() {
            return None;
        }
        let raw = read_utf8(&mx)?;
        if !raw.contains("Mix.Project") && !raw.contains("def project") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "mix-deps",
                "deps.get",
                vec!["mix".into(), "deps.get".into()],
            ),
            script_task("mix-test", "test", vec!["mix".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "elixir".into(),
            runtime_hint: Some("mix".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct GradleDetector;

impl ProjectDetector for GradleDetector {
    fn id(&self) -> &'static str {
        "gradle"
    }

    fn priority(&self) -> i32 {
        82
    }

    fn markers(&self) -> &'static [&'static str] {
        &["build.gradle", "build.gradle.kts"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let a = path.join("build.gradle");
        let b = path.join("build.gradle.kts");
        let raw = if a.is_file() {
            read_utf8(&a)?
        } else if b.is_file() {
            read_utf8(&b)?
        } else {
            return None;
        };
        let lower = raw.to_lowercase();
        if raw.trim().len() < 8 {
            return None;
        }
        if !lower.contains("plugins")
            && !lower.contains("apply(")
            && !lower.contains("dependencies")
            && !lower.contains("android")
            && !lower.contains("java")
            && !lower.contains("kotlin")
            && !lower.contains("task ")
            && !lower.contains("rootproject")
        {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "gradle-build",
                "build",
                vec!["gradle".into(), "build".into()],
            ),
            script_task("gradle-test", "test", vec!["gradle".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "kotlin".into(),
            runtime_hint: Some("gradle".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct MavenDetector;

impl ProjectDetector for MavenDetector {
    fn id(&self) -> &'static str {
        "pom.xml"
    }

    fn priority(&self) -> i32 {
        81
    }

    fn markers(&self) -> &'static [&'static str] {
        &["pom.xml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let pom = path.join("pom.xml");
        if !pom.is_file() {
            return None;
        }
        let raw = read_utf8(&pom)?;
        if !raw.contains("<project") || !raw.contains("artifactId") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "mvn-package",
                "package",
                vec!["mvn".into(), "-q".into(), "package".into()],
            ),
            script_task(
                "mvn-test",
                "test",
                vec!["mvn".into(), "-q".into(), "test".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "java".into(),
            runtime_hint: Some("mvn".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct SwiftPackageDetector;

impl ProjectDetector for SwiftPackageDetector {
    fn id(&self) -> &'static str {
        "Package.swift"
    }

    fn priority(&self) -> i32 {
        80
    }

    fn markers(&self) -> &'static [&'static str] {
        &["Package.swift"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let sp = path.join("Package.swift");
        if !sp.is_file() {
            return None;
        }
        let raw = read_utf8(&sp)?;
        if !raw.contains("Package(") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task("swift-build", "build", vec!["swift".into(), "build".into()]),
            script_task("swift-test", "test", vec!["swift".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "swift".into(),
            runtime_hint: Some("swift".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct CMakeDetector;

impl ProjectDetector for CMakeDetector {
    fn id(&self) -> &'static str {
        "CMakeLists.txt"
    }

    fn priority(&self) -> i32 {
        48
    }

    fn markers(&self) -> &'static [&'static str] {
        &["CMakeLists.txt"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let cm = path.join("CMakeLists.txt");
        if !cm.is_file() {
            return None;
        }
        let raw = read_utf8(&cm)?;
        if !raw.to_lowercase().contains("project(") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "cmake-config",
                "configure",
                vec!["cmake".into(), "-B".into(), "build".into(), ".".into()],
            ),
            script_task(
                "cmake-build",
                "build",
                vec!["cmake".into(), "--build".into(), "build".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "cpp".into(),
            runtime_hint: Some("cmake".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct GoWorkDetector;

impl ProjectDetector for GoWorkDetector {
    fn id(&self) -> &'static str {
        "go.work"
    }

    fn priority(&self) -> i32 {
        96
    }

    fn markers(&self) -> &'static [&'static str] {
        &["go.work"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let gw = path.join("go.work");
        if !gw.is_file() {
            return None;
        }
        let raw = read_utf8(&gw)?;
        if !raw.lines().any(|l| {
            let t = l.trim();
            let mut it = t.split_ascii_whitespace();
            it.next() == Some("go") && it.next().is_some()
        }) {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "go-work-build",
                "build",
                vec!["go".into(), "build".into(), "./...".into()],
            ),
            script_task(
                "go-work-test",
                "test",
                vec!["go".into(), "test".into(), "./...".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "go".into(),
            runtime_hint: Some("go".into()),
            tasks,
            tags: vec![self.id().into(), "monorepo".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

pub struct PythonDetector;

impl ProjectDetector for PythonDetector {
    fn id(&self) -> &'static str {
        "python"
    }

    fn priority(&self) -> i32 {
        70
    }

    fn markers(&self) -> &'static [&'static str] {
        &["pyproject.toml", "requirements.txt", "Pipfile"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let py = path.join("pyproject.toml");
        let req = path.join("requirements.txt");
        let pip = path.join("Pipfile");
        let marker = if py.is_file() {
            "pyproject.toml"
        } else if req.is_file() {
            let sample = read_utf8(&req)?;
            if !requirements_txt_has_package_line(&sample) {
                return None;
            }
            "requirements.txt"
        } else if pip.is_file() {
            let sample = read_utf8(&pip)?;
            if !sample.contains("[packages]")
                && !sample.contains("[[source]]")
                && !sample.contains("[dev-packages]")
                && !sample.contains("python_version")
            {
                return None;
            }
            "Pipfile"
        } else {
            return None;
        };
        let mut name = dirname_name(path);
        let mut hint = Some("python3".into());
        if py.is_file() {
            let raw = read_utf8(&py)?;
            let t: toml::Value = toml::from_str(&raw).ok()?;
            let has_project = t.get("project").is_some();
            let has_poetry = t.get("tool").and_then(|x| x.get("poetry")).is_some();
            let has_tool_other = t.get("tool").is_some() && !has_poetry;
            let has_build = t.get("build-system").is_some();
            if !has_project && !has_poetry && !has_tool_other && !has_build {
                return None;
            }
            if has_project {
                if let Some(n) = t
                    .get("project")
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                {
                    name = n.to_string();
                } else if !has_poetry {
                    let p = t.get("project");
                    let ok = p.and_then(|x| x.get("dependencies")).is_some()
                        || p.and_then(|x| x.get("optional-dependencies")).is_some()
                        || p.and_then(|x| x.get("dynamic")).is_some()
                        || p.and_then(|x| x.get("readme")).is_some();
                    if !ok {
                        return None;
                    }
                }
            }
            if let Some(req) = t
                .get("project")
                .and_then(|p| p.get("requires-python"))
                .and_then(|r| r.as_str())
            {
                hint = Some(req.to_string());
            }
        }
        let mut tasks = vec![script_task(
            "py-install",
            "install deps",
            vec![
                "python".into(),
                "-m".into(),
                "pip".into(),
                "install".into(),
                ".".into(),
            ],
        )];
        if req.is_file() {
            tasks.push(script_task(
                "py-pip-req",
                "pip install -r",
                vec![
                    "python".into(),
                    "-m".into(),
                    "pip".into(),
                    "install".into(),
                    "-r".into(),
                    "requirements.txt".into(),
                ],
            ));
        }
        if pip.is_file() {
            tasks.push(script_task(
                "py-pipenv",
                "pipenv install",
                vec!["pipenv".into(), "install".into()],
            ));
        }
        tasks.push(script_task(
            "py-pytest",
            "pytest",
            vec!["python".into(), "-m".into(), "pytest".into()],
        ));
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "python".into(),
            runtime_hint: hint,
            tasks,
            tags: vec![self.id().into(), marker.into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
