use std::collections::HashSet;
use std::path::PathBuf;
use crate::models::IdeCandidateDto;
use super::common::push_candidate;

pub fn scan_install_roots(
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
