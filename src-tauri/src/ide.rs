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

// ============================================================================
// Core utilities
// ============================================================================

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

fn icon_for_id(id: &str) -> Option<String> {
    Some(
        match id {
            "vscode" | "vscode-insiders" | "vscode-oss" | "vscodium" => {
                "mdi--visual-studio-code"
            }
            "cursor" => "mdi--target",
            "windsurf" => "mdi--surfing",
            "trae" => "mdi--robot",
            "fleet" => "mdi--jet",
            "intellij" => "mdi--language-java",
            "webstorm" => "mdi--language-javascript",
            "pycharm" => "mdi--language-python",
            "rustrover" => "mdi--language-rust",
            "goland" => "mdi--language-go",
            "clion" => "mdi--language-cpp",
            "phpstorm" => "mdi--language-php",
            "rider" => "mdi--language-cpp",
            "sublime" => "mdi--text-box-outline",
            "zed" => "mdi--alpha-z-box",
            "lapce" => "mdi--lightning-bolt",
            "helix" => "mdi--hexagon",
            "android-studio" => "mdi--android-debug-bridge",
            "notepad-plus-plus" => "mdi--note-edit",
            "eclipse" => "mdi--eclipse",
            "netbeans" => "mdi--netbeans",
            "atom" => "mdi--atom",
            "brackets" => "mdi--code-brackets",
            "vim" | "neovim" => "mdi--vi",
            "emacs" => "mdi--gnu",
            "kate" => "mdi--text",
            "geany" => "mdi--code",
            "nova" => "mdi--star",
            "textmate" => "mdi--text-box",
            "bbedit" => "mdi--text-box",
            "coteditor" => "mdi--text-box",
            "codeblocks" => "mdi--application-code",
            "arduino" => "mdi--arduino",
            "rstudio" => "mdi--language-r",
            "jupyterlab" => "mdi--notebook",
            "spyder" => "mdi--spider",
            "thonny" => "mdi--snake",
            "bluej" => "mdi--coffee",
            "greenfoot" => "mdi--foot-print",
            "processing" => "mdi--code",
            "positron" => "mdi--atom",
            "micro" => "mdi--microphone",
            "scite" => "mdi--text-box",
            "drracket" => "mdi--code",
            _ if id.starts_with("vs-20") => "mdi--visual-studio",
            _ => "mdi--application-edit-outline",
        }
        .to_string(),
    )
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

    out.push(IdeCandidateDto {
        id: id.to_string(),
        label: label.to_string(),
        executable: path.to_string_lossy().to_string(),
        icon: icon_for_id(id),
    });
}

// ============================================================================
// PATH lookup
// ============================================================================

#[cfg(windows)]
fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
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

// ============================================================================
// Known IDE executable names (used by fallback scanners)
// ============================================================================

#[cfg(windows)]
static KNOWN_WINDOWS_EXE_PATTERNS: &[(&str, &str, &[&str])] = &[
    ("vscode", "Visual Studio Code", &["Code.exe"]),
    (
        "vscode-insiders",
        "Visual Studio Code Insiders",
        &["Code - Insiders.exe"],
    ),
    ("vscodium", "VSCodium", &["VSCodium.exe"]),
    ("cursor", "Cursor", &["Cursor.exe"]),
    ("windsurf", "Windsurf", &["Windsurf.exe"]),
    ("trae", "Trae", &["Trae.exe"]),
    ("zed", "Zed", &["zed.exe", "Zed.exe"]),
    (
        "antigravity",
        "Google Antigravity",
        &["Antigravity.exe", "antigravity.exe"],
    ),
    (
        "sublime",
        "Sublime Text",
        &["sublime_text.exe", "Sublime Text.exe"],
    ),
    ("atom", "Atom", &["atom.exe"]),
    ("brackets", "Brackets", &["Brackets.exe"]),
    ("geany", "Geany", &["geany.exe"]),
    ("notepad-plus-plus", "Notepad++", &["notepad++.exe"]),
    ("lapce", "Lapce", &["lapce.exe"]),
    ("intellij", "IntelliJ IDEA", &["idea64.exe"]),
    ("webstorm", "WebStorm", &["webstorm64.exe"]),
    ("pycharm", "PyCharm", &["pycharm64.exe"]),
    ("rustrover", "RustRover", &["rustrover64.exe"]),
    ("goland", "GoLand", &["goland64.exe"]),
    ("clion", "CLion", &["clion64.exe"]),
    ("phpstorm", "PhpStorm", &["phpstorm64.exe"]),
    ("rider", "Rider", &["rider64.exe"]),
    (
        "android-studio",
        "Android Studio",
        &["studio64.exe", "studio.exe"],
    ),
    ("fleet", "Fleet", &["fleet.exe"]),
    ("rstudio", "RStudio", &["rstudio.exe"]),
    ("spyder", "Spyder", &["spyder.exe"]),
    ("bluej", "BlueJ", &["bluej.exe"]),
    ("arduino", "Arduino IDE", &["arduino.exe"]),
    ("codeblocks", "Code::Blocks", &["codeblocks.exe"]),
    ("eclipse", "Eclipse", &["eclipse.exe"]),
    ("netbeans", "NetBeans", &["netbeans.exe", "netbeans64.exe"]),
];

