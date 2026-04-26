use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{codes, StableError};
use crate::fs_scope_util;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummaryDto {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectPayload {
    pub parent_path: String,
    pub project_name: String,
    pub template_id: String,
    pub run_post_create: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResultDto {
    pub project_path: String,
    pub files_written: u32,
    pub post_create_log: Option<String>,
}

struct TemplateDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    build_files: fn(&str, &str) -> Vec<(String, String)>,
    post_create: &'static [&'static str],
}

fn slugify(raw: &str) -> String {
    let s = raw.trim().to_lowercase();
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in s.chars() {
        let next = match ch {
            'a'..='z' | '0'..='9' => Some(ch),
            '_' | '-' | ' ' => Some('-'),
            _ => None,
        };
        if let Some(c) = next {
            if c == '-' {
                if !out.is_empty() && !prev_dash {
                    out.push('-');
                    prev_dash = true;
                }
            } else {
                out.push(c);
                prev_dash = false;
            }
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn bun_typescript_files(slug: &str, display: &str) -> Vec<(String, String)> {
    let pkg = format!(
        r#"{{
  "name": "{slug}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {{
    "dev": "bun run src/index.ts",
    "start": "bun run src/index.ts"
  }}
}}
"#
    );
    let tsconfig = r#"{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
"#
    .to_string();
    let index_ts = format!(
        r#"const title = "{display}";

console.log(`${{title}} — Bun + TypeScript`);

export {{}};
"#
    );
    let gitignore = "node_modules\ndist\n.DS_Store\n".to_string();
    let readme = format!("# {display}\n\nRun `bun install` then `bun run dev`.\n");
    vec![
        ("package.json".into(), pkg),
        ("tsconfig.json".into(), tsconfig),
        ("src/index.ts".into(), index_ts),
        (".gitignore".into(), gitignore),
        ("README.md".into(), readme),
    ]
}

fn node_typescript_files(slug: &str, display: &str) -> Vec<(String, String)> {
    let pkg = format!(
        r#"{{
  "name": "{slug}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {{
    "dev": "node --watch src/index.ts",
    "start": "node src/index.ts"
  }}
}}
"#
    );
    let tsconfig = r#"{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
"#
    .to_string();
    let index_ts = format!(
        r#"const title = "{display}";

console.log(`${{title}} — Node + TypeScript`);

export {{}};
"#
    );
    let gitignore = "node_modules\ndist\n.DS_Store\n".to_string();
    let readme =
        format!("# {display}\n\nRequires Node 18+. Run `npm install` then `npm run dev`.\n");
    vec![
        ("package.json".into(), pkg),
        ("tsconfig.json".into(), tsconfig),
        ("src/index.ts".into(), index_ts),
        (".gitignore".into(), gitignore),
        ("README.md".into(), readme),
    ]
}

fn builtin_defs() -> &'static [TemplateDef] {
    &[
        TemplateDef {
            id: "bun-typescript",
            name: "Bun + TypeScript",
            description: "Minimal Bun project with TypeScript entrypoint.",
            build_files: bun_typescript_files,
            post_create: &["bun install"],
        },
        TemplateDef {
            id: "node-typescript",
            name: "Node + TypeScript",
            description: "Minimal Node ESM project with TypeScript (no bundler).",
            build_files: node_typescript_files,
            post_create: &["npm install"],
        },
    ]
}

fn find_def(id: &str) -> Option<&'static TemplateDef> {
    builtin_defs().iter().find(|t| t.id == id)
}

#[tauri::command]
pub fn list_project_templates() -> Vec<TemplateSummaryDto> {
    builtin_defs()
        .iter()
        .map(|t| TemplateSummaryDto {
            id: t.id.to_string(),
            name: t.name.to_string(),
            description: t.description.to_string(),
        })
        .collect()
}

fn write_tree(root: &Path, files: &[(String, String)]) -> Result<u32, StableError> {
    let mut n = 0u32;
    for (rel, content) in files {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                StableError::new(
                    codes::INTERNAL,
                    format!("mkdir {}: {}", parent.display(), e),
                )
            })?;
        }
        let mut f = fs::File::create(&path).map_err(|e| {
            StableError::new(codes::INTERNAL, format!("create {}: {}", path.display(), e))
        })?;
        f.write_all(content.as_bytes()).map_err(|e| {
            StableError::new(codes::INTERNAL, format!("write {}: {}", path.display(), e))
        })?;
        n += 1;
    }
    Ok(n)
}

fn run_post_create_hooks(root: &Path, hooks: &[&str]) -> Result<String, StableError> {
    let mut log = String::new();
    for line in hooks {
        let out = if cfg!(windows) {
            std::process::Command::new("cmd")
                .args(["/C", line])
                .current_dir(root)
                .output()
        } else {
            std::process::Command::new("sh")
                .args(["-lc", line])
                .current_dir(root)
                .output()
        }
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
        log.push_str(&format!("$ {}\n", line));
        if !out.stdout.is_empty() {
            log.push_str(&String::from_utf8_lossy(&out.stdout));
        }
        if !out.stderr.is_empty() {
            log.push_str(&String::from_utf8_lossy(&out.stderr));
        }
        if !out.status.success() {
            return Err(StableError::new(
                codes::SPAWN_FAILED,
                format!("post-create step failed: {}\n{}", line, log),
            ));
        }
    }
    Ok(log)
}

#[tauri::command]
pub fn create_project_from_template(
    app: AppHandle,
    payload: CreateProjectPayload,
) -> Result<CreateProjectResultDto, StableError> {
    let parent = PathBuf::from(payload.parent_path.trim());
    if !parent.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "parent path is not a directory",
        ));
    }
    let t = find_def(&payload.template_id)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "unknown template"))?;
    let display = payload.project_name.trim();
    if display.is_empty() || display == "." || display == ".." {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "invalid project name",
        ));
    }
    if display.contains('/') || display.contains('\\') {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project name must not contain path separators",
        ));
    }
    let slug = slugify(display);
    if slug.is_empty() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project name must contain letters or digits",
        ));
    }
    fs_scope_util::allow_library_root(&app, parent.to_str().unwrap_or(""))?;
    let root = parent.join(&slug);
    if root.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "a file or folder with that name already exists",
        ));
    }
    fs::create_dir_all(&root).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("create project directory: {}", e))
    })?;
    let files = (t.build_files)(&slug, display);
    let files_written = write_tree(&root, &files)?;
    fs_scope_util::allow_library_root(&app, root.to_str().unwrap_or(""))?;
    let post_create_log = if payload.run_post_create && !t.post_create.is_empty() {
        Some(run_post_create_hooks(&root, t.post_create)?)
    } else {
        None
    };
    Ok(CreateProjectResultDto {
        project_path: dunce::canonicalize(&root)
            .unwrap_or(root)
            .to_string_lossy()
            .into_owned(),
        files_written,
        post_create_log,
    })
}
