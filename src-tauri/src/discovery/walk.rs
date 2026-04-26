use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::discovery::draft::ProjectDraft;
use crate::discovery::paths::path_key;
use crate::discovery::registry::DetectorRegistry;
use crate::discovery::skip::should_skip_directory;
use crate::discovery::workspace::{read_package_json_workspaces, resolve_workspace_members};

pub fn filter_outermost_projects(mut drafts: Vec<ProjectDraft>) -> Vec<ProjectDraft> {
    drafts.sort_by_key(|d| path_key(&d.root).len());
    let mut kept: Vec<ProjectDraft> = Vec::new();
    for d in drafts {
        let d_canon = dunce::canonicalize(&d.root).unwrap_or_else(|_| d.root.clone());
        let mut parent_idx = None;
        for (i, k) in kept.iter().enumerate() {
            let k_canon = dunce::canonicalize(&k.root).unwrap_or_else(|_| k.root.clone());
            if d_canon.starts_with(&k_canon) && d_canon != k_canon {
                parent_idx = Some(i);
                break;
            }
        }

        if let Some(idx) = parent_idx {
            let parent = &mut kept[idx];
            let rel = d
                .root
                .strip_prefix(&parent.root)
                .ok()
                .and_then(|p| p.to_str())
                .unwrap_or("");

            for mut task in d.tasks {
                if !rel.is_empty() {
                    task.label = format!("{rel}: {}", task.label);
                }
                parent.tasks.push(task);
            }
        } else {
            kept.push(d);
        }
    }
    kept
}

fn is_descendant(child: &Path, ancestor: &Path) -> bool {
    let c = dunce::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
    let a = dunce::canonicalize(ancestor).unwrap_or_else(|_| ancestor.to_path_buf());
    c.starts_with(&a) && c != a
}

/// For most locations, [`filter_outermost_projects`] keeps only one project per nested tree.
/// When a draft is a JavaScript/TypeScript monorepo root (`package.json` `workspaces`), paths
/// listed in the workspace manifest are **not** dropped as "inner" projects: they are merged back
/// with the root (if the root is a project) and any member that did not appear in the initial walk
/// is re-detected with [`DetectorRegistry::detect`].
pub fn filter_monorepo_and_outermost(
    registry: &DetectorRegistry,
    raw: Vec<ProjectDraft>,
    monorepos_expanded: &mut u64,
    workspace_warnings: &mut u64,
) -> Vec<ProjectDraft> {
    let raw_keys: HashSet<String> = raw.iter().map(|d| path_key(&d.root)).collect();
    let outer = filter_outermost_projects(raw.clone());
    let mut by_key: HashMap<String, ProjectDraft> = HashMap::new();
    for d in &outer {
        by_key.insert(path_key(&d.root), d.clone());
    }

    for o in &outer {
        let (globs, parse_err) = read_package_json_workspaces(&o.root);
        if parse_err {
            *workspace_warnings += 1;
        }
        if globs.is_empty() {
            continue;
        }
        let res = resolve_workspace_members(&o.root, &globs, workspace_warnings);
        if res.truncated {
            *workspace_warnings += 1;
        }
        if res.members.is_empty() {
            continue;
        }
        *monorepos_expanded += 1;

        for d in &raw {
            if d.root == o.root {
                continue;
            }
            if !is_descendant(&d.root, &o.root) {
                continue;
            }
            let k = path_key(&d.root);
            if res.members.contains(&k) {
                by_key.insert(k, d.clone());
            }
        }

        for mk in &res.members {
            if raw_keys.contains(mk) {
                continue;
            }
            if by_key.contains_key(mk) {
                continue;
            }
            let p = PathBuf::from(mk);
            if let Some(d) = registry.detect(&p) {
                let kk = path_key(&d.root);
                if res.members.contains(&kk) {
                    by_key.insert(kk, d);
                }
            }
        }
    }

    by_key.into_values().collect()
}

pub const MAX_DEPTH: usize = crate::discovery::paths::MAX_PATH_DEPTH;

pub use crate::discovery::skip::path_has_skipped_dir_segment;

pub fn collect_projects_under_root(
    registry: &DetectorRegistry,
    root: &Path,
    dirs_skipped_errors: &mut u64,
) -> Vec<ProjectDraft> {
    let mut out = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut visited: HashSet<String> = HashSet::new();

    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            continue;
        }

        let key = path_key(&dir);
        if !visited.insert(key) {
            continue;
        }

        if should_skip_directory(&dir) {
            continue;
        }

        if let Some(draft) = registry.detect(&dir) {
            out.push(draft);
        }

        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => {
                *dirs_skipped_errors += 1;
                continue;
            }
        };

        for ent in read.flatten() {
            let Ok(ft) = ent.file_type() else {
                *dirs_skipped_errors += 1;
                continue;
            };
            if !ft.is_dir() {
                continue;
            }
            let path = ent.path();
            if should_skip_directory(&path) {
                continue;
            }
            stack.push((path, depth + 1));
        }
    }

    out
}

#[cfg(test)]
mod monorepo_tests {
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    use super::collect_projects_under_root;
    use super::filter_monorepo_and_outermost;
    use super::path_key;
    use crate::discovery::registry::DetectorRegistry;

    fn write_json(root: &Path, rel: &str, j: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(j.as_bytes()).unwrap();
    }

    #[test]
    fn monorepo_keeps_root_and_listed_packages() {
        let base = std::env::temp_dir().join("pv-walk-mono");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_json(
            &base,
            "package.json",
            r#"{"name": "root","private": true,"workspaces": ["packages/*"]}"#,
        );
        write_json(
            &base,
            "packages/a/package.json",
            r#"{"name": "a","version": "0.0.0"}"#,
        );
        write_json(
            &base,
            "packages/b/package.json",
            r#"{"name": "b","version": "0.0.0"}"#,
        );
        let reg = DetectorRegistry::standard();
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let outer_only = super::filter_outermost_projects(raw.clone());
        assert_eq!(outer_only.len(), 1, "outermost only should collapse nested");
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_monorepo_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: std::collections::HashSet<String> =
            merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 3, "root + 2 packages");
        assert_eq!(m, 1, "one monorepo pattern applied");
    }

    #[test]
    fn single_non_workspace_stays_outermost() {
        let base = std::env::temp_dir().join("pv-walk-solo");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_json(&base, "package.json", r#"{"name": "s","version": "0.0.0"}"#);
        let reg = DetectorRegistry::standard();
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_monorepo_and_outermost(&reg, raw, &mut m, &mut w);
        assert_eq!(merged.len(), 1);
        assert_eq!(m, 0);
    }
}
