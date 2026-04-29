#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::error::{codes, StableError};
use crate::models::IdeCandidateDto;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn dedup_key(path: &Path) -> String {
    dunce::canonicalize(path)
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_else(|_| path.to_string_lossy().to_lowercase())
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            return matches!(ext_lower.as_str(), "exe" | "cmd" | "bat");
        }
        return false;
    }
    #[cfg(not(windows))]
    {
        true
    }
}

fn push_candidate(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
    id: &str,
    label: &str,
    path: PathBuf,
) {
    if !is_executable_file(&path) {
        return;
    }
    if seen_ids.contains(id) {
        return;
    }
    let key = dedup_key(&path);
    if !seen_paths.insert(key) {
        return;
    }
    seen_ids.insert(id.to_string());

    // For now we map IDs to standard Iconify icons instead of raw binary extraction
    // which is heavy. The frontend can use these to render the correct icon.
    let icon = match id {
        "vscode" | "vscode-insiders" => Some("mdi--visual-studio-code".to_string()),
        "cursor" => Some("mdi--target".to_string()),
        "windsurf" => Some("mdi--surfing".to_string()),
        "intellij" => Some("mdi--language-java".to_string()),
        "webstorm" => Some("mdi--language-javascript".to_string()),
        "pycharm" => Some("mdi--language-python".to_string()),
        "rustrover" => Some("mdi--language-rust".to_string()),
        "goland" => Some("mdi--language-go".to_string()),
        "phpstorm" => Some("mdi--language-php".to_string()),
        "rider" => Some("mdi--language-cpp".to_string()),
        "sublime" => Some("mdi--text-box-outline".to_string()),
        "zed" => Some("mdi--alpha-z-box".to_string()),
        "android-studio" => Some("mdi--android-debug-bridge".to_string()),
        _ if id.starts_with("vs-20") => Some("mdi--visual-studio".to_string()),
        _ => Some("mdi--application-edit-outline".to_string()),
    };

    out.push(IdeCandidateDto {
        id: id.to_string(),
        label: label.to_string(),
        executable: path.to_string_lossy().to_string(),
        icon,
    });
}

#[cfg(windows)]
fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        // Prefer .exe first, then scripts, then bare name (to avoid picking up non-executables)
        for ext in [".exe", ".cmd", ".bat", ""] {
            let p = dir.join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn jetbrains_exe_label(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "idea64.exe" | "idea" => Some(("intellij", "IntelliJ IDEA")),
        "webstorm64.exe" | "webstorm" => Some(("webstorm", "WebStorm")),
        "pycharm64.exe" | "pycharm" => Some(("pycharm", "PyCharm")),
        "rustrover64.exe" | "rustrover" => Some(("rustrover", "RustRover")),
        "goland64.exe" | "goland" => Some(("goland", "GoLand")),
        "clion64.exe" | "clion" => Some(("clion", "CLion")),
        "phpstorm64.exe" | "phpstorm" => Some(("phpstorm", "PhpStorm")),
        "rider64.exe" | "rider" => Some(("rider", "Rider")),
        "studio64.exe" | "studio" | "studio.exe" => Some(("android-studio", "Android Studio")),
        _ => None,
    }
}

fn walk_jetbrains_install_roots(
    roots: &[PathBuf],
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(root) else {
            continue;
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_dir() {
                walk_jetbrains_bins(&p, 0, out, seen_paths, seen_ids);
            }
        }
    }
}

fn walk_jetbrains_bins(
    dir: &Path,
    depth: u8,
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    if depth > 12 {
        return;
    }
    let name_os = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name_os.eq_ignore_ascii_case("bin") {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if let Some(fname) = p.file_name().and_then(|n| n.to_str()) {
                if let Some((id, label)) = jetbrains_exe_label(fname) {
                    push_candidate(out, seen_paths, seen_ids, id, label, p);
                }
            }
        }
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_dir() {
            walk_jetbrains_bins(&p, depth + 1, out, seen_paths, seen_ids);
        }
    }
}

