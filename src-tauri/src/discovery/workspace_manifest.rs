//! Unified workspace detection for all monorepo formats.
//!
//! Detects workspace manifests across package.json, pnpm, Cargo, Go, UV, Nx, and Turborepo.
//! Produces [`WorkspaceManifest`] values that drive the filtering logic in [`crate::discovery::walk`].

use std::collections::HashSet;
use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::paths::path_key;
use crate::discovery::workspace::{read_package_json_workspaces, resolve_workspace_members};

#[derive(Debug, Clone, PartialEq)]
pub enum WorkspaceType {
    PackageJson,
    Pnpm,
    Cargo,
    Go,
    Uv,
    Nx,
    Turbo,
}

#[derive(Debug, Clone)]
pub struct WorkspaceManifest {
    pub root_key: String,
    pub member_keys: HashSet<String>,
    pub workspace_type: WorkspaceType,
    pub overlay_tags: Vec<String>,
    /// When true, do not collapse any descendant projects into this root.
    /// Used for Nx where the project graph is opaque to us.
    pub disable_collapse: bool,
}

/// Scan every draft directory for a workspace manifest and return all manifests found.
pub fn detect_all_workspaces(
    drafts: &[ProjectDraft],
    workspace_warnings: &mut u64,
) -> Vec<WorkspaceManifest> {
    let mut manifests = Vec::new();
    let mut seen_roots: HashSet<String> = HashSet::new();

    for draft in drafts {
        let k = path_key(&draft.root);
        if seen_roots.contains(&k) {
            continue;
        }
        if let Some(manifest) = detect_workspace_at(&draft.root, workspace_warnings) {
            seen_roots.insert(manifest.root_key.clone());
            manifests.push(manifest);
        }
    }

    manifests
}

fn detect_workspace_at(
    path: &Path,
    workspace_warnings: &mut u64,
) -> Option<WorkspaceManifest> {
    let root_key = path_key(path);
    let mut overlay_tags: Vec<String> = Vec::new();

    // Detect Turbo (tag-only overlay on top of another workspace)
    let has_turbo = path.join("turbo.json").is_file();
    if has_turbo {
        overlay_tags.push("turborepo".into());
    }

    // Nx is special: we don't know members, we just disable collapse
    if path.join("nx.json").is_file() {
        overlay_tags.push("nx".into());
        return Some(WorkspaceManifest {
            root_key,
            member_keys: HashSet::new(),
            workspace_type: WorkspaceType::Nx,
            overlay_tags,
            disable_collapse: true,
        });
    }

    // package.json workspaces
    let (pj_globs, pj_err) = read_package_json_workspaces(path);
    if pj_err {
        *workspace_warnings += 1;
    }
    if !pj_globs.is_empty() {
        let res = resolve_workspace_members(path, &pj_globs, workspace_warnings);
        if res.truncated {
            *workspace_warnings += 1;
        }
        return Some(WorkspaceManifest {
            root_key,
            member_keys: res.members,
            workspace_type: WorkspaceType::PackageJson,
            overlay_tags,
            disable_collapse: false,
        });
    }

    // pnpm-workspace.yaml
    let pnpm_globs = read_pnpm_workspace(path);
    if !pnpm_globs.is_empty() {
        let res = resolve_workspace_members(path, &pnpm_globs, workspace_warnings);
        if res.truncated {
            *workspace_warnings += 1;
        }
        return Some(WorkspaceManifest {
            root_key,
            member_keys: res.members,
            workspace_type: WorkspaceType::Pnpm,
            overlay_tags,
            disable_collapse: false,
        });
    }

    // Cargo.toml workspace
    let cargo_globs = read_cargo_workspace(path);
    if !cargo_globs.is_empty() {
        let res = resolve_workspace_members(path, &cargo_globs, workspace_warnings);
        if res.truncated {
            *workspace_warnings += 1;
        }
        return Some(WorkspaceManifest {
            root_key,
            member_keys: res.members,
            workspace_type: WorkspaceType::Cargo,
            overlay_tags,
            disable_collapse: false,
        });
    }

    // go.work
    let go_members = read_go_workspace(path);
    if !go_members.is_empty() {
        return Some(WorkspaceManifest {
            root_key,
            member_keys: go_members,
            workspace_type: WorkspaceType::Go,
            overlay_tags,
            disable_collapse: false,
        });
    }

    // UV / PEP 735 workspace
    let uv_members = read_uv_workspace(path);
    if !uv_members.is_empty() {
        return Some(WorkspaceManifest {
            root_key,
            member_keys: uv_members,
            workspace_type: WorkspaceType::Uv,
            overlay_tags,
            disable_collapse: false,
        });
    }

    None
}

// ── Parsers ──────────────────────────────────────────────────────────────

