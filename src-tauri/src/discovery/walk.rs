use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::discovery::draft::ProjectDraft;
use crate::discovery::paths::path_key;
use crate::discovery::registry::DetectorRegistry;
use crate::discovery::skip::should_skip_directory;
use crate::discovery::workspace_manifest::detect_all_workspaces;

pub fn filter_outermost_projects(mut drafts: Vec<ProjectDraft>) -> Vec<ProjectDraft> {
    drafts.sort_by_key(|d| path_key(&d.root).len());
    let mut kept: Vec<ProjectDraft> = Vec::new();
    for d in drafts {
        let d_key = path_key(&d.root);
        let mut parent_idx = None;
        for (i, k) in kept.iter().enumerate() {
            let k_key = path_key(&k.root);
            if key_is_descendant(&d_key, &k_key) {
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
                    task.cwd = Some(rel.replace('\\', "/"));
                }
                parent.tasks.push(task);
            }
        } else {
            kept.push(d);
        }
    }
    kept
}

fn key_is_descendant(child_key: &str, ancestor_key: &str) -> bool {
    if child_key == ancestor_key {
        return false;
    }
    if !child_key.starts_with(ancestor_key) {
        return false;
    }
    let sep = std::path::MAIN_SEPARATOR as u8;
    child_key.as_bytes().get(ancestor_key.len()) == Some(&sep)
}

