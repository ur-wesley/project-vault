//! Parse `package.json` `workspaces`, resolve glob patterns to member directory keys, and enforce caps.
//! Unlisted nested packages still follow [`crate::discovery::walk::filter_outermost_projects`] unless a
//! workspace manifest applies; see [`crate::discovery::walk::filter_workspaces_and_outermost`].

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use glob::glob;
use serde_json::Value as JsonValue;

use crate::discovery::paths::{path_key, MAX_PATH_DEPTH as MAX_REL_DEPTH};
use crate::discovery::skip::path_has_skipped_dir_segment;

pub const MAX_WORKSPACE_MEMBERS: usize = 200;

fn workspaces_globs_from_value(v: &JsonValue) -> Option<Vec<String>> {
    let w = v.get("workspaces")?;
    if w.is_array() {
        let a: Vec<String> = w
            .as_array()?
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .filter(|s| !s.is_empty())
            .collect();
        return Some(a);
    }
    if w.is_object() {
        let a = w.as_object()?.get("packages")?.as_array()?;
        return Some(
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .filter(|s| !s.is_empty())
                .collect(),
        );
    }
    None
}

pub fn read_package_json_workspaces(manifest_dir: &Path) -> (Vec<String>, bool) {
    let p = manifest_dir.join("package.json");
    if !p.is_file() {
        return (Vec::new(), false);
    }
    let text = match fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return (Vec::new(), true),
    };
    let v: JsonValue = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (Vec::new(), true),
    };
    let Some(globs) = workspaces_globs_from_value(&v) else {
        return (Vec::new(), false);
    };
    (globs, false)
}

pub struct WorkspaceMemberResolve {
    pub members: HashSet<String>,
    pub truncated: bool,
}

fn depth_under_root(root: &Path, path: &Path) -> Option<usize> {
    let r = dunce::canonicalize(root)
        .or_else(|_| std::fs::canonicalize(root))
        .ok()?;
    let p = dunce::canonicalize(path)
        .or_else(|_| std::fs::canonicalize(path))
        .ok()?;
    let s = p.strip_prefix(&r).ok()?;
    let n = s
        .components()
        .filter(|c| {
            use std::path::Component;
            matches!(c, Component::Normal(_))
        })
        .count();
    Some(n)
}

fn glob_root_path(root: &Path) -> String {
    let c = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let s = dunce::simplified(&c);
    s.to_string_lossy().replace('\\', "/")
}

fn join_glob_root(root: &Path, pat: &str) -> String {
    let base = glob_root_path(root);
    let tail = pat.replace('\\', "/");
    if let Some(s) = tail.strip_prefix("./") {
        format!("{}/{}", base, s)
    } else {
        format!("{}/{}", base, tail)
    }
}

pub fn resolve_workspace_members(
    monorepo_root: &Path,
    globs: &[String],
    workspace_warnings: &mut u64,
) -> WorkspaceMemberResolve {
    let mut members: HashSet<String> = HashSet::new();
    let mut hit_cap = false;
    for pat in globs {
        if members.len() >= MAX_WORKSPACE_MEMBERS {
            hit_cap = true;
            break;
        }
        let pjoin = join_glob_root(monorepo_root, pat.trim());
        let g = match glob(&pjoin) {
            Ok(x) => x,
            Err(_) => {
                *workspace_warnings += 1;
                continue;
            }
        };
        for ent in g {
            if members.len() >= MAX_WORKSPACE_MEMBERS {
                hit_cap = true;
                break;
            }
            let path = match ent {
                Ok(p) => p,
                Err(_) => {
                    *workspace_warnings += 1;
                    continue;
                }
            };
            if !path.is_dir() {
                continue;
            }
            if path_has_skipped_dir_segment(&path) {
                continue;
            }
            let Some(d) = depth_under_root(monorepo_root, &path) else {
                continue;
            };
            if d > MAX_REL_DEPTH {
                continue;
            }
            members.insert(path_key(&path));
        }
        if hit_cap {
            break;
        }
    }
    let truncated = hit_cap;
    WorkspaceMemberResolve { members, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parse_workspaces_array_and_packages_object() {
        let a: JsonValue =
            serde_json::from_str(r#"{"name": "r", "workspaces": ["packages/*", "tooling/pkg-a"]}"#)
                .unwrap();
        let g = workspaces_globs_from_value(&a).unwrap();
        assert_eq!(g, vec!["packages/*", "tooling/pkg-a"]);

        let b: JsonValue =
            serde_json::from_str(r#"{"name": "r", "workspaces": {"packages": ["apps/*", "lib"]}}"#)
                .unwrap();
        let g2 = workspaces_globs_from_value(&b).unwrap();
        assert_eq!(g2, vec!["apps/*", "lib"]);
    }

    fn write_pkg(dir: &Path, name: &str) {
        fs::create_dir_all(dir).unwrap();
        let mut f = fs::File::create(dir.join("package.json")).unwrap();
        writeln!(
            f,
            r#"{{"name": "{}", "private": true, "version": "0.0.0"}}"#,
            name
        )
        .unwrap();
    }

    #[test]
    fn resolve_finds_two_packages_excludes_node_modules() {
        let base = std::env::temp_dir().join("pv-mono-test");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let mut root = fs::File::create(base.join("package.json")).unwrap();
        writeln!(
            root,
            r#"{{"name": "m", "private": true, "workspaces": ["packages/*"]}}"#
        )
        .unwrap();
        let pkg1 = base.join("packages").join("a");
        let pkg2 = base.join("packages").join("b");
        let nm = base.join("node_modules").join("x");
        write_pkg(&pkg1, "a");
        write_pkg(&pkg2, "b");
        write_pkg(&nm, "x");
        let mut w = 0u64;
        let (g, _) = read_package_json_workspaces(&base);
        let r = resolve_workspace_members(&base, &g, &mut w);
        assert_eq!(
            r.members.len(),
            2,
            "expected two workspace packages, got {:?}",
            r.members
        );
        let a_key = path_key(&pkg1);
        let b_key = path_key(&pkg2);
        assert!(r.members.contains(&a_key), "missing a");
        assert!(r.members.contains(&b_key), "missing b");
        let n_key = path_key(&nm);
        assert!(
            !r.members.contains(&n_key),
            "node_modules should not be a member"
        );
    }

    #[test]
    fn missing_workspaces_is_empty() {
        let t: JsonValue = serde_json::from_str(r#"{"name": "n"}"#).unwrap();
        assert!(workspaces_globs_from_value(&t).is_none());
    }
}
