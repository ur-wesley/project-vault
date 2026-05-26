use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use crate::fs_scope_util;
use crate::models::ProjectDto;
use crate::spawn::EmbeddedTerminals;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::spawn::TerminalBuffers;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummaryDto {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub template_type: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectPayload {
    pub location_id: String,
    pub project_name: String,
    pub template_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResultDto {
    pub project_path: String,
    pub files_written: u32,
    pub post_create_log: Option<String>,
    pub session_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTemplateCommandPayload {
    pub command: String,
    pub cwd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTemplateCommandResultDto {
    pub session_id: String,
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

fn default_templates() -> Vec<TemplateSummaryDto> {
    vec![
        TemplateSummaryDto {
            id: "bun-ts".into(),
            name: "Bun + TypeScript".into(),
            description: "Interactive bun init".into(),
            template_type: "command".into(),
            config: serde_json::json!({
                "command": "bun init",
                "cwd": "project"
            }),
        },
        TemplateSummaryDto {
            id: "cargo".into(),
            name: "Rust (Cargo)".into(),
            description: "cargo new {name}".into(),
            template_type: "command".into(),
            config: serde_json::json!({
                "command": "cargo new {name}",
                "cwd": "parent"
            }),
        },
        TemplateSummaryDto {
            id: "go-mod".into(),
            name: "Go Module".into(),
            description: "go mod init + basic structure".into(),
            template_type: "command".into(),
            config: serde_json::json!({
                "command": "go mod init {name}",
                "cwd": "project",
                "postCreate": ["echo 'package main\\n\\nimport \"fmt\"\\n\\nfunc main() {\\n\\tfmt.Println(\"Hello, {name}!\")\\n}' > main.go"]
            }),
        },
        TemplateSummaryDto {
            id: "dotnet-web".into(),
            name: "ASP.NET Core".into(),
            description: "dotnet new web".into(),
            template_type: "command".into(),
            config: serde_json::json!({
                "command": "dotnet new web -n {name}",
                "cwd": "parent"
            }),
        },
        TemplateSummaryDto {
            id: "tauri-app".into(),
            name: "Tauri App".into(),
            description: "bun create tauri-app".into(),
            template_type: "command".into(),
            config: serde_json::json!({
                "command": "bun create tauri-app {name}",
                "cwd": "parent"
            }),
        },
        TemplateSummaryDto {
            id: "node-ts".into(),
            name: "Node + TypeScript".into(),
            description: "Minimal Node ESM project with TypeScript".into(),
            template_type: "files".into(),
            config: serde_json::json!({
                "files": {
                    "package.json": "{\n  \"name\": \"{name}\",\n  \"version\": \"0.1.0\",\n  \"type\": \"module\",\n  \"scripts\": {\n    \"dev\": \"node --watch src/index.ts\"\n  }\n}\n",
                    "tsconfig.json": "{\n  \"compilerOptions\": {\n    \"target\": \"ES2022\",\n    \"module\": \"ESNext\",\n    \"moduleResolution\": \"bundler\",\n    \"strict\": true,\n    \"skipLibCheck\": true,\n    \"noEmit\": true\n  },\n  \"include\": [\"src/**/*\"]\n}\n",
                    "src/index.ts": "const title = \"{name}\";\n\nconsole.log(`${title} — Node + TypeScript`);\n\nexport {};\n",
                    ".gitignore": "node_modules\ndist\n.DS_Store\n",
                    "README.md": "# {name}\n\nRequires Node 18+. Run `npm install` then `npm run dev`.\n"
                }
            }),
        },
    ]
}

async fn load_templates(db: State<'_, DbInstances>) -> Result<Vec<TemplateSummaryDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let raw = db::get_setting(&pool, "project_templates").await?;
    let list: Vec<TemplateSummaryDto> = match raw {
        Some(json) => {
            let parsed: Vec<TemplateSummaryDto> = serde_json::from_str(&json).unwrap_or_default();
            if parsed.is_empty() {
                default_templates()
            } else {
                parsed
            }
        }
        None => default_templates(),
    };
    Ok(list)
}

fn find_template<'a>(templates: &'a [TemplateSummaryDto], id: &str) -> Option<&'a TemplateSummaryDto> {
    templates.iter().find(|t| t.id == id)
}

fn replace_vars(input: &str, name: &str) -> String {
    input.replace("{name}", name)
}

fn write_files(root: &Path, files: &HashMap<String, String>, name: &str) -> Result<u32, StableError> {
    let mut n = 0u32;
    for (rel, content) in files {
        let rel = replace_vars(rel, name);
        let content = replace_vars(content, name);
        let path = root.join(&rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                StableError::new(codes::INTERNAL, format!("mkdir {}: {}", parent.display(), e))
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

async fn download_github_template(
    source: &str,
    branch: &str,
    target: &Path,
) -> Result<(), StableError> {
    // Parse owner/repo from URL like https://github.com/owner/repo
    let parts: Vec<&str> = source.trim_end_matches('/').split('/').collect();
    let (owner, repo) = if parts.len() >= 2 {
        (parts[parts.len() - 2], parts[parts.len() - 1])
    } else {
        return Err(StableError::new(codes::INVALID_PATH, "invalid github url"));
    };

    let url = format!(
        "https://codeload.github.com/{}/{}/zip/refs/heads/{}",
        owner, repo, branch
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "Project Vault")
        .send()
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, format!("download failed: {}", e)))?;

    if !resp.status().is_success() {
        return Err(StableError::new(
            codes::INTERNAL,
            format!("github download failed: {}", resp.status()),
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, format!("download read failed: {}", e)))?;

    let temp_zip = target.join(".tmp-template.zip");
    fs::write(&temp_zip, &bytes).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("write zip: {}", e))
    })?;

    let file = fs::File::open(&temp_zip).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("open zip: {}", e))
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("parse zip: {}", e))
    })?;

    let prefix = format!("{}-{}/", repo, branch);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            StableError::new(codes::INTERNAL, format!("zip entry: {}", e))
        })?;
        let name = entry.name();
        if !name.starts_with(&prefix) {
            continue;
        }
        let rel = &name[prefix.len()..];
        if rel.is_empty() || rel.ends_with('/') {
            continue;
        }
        let out_path = target.join(rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                StableError::new(codes::INTERNAL, format!("mkdir: {}", e))
            })?;
        }
        let mut out_file = fs::File::create(&out_path).map_err(|e| {
            StableError::new(codes::INTERNAL, format!("create file: {}", e))
        })?;
        let mut buf = [0u8; 4096];
        loop {
            let n = entry.read(&mut buf).map_err(|e| {
                StableError::new(codes::INTERNAL, format!("read zip: {}", e))
            })?;
            if n == 0 {
                break;
            }
            out_file.write_all(&buf[..n]).map_err(|e| {
                StableError::new(codes::INTERNAL, format!("write file: {}", e))
            })?;
        }
    }

    drop(archive);
    let _ = fs::remove_file(&temp_zip);

    Ok(())
}

