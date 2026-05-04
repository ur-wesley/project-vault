use std::collections::HashSet;
use std::path::PathBuf;
use crate::models::IdeCandidateDto;
use super::common::{push_candidate, path_dirs_lookup};
use super::constants::KNOWN_WINDOWS_EXE_PATTERNS;
use super::jetbrains::walk_jetbrains_install_roots;
use super::scanner::scan_install_roots;

pub fn discover_platform(
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

pub fn discover_platform_fallback(
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
