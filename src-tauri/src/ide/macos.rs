use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::models::IdeCandidateDto;
use super::common::{push_candidate, path_dirs_lookup};
use super::jetbrains::walk_jetbrains_install_roots;

pub fn discover_platform(
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
        "vscode-oss",
        "VSCode OSS",
        apps.join("Code - OSS.app/Contents/Resources/app/bin/code"),
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
        ("datagrip", "DataGrip", "DataGrip.app/Contents/MacOS/datagrip"),
        ("rubymine", "RubyMine", "RubyMine.app/Contents/MacOS/rubymine"),
        ("appcode", "AppCode", "AppCode.app/Contents/MacOS/appcode"),
        ("dataspell", "DataSpell", "DataSpell.app/Contents/MacOS/dataspell"),
        ("aqua", "Aqua", "Aqua.app/Contents/MacOS/aqua"),
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

pub fn discover_platform_fallback(
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
        (
            "vscode-oss",
            "VSCode OSS",
            &["Contents/Resources/app/bin/code"],
        ),
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
        ("datagrip", "DataGrip", &["Contents/MacOS/datagrip"]),
        ("rubymine", "RubyMine", &["Contents/MacOS/rubymine"]),
        ("appcode", "AppCode", &["Contents/MacOS/appcode"]),
        ("dataspell", "DataSpell", &["Contents/MacOS/dataspell"]),
        ("aqua", "Aqua", &["Contents/MacOS/aqua"]),
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
                || (*id == "vscode-oss"
                    && (bundle_name.contains("code - oss")
                        || bundle_name.contains("code-oss")
                        || bundle_name.contains("code oss")
                        || bundle_name.contains("vscode oss")))
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
