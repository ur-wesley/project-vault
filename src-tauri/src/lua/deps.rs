use mlua::{Lua, Table, Value};
use mlua::LuaSerdeExt;
use serde::{Deserialize, Serialize};

pub const VENDOR_LOCK_FILE: &str = "vendor-lock.luau";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum PluginDependency {
    Id(String),
    Spec(PluginDependencySpec),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginDependencySpec {
    pub id: String,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
}

impl PluginDependency {
    pub fn id(&self) -> &str {
        match self {
            PluginDependency::Id(id) => id,
            PluginDependency::Spec(spec) => &spec.id,
        }
    }

    pub fn repo(&self) -> Option<&str> {
        match self {
            PluginDependency::Id(_) => None,
            PluginDependency::Spec(spec) => spec.repo.as_deref(),
        }
    }

    pub fn dir(&self) -> Option<&str> {
        match self {
            PluginDependency::Id(_) => None,
            PluginDependency::Spec(spec) => spec.dir.as_deref(),
        }
    }

    pub fn pin_ref(&self) -> Option<&str> {
        match self {
            PluginDependency::Id(_) => None,
            PluginDependency::Spec(spec) => spec
                .branch
                .as_deref()
                .or(spec.tag.as_deref())
                .or(spec.commit.as_deref()),
        }
    }

    pub fn from_id(id: impl Into<String>) -> Self {
        PluginDependency::Id(id.into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ExternalDependency {
    Id(String),
    Spec(ExternalDependencySpec),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalDependencySpec {
    pub id: String,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
}

impl ExternalDependency {
    pub fn id(&self) -> &str {
        match self {
            ExternalDependency::Id(id) => id,
            ExternalDependency::Spec(spec) => &spec.id,
        }
    }

    pub fn repo(&self) -> Option<&str> {
        match self {
            ExternalDependency::Id(_) => None,
            ExternalDependency::Spec(spec) => spec.repo.as_deref(),
        }
    }

    pub fn main_path(&self) -> &str {
        match self {
            ExternalDependency::Id(_) => "init.luau",
            ExternalDependency::Spec(spec) => spec.main.as_deref().unwrap_or("init.luau"),
        }
    }

    pub fn pin_ref(&self) -> Option<&str> {
        match self {
            ExternalDependency::Id(_) => None,
            ExternalDependency::Spec(spec) => spec
                .branch
                .as_deref()
                .or(spec.tag.as_deref())
                .or(spec.commit.as_deref()),
        }
    }

    pub fn to_lock_entry(&self, resolved_commit: Option<String>) -> ExternalLockEntry {
        match self {
            ExternalDependency::Id(id) => ExternalLockEntry {
                id: id.clone(),
                repo: String::new(),
                main: "init.luau".to_string(),
                commit: resolved_commit.unwrap_or_default(),
            },
            ExternalDependency::Spec(spec) => ExternalLockEntry {
                id: spec.id.clone(),
                repo: spec.repo.clone().unwrap_or_default(),
                main: spec.main.clone().unwrap_or_else(|| "init.luau".to_string()),
                commit: resolved_commit
                    .or_else(|| spec.commit.clone())
                    .unwrap_or_default(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalLockEntry {
    pub id: String,
    pub repo: String,
    pub main: String,
    pub commit: String,
}

pub fn parse_plugin_dependencies(table: &Table) -> Option<Vec<PluginDependency>> {
    parse_dependency_list(table, "dependencies", parse_plugin_dependency_value)
}

pub fn parse_external_dependencies(table: &Table) -> Option<Vec<ExternalDependency>> {
    parse_dependency_list(table, "externals", parse_external_dependency_value)
}

fn parse_dependency_list<T, F>(table: &Table, key: &str, parse_item: F) -> Option<Vec<T>>
where
    F: Fn(Value) -> Option<T>,
{
    let list_tbl: Table = table.get(key).ok()?;
    let mut values = Vec::new();
    for value in list_tbl.sequence_values::<Value>().flatten() {
        if let Some(parsed) = parse_item(value) {
            values.push(parsed);
        }
    }
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn parse_plugin_dependency_value(value: Value) -> Option<PluginDependency> {
    match value {
        Value::String(s) => Some(PluginDependency::Id(s.to_str().ok()?.to_string())),
        Value::Table(t) => {
            let id: String = t.get("id").ok()?;
            Some(PluginDependency::Spec(PluginDependencySpec {
                id,
                repo: t.get("repo").ok(),
                dir: t.get("dir").ok(),
                branch: t.get("branch").ok(),
                tag: t.get("tag").ok(),
                commit: t.get("commit").ok(),
            }))
        }
        _ => None,
    }
}

fn parse_external_dependency_value(value: Value) -> Option<ExternalDependency> {
    match value {
        Value::String(s) => Some(ExternalDependency::Id(s.to_str().ok()?.to_string())),
        Value::Table(t) => {
            let id: String = t.get("id").ok()?;
            Some(ExternalDependency::Spec(ExternalDependencySpec {
                id,
                repo: t.get("repo").ok(),
                main: t.get("main").ok(),
                branch: t.get("branch").ok(),
                tag: t.get("tag").ok(),
                commit: t.get("commit").ok(),
            }))
        }
        _ => None,
    }
}

pub fn dependency_ids(deps: &[PluginDependency]) -> Vec<String> {
    deps.iter().map(|d| d.id().to_string()).collect()
}

pub fn external_ids(exts: &[ExternalDependency]) -> Vec<String> {
    exts.iter().map(|e| e.id().to_string()).collect()
}

pub fn is_allowed_git_url(repo: &str) -> bool {
    repo.starts_with("https://") || repo.starts_with("git@") || repo.starts_with("ssh://")
}

pub fn load_vendor_lock(lua: &Lua, path: &std::path::Path) -> Vec<ExternalLockEntry> {
    if !path.is_file() {
        return Vec::new();
    }
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(val) = lua.load(&content).eval() else {
        return Vec::new();
    };
    lua.from_value(val).unwrap_or_default()
}

pub fn write_vendor_lock(path: &std::path::Path, entries: &[ExternalLockEntry]) -> std::io::Result<()> {
    let mut content = String::from("--!strict\n-- Auto-generated vendor lock\nreturn {\n");
    for entry in entries {
        content.push_str("  {\n");
        content.push_str(&format!("    id = \"{}\",\n", entry.id));
        content.push_str(&format!("    repo = \"{}\",\n", entry.repo));
        content.push_str(&format!("    main = \"{}\",\n", entry.main));
        content.push_str(&format!("    commit = \"{}\",\n", entry.commit));
        content.push_str("  },\n");
    }
    content.push_str("}\n");
    std::fs::write(path, content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_dependency_id_accessor() {
        let d = PluginDependency::Spec(PluginDependencySpec {
            id: "telescope".into(),
            repo: Some("https://github.com/x/pv-plugins".into()),
            dir: Some("telescope".into()),
            branch: None,
            tag: None,
            commit: None,
        });
        assert_eq!(d.id(), "telescope");
        assert_eq!(d.repo(), Some("https://github.com/x/pv-plugins"));
    }

    #[test]
    fn git_url_validation() {
        assert!(is_allowed_git_url("https://github.com/a/b"));
        assert!(is_allowed_git_url("git@github.com:a/b.git"));
        assert!(!is_allowed_git_url("file:///tmp/x"));
    }

    #[test]
    fn parse_dependencies_from_lua_table() {
        let lua = crate::lua::engine::LuaEngine::create_instance().unwrap();
        let table: Table = lua
            .load(
                r#"return {
  dependencies = { "telescope", { id = "mise", repo = "https://github.com/x/r", dir = "mise" } },
  externals = { { id = "fuse", repo = "https://github.com/x/fuse", main = "init.luau" } },
}"#,
            )
            .eval()
            .unwrap();
        let deps = parse_plugin_dependencies(&table).unwrap();
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].id(), "telescope");
        assert_eq!(deps[1].repo(), Some("https://github.com/x/r"));

        let exts = parse_external_dependencies(&table).unwrap();
        assert_eq!(exts[0].id(), "fuse");
        assert_eq!(exts[0].main_path(), "init.luau");
    }
}