/// Read `pnpm-workspace.yaml` and return the `packages:` globs.
pub fn read_pnpm_workspace(path: &Path) -> Vec<String> {
    let p = path.join("pnpm-workspace.yaml");
    if !p.is_file() {
        return Vec::new();
    }
    let text = match std::fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut in_packages = false;
    let mut globs = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("packages:") {
            in_packages = true;
            continue;
        }
        if in_packages {
            if trimmed.starts_with('-') {
                let glob = trimmed
                    .trim_start_matches('-')
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
                if !glob.is_empty() {
                    globs.push(glob);
                }
            } else if !trimmed.is_empty() && !trimmed.starts_with('#') {
                // dedented -> packages section ended
                in_packages = false;
            }
        }
    }
    globs
}

/// Read `Cargo.toml` and return `[workspace].members` globs.
pub fn read_cargo_workspace(path: &Path) -> Vec<String> {
    let p = path.join("Cargo.toml");
    if !p.is_file() {
        return Vec::new();
    }
    let text = match std::fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let v: toml::Value = match toml::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let workspace = match v.get("workspace") {
        Some(w) => w,
        None => return Vec::new(),
    };

    let members = match workspace.get("members").and_then(|m| m.as_array()) {
        Some(a) => a,
        None => return Vec::new(),
    };

    members
        .iter()
        .filter_map(|m| m.as_str().map(String::from))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Read `go.work` and return explicit member directory keys.
pub fn read_go_workspace(path: &Path) -> HashSet<String> {
    let p = path.join("go.work");
    if !p.is_file() {
        return HashSet::new();
    }
    let text = match std::fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return HashSet::new(),
    };

    let mut members = HashSet::new();
    for line in text.lines() {
        let t = line.trim();
        // go.work lines look like: use ./api
        if !t.starts_with("use") {
            continue;
        }
        let mut parts = t.split_ascii_whitespace();
        let _cmd = parts.next();
        if let Some(rel) = parts.next() {
            let clean = rel.trim_matches('"').trim_matches('\'');
            if clean.starts_with("./") || clean.starts_with("../") || !clean.starts_with('/') {
                let abs = path.join(clean);
                if abs.is_dir() {
                    members.insert(path_key(&abs));
                }
            }
        }
    }
    members
}

/// Read `pyproject.toml` for UV/PEP-735 workspace members.
pub fn read_uv_workspace(path: &Path) -> HashSet<String> {
    let p = path.join("pyproject.toml");
    if !p.is_file() {
        return HashSet::new();
    }
    let text = match std::fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return HashSet::new(),
    };
    let v: toml::Value = match toml::from_str(&text) {
        Ok(v) => v,
        Err(_) => return HashSet::new(),
    };

    // tool.uv.workspace.members
    let tool = match v.get("tool") {
        Some(t) => t,
        None => return HashSet::new(),
    };
    let uv = match tool.get("uv") {
        Some(u) => u,
        None => return HashSet::new(),
    };
    let workspace = match uv.get("workspace") {
        Some(w) => w,
        None => return HashSet::new(),
    };
    let members = match workspace.get("members").and_then(|m| m.as_array()) {
        Some(a) => a,
        None => return HashSet::new(),
    };

    let mut result = HashSet::new();
    for m in members {
        if let Some(glob) = m.as_str() {
            let clean = glob.trim();
            if clean.is_empty() {
                continue;
            }
            let abs = path.join(clean);
            if abs.is_dir() {
                result.insert(path_key(&abs));
            } else {
                // Treat as glob – try to resolve
                let res = resolve_workspace_members(path, &[clean.to_string()], &mut 0);
                for mk in res.members {
                    result.insert(mk);
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn pnpm_workspace_parses_packages() {
        let base = std::env::temp_dir().join("pv-pnpm-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        write_file(
            &base,
            "pnpm-workspace.yaml",
            "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
        );
        let globs = read_pnpm_workspace(&base);
        assert_eq!(globs, vec!["packages/*", "apps/*"]);
    }

    #[test]
    fn cargo_workspace_parses_members() {
        let base = std::env::temp_dir().join("pv-cargo-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        write_file(
            &base,
            "Cargo.toml",
            r#"[workspace]
members = ["crates/*", "tools/cli"]
"#,
        );
        let globs = read_cargo_workspace(&base);
        assert_eq!(globs, vec!["crates/*", "tools/cli"]);
    }

    #[test]
    fn go_workspace_parses_use_directives() {
        let base = std::env::temp_dir().join("pv-go-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(base.join("api")).unwrap();
        write_file(
            &base,
            "go.work",
            r#"go 1.21

use ./api
"#,
        );
        let members = read_go_workspace(&base);
        assert_eq!(members.len(), 1);
        assert!(members.contains(&path_key(&base.join("api"))));
    }

    #[test]
    fn uv_workspace_parses_members() {
        let base = std::env::temp_dir().join("pv-uv-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(base.join("packages").join("core")).unwrap();
        write_file(
            &base,
            "pyproject.toml",
            r#"[tool.uv.workspace]
members = ["packages/*"]
"#,
        );
        let members = read_uv_workspace(&base);
        assert_eq!(members.len(), 1);
        assert!(members.contains(&path_key(&base.join("packages").join("core"))));
    }
}
