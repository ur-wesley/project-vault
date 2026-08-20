use mlua::{Lua, LuaSerdeExt, Result, Table};
use super::ModuleContext;
use tauri::Emitter;
use crate::lua::ui::{InputBoxOptions, QuickPickOptions};

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
                    crate::lua::ui::show_input_box(app, &bridge, options).await.map_err(|e| mlua::Error::RuntimeError(e.message))
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
                    crate::lua::ui::show_quick_pick(app, &bridge, options).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;
        let app_c3 = app.clone();
        ui.set(
            "open_project_file",
            lua.create_function(move |_, (project_id, file_path, line): (String, String, Option<u32>)| {
                let _ = app_c3.emit("plugin:open-project-file", serde_json::json!({
                    "projectId": project_id,
                    "filePath": file_path,
                    "line": line.unwrap_or(0)
                }));
                Ok(())
            })?,
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
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_footer.emit("plugin:set-footer", serde_json::json!({
                    "pluginId": pid,
                    "id": opts.id,
                    "text": opts.text,
                    "icon": opts.icon,
                    "tooltip": opts.tooltip,
                    "command": opts.command,
                    "color": opts.color.unwrap_or_else(|| "default".to_string()),
                    "position": opts.position.unwrap_or_else(|| "left".to_string()),
                }));
                Ok(())
            })?,
        )?;

        let app_c4 = app.clone();
        ui.set(
            "show_markdown_dialog",
            lua.create_function(move |lua, (title, content): (String, String)| {
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_c4.emit("plugin:show-markdown-dialog", serde_json::json!({
                    "pluginId": pid,
                    "title": title,
                    "content": content
                }));
                Ok(())
            })?,
        )?;

        // vault.ui.clear_footer — remove a footer segment by id
        let app_footer_clear = app.clone();
        ui.set(
            "clear_footer",
            lua.create_function(move |lua, id: String| {
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_footer_clear.emit("plugin:clear-footer", serde_json::json!({
                    "pluginId": pid,
                    "id": id,
                }));
                Ok(())
            })?,
        )?;

        let app_form = app.clone();
        let bridge_form = bridge.clone();
        let show_form_async = lua.create_async_function(move |lua, options_val: mlua::Value| {
            let app = app_form.clone();
            let bridge = bridge_form.clone();
            let options_res: mlua::Result<crate::lua::ui::FormOptions> = lua.from_value(options_val);
            async move {
                let options = options_res?;
                let res = crate::lua::ui::show_form(app, &bridge, options).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                if let Some(v) = res {
                    let json = serde_json::to_string(&v).map_err(mlua::Error::external)?;
                    Ok(Some(json))
                } else {
                    Ok(None)
                }
            }
        })?;
        ui.set("_show_form_async", show_form_async)?;

        let show_form_wrapper: mlua::Function = lua.load(
            r#"
            return function(options)
                local loaded = package.loaded
                local vault = loaded["vault"]
                local raw = vault.ui._show_form_async(options)
                if not raw then return nil end
                return vault.json.parse(raw)
            end
            "#
        ).eval()?;
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
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_widget.emit("plugin:set-header-widget", serde_json::json!({
                    "pluginId": pid,
                    "id": opts.id,
                    "type": opts.widget_type,
                    "text": opts.text,
                    "icon": opts.icon,
                    "tooltip": opts.tooltip,
                    "command": opts.command,
                    "color": opts.color.unwrap_or_else(|| "default".to_string()),
                }));
                Ok(())
            })?,
        )?;

        let app_widget_clear = app.clone();
        ui.set(
            "clear_header_widget",
            lua.create_function(move |lua, id: String| {
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_widget_clear.emit("plugin:clear-header-widget", serde_json::json!({
                    "pluginId": pid,
                    "id": id,
                }));
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
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_page.emit("plugin:set-page", serde_json::json!({
                    "pluginId": pid,
                    "id": opts.id,
                    "title": opts.title,
                    "itemCommand": opts.item_command,
                    "items": opts.items,
                }));
                Ok(())
            })?,
        )?;

        let app_page_clear = app.clone();
        ui.set(
            "clear_page",
            lua.create_function(move |lua, id: String| {
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_page_clear.emit("plugin:clear-page", serde_json::json!({
                    "pluginId": pid,
                    "id": id,
                }));
                Ok(())
            })?,
        )?;

        let app_page_open = app.clone();
        ui.set(
            "open_page",
            lua.create_function(move |lua, page_id: String| {
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_page_open.emit("plugin:open-page", serde_json::json!({
                    "pluginId": pid,
                    "pageId": page_id,
                }));
                Ok(())
            })?,
        )?;

        vault.set("ui", ui)?;
    }
    Ok(())
}