#[cfg(not(windows))]
static KNOWN_UNIX_EXE_NAMES: &[(&str, &str, &[&str])] = &[
    ("vscode", "Visual Studio Code", &["code"]),
    (
        "vscode-insiders",
        "Visual Studio Code Insiders",
        &["code-insiders"],
    ),
    ("vscodium", "VSCodium", &["codium"]),
    ("cursor", "Cursor", &["cursor"]),
    ("windsurf", "Windsurf", &["windsurf"]),
    ("trae", "Trae", &["trae"]),
    ("zed", "Zed", &["zed"]),
    ("sublime", "Sublime Text", &["subl", "sublime_text"]),
    ("lapce", "Lapce", &["lapce"]),
    ("vim", "Vim", &["vim"]),
    ("neovim", "Neovim", &["nvim"]),
    ("helix", "Helix", &["hx"]),
    ("emacs", "Emacs", &["emacs"]),
    ("geany", "Geany", &["geany"]),
    ("kate", "Kate", &["kate"]),
    ("rstudio", "RStudio", &["rstudio"]),
    ("spyder", "Spyder", &["spyder"]),
    ("bluej", "BlueJ", &["bluej"]),
    ("antigravity", "Google Antigravity", &["antigravity"]),
];

// ============================================================================
// JetBrains discovery
// ============================================================================

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
        "fleet" => Some(("fleet", "Fleet")),
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

// ============================================================================
// Generic shallow directory scanner
// ============================================================================

