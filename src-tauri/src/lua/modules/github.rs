use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Manager;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let github = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_gh = app.clone();
        github.set(
            "request",
            lua.create_async_function(move |_, (method, path, body_val): (String, String, Option<String>)| {
                let app = app_gh.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let token = crate::db::get_setting(&pool, "github_token").await.ok().flatten();
                    
                    let client = reqwest::Client::new();
                    let clean_path = path.trim_start_matches('/');
                    let url = format!("https://api.github.com/{}", clean_path);
                    let mut req = match method.to_uppercase().as_str() {
                        "GET" => client.get(&url),
                        "POST" => client.post(&url),
                        "PUT" => client.put(&url),
                        "DELETE" => client.delete(&url),
                        _ => client.get(&url),
                    };

                    req = req.header("User-Agent", "project-vault-plugin");
                    req = req.header("Accept", "application/vnd.github+json");
                    req = req.header("X-GitHub-Api-Version", "2022-11-28");
                    if let Some(t) = token {
                        req = req.header("Authorization", format!("Bearer {}", t));
                    }

                    if let Some(b) = body_val {
                        req = req.header("Content-Type", "application/json");
                        req = req.body(b);
                    }

                    let resp = req.send().await.map_err(mlua::Error::external)?;
                    let status = resp.status().as_u16();
                    let text = resp.text().await.map_err(mlua::Error::external)?;

                    let res_json = serde_json::json!({
                        "status": status,
                        "body": text
                    });

                    Ok(res_json.to_string())
                }
            })?,
        )?;
    } else {
        github.set(
            "request",
            lua.create_function(|_, _: (String, String, Option<String>)| {
                Ok(r#"{"status":400,"body":""}"#.to_string())
            })?,
        )?;
    }
    vault.set("github", github)?;
    Ok(())
}
