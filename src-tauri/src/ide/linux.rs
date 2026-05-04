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
