use std::collections::HashSet;
use std::path::PathBuf;
use crate::models::IdeCandidateDto;
use super::common::{is_executable_file, path_dirs_lookup, push_candidate};
use super::constants::KNOWN_UNIX_EXE_NAMES;
use super::jetbrains::walk_jetbrains_install_roots;
use super::scanner::scan_install_roots;

pub fn discover_platform(
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

    // VSCode OSS (microsoft/vscode product.json applicationName "code-oss")
    let oss_paths = [
        "/usr/bin/code-oss",
        "/usr/local/bin/code-oss",
        "/opt/code-oss/bin/code-oss",
        "/opt/VSCode-linux-x64/bin/code-oss",
    ];
    for p in oss_paths {
        push_candidate(
            out,
            seen_paths,
            seen_ids,
            "vscode-oss",
            "VSCode OSS",
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
        ("datagrip", "DataGrip", "/opt/datagrip/bin/datagrip.sh"),
        ("rubymine", "RubyMine", "/opt/rubymine/bin/rubymine.sh"),
        ("appcode", "AppCode", "/opt/appcode/bin/appcode.sh"),
        ("dataspell", "DataSpell", "/opt/dataspell/bin/dataspell.sh"),
        ("aqua", "Aqua", "/opt/aqua/bin/aqua.sh"),
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
        ("code-oss", "vscode-oss", "VSCode OSS"),
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
        ("vscode-oss", "VSCode OSS", &["code-oss*", "vscode-oss*", "vscode-linux-x64*"], &["bin/code-oss", "code-oss"]),
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
        ("datagrip", "DataGrip", &["datagrip*"], &["bin/datagrip.sh", "bin/datagrip"]),
        ("rubymine", "RubyMine", &["rubymine*"], &["bin/rubymine.sh", "bin/rubymine"]),
        ("appcode", "AppCode", &["appcode*"], &["bin/appcode.sh", "bin/appcode"]),
        ("dataspell", "DataSpell", &["dataspell*"], &["bin/dataspell.sh", "bin/dataspell"]),
        ("aqua", "Aqua", &["aqua*"], &["bin/aqua.sh", "bin/aqua"]),
        ("antigravity", "Google Antigravity", &["antigravity*", "google*antigravity*"], &["antigravity", "bin/antigravity"]),
    ];

    scan_install_roots(&[PathBuf::from("/opt")], out, seen_paths, seen_ids, &opt_checks);
}

pub fn discover_platform_fallback(
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

        // Flatpak / Snap wrappers: resolve only when the entry points at a
        // known IDE with a concrete executable (flatpak export shim, snap app
        // command shim). Unknown apps are skipped safely.
        if exe_token == "flatpak" {
            handle_flatpak_desktop_entry(&tokens, out, seen_paths, seen_ids);
            continue;
        }
        if exe_token == "snap" {
            handle_snap_desktop_entry(&tokens, out, seen_paths, seen_ids);
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

/// Known Flatpak application IDs for IDEs, mapped to (id, label).
/// Only IDs that exist on Flathub are listed.
pub fn known_flatpak_app(app_id: &str) -> Option<(&'static str, &'static str)> {
    match app_id {
        "com.visualstudio.code" => Some(("vscode", "Visual Studio Code")),
        "com.vscodium.codium" => Some(("vscodium", "VSCodium")),
        "dev.zed.Zed" => Some(("zed", "Zed")),
        "com.jetbrains.IntelliJ-IDEA-Community" | "com.jetbrains.IntelliJ-IDEA-Ultimate" => {
            Some(("intellij", "IntelliJ IDEA"))
        }
        "com.jetbrains.PyCharm-Community" | "com.jetbrains.PyCharm-Professional" => {
            Some(("pycharm", "PyCharm"))
        }
        "com.jetbrains.CLion" => Some(("clion", "CLion")),
        "com.jetbrains.PhpStorm" => Some(("phpstorm", "PhpStorm")),
        "com.jetbrains.Rider" => Some(("rider", "Rider")),
        "com.jetbrains.GoLand" => Some(("goland", "GoLand")),
        "com.jetbrains.WebStorm" => Some(("webstorm", "WebStorm")),
        "com.jetbrains.RubyMine" => Some(("rubymine", "RubyMine")),
        "com.jetbrains.DataGrip" => Some(("datagrip", "DataGrip")),
        "com.jetbrains.RustRover" => Some(("rustrover", "RustRover")),
        _ => None,
    }
}

/// Extract the application ID from a `flatpak run ...` token list.
/// App IDs are reverse-DNS identifiers containing at least one '.'.
pub fn flatpak_app_id(tokens: &[String]) -> Option<&str> {
    tokens
        .iter()
        .skip(1)
        .filter(|t| !t.starts_with('-'))
        .map(|t| t.as_str())
        .find(|t| t.contains('.') && !t.starts_with('%'))
}

/// Extract the app command from a `snap run ...` token list,
/// e.g. ["snap", "run", "code"] -> "code".
pub fn snap_app_command(tokens: &[String]) -> Option<String> {
    // Prefer the token after the "run" subcommand.
    for (i, t) in tokens.iter().enumerate() {
        if t == "run" {
            return tokens
                .get(i + 1)
                .filter(|t| !t.starts_with('-'))
                .cloned();
        }
    }
    // Fallback: first positional token after "snap" that is not a flag.
    tokens
        .iter()
        .skip(1)
        .find(|t| !t.starts_with('-'))
        .cloned()
}

/// Resolve the concrete shim executable Flatpak installs per app. Flatpak
/// exports one wrapper per app at /var/lib/flatpak/exports/bin and
/// ~/.local/share/flatpak/exports/bin (both added to PATH by flatpak's
/// profile script). Returns the shim path only when it exists on disk.
pub fn flatpak_shim_path(app_id: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home)
            .join(".local/share/flatpak/exports/bin")
            .join(app_id);
        if p.is_file() {
            return Some(p);
        }
    }
    let p = PathBuf::from("/var/lib/flatpak/exports/bin").join(app_id);
    if p.is_file() {
        return Some(p);
    }
    path_dirs_lookup(app_id)
}

fn handle_flatpak_desktop_entry(
    tokens: &[String],
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let Some(app_id) = flatpak_app_id(tokens) else {
        return;
    };
    let Some((id, label)) = known_flatpak_app(app_id) else {
        return;
    };
    let Some(shim) = flatpak_shim_path(app_id) else {
        return;
    };
    push_candidate(out, seen_paths, seen_ids, id, label, shim);
}

fn handle_snap_desktop_entry(
    tokens: &[String],
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
) {
    let Some(app) = snap_app_command(tokens) else {
        return;
    };
    // Snap puts an executable shim at /snap/bin/<app>, which is on PATH.
    let Some(exe_path) = path_dirs_lookup(&app) else {
        return;
    };
    if !is_executable_file(&exe_path) {
        return;
    }
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
            push_candidate(out, seen_paths, seen_ids, id, label, exe_path);
            break;
        }
    }
}

