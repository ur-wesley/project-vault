use super::ModuleContext;
use crate::lua::ui::{InputBoxOptions, QuickPickOptions};
use mlua::{Lua, LuaSerdeExt, Result, Table};
use tauri::Emitter;

/// Validate optional per-page header actions for `set_view`:
/// `actions = [{ id, label, icon?, command? }]` (max 8). Rejects with a
/// clear message so the plugin's error path can surface it instead of
/// silently dropping the buttons.
fn parse_view_actions(value: &serde_json::Value) -> std::result::Result<Vec<serde_json::Value>, String> {
    let arr = value
        .as_array()
        .ok_or_else(|| "set_view actions must be an array".to_string())?;
    if arr.len() > 8 {
        return Err("set_view actions limited to 8".to_string());
    }
    for a in arr {
        let o = a
            .as_object()
            .ok_or_else(|| "set_view action must be an object".to_string())?;
        for key in ["id", "label"] {
            match o.get(key).and_then(|v| v.as_str()) {
                Some(s) if !s.trim().is_empty() => {}
                _ => return Err(format!("set_view action requires non-empty '{key}'")),
            }
        }
        for key in ["icon", "command"] {
            if let Some(v) = o.get(key) {
                if !v.is_string() {
                    return Err(format!("set_view action '{key}' must be a string"));
                }
            }
        }
    }
    Ok(arr.clone())
}

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    if let (Some(app), Some(bridge)) = (ctx.app.clone(), ctx.bridge.clone()) {
        let ui = lua.create_table()?;
        let app_c = app.clone();
        let bridge_c = bridge.clone();
        ui.set(
            "show_input_box",
            lua.create_async_function(move |lua, options_val: mlua::Value| {
                let app = app_c.clone();
                let bridge = bridge_c.clone();
                let options_res: mlua::Result<InputBoxOptions> = lua.from_value(options_val);
                async move {
                    let options = options_res?;
                    crate::lua::ui::show_input_box(app, &bridge, options)
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;

        let app_c2 = app.clone();
        let bridge_c2 = bridge.clone();
        ui.set(
            "show_quick_pick",
            lua.create_async_function(move |lua, options_val: mlua::Value| {
                let app = app_c2.clone();
                let bridge = bridge_c2.clone();
                let options_res: mlua::Result<QuickPickOptions> = lua.from_value(options_val);
                async move {
                    let options = options_res?;
                    crate::lua::ui::show_quick_pick(app, &bridge, options)
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;
        let app_c3 = app.clone();
        ui.set(
            "open_project_file",
            lua.create_function(
                move |_, (project_id, file_path, line): (String, String, Option<u32>)| {
                    let _ = app_c3.emit(
                        "plugin:open-project-file",
                        serde_json::json!({
                            "projectId": project_id,
                            "filePath": file_path,
                            "line": line.unwrap_or(0)
                        }),
                    );
                    Ok(())
                },
            )?,
        )?;

        // vault.ui.set_footer — display a persistent segment in the app footer/status bar
        let app_footer = app.clone();
        ui.set(
            "set_footer",
            lua.create_function(move |lua, options_val: mlua::Value| {
                #[derive(serde::Deserialize)]
                struct FooterOptions {
                    id: String,
                    text: String,
                    icon: Option<String>,
                    tooltip: Option<String>,
                    command: Option<String>,
                    color: Option<String>,
                    position: Option<String>,
                }
                let opts: FooterOptions = lua.from_value(options_val)?;
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_footer.emit(
                    "plugin:set-footer",
                    serde_json::json!({
                        "pluginId": pid,
                        "id": opts.id,
                        "text": opts.text,
                        "icon": opts.icon,
                        "tooltip": opts.tooltip,
                        "command": opts.command,
                        "color": opts.color.unwrap_or_else(|| "default".to_string()),
                        "position": opts.position.unwrap_or_else(|| "left".to_string()),
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_c4 = app.clone();
        ui.set(
            "show_markdown_dialog",
            lua.create_function(move |lua, (title, content): (String, String)| {
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_c4.emit(
                    "plugin:show-markdown-dialog",
                    serde_json::json!({
                        "pluginId": pid,
                        "title": title,
                        "content": content
                    }),
                );
                Ok(())
            })?,
        )?;

        // vault.ui.clear_footer — remove a footer segment by id
        let app_footer_clear = app.clone();
        ui.set(
            "clear_footer",
            lua.create_function(move |lua, id: String| {
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_footer_clear.emit(
                    "plugin:clear-footer",
                    serde_json::json!({
                        "pluginId": pid,
                        "id": id,
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_form = app.clone();
        let bridge_form = bridge.clone();
        let show_form_async = lua.create_async_function(move |lua, options_val: mlua::Value| {
            let app = app_form.clone();
            let bridge = bridge_form.clone();
            let options_res: mlua::Result<crate::lua::ui::FormOptions> =
                lua.from_value(options_val);
            async move {
                let options = options_res?;
                let res = crate::lua::ui::show_form(app, &bridge, options)
                    .await
                    .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                if let Some(v) = res {
                    let json = serde_json::to_string(&v).map_err(mlua::Error::external)?;
                    Ok(Some(json))
                } else {
                    Ok(None)
                }
            }
        })?;
        ui.set("_show_form_async", show_form_async)?;

        let show_form_wrapper: mlua::Function = lua
            .load(
                r#"
            return function(options)
                local loaded = package.loaded
                local vault = loaded["vault"]
                local raw = vault.ui._show_form_async(options)
                if not raw then return nil end
                return vault.json.parse(raw)
            end
            "#,
            )
            .eval()?;
        ui.set("show_form", show_form_wrapper)?;

        let app_widget = app.clone();
        ui.set(
            "set_header_widget",
            lua.create_function(move |lua, options_val: mlua::Value| {
                #[derive(serde::Deserialize)]
                struct HeaderWidgetOptions {
                    id: String,
                    #[serde(rename = "type")]
                    widget_type: String, // "button" | "badge" | "text"
                    text: String,
                    icon: Option<String>,
                    tooltip: Option<String>,
                    command: Option<String>,
                    color: Option<String>,
                }
                let opts: HeaderWidgetOptions = lua.from_value(options_val)?;
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_widget.emit(
                    "plugin:set-header-widget",
                    serde_json::json!({
                        "pluginId": pid,
                        "id": opts.id,
                        "type": opts.widget_type,
                        "text": opts.text,
                        "icon": opts.icon,
                        "tooltip": opts.tooltip,
                        "command": opts.command,
                        "color": opts.color.unwrap_or_else(|| "default".to_string()),
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_widget_clear = app.clone();
        ui.set(
            "clear_header_widget",
            lua.create_function(move |lua, id: String| {
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_widget_clear.emit(
                    "plugin:clear-header-widget",
                    serde_json::json!({
                        "pluginId": pid,
                        "id": id,
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_page = app.clone();
        ui.set(
            "set_page",
            lua.create_function(move |lua, options_val: mlua::Value| {
                #[derive(serde::Deserialize, serde::Serialize)]
                struct PageItem {
                    id: String,
                    label: String,
                    detail: Option<String>,
                    icon: Option<String>,
                }
                #[derive(serde::Deserialize)]
                struct PageOptions {
                    id: String,
                    title: Option<String>,
                    #[serde(rename = "itemCommand")]
                    item_command: Option<String>,
                    items: Vec<PageItem>,
                }
                let opts: PageOptions = lua.from_value(options_val)?;
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_page.emit(
                    "plugin:set-page",
                    serde_json::json!({
                        "pluginId": pid,
                        "id": opts.id,
                        "title": opts.title,
                        "itemCommand": opts.item_command,
                        "items": opts.items,
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_page_clear = app.clone();
        ui.set(
            "clear_page",
            lua.create_function(move |lua, id: String| {
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_page_clear.emit(
                    "plugin:clear-page",
                    serde_json::json!({
                        "pluginId": pid,
                        "id": id,
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_page_open = app.clone();
        ui.set(
            "open_page",
            lua.create_function(move |lua, page_id: String| {
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_page_open.emit(
                    "plugin:open-page",
                    serde_json::json!({
                        "pluginId": pid,
                        "pageId": page_id,
                    }),
                );
                Ok(())
            })?,
        )?;

        // ── New native UI primitives (modular dialog/view/store system) ──
        let app_table = app.clone();
        let bridge_table = bridge.clone();
        ui.set(
            "show_table",
            lua.create_async_function(move |lua, options_val: mlua::Value| {
                let app = app_table.clone();
                let bridge = bridge_table.clone();
                let parsed: mlua::Result<crate::lua::ui::dialogs::TableDialogOptions> =
                    lua.from_value(options_val);
                async move {
                    let options = parsed?;
                    let res = crate::lua::ui::show_table_dialog(app, &bridge, options)
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    Ok(res)
                }
            })?,
        )?;

        let app_confirm = app.clone();
        let bridge_confirm = bridge.clone();
        ui.set(
            "show_confirm",
            lua.create_async_function(move |lua, options_val: mlua::Value| {
                let app = app_confirm.clone();
                let bridge = bridge_confirm.clone();
                let parsed: mlua::Result<crate::lua::ui::types::ConfirmOptions> =
                    lua.from_value(options_val);
                async move {
                    let options = parsed?;
                    crate::lua::ui::show_confirm_dialog(app, &bridge, options)
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;

        let app_toast = app.clone();
        ui.set(
            "show_toast",
            lua.create_function(move |lua, options_val: mlua::Value| {
                let opts: crate::lua::ui::dialogs::ToastOptions = lua.from_value(options_val)?;
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                crate::lua::ui::emit_toast(&app_toast, &pid, opts)
                    .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                Ok(())
            })?,
        )?;

        // set_view / update_view — versioned view specs, superset of set_page.
        let app_view = app.clone();
        ui.set(
            "set_view",
            lua.create_function(move |lua, options_val: mlua::Value| {
                let value: serde_json::Value = lua.from_value(options_val)?;
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let id = value
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.trim().is_empty() {
                    return Err(mlua::Error::RuntimeError("set_view requires id".into()));
                }
                let view = value
                    .get("view")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                crate::lua::ui::pages::normalize_view_value(view.clone())
                    .map_err(mlua::Error::RuntimeError)?;
                crate::lua::ui::types::validate_view_children_count(
                    view.get("children")
                        .and_then(|c| c.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0),
                )
                .map_err(mlua::Error::RuntimeError)?;
                let actions = match value.get("actions") {
                    None | Some(serde_json::Value::Null) => Vec::new(),
                    Some(v) => parse_view_actions(v).map_err(mlua::Error::RuntimeError)?,
                };
                let _ = app_view.emit(
                    crate::lua::ui::events::SET_VIEW,
                    serde_json::json!({
                        "pluginId": pid,
                        "id": id,
                        "title": value.get("title").and_then(|v| v.as_str()),
                        "view": view,
                        "actions": actions,
                    }),
                );
                Ok(())
            })?,
        )?;

        let app_patch = app.clone();
        ui.set(
            "update_view",
            lua.create_function(move |lua, options_val: mlua::Value| {
                let value: serde_json::Value = lua.from_value(options_val)?;
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let id = value
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.trim().is_empty() {
                    return Err(mlua::Error::RuntimeError("update_view requires id".into()));
                }
                let _ = app_patch.emit(
                    crate::lua::ui::events::SET_VIEW,
                    serde_json::json!({
                        "pluginId": pid,
                        "id": id,
                        "patch": value.get("patch"),
                        "partial": true,
                    }),
                );
                Ok(())
            })?,
        )?;

        vault.set("ui", ui)?;
    }
    Ok(())
}
