use std::fs;
use std::path::Path;

use serde_json::Value as JsonValue;

use crate::models::TaskDto;

pub fn dirname_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".into())
}

pub fn read_utf8(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

pub fn deps_has_package(v: &JsonValue, pkg: &str) -> bool {
    for key in [
        "devDependencies",
        "dependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(o) = v.get(key).and_then(|x| x.as_object()) else {
            continue;
        };
        if o.contains_key(pkg) {
            return true;
        }
    }
    false
}

pub fn root_has_tsconfig_json(root: &Path) -> bool {
    let Ok(read) = fs::read_dir(root) else {
        return false;
    };
    for e in read.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let osname = e.file_name();
        let Some(name) = osname.to_str() else {
            continue;
        };
        if name.starts_with("tsconfig") && name.ends_with(".json") {
            return true;
        }
    }
    false
}

pub fn dir_has_typescript_source_file(dir: &Path) -> bool {
    const EXT: [&str; 4] = ["ts", "tsx", "mts", "cts"];
    let Ok(read) = fs::read_dir(dir) else {
        return false;
    };
    for e in read.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if let Some(ext) = e.path().extension().and_then(|x| x.to_str()) {
            if EXT.contains(&ext) {
                return true;
            }
        }
    }
    false
}

pub fn package_json_types_entry_is_ts(v: &JsonValue) -> bool {
    for key in ["types", "typings"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            let t = s.trim();
            if t.ends_with(".d.ts")
                || t.ends_with(".ts")
                || t.ends_with(".tsx")
                || t.ends_with(".mts")
                || t.ends_with(".cts")
            {
                return true;
            }
        }
    }
    false
}

pub fn project_looks_typescript(v: &JsonValue, root: &Path) -> bool {
    if root_has_tsconfig_json(root) {
        return true;
    }
    if dir_has_typescript_source_file(root) {
        return true;
    }
    if dir_has_typescript_source_file(&root.join("src")) {
        return true;
    }
    if package_json_types_entry_is_ts(v) {
        return true;
    }
    if deps_has_package(v, "typescript") {
        return true;
    }
    false
}

pub fn package_json_stack(v: &JsonValue, root: &Path) -> String {
    if project_looks_typescript(v, root) {
        return "typescript".into();
    }
    "javascript".into()
}

pub fn package_json_looks_real(v: &JsonValue) -> bool {
    let Some(o) = v.as_object() else {
        return false;
    };
    if o.is_empty() {
        return false;
    }
    // If it has scripts or dependencies, we definitely want it
    if o.get("scripts").is_some()
        || o.get("dependencies").is_some()
        || o.get("devDependencies").is_some()
    {
        return true;
    }
    // A workspace manifest is always a real project (monorepo root)
    if o.get("workspaces").is_some() {
        return true;
    }
    // Otherwise, check if it has at least 1 common key to avoid random JSON files
    let common_keys = [
        "name",
        "version",
        "description",
        "main",
        "type",
        "author",
        "license",
        "private",
        "packageManager",
    ];
    let count = o
        .keys()
        .filter(|k| common_keys.contains(&k.as_str()))
        .count();
    count >= 1
}

pub fn requirements_txt_has_package_line(s: &str) -> bool {
    s.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with('#') && t.chars().any(|c| c.is_ascii_alphanumeric())
    })
}

pub fn script_task(id: &str, label: &str, argv: Vec<String>) -> TaskDto {
    TaskDto {
        id: id.to_string(),
        label: label.to_string(),
        argv,
        kind: "script".into(),
        cwd: None,
        description: None,
        depends: Vec::new(),
        source: None,
    }
}