pub fn parse_desktop_exec(exec: &str) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn flatpak_app_id_extracts_reverse_dns_id() {
        assert_eq!(
            flatpak_app_id(&toks(&["flatpak", "run", "com.visualstudio.code"])),
            Some("com.visualstudio.code")
        );
        assert_eq!(
            flatpak_app_id(&toks(&[
                "flatpak",
                "run",
                "--branch=stable",
                "--arch=x86_64",
                "com.jetbrains.Rider"
            ])),
            Some("com.jetbrains.Rider")
        );
        assert_eq!(
            flatpak_app_id(&toks(&["flatpak", "run", "--command=code", "com.visualstudio.code"])),
            Some("com.visualstudio.code")
        );
    }

    #[test]
    fn flatpak_app_id_missing_or_unparseable() {
        assert_eq!(flatpak_app_id(&toks(&["flatpak"])), None);
        assert_eq!(flatpak_app_id(&toks(&["flatpak", "run"])), None);
        assert_eq!(flatpak_app_id(&toks(&["flatpak", "info"])), None);
        assert_eq!(flatpak_app_id(&toks(&[])), None);
    }

    #[test]
    fn known_flatpak_app_maps_ide_ids() {
        assert_eq!(
            known_flatpak_app("com.visualstudio.code"),
            Some(("vscode", "Visual Studio Code"))
        );
        assert_eq!(
            known_flatpak_app("com.vscodium.codium"),
            Some(("vscodium", "VSCodium"))
        );
        assert_eq!(known_flatpak_app("dev.zed.Zed"), Some(("zed", "Zed")));
        assert_eq!(
            known_flatpak_app("com.jetbrains.IntelliJ-IDEA-Ultimate"),
            Some(("intellij", "IntelliJ IDEA"))
        );
        assert_eq!(
            known_flatpak_app("com.jetbrains.PyCharm-Community"),
            Some(("pycharm", "PyCharm"))
        );
        assert_eq!(
            known_flatpak_app("com.jetbrains.DataGrip"),
            Some(("datagrip", "DataGrip"))
        );
        // Not on Flathub: must not be mapped.
        assert_eq!(known_flatpak_app("com.visualstudio.code.oss"), None);
        assert_eq!(known_flatpak_app("io.random.editor"), None);
    }

    #[test]
    fn snap_app_command_extracts_after_run() {
        assert_eq!(
            snap_app_command(&toks(&["snap", "run", "code"])),
            Some("code".to_string())
        );
        assert_eq!(
            snap_app_command(&toks(&["snap", "run", "codium"])),
            Some("codium".to_string())
        );
        assert_eq!(
            snap_app_command(&toks(&["snap", "code"])),
            Some("code".to_string())
        );
        assert_eq!(snap_app_command(&toks(&["snap"])), None);
        assert_eq!(snap_app_command(&toks(&["snap", "run", "--shell", "code"])), None);
    }

    #[test]
    fn parse_desktop_exec_handles_quotes_and_placeholders() {
        assert_eq!(
            parse_desktop_exec("flatpak run com.visualstudio.code %F"),
            toks(&["flatpak", "run", "com.visualstudio.code"])
        );
        assert_eq!(
            parse_desktop_exec("\"/opt/sublime_text/sublime_text\" %F"),
            toks(&["/opt/sublime_text/sublime_text"])
        );
        assert_eq!(
            parse_desktop_exec("code --new-window %U"),
            toks(&["code", "--new-window"])
        );
        assert_eq!(parse_desktop_exec(""), Vec::<String>::new());
    }
}