#[cfg(windows)]
fn discover_platform(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let pf = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let pf86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);

    if let Some(ref base) = local {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode",
            "Visual Studio Code",
            base.join("Programs/Microsoft VS Code/Code.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode-insiders",
            "Visual Studio Code Insiders",
            base.join("Programs/Microsoft VS Code Insiders/Code - Insiders.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "cursor",
            "Cursor",
            base.join("Programs/cursor/Cursor.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "windsurf",
            "Windsurf",
            base.join("Programs/Windsurf/Windsurf.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "zed",
            "Zed",
            base.join("Zed/bin/zed.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            base.join("Google/Antigravity/Antigravity.exe"),
        );
        walk_jetbrains_install_roots(
            &[base.join("JetBrains/Toolbox/apps")],
            out,
            seen_paths,
            seen_ids,
        );
    }
    if let Some(ref base) = pf {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode",
            "Visual Studio Code",
            base.join("Microsoft VS Code/Code.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "sublime",
            "Sublime Text",
            base.join("Sublime Text/sublime_text.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            base.join("Google/Antigravity/Antigravity.exe"),
        );
        for (edition, id, label) in [
            (
                "Community",
                "vs-2022-community",
                "Visual Studio 2022 (Community)",
            ),
            (
                "Professional",
                "vs-2022-pro",
                "Visual Studio 2022 (Professional)",
            ),
            (
                "Enterprise",
                "vs-2022-enterprise",
                "Visual Studio 2022 (Enterprise)",
            ),
            ("Preview", "vs-2022-preview", "Visual Studio 2022 (Preview)"),
            (
                "BuildTools",
                "vs-2022-buildtools",
                "Visual Studio 2022 (Build Tools)",
            ),
        ] {
            let p = base
                .join("Microsoft Visual Studio")
                .join("2022")
                .join(edition)
                .join("Common7")
                .join("IDE")
                .join("devenv.exe");
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
        for (edition, id, label) in [
            (
                "Community",
                "vs-2019-community",
                "Visual Studio 2019 (Community)",
            ),
            (
                "Professional",
                "vs-2019-pro",
                "Visual Studio 2019 (Professional)",
            ),
            (
                "Enterprise",
                "vs-2019-enterprise",
                "Visual Studio 2019 (Enterprise)",
            ),
        ] {
            let p = base
                .join("Microsoft Visual Studio")
                .join("2019")
                .join(edition)
                .join("Common7")
                .join("IDE")
                .join("devenv.exe");
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }
    if let Some(ref base) = pf86 {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode",
            "Visual Studio Code",
            base.join("Microsoft VS Code/Code.exe"),
        );
    }

    for (name, id, label) in [
        ("code", "vscode", "Visual Studio Code"),
        (
            "code-insiders",
            "vscode-insiders",
            "Visual Studio Code Insiders",
        ),
        ("cursor", "cursor", "Cursor"),
        ("windsurf", "windsurf", "Windsurf"),
        ("zed", "zed", "Zed"),
        ("antigravity", "antigravity", "Google Antigravity"),
    ] {
        if let Some(p) = path_dirs_lookup(name) {
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }
}

#[cfg(target_os = "macos")]
fn discover_platform(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let apps = Path::new("/Applications");
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vscode",
        "Visual Studio Code",
        apps.join("Visual Studio Code.app/Contents/Resources/app/bin/code"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vscode-insiders",
        "Visual Studio Code Insiders",
        apps.join("Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "cursor",
        "Cursor",
        apps.join("Cursor.app/Contents/Resources/app/bin/cursor"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "windsurf",
        "Windsurf",
        apps.join("Windsurf.app/Contents/Resources/app/bin/windsurf"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "zed",
        "Zed",
        apps.join("Zed.app/Contents/MacOS/zed"),
    );
    for rel in [
        "Antigravity.app/Contents/Resources/app/bin/antigravity",
        "Antigravity.app/Contents/MacOS/Antigravity",
    ] {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            apps.join(rel),
        );
    }
    for (id, label, rel) in [
        (
            "intellij",
            "IntelliJ IDEA",
            "IntelliJ IDEA.app/Contents/MacOS/idea",
        ),
        (
            "webstorm",
            "WebStorm",
            "WebStorm.app/Contents/MacOS/webstorm",
        ),
        ("pycharm", "PyCharm", "PyCharm.app/Contents/MacOS/pycharm"),
        (
            "rustrover",
            "RustRover",
            "RustRover.app/Contents/MacOS/rustrover",
        ),
        ("goland", "GoLand", "GoLand.app/Contents/MacOS/goland"),
        ("clion", "CLion", "CLion.app/Contents/MacOS/clion"),
        (
            "phpstorm",
            "PhpStorm",
            "PhpStorm.app/Contents/MacOS/phpstorm",
        ),
        ("rider", "Rider", "Rider.app/Contents/MacOS/rider"),
        (
            "android-studio",
            "Android Studio",
            "Android Studio.app/Contents/MacOS/studio",
        ),
    ] {
        push_candidate(out, seen_paths, seen_ids, id, label, apps.join(rel));
    }

    for (name, id, label) in [
        ("code", "vscode", "Visual Studio Code"),
        (
            "code-insiders",
            "vscode-insiders",
            "Visual Studio Code Insiders",
        ),
        ("cursor", "cursor", "Cursor"),
        ("windsurf", "windsurf", "Windsurf"),
        ("zed", "zed", "Zed"),
        ("antigravity", "antigravity", "Google Antigravity"),
    ] {
        if let Some(p) = path_dirs_lookup(name) {
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let home_path = PathBuf::from(home);
        walk_jetbrains_install_roots(
            &[home_path.join("Library/Application Support/JetBrains/Toolbox/apps")],
            out,
            seen_paths,
            seen_ids,
        );
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn discover_platform(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vscode",
        "Visual Studio Code",
        PathBuf::from("/usr/share/code/bin/code"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vscode",
        "Visual Studio Code",
        PathBuf::from("/usr/lib/code/code"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vscode",
        "Visual Studio Code",
        PathBuf::from("/opt/visual-studio-code/bin/code"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "cursor",
        "Cursor",
        PathBuf::from("/usr/share/cursor/bin/cursor"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "zed",
        "Zed",
        PathBuf::from("/usr/bin/zed"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "zed",
        "Zed",
        PathBuf::from("/usr/local/bin/zed"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "sublime",
        "Sublime Text",
        PathBuf::from("/opt/sublime_text/sublime_text"),
    );
    for p in [
        "/opt/Antigravity/antigravity",
        "/usr/lib/antigravity/antigravity",
    ] {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            PathBuf::from(p),
        );
    }

    if let Ok(home) = std::env::var("HOME") {
        let h = PathBuf::from(home);
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "cursor",
            "Cursor",
            h.join(".local/bin/cursor"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "zed",
            "Zed",
            h.join(".local/bin/zed"),
        );
        walk_jetbrains_install_roots(
            &[h.join(".local/share/JetBrains/Toolbox/apps")],
            out,
            seen_paths,
            seen_ids,
        );
    }

    for (name, id, label) in [
        ("code", "vscode", "Visual Studio Code"),
        (
            "code-insiders",
            "vscode-insiders",
            "Visual Studio Code Insiders",
        ),
        ("cursor", "cursor", "Cursor"),
        ("windsurf", "windsurf", "Windsurf"),
        ("zed", "zed", "Zed"),
        ("subl", "sublime", "Sublime Text"),
        ("antigravity", "antigravity", "Google Antigravity"),
    ] {
        if let Some(p) = path_dirs_lookup(name) {
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }
}

pub fn discover_ides() -> Vec<IdeCandidateDto> {
    let mut out = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut seen_ids = HashSet::new();
    discover_platform(&mut out, &mut seen_paths, &mut seen_ids);
    out.sort_by(|a, b| {
        a.label
            .to_lowercase()
            .cmp(&b.label.to_lowercase())
            .then_with(|| a.executable.cmp(&b.executable))
    });
    out
}

pub fn launch_ide(executable: &str, project_dir: &Path) -> Result<std::process::Child, StableError> {
    let exe = executable.trim();
    if exe.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "executable empty"));
    }
    if !project_dir.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project not a directory",
        ));
    }

    let mut c = if cfg!(windows) && (exe.ends_with(".cmd") || exe.ends_with(".bat")) {
        let mut cmd = Command::new("cmd.exe");
        cmd.arg("/C");
        cmd.arg(exe);
        cmd
    } else {
        Command::new(exe)
    };

    c.arg(project_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);

    let child = c.spawn()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    Ok(child)
}