#[tauri::command]
pub async fn list_project_templates(
    db: State<'_, DbInstances>,
) -> Result<Vec<TemplateSummaryDto>, StableError> {
    load_templates(db).await
}

#[tauri::command]
pub async fn save_project_templates(
    db: State<'_, DbInstances>,
    templates_json: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    // Validate JSON
    let _: Vec<TemplateSummaryDto> = serde_json::from_str(&templates_json)
        .map_err(|e| StableError::new(codes::INVALID_PATH, format!("invalid templates json: {}", e)))?;
    db::set_setting(&pool, "project_templates", &templates_json).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_project_from_template(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: CreateProjectPayload,
) -> Result<CreateProjectResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let location = db::get_location(&pool, &payload.location_id).await?;
    let parent = PathBuf::from(&location.path);
    if !parent.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "location path is not a directory",
        ));
    }

    let templates = load_templates(db.clone()).await?;
    let t = find_template(&templates, &payload.template_id)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "unknown template"))?;

    let display = payload.project_name.trim();
    if display.is_empty() || display == "." || display == ".." {
        return Err(StableError::new(codes::INVALID_PATH, "invalid project name"));
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

    let template_type = t.template_type.as_str();
    let config = &t.config;

    let result = match template_type {
        "command" => {
            let cmd_str = config
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cwd_mode = config
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or("project");
            let _post_create = config
                .get("postCreate")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            let cmd = replace_vars(cmd_str, display);

            // Create the directory (if needed) and insert a placeholder project so
            // the frontend can navigate to it immediately while the command runs.
            if cwd_mode == "project" {
                fs::create_dir_all(&root).map_err(|e| {
                    StableError::new(codes::INTERNAL, format!("create project directory: {}", e))
                })?;
            }
            let canonical_path = dunce::canonicalize(&root)
                .unwrap_or(root.clone())
                .to_string_lossy()
                .into_owned();
            let placeholder = ProjectDto {
                id: String::new(),
                location_id: payload.location_id.clone(),
                name: display.to_string(),
                path: canonical_path.clone(),
                stack: t.template_type.clone(),
                runtime_hint: None,
                favorite: false,
                last_opened_at_ms: None,
                total_playtime_ms: 0,
                tasks: Vec::new(),
                tags: vec!["wizard".into()],
                github_owner: None,
                github_repo: None,
                file_count: 0,
                size_bytes: 0,
                last_edited_at_ms: None,
            };
            let inserted = db::upsert_project(&pool, &placeholder).await?;

            Ok(CreateProjectResultDto {
                project_path: canonical_path,
                files_written: 0,
                post_create_log: None,
                session_id: Some(cmd),
                project_id: Some(inserted.id),
            })
        }
        "git" => {
            fs::create_dir_all(&root).map_err(|e| {
                StableError::new(codes::INTERNAL, format!("create project directory: {}", e))
            })?;
            let source = config
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let branch = config
                .get("branch")
                .and_then(|v| v.as_str())
                .unwrap_or("main");
            download_github_template(source, branch, &root).await?;
            fs_scope_util::allow_library_root(&app, root.to_str().unwrap_or(""))?;
            let file_count = walkdir::WalkDir::new(&root)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .count() as u32;
            Ok(CreateProjectResultDto {
                project_path: dunce::canonicalize(&root)
                    .unwrap_or(root)
                    .to_string_lossy()
                    .into_owned(),
                files_written: file_count,
                post_create_log: None,
                session_id: None,
                project_id: None,
            })
        }
        "files" => {
            let files_map = config
                .get("files")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect::<HashMap<String, String>>()
                })
                .unwrap_or_default();
            fs::create_dir_all(&root).map_err(|e| {
                StableError::new(codes::INTERNAL, format!("create project directory: {}", e))
            })?;
            let files_written = write_files(&root, &files_map, display)?;
            fs_scope_util::allow_library_root(&app, root.to_str().unwrap_or(""))?;
            Ok(CreateProjectResultDto {
                project_path: dunce::canonicalize(&root)
                    .unwrap_or(root)
                    .to_string_lossy()
                    .into_owned(),
                files_written,
                post_create_log: None,
                session_id: None,
                project_id: None,
            })
        }
        _ => Err(StableError::new(codes::NOT_FOUND, "unknown template type")),
    };

    result
}

#[tauri::command]
pub async fn run_template_command(
    app: AppHandle,
    _db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    buffers: State<'_, TerminalBuffers>,
    payload: RunTemplateCommandPayload,
) -> Result<RunTemplateCommandResultDto, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, _db, terms, payload);
        return Err(StableError::new(
            codes::INTERNAL,
            "embedded terminal not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let cwd = PathBuf::from(&payload.cwd);
        if !cwd.is_dir() {
            return Err(StableError::new(codes::INVALID_PATH, "cwd not a directory"));
        }
        let session_id = crate::spawn::embedded::spawn_session(app, &terms, &buffers, cwd, None)?;
        // Write the command to the terminal
        let cmd = format!("{}\r", payload.command);
        crate::spawn::embedded::write_session(&terms, &session_id, &cmd)?;
        Ok(RunTemplateCommandResultDto { session_id })
    }
}
