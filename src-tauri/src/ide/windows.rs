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
            "vscode-oss",
            "VSCode OSS",
            base.join("Programs/Microsoft Code OSS/Code - OSS.exe"),
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
            "vscode-oss",
            "VSCode OSS",
            base.join("Microsoft Code OSS/Code - OSS.exe"),
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

    // -- PATH lookups derived from KNOWN_WINDOWS_EXE_PATTERNS so every known
    //    exe name is covered, not just the hand list above. Deduplication is
    //    handled by push_candidate (seen_ids / seen_paths).
    for (id, label, exes) in KNOWN_WINDOWS_EXE_PATTERNS {
        if seen_ids.contains(*id) {
            continue;
        }
        for exe in *exes {
            if let Some(p) = path_dirs_lookup(exe) {
                push_candidate(out, seen_paths, seen_ids, id, label, p);
                break;
            }
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
            "vscode-oss",
            "VSCode OSS",
            &["microsoft code oss*", "code - oss*", "code-oss*"],
            &["Code - OSS.exe"],
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
            let display_icon: String = app_key.get_value("DisplayIcon").unwrap_or_default();
            let uninstall_string: String = app_key.get_value("UninstallString").unwrap_or_default();
            if install_loc.is_empty() && display_icon.is_empty() && uninstall_string.is_empty() {
                continue;
            }

            // 1) InstallLocation: look for known IDE executables in the install
            //    dir root and its bin/ subdir.
            if !install_loc.is_empty() {
                let loc = PathBuf::from(&install_loc);
                if loc.is_dir() {
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

            // 2) DisplayIcon / UninstallString: use the executable path they
            //    reference only when it resolves to an actual known IDE
            //    executable. MsiExec.exe /X{...}, uninstall.exe, etc. never
            //    match a known exe name, so they are skipped safely.
            for raw in [&display_icon, &uninstall_string] {
                let Some(path_str) = parse_registry_exe_path(raw) else {
                    continue;
                };
                let Some(expanded) = expand_registry_path(&path_str) else {
                    continue;
                };
                let p = PathBuf::from(&expanded);
                if !p.is_file() {
                    continue;
                }
                let Some(file_name) = p.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let Some((id, label)) = known_exe_pattern_for(file_name) else {
                    continue;
                };
                push_candidate(out, seen_paths, seen_ids, id, label, p);
            }
        }
    }
}

/// Extract an executable path from a registry string value (DisplayIcon or
/// UninstallString). Handles:
///   - quoted:   "\"C:\\Program Files\\App\\app.exe\",0"   -> "C:\\Program Files\\App\\app.exe"
///   - plain:    "C:\\Program Files\\App\\app.exe /S"      -> "C:\\Program Files\\App\\app.exe"
/// Returns the raw (possibly %VAR%-containing) path without quotes/arguments.
pub fn parse_registry_exe_path(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let candidate = if let Some(stripped) = value.strip_prefix('"') {
        // Quoted form: everything up to the closing quote.
        match stripped.find('"') {
            Some(end) => stripped[..end].to_string(),
            None => return None, // unterminated quote: not parseable
        }
    } else {
        // Unquoted form: stop at the first comma or whitespace
        // (e.g. "C:\\Tools\\app.exe,0" or "MsiExec.exe /I{GUID}").
        let end = value
            .find(|c: char| c == ',' || c == ' ' || c == '\t')
            .unwrap_or(value.len());
        value[..end].to_string()
    };
    let candidate = candidate.trim();
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

/// Expand %VAR% references in a registry path (winreg returns REG_EXPAND_SZ
/// values unexpanded). Returns None when a referenced variable is missing or
/// the value is malformed, so callers can skip unresolvable entries safely.
pub fn expand_registry_path(raw: &str) -> Option<String> {
    if !raw.contains('%') {
        return Some(raw.to_string());
    }
    let mut out = String::new();
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            return None; // unterminated %VAR
        };
        let var = &after[..end];
        if var.is_empty() {
            return None; // "%%" is not meaningful in a path
        }
        out.push_str(&std::env::var(var).ok()?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// Find the first known IDE pattern whose executable names contain
/// `file_name` (case-insensitive), returning its (id, label).
pub fn known_exe_pattern_for(file_name: &str) -> Option<(&'static str, &'static str)> {
    let lower = file_name.to_lowercase();
    for (id, label, exes) in KNOWN_WINDOWS_EXE_PATTERNS {
        if exes.iter().any(|exe| exe.to_lowercase() == lower) {
            return Some((id, label));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_registry_exe_path_handles_quoted_with_icon_index() {
        assert_eq!(
            parse_registry_exe_path("\"C:\\Program Files\\App\\app.exe\",0"),
            Some("C:\\Program Files\\App\\app.exe".to_string())
        );
    }

    #[test]
    fn parse_registry_exe_path_handles_quoted_with_args() {
        assert_eq!(
            parse_registry_exe_path("\"C:\\Program Files\\App\\uninstall.exe\" /S"),
            Some("C:\\Program Files\\App\\uninstall.exe".to_string())
        );
    }

    #[test]
    fn parse_registry_exe_path_handles_plain_and_msi() {
        assert_eq!(
            parse_registry_exe_path("C:\\Tools\\App\\app.exe,0"),
            Some("C:\\Tools\\App\\app.exe".to_string())
        );
        assert_eq!(
            parse_registry_exe_path("MsiExec.exe /X{GUID}"),
            Some("MsiExec.exe".to_string())
        );
        assert_eq!(
            parse_registry_exe_path("C:\\Tools\\App\\app.exe /S"),
            Some("C:\\Tools\\App\\app.exe".to_string())
        );
    }

    #[test]
    fn parse_registry_exe_path_rejects_empty_and_malformed() {
        assert_eq!(parse_registry_exe_path(""), None);
        assert_eq!(parse_registry_exe_path("   "), None);
        assert_eq!(parse_registry_exe_path("\"unterminated"), None);
        assert_eq!(parse_registry_exe_path("\"  \""), None);
    }

    #[test]
    fn expand_registry_path_passthrough_and_expansion() {
        assert_eq!(
            expand_registry_path("C:\\Program Files\\App\\app.exe"),
            Some("C:\\Program Files\\App\\app.exe".to_string())
        );
        // %SystemRoot% is always defined on Windows.
        let expanded = expand_registry_path("%SystemRoot%\\System32\\notepad.exe");
        assert!(expanded
            .as_deref()
            .unwrap_or("")
            .ends_with("\\System32\\notepad.exe"));
        assert_eq!(expand_registry_path("%DEFINITELY_NOT_SET_VAR_XYZ%\\x.exe"), None);
        assert_eq!(expand_registry_path("C:\\%unterminated"), None);
    }

    #[test]
    fn known_exe_pattern_for_matches_case_insensitively() {
        assert_eq!(
            known_exe_pattern_for("Code.exe"),
            Some(("vscode", "Visual Studio Code"))
        );
        assert_eq!(
            known_exe_pattern_for("code.exe"),
            Some(("vscode", "Visual Studio Code"))
        );
        assert_eq!(
            known_exe_pattern_for("Code - OSS.exe"),
            Some(("vscode-oss", "VSCode OSS"))
        );
        assert_eq!(
            known_exe_pattern_for("dataSpell64.exe"),
            Some(("dataspell", "DataSpell"))
        );
        assert_eq!(known_exe_pattern_for("uninstall.exe"), None);
        assert_eq!(known_exe_pattern_for("MsiExec.exe"), None);
    }
}