fn scan_install_roots(
    roots: &[PathBuf],
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
    checks: &[(&str, &str, &[&str], &[&str])],
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
            if !p.is_dir() {
                continue;
            }
            let dir_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let dir_lower = dir_name.to_lowercase();

            for (id, label, dir_patterns, exe_names) in checks {
                if seen_ids.contains(*id) {
                    continue;
                }

                let matched = dir_patterns.iter().any(|pat| {
                    if pat.starts_with('*') && pat.ends_with('*') {
                        dir_lower.contains(&pat[1..pat.len() - 1])
                    } else if pat.ends_with('*') {
                        dir_lower.starts_with(&pat[..pat.len() - 1])
                    } else if pat.starts_with('*') {
                        dir_lower.ends_with(&pat[1..])
                    } else {
                        dir_lower == *pat
                    }
                });

                if matched {
                    for exe in *exe_names {
                        let exe_path = p.join(exe);
                        if exe_path.is_file() {
                            push_candidate(out, seen_paths, seen_ids, id, label, exe_path);
                            break;
                        }
                    }
                    if !seen_ids.contains(*id) {
                        for exe in *exe_names {
                            let bin_path = p.join("bin").join(exe);
                            if bin_path.is_file() {
                                push_candidate(out, seen_paths, seen_ids, id, label, bin_path);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// Windows primary discovery
// ============================================================================

#[cfg(windows)]
fn discover_platform(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let pf = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let pf86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);

    // -- Hardcoded paths for popular IDEs --
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
            "zed",
            "Zed",
            base.join("Zed/zed.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "zed",
            "Zed",
            base.join("Programs/Zed/bin/zed.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "zed",
            "Zed",
            base.join("Programs/Zed/zed.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            base.join("Google/Antigravity/Antigravity.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            base.join("Programs/Google/Antigravity/Antigravity.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            base.join("Antigravity/Antigravity.exe"),
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
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "notepad-plus-plus",
            "Notepad++",
            base.join("Notepad++/notepad++.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "geany",
            "Geany",
            base.join("Geany/bin/geany.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "atom",
            "Atom",
            base.join("Atom/atom.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "brackets",
            "Brackets",
            base.join("Brackets/Brackets.exe"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "rstudio",
            "RStudio",
            base.join("RStudio/bin/rstudio.exe"),
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
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "notepad-plus-plus",
            "Notepad++",
            base.join("Notepad++/notepad++.exe"),
        );
    }

    // -- PATH lookups --
    for (name, id, label) in [
        ("code", "vscode", "Visual Studio Code"),
        (
            "code-insiders",
            "vscode-insiders",
            "Visual Studio Code Insiders",
        ),
        ("codium", "vscodium", "VSCodium"),
        ("cursor", "cursor", "Cursor"),
        ("windsurf", "windsurf", "Windsurf"),
        ("zed", "zed", "Zed"),
        ("subl", "sublime", "Sublime Text"),
        ("sublime_text", "sublime", "Sublime Text"),
        ("notepad++", "notepad-plus-plus", "Notepad++"),
        ("atom", "atom", "Atom"),
        ("brackets", "brackets", "Brackets"),
        ("geany", "geany", "Geany"),
        ("lapce", "lapce", "Lapce"),
        ("helix", "helix", "Helix"),
        ("hx", "helix", "Helix"),
        ("nvim-qt", "neovim", "Neovim"),
        ("gvim", "vim", "Vim"),
        ("emacs", "emacs", "Emacs"),
        ("rstudio", "rstudio", "RStudio"),
        ("spyder", "spyder", "Spyder"),
        ("bluej", "bluej", "BlueJ"),
        ("antigravity", "antigravity", "Google Antigravity"),
    ] {
        if let Some(p) = path_dirs_lookup(name) {
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }

    // -- Generic install root scanner --
    let scan_roots: Vec<PathBuf> = [local.as_ref().map(|p| p.join("Programs")), pf, pf86]
        .into_iter()
        .flatten()
        .collect();

    let checks = [
        (
            "vscode",
            "Visual Studio Code",
            &["vs code*", "vscode*"][..],
            &["Code.exe", "code.exe"][..],
        ),
        (
            "vscode-insiders",
            "Visual Studio Code Insiders",
            &["vs code insiders*", "vscode-insiders*"],
            &["Code - Insiders.exe", "code-insiders.exe"],
        ),
        (
            "vscodium",
            "VSCodium",
            &["vscodium*"],
            &["VSCodium.exe", "vscodium.exe"],
        ),
        ("cursor", "Cursor", &["cursor"], &["Cursor.exe", "cursor.exe"]),
        ("windsurf", "Windsurf", &["windsurf"], &["Windsurf.exe", "windsurf.exe"]),
        ("zed", "Zed", &["zed"], &["zed.exe", "Zed.exe"]),
        (
            "sublime",
            "Sublime Text",
            &["sublime*"],
            &["sublime_text.exe", "Sublime Text.exe"],
        ),
        ("atom", "Atom", &["atom"], &["atom.exe"]),
        (
            "brackets",
            "Brackets",
            &["brackets"],
            &["Brackets.exe"],
        ),
        ("geany", "Geany", &["geany"], &["geany.exe"]),
        ("lapce", "Lapce", &["lapce"], &["lapce.exe"]),
        (
            "codeblocks",
            "Code::Blocks",
            &["codeblocks*"],
            &["codeblocks.exe"],
        ),
        (
            "arduino",
            "Arduino IDE",
            &["arduino*"],
            &["arduino.exe"],
        ),
        (
            "rstudio",
            "RStudio",
            &["rstudio*"],
            &["rstudio.exe"],
        ),
        (
            "spyder",
            "Spyder",
            &["spyder*"],
            &["spyder.exe"],
        ),
        (
            "bluej",
            "BlueJ",
            &["bluej*"],
            &["bluej.exe"],
        ),
        (
            "notepad-plus-plus",
            "Notepad++",
            &["notepad++*", "notepad plus*"],
            &["notepad++.exe"],
        ),
        (
            "antigravity",
            "Google Antigravity",
            &["antigravity", "google*antigravity*"],
            &["Antigravity.exe", "antigravity.exe"],
        ),
    ];

    scan_install_roots(&scan_roots, out, seen_paths, seen_ids, &checks);
}

// ============================================================================
// Windows registry fallback
// ============================================================================

#[cfg(windows)]
fn discover_platform_fallback(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let hives: &[(winreg::HKEY, &str)] = &[
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];

    for (hive, subpath) in hives {
        let Ok(root) = RegKey::predef(*hive).open_subkey(subpath) else {
            continue;
        };
        let Ok(keys) = root.enum_keys().collect::<Result<Vec<_>, _>>() else {
            continue;
        };
        for name in keys {
            let Ok(app_key) = root.open_subkey(&name) else {
                continue;
            };
            let install_loc: String = app_key.get_value("InstallLocation").unwrap_or_default();
            if install_loc.is_empty() {
                continue;
            }
            let loc = PathBuf::from(&install_loc);
            if !loc.is_dir() {
                continue;
            }

            // Search InstallLocation root and bin/ subdir for known IDE exes
            for (id, label, exes) in KNOWN_WINDOWS_EXE_PATTERNS {
                if seen_ids.contains(*id) {
                    continue;
                }
                for exe in *exes {
                    let p = loc.join(exe);
                    if p.is_file() {
                        push_candidate(out, seen_paths, seen_ids, id, label, p);
                        break;
                    }
                    let bin_p = loc.join("bin").join(exe);
                    if bin_p.is_file() {
                        push_candidate(out, seen_paths, seen_ids, id, label, bin_p);
                        break;
                    }
                }
            }
        }
    }
}

// ============================================================================
// macOS primary discovery
// ============================================================================

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
        "vscodium",
        "VSCodium",
        apps.join("VSCodium.app/Contents/Resources/app/bin/codium"),
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
        "trae",
        "Trae",
        apps.join("Trae.app/Contents/Resources/app/bin/trae"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "zed",
        "Zed",
        apps.join("Zed.app/Contents/MacOS/zed"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "lapce",
        "Lapce",
        apps.join("Lapce.app/Contents/MacOS/lapce"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "nova",
        "Nova",
        apps.join("Nova.app/Contents/MacOS/Nova"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "textmate",
        "TextMate",
        apps.join("TextMate.app/Contents/MacOS/TextMate"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "bbedit",
        "BBEdit",
        apps.join("BBEdit.app/Contents/MacOS/BBEdit"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "coteditor",
        "CotEditor",
        apps.join("CotEditor.app/Contents/MacOS/CotEditor"),
    );

    for rel in [
        "Antigravity.app/Contents/Resources/app/bin/antigravity",
        "Antigravity.app/Contents/MacOS/Antigravity",
        "Google Antigravity.app/Contents/Resources/app/bin/antigravity",
        "Google Antigravity.app/Contents/MacOS/Antigravity",
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
        ("intellij", "IntelliJ IDEA", "IntelliJ IDEA.app/Contents/MacOS/idea"),
        ("webstorm", "WebStorm", "WebStorm.app/Contents/MacOS/webstorm"),
        ("pycharm", "PyCharm", "PyCharm.app/Contents/MacOS/pycharm"),
        (
            "rustrover",
            "RustRover",
            "RustRover.app/Contents/MacOS/rustrover",
        ),
        ("goland", "GoLand", "GoLand.app/Contents/MacOS/goland"),
        ("clion", "CLion", "CLion.app/Contents/MacOS/clion"),
        ("phpstorm", "PhpStorm", "PhpStorm.app/Contents/MacOS/phpstorm"),
        ("rider", "Rider", "Rider.app/Contents/MacOS/rider"),
        (
            "android-studio",
            "Android Studio",
            "Android Studio.app/Contents/MacOS/studio",
        ),
        ("fleet", "Fleet", "Fleet.app/Contents/MacOS/fleet"),
    ] {
        push_candidate(out, seen_paths, seen_ids, id, label, apps.join(rel));
    }

    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "sublime",
        "Sublime Text",
        apps.join("Sublime Text.app/Contents/MacOS/Sublime Text"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "sublime",
        "Sublime Text",
        apps.join("Sublime Text 3.app/Contents/MacOS/Sublime Text"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "sublime",
        "Sublime Text",
        apps.join("Sublime Text 4.app/Contents/MacOS/Sublime Text"),
    );

    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "emacs",
        "Emacs",
        apps.join("Emacs.app/Contents/MacOS/Emacs"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "emacs",
        "Emacs",
        apps.join("Aquamacs.app/Contents/MacOS/Aquamacs"),
    );

    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vim",
        "MacVim",
        apps.join("MacVim.app/Contents/MacOS/MacVim"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "neovim",
        "VimR",
        apps.join("VimR.app/Contents/MacOS/VimR"),
    );

    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "rstudio",
        "RStudio",
        apps.join("RStudio.app/Contents/MacOS/RStudio"),
    );

    // -- ~/Applications mirror --
    if let Ok(home) = std::env::var("HOME") {
        let home_apps = PathBuf::from(home).join("Applications");
        if home_apps.is_dir() {
            let home_checks = [
                (
                    "vscode",
                    "Visual Studio Code",
                    "Visual Studio Code.app/Contents/Resources/app/bin/code",
                ),
                (
                    "vscode-insiders",
                    "Visual Studio Code Insiders",
                    "Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
                ),
                (
                    "cursor",
                    "Cursor",
                    "Cursor.app/Contents/Resources/app/bin/cursor",
                ),
                ("zed", "Zed", "Zed.app/Contents/MacOS/zed"),
                ("fleet", "Fleet", "Fleet.app/Contents/MacOS/fleet"),
                (
                    "sublime",
                    "Sublime Text",
                    "Sublime Text.app/Contents/MacOS/Sublime Text",
                ),
                (
                    "intellij",
                    "IntelliJ IDEA",
                    "IntelliJ IDEA.app/Contents/MacOS/idea",
                ),
            ];
            for (id, label, rel) in home_checks {
                push_candidate(out, seen_paths, seen_ids, id, label, home_apps.join(rel));
            }
        }
    }

    // -- PATH lookups --
    for (name, id, label) in [
        ("code", "vscode", "Visual Studio Code"),
        (
            "code-insiders",
            "vscode-insiders",
            "Visual Studio Code Insiders",
        ),
        ("codium", "vscodium", "VSCodium"),
        ("cursor", "cursor", "Cursor"),
        ("windsurf", "windsurf", "Windsurf"),
        ("trae", "trae", "Trae"),
        ("zed", "zed", "Zed"),
        ("lapce", "lapce", "Lapce"),
        ("subl", "sublime", "Sublime Text"),
        ("vim", "vim", "Vim"),
        ("nvim", "neovim", "Neovim"),
        ("emacs", "emacs", "Emacs"),
        ("rstudio", "rstudio", "RStudio"),
        ("antigravity", "antigravity", "Google Antigravity"),
    ] {
        if let Some(p) = path_dirs_lookup(name) {
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }

    // -- JetBrains Toolbox --
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

// ============================================================================
// macOS fallback (mdfind + file walking)
// ============================================================================

#[cfg(target_os = "macos")]
fn discover_platform_fallback(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let mut app_paths: Vec<PathBuf> = Vec::new();

    // Try Spotlight first
    let output = Command::new("mdfind")
        .arg("kMDItemContentType == \"com.apple.application-bundle\"")
        .output();
    if let Ok(o) = output {
        if o.status.success() {
            let stdout = String::from_utf8_lossy(&o.stdout);
            for line in stdout.lines() {
                let p = PathBuf::from(line.trim());
                if p.is_dir() {
                    app_paths.push(p);
                }
            }
        }
    }

    // Always walk /Applications and ~/Applications as backup / supplement
    let walk_roots = [Path::new("/Applications"), Path::new("~/Applications")];
    for root in walk_roots {
        let root = if root.starts_with("~") {
            if let Ok(home) = std::env::var("HOME") {
                PathBuf::from(home).join("Applications")
            } else {
                continue;
            }
        } else {
            root.to_path_buf()
        };
        if !root.is_dir() {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(&root) else {
            continue;
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_dir() && p.extension().and_then(|e| e.to_str()) == Some("app") {
                if !app_paths.contains(&p) {
                    app_paths.push(p);
                }
            }
        }
    }

    // Known bundle name → (id, label, candidate exe paths inside .app)
    let bundle_checks: &[(&str, &str, &[&str])] = &[
        ("vscode", "Visual Studio Code", &["Contents/Resources/app/bin/code"]),
        (
            "vscode-insiders",
            "Visual Studio Code Insiders",
            &["Contents/Resources/app/bin/code"],
        ),
        ("vscodium", "VSCodium", &["Contents/Resources/app/bin/codium"]),
        ("cursor", "Cursor", &["Contents/Resources/app/bin/cursor"]),
        ("windsurf", "Windsurf", &["Contents/Resources/app/bin/windsurf"]),
        ("trae", "Trae", &["Contents/Resources/app/bin/trae"]),
        ("zed", "Zed", &["Contents/MacOS/zed"]),
        ("lapce", "Lapce", &["Contents/MacOS/lapce"]),
        ("sublime", "Sublime Text", &["Contents/MacOS/Sublime Text"]),
        ("nova", "Nova", &["Contents/MacOS/Nova"]),
        ("textmate", "TextMate", &["Contents/MacOS/TextMate"]),
        ("bbedit", "BBEdit", &["Contents/MacOS/BBEdit"]),
        ("coteditor", "CotEditor", &["Contents/MacOS/CotEditor"]),
        ("intellij", "IntelliJ IDEA", &["Contents/MacOS/idea"]),
        ("webstorm", "WebStorm", &["Contents/MacOS/webstorm"]),
        ("pycharm", "PyCharm", &["Contents/MacOS/pycharm"]),
        ("rustrover", "RustRover", &["Contents/MacOS/rustrover"]),
        ("goland", "GoLand", &["Contents/MacOS/goland"]),
        ("clion", "CLion", &["Contents/MacOS/clion"]),
        ("phpstorm", "PhpStorm", &["Contents/MacOS/phpstorm"]),
        ("rider", "Rider", &["Contents/MacOS/rider"]),
        ("android-studio", "Android Studio", &["Contents/MacOS/studio"]),
        ("fleet", "Fleet", &["Contents/MacOS/fleet"]),
        ("emacs", "Emacs", &["Contents/MacOS/Emacs"]),
        ("vim", "MacVim", &["Contents/MacOS/MacVim"]),
        ("neovim", "VimR", &["Contents/MacOS/VimR"]),
        ("rstudio", "RStudio", &["Contents/MacOS/RStudio"]),
        (
            "antigravity",
            "Google Antigravity",
            &[
                "Contents/Resources/app/bin/antigravity",
                "Contents/MacOS/Antigravity",
            ],
        ),
    ];

    for app_path in app_paths {
        let bundle_name = app_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        for (id, label, rels) in bundle_checks {
            if seen_ids.contains(*id) {
                continue;
            }
            // Heuristic: bundle name contains the IDE name (e.g., "Visual Studio Code.app")
            let keyword = id.replace("vscode", "visual studio code").replace("-", "");
            let matches = bundle_name.contains(id)
                || bundle_name.contains(&keyword)
                || (*id == "vscode" && bundle_name.contains("visual studio code"))
                || (*id == "vscode-insiders" && bundle_name.contains("visual studio code insiders"))
                || (*id == "vscodium" && bundle_name.contains("vscodium"))
                || (*id == "android-studio" && bundle_name.contains("android studio"))
                || (*id == "antigravity" && bundle_name.contains("antigravity"));

            if matches {
                for rel in *rels {
                    let exe = app_path.join(rel);
                    if exe.is_file() {
                        push_candidate(out, seen_paths, seen_ids, id, label, exe);
                        break;
                    }
                }
            }
        }
    }
}

// ============================================================================
// Linux primary discovery
// ============================================================================

#[cfg(all(unix, not(target_os = "macos")))]
fn discover_platform(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let code_paths = [
        "/usr/share/code/bin/code",
        "/usr/lib/code/code",
        "/usr/lib/code/bin/code",
        "/opt/visual-studio-code/bin/code",
        "/opt/vscode/bin/code",
        "/opt/VSCode-linux-x64/bin/code",
    ];
    for p in code_paths {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode",
            "Visual Studio Code",
            PathBuf::from(p),
        );
    }

    let insiders_paths = [
        "/usr/share/code-insiders/bin/code-insiders",
        "/usr/lib/code-insiders/code-insiders",
        "/opt/visual-studio-code-insiders/bin/code-insiders",
    ];
    for p in insiders_paths {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode-insiders",
            "Visual Studio Code Insiders",
            PathBuf::from(p),
        );
    }

    let codium_paths = [
        "/usr/share/codium/bin/codium",
        "/usr/lib/codium/codium",
        "/opt/vscodium/bin/codium",
    ];
    for p in codium_paths {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscodium",
            "VSCodium",
            PathBuf::from(p),
        );
    }

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
        "cursor",
        "Cursor",
        PathBuf::from("/opt/Cursor/cursor"),
    );

    let zed_paths = [
        "/usr/bin/zed",
        "/usr/local/bin/zed",
        "/opt/zed/bin/zed",
        "/opt/zed/zed",
        "/usr/share/zed/bin/zed",
    ];
    for p in zed_paths {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "zed",
            "Zed",
            PathBuf::from(p),
        );
    }

    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "sublime",
        "Sublime Text",
        PathBuf::from("/opt/sublime_text/sublime_text"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "sublime",
        "Sublime Text",
        PathBuf::from("/usr/bin/sublime_text"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "lapce",
        "Lapce",
        PathBuf::from("/usr/bin/lapce"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "lapce",
        "Lapce",
        PathBuf::from("/opt/lapce/lapce"),
    );

    for p in [
        "/opt/Antigravity/antigravity",
        "/usr/lib/antigravity/antigravity",
        "/usr/share/antigravity/antigravity",
        "/opt/antigravity/antigravity",
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

    for (id, label, path) in [
        ("intellij", "IntelliJ IDEA", "/opt/idea/bin/idea.sh"),
        ("webstorm", "WebStorm", "/opt/WebStorm/bin/webstorm.sh"),
        ("pycharm", "PyCharm", "/opt/pycharm/bin/pycharm.sh"),
        ("rustrover", "RustRover", "/opt/rustrover/bin/rustrover.sh"),
        ("goland", "GoLand", "/opt/GoLand/bin/goland.sh"),
        ("clion", "CLion", "/opt/clion/bin/clion.sh"),
        ("phpstorm", "PhpStorm", "/opt/PhpStorm/bin/phpstorm.sh"),
        ("rider", "Rider", "/opt/Rider/bin/rider.sh"),
        (
            "android-studio",
            "Android Studio",
            "/opt/android-studio/bin/studio.sh",
        ),
        ("fleet", "Fleet", "/opt/fleet/bin/fleet"),
    ] {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            id,
            label,
            PathBuf::from(path),
        );
    }

    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "emacs",
        "Emacs",
        PathBuf::from("/usr/bin/emacs"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "vim",
        "Vim",
        PathBuf::from("/usr/bin/vim"),
    );
    push_candidate(
        out,
        seen_paths,
        seen_ids,
        "neovim",
        "Neovim",
        PathBuf::from("/usr/bin/nvim"),
    );

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
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "lapce",
            "Lapce",
            h.join(".local/bin/lapce"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "helix",
            "Helix",
            h.join(".local/bin/hx"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "neovim",
            "Neovim",
            h.join(".local/bin/nvim"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "emacs",
            "Emacs",
            h.join(".local/bin/emacs"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "sublime",
            "Sublime Text",
            h.join(".local/bin/sublime_text"),
        );
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "antigravity",
            "Google Antigravity",
            h.join(".local/bin/antigravity"),
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
        ("codium", "vscodium", "VSCodium"),
        ("cursor", "cursor", "Cursor"),
        ("windsurf", "windsurf", "Windsurf"),
        ("trae", "trae", "Trae"),
        ("zed", "zed", "Zed"),
        ("lapce", "lapce", "Lapce"),
        ("subl", "sublime", "Sublime Text"),
        ("sublime_text", "sublime", "Sublime Text"),
        ("vim", "vim", "Vim"),
        ("nvim", "neovim", "Neovim"),
        ("hx", "helix", "Helix"),
        ("emacs", "emacs", "Emacs"),
        ("geany", "geany", "Geany"),
        ("kate", "kate", "Kate"),
        ("rstudio", "rstudio", "RStudio"),
        ("spyder", "spyder", "Spyder"),
        ("bluej", "bluej", "BlueJ"),
        ("antigravity", "antigravity", "Google Antigravity"),
    ] {
        if let Some(p) = path_dirs_lookup(name) {
            push_candidate(out, seen_paths, seen_ids, id, label, p);
        }
    }

    let opt_checks = [
        ("vscode", "Visual Studio Code", &["vscode*", "vscodium*", "code*"], &["bin/code", "code"]),
        ("cursor", "Cursor", &["cursor*"], &["bin/cursor", "cursor"]),
        ("zed", "Zed", &["zed*"], &["bin/zed", "zed"]),
        ("lapce", "Lapce", &["lapce*"], &["bin/lapce", "lapce"]),
        ("sublime", "Sublime Text", &["sublime*"], &["sublime_text"]),
        ("intellij", "IntelliJ IDEA", &["idea*", "intellij*"], &["bin/idea.sh", "bin/idea"]),
        ("webstorm", "WebStorm", &["webstorm*"], &["bin/webstorm.sh", "bin/webstorm"]),
        ("pycharm", "PyCharm", &["pycharm*"], &["bin/pycharm.sh", "bin/pycharm"]),
        ("rustrover", "RustRover", &["rustrover*"], &["bin/rustrover.sh", "bin/rustrover"]),
        ("goland", "GoLand", &["goland*"], &["bin/goland.sh", "bin/goland"]),
        ("clion", "CLion", &["clion*"], &["bin/clion.sh", "bin/clion"]),
        ("phpstorm", "PhpStorm", &["phpstorm*"], &["bin/phpstorm.sh", "bin/phpstorm"]),
        ("rider", "Rider", &["rider*"], &["bin/rider.sh", "bin/rider"]),
        ("android-studio", "Android Studio", &["android-studio*"], &["bin/studio.sh", "bin/studio"]),
        ("fleet", "Fleet", &["fleet*"], &["bin/fleet", "fleet"]),
        ("antigravity", "Google Antigravity", &["antigravity*", "google*antigravity*"], &["antigravity", "bin/antigravity"]),
    ];

    scan_install_roots(&[PathBuf::from("/opt")], out, seen_paths, seen_ids, &opt_checks);
}

// ============================================================================
// Linux .desktop fallback
// ============================================================================

#[cfg(all(unix, not(target_os = "macos")))]
fn discover_platform_fallback(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let paths = freedesktop_desktop_entry::default_paths();
    let entries = match freedesktop_desktop_entry::desktop_entries(&paths, &[]) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries {
        let exec = entry.exec().map(|s| s.to_string()).unwrap_or_default();
        if exec.is_empty() {
            continue;
        }

        // Parse the Exec field: first token is the executable, strip placeholders
        let tokens = parse_desktop_exec(&exec);
        let Some(exe_token) = tokens.first() else {
            continue;
        };

        // Skip Flatpak / Snap wrappers (agreed: skip for now)
        if exe_token == "flatpak" || exe_token == "snap" {
            continue;
        }

        // Resolve executable path
        let exe_path = if exe_token.starts_with('/') {
            PathBuf::from(exe_token)
        } else {
            match path_dirs_lookup(exe_token) {
                Some(p) => p,
                None => continue,
            }
        };

        if !is_executable_file(&exe_path) {
            continue;
        }

        // Match against known IDE executable names
        let exe_name = exe_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        for (id, label, names) in KNOWN_UNIX_EXE_NAMES {
            if seen_ids.contains(*id) {
                continue;
            }
            if names.iter().any(|n| exe_name == *n) {
                push_candidate(out, seen_paths, seen_ids, id, label, exe_path.clone());
                break;
            }
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn parse_desktop_exec(exec: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;

    for c in exec.chars() {
        match c {
            '"' if in_quote => {
                in_quote = false;
            }
            '"' if !in_quote => {
                in_quote = true;
            }
            ' ' if !in_quote => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    // Remove placeholder tokens (%F, %U, %f, %u, %i, %c, %k, etc.)
    tokens
        .into_iter()
        .filter(|t| !t.starts_with('%'))
        .collect()
}

// ============================================================================
// Public API
// ============================================================================

pub fn discover_ides() -> Vec<IdeCandidateDto> {
    let mut out = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut seen_ids = HashSet::new();
    discover_platform(&mut out, &mut seen_paths, &mut seen_ids);
    discover_platform_fallback(&mut out, &mut seen_paths, &mut seen_ids);
    out.sort_by(|a, b| {
        a.label
            .to_lowercase()
            .cmp(&b.label.to_lowercase())
            .then_with(|| a.executable.cmp(&b.executable))
    });
    out
}

pub fn launch_ide(
    executable: &str,
    project_dir: &Path,
) -> Result<std::process::Child, StableError> {
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

    let child = c
        .spawn()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    Ok(child)
}
