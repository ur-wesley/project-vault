use std::collections::HashSet;
use std::path::{Path, PathBuf};
use crate::models::IdeCandidateDto;
use super::common::push_candidate;

pub fn jetbrains_exe_label(name: &str) -> Option<(&'static str, &'static str)> {
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

pub fn walk_jetbrains_install_roots(
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

pub fn walk_jetbrains_bins(
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