/// Unified filter:
/// 1. Detect workspace manifests and .git monorepos — only for tagging the root.
/// 2. ALL nested projects collapse into their outermost parent with prefixed tasks.
///    The parent gets tagged "monorepo" when it absorbs children.
/// 3. Nx is the ONLY exception: root stays, children are kept separate.
/// 4. Standalone projects (no nested children) stay as-is.
pub fn filter_workspaces_and_outermost(
    _registry: &DetectorRegistry,
    raw: Vec<ProjectDraft>,
    monorepos_expanded: &mut u64,
    workspace_warnings: &mut u64,
) -> Vec<ProjectDraft> {
    let manifests = detect_all_workspaces(&raw, workspace_warnings);

    // Nx roots are the only ones that disable collapse
    let collapse_disabled_roots: HashSet<String> = manifests
        .iter()
        .filter(|m| m.disable_collapse)
        .map(|m| m.root_key.clone())
        .collect();

    // Tag roots that have explicit workspace manifests
    let workspace_roots: HashSet<String> = manifests
        .iter()
        .map(|m| m.root_key.clone())
        .collect();

    // Sort raw by path length so parents are processed before children
    let mut drafts = raw;
    drafts.sort_by_key(|d| path_key(&d.root).len());

    let mut by_key: HashMap<String, ProjectDraft> = HashMap::new();

    for d in drafts {
        let k = path_key(&d.root);
        let mut d = d;

        // Apply workspace overlay tags (turborepo, etc.) to the root
        if workspace_roots.contains(&k) {
            for manifest in &manifests {
                if manifest.root_key == k {
                    for tag in &manifest.overlay_tags {
                        if !d.tags.contains(tag) {
                            d.tags.push(tag.clone());
                        }
                    }
                    *monorepos_expanded += 1;
                }
            }
        }

        // Try to find a parent already in by_key
        let mut parent_key: Option<String> = None;
        for pk in by_key.keys() {
            if key_is_descendant(&k, pk) {
                // Never collapse under Nx roots
                if collapse_disabled_roots.contains(pk) {
                    continue;
                }
                parent_key = Some(pk.clone());
                break;
            }
        }

        if let Some(pk) = parent_key {
            let parent = by_key.get_mut(&pk).unwrap();
            let rel = d
                .root
                .strip_prefix(&parent.root)
                .ok()
                .and_then(|p| p.to_str())
                .unwrap_or("");
            let rel_slash = rel.replace('\\', "/");
            for task in &d.tasks {
                let mut t = task.clone();
                if !rel.is_empty() {
                    t.label = format!("{rel_slash}: {}", t.label);
                    t.cwd = Some(rel_slash.clone());
                }
                parent.tasks.push(t);
            }
            // Merge tags from child into parent
            for tag in &d.tags {
                if !parent.tags.contains(tag) {
                    parent.tags.push(tag.clone());
                }
            }
            if !parent.tags.iter().any(|t| t == "monorepo") {
                parent.tags.push("monorepo".into());
            }
        } else {
            by_key.insert(k, d);
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
mod tests {
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    use super::*;
    use crate::discovery::registry::DetectorRegistry;

    fn write_json(root: &Path, rel: &str, j: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(j.as_bytes()).unwrap();
    }

    fn write_toml(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn package_json_workspace_collapses_into_root() {
        let base = std::env::temp_dir().join("pv-walk-pj");
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
            r#"{"name": "a","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );
        write_json(
            &base,
            "packages/b/package.json",
            r#"{"name": "b","version": "0.0.0","scripts":{"build":"tsc"}}"#,
        );
        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "workspace members collapse into root");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root tagged monorepo");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("packages/a:")), "a tasks prefixed");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("packages/b:")), "b tasks prefixed");
    }

    #[test]
    fn pnpm_workspace_collapses_into_root() {
        let base = std::env::temp_dir().join("pv-walk-pnpm");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_json(&base, "package.json", r#"{"name": "root","private": true}"#);
        let pnpm = base.join("pnpm-workspace.yaml");
        let mut f = fs::File::create(&pnpm).unwrap();
        f.write_all(b"packages:\n  - 'packages/*'\n").unwrap();
        write_json(
            &base,
            "packages/x/package.json",
            r#"{"name": "x","version": "0.0.0","scripts":{"dev":"vite"}}"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "pnpm workspace collapses into root");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root tagged monorepo");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("packages/x:")), "x tasks prefixed");
    }

    #[test]
    fn cargo_workspace_collapses_into_root() {
        let base = std::env::temp_dir().join("pv-walk-cargo");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_toml(
            &base,
            "Cargo.toml",
            r#"[workspace]
members = ["crates/*"]
"#,
        );
        write_toml(
            &base,
            "crates/core/Cargo.toml",
            r#"[package]
name = "core"
version = "0.1.0"
"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "cargo workspace collapses into root");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root tagged monorepo");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("crates/core:")), "core tasks prefixed");
    }

    #[test]
    fn mixed_stack_nested_collapses_into_root() {
        let base = std::env::temp_dir().join("pv-walk-mixed");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // JS frontend root
        write_json(&base, "package.json", r#"{"name": "app","version": "0.0.0"}"#);
        // Go backend nested
        write_toml(
            &base.join("backend"),
            "go.mod",
            r#"module example.com/backend

go 1.21
"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "root absorbs nested backend");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        let has_prefixed = root.tasks.iter().any(|t| t.label.starts_with("backend:"));
        assert!(has_prefixed, "Go backend tasks should be prefixed into root");
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root should be tagged monorepo");
    }

    #[test]
    fn implicit_monorepo_root_keeps_children_collapsed() {
        let base = std::env::temp_dir().join("pv-walk-implicit");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // Root has package.json but no workspaces field — implicit monorepo
        write_json(
            &base,
            "package.json",
            r#"{"name": "root","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );
        write_json(
            &base.join("docs"),
            "package.json",
            r#"{"name": "docs","version": "0.0.0","scripts":{"start":"storybook"}}"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "root absorbs docs");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        let has_prefixed = root.tasks.iter().any(|t| t.label.starts_with("docs:"));
        assert!(has_prefixed, "docs tasks should be prefixed into root");
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root should be tagged monorepo");
    }

    #[test]
    fn implicit_monorepo_js_with_go_backend_collapses() {
        let base = std::env::temp_dir().join("pv-walk-js-go");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_json(&base, "package.json", r#"{"name": "app","version": "0.0.0"}"#);
        write_toml(
            &base.join("backend"),
            "go.mod",
            r#"module example.com/backend

go 1.21
"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "root absorbs backend");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        let has_prefixed = root.tasks.iter().any(|t| t.label.starts_with("backend:"));
        assert!(has_prefixed, "backend tasks should be prefixed into root");
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root should be tagged monorepo");
    }

    #[test]
    fn monorepo_root_with_explicit_members_collapses() {
        // Simulates a real-world monorepo root that only has private + workspaces
        let base = std::env::temp_dir().join("pv-walk-explicit-mono");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_json(
            &base,
            "package.json",
            r#"{"private": true, "workspaces": ["api", "auth", "shared", "web"]}"#,
        );
        write_json(
            &base.join("api"),
            "package.json",
            r#"{"name": "@onyx-manager/api","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );
        write_json(
            &base.join("auth"),
            "package.json",
            r#"{"name": "@onyx-manager/auth","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );
        write_json(
            &base.join("shared"),
            "package.json",
            r#"{"name": "@onyx-manager/shared","version": "0.0.0"}"#,
        );
        write_json(
            &base.join("web"),
            "package.json",
            r#"{"name": "@onyx-manager/web","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "all members collapse into root");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root tagged monorepo");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("api:")), "api tasks prefixed");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("auth:")), "auth tasks prefixed");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("web:")), "web tasks prefixed");
    }

    #[test]
    fn pnpm_workspace_without_root_package_json_collapses() {
        let base = std::env::temp_dir().join("pv-walk-pnpm-no-pkg");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // No root package.json — only pnpm-workspace.yaml
        let pnpm = base.join("pnpm-workspace.yaml");
        let mut f = fs::File::create(&pnpm).unwrap();
        f.write_all(b"packages:\n  - 'apps/*'\n  - 'packages/*'\n").unwrap();
        write_json(
            &base.join("apps").join("api"),
            "package.json",
            r#"{"name": "@test/api","version": "0.0.0","scripts":{"dev":"vite"}}"#,
        );
        write_json(
            &base.join("packages").join("shared"),
            "package.json",
            r#"{"name": "@test/shared","version": "0.0.0"}"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, "pnpm workspace collapses into root");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root tagged monorepo");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("apps/api:")), "api tasks prefixed");
    }

    #[test]
    fn git_monorepo_collapses_into_root() {
        let base = std::env::temp_dir().join("pv-walk-git-mono");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // Root has package.json AND .git — but NO workspaces field
        write_json(
            &base,
            "package.json",
            r#"{"name": "onyx-manager","version": "0.0.0"}"#,
        );
        fs::create_dir_all(base.join(".git")).unwrap();
        write_json(
            &base.join("apps").join("api"),
            "package.json",
            r#"{"name": "@onyx-manager/api","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );
        write_json(
            &base.join("apps").join("web"),
            "package.json",
            r#"{"name": "@onyx-manager/web","version": "0.0.0","scripts":{"dev":"next"}}"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert_eq!(keys.len(), 1, ".git monorepo collapses into root");
        assert!(keys.contains(&path_key(&base)), "root stays");
        let root = merged.iter().find(|d| path_key(&d.root) == path_key(&base)).unwrap();
        assert!(root.tags.iter().any(|t| t == "monorepo"), "root tagged monorepo");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("apps/api:")), "api tasks prefixed");
        assert!(root.tasks.iter().any(|t| t.label.starts_with("apps/web:")), "web tasks prefixed");
    }

    #[test]
    fn nx_disables_collapse() {
        let base = std::env::temp_dir().join("pv-walk-nx");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        write_json(&base, "package.json", r#"{"name": "root","version": "0.0.0"}"#);
        let mut nx = fs::File::create(base.join("nx.json")).unwrap();
        nx.write_all(b"{}").unwrap();
        write_json(
            &base.join("apps").join("web"),
            "package.json",
            r#"{"name": "web","version": "0.0.0"}"#,
        );

        let reg = DetectorRegistry::standard(std::path::PathBuf::from("."));
        let mut e = 0u64;
        let raw = collect_projects_under_root(&reg, &base, &mut e);
        let mut m = 0u64;
        let mut w = 0u64;
        let merged = filter_workspaces_and_outermost(&reg, raw, &mut m, &mut w);
        let keys: HashSet<String> = merged.iter().map(|d| path_key(&d.root)).collect();
        assert!(keys.contains(&path_key(&base)), "nx root stays");
        assert!(
            keys.contains(&path_key(&base.join("apps").join("web"))),
            "nx child stays"
        );
        assert_eq!(keys.len(), 2);
    }
}
