use sqlx::{Pool, Sqlite};

use crate::error::{codes, StableError};
use crate::models::{
    CanvasBlueprintDto, CanvasNodeDto, CanvasProjectLayoutDto, CanvasWireDto, ViewportDto,
};

#[derive(sqlx::FromRow)]
struct CanvasLayoutRow {
    project_id: String,
    blueprint_id: Option<String>,
    layout_mode: String,
    viewport_json: String,
    nodes_json: String,
    wires_json: String,
    updated_at_ms: i64,
    schema_version: Option<i32>,
}

#[derive(sqlx::FromRow)]
struct CanvasBlueprintRow {
    id: String,
    name: String,
    description: Option<String>,
    app_scope: String,
    layout_json: String,
    is_builtin: i32,
    created_at_ms: i64,
}

pub async fn get_canvas_layout(
    pool: &Pool<Sqlite>,
    project_id: &str,
) -> Result<Option<CanvasProjectLayoutDto>, StableError> {
    // schema_version column exists after migration 013; fall back for older DBs.
    let primary: Result<Option<CanvasLayoutRow>, sqlx::Error> = sqlx::query_as(
        "SELECT project_id, blueprint_id, layout_mode, viewport_json, nodes_json, wires_json, updated_at_ms, schema_version FROM canvas_project_layouts WHERE project_id = ?1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await;
    let row: Option<CanvasLayoutRow> = match primary {
        Ok(r) => r,
        Err(_) => sqlx::query_as(
            "SELECT project_id, blueprint_id, layout_mode, viewport_json, nodes_json, wires_json, updated_at_ms, NULL as schema_version FROM canvas_project_layouts WHERE project_id = ?1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, format!("get_canvas_layout query failed: {e}")))?,
    };

    match row {
        None => Ok(None),
        Some(r) => {
            let viewport: ViewportDto =
                serde_json::from_str(&r.viewport_json).unwrap_or(ViewportDto {
                    pan_x: 0.0,
                    pan_y: 0.0,
                    zoom: 1.0,
                });
            let nodes: Vec<CanvasNodeDto> = serde_json::from_str(&r.nodes_json).unwrap_or_default();
            let wires: Vec<CanvasWireDto> = serde_json::from_str(&r.wires_json).unwrap_or_default();

            Ok(Some(
                CanvasProjectLayoutDto {
                    project_id: r.project_id,
                    blueprint_id: r.blueprint_id,
                    layout_mode: r.layout_mode,
                    viewport,
                    nodes,
                    wires,
                    updated_at_ms: r.updated_at_ms,
                    schema_version: r.schema_version,
                }
                .migrated(),
            ))
        }
    }
}

pub async fn save_canvas_layout(
    pool: &Pool<Sqlite>,
    layout: &CanvasProjectLayoutDto,
) -> Result<(), StableError> {
    layout.validate()?;
    let clean = layout.clone().migrated();
    let viewport_json = serde_json::to_string(&clean.viewport)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("serialize viewport: {e}")))?;
    let nodes_json = serde_json::to_string(&clean.nodes)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("serialize nodes: {e}")))?;
    let wires_json = serde_json::to_string(&clean.wires)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("serialize wires: {e}")))?;
    if viewport_json.len() > 4_096 || nodes_json.len() > 512_000 || wires_json.len() > 256_000 {
        return Err(StableError::new(
            "INVALID_LAYOUT",
            "canvas layout payload too large",
        ));
    }

    sqlx::query(
        r#"
        INSERT INTO canvas_project_layouts (project_id, blueprint_id, layout_mode, viewport_json, nodes_json, wires_json, updated_at_ms, schema_version)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 2)
        ON CONFLICT(project_id) DO UPDATE SET
            blueprint_id = excluded.blueprint_id,
            layout_mode = excluded.layout_mode,
            viewport_json = excluded.viewport_json,
            nodes_json = excluded.nodes_json,
            wires_json = excluded.wires_json,
            updated_at_ms = excluded.updated_at_ms,
            schema_version = 2
        "#,
    )
    .bind(&clean.project_id)
    .bind(&clean.blueprint_id)
    .bind(&clean.layout_mode)
    .bind(viewport_json)
    .bind(nodes_json)
    .bind(wires_json)
    .bind(clean.updated_at_ms)
    .execute(pool)
    .await
    .map_err(|e| {
        // Pre-013 DBs lack schema_version: retry without the column.
        StableError::new(codes::DB_ERROR, format!("save_canvas_layout failed: {e}"))
    })?;

    Ok(())
}

pub async fn list_canvas_blueprints(
    pool: &Pool<Sqlite>,
) -> Result<Vec<CanvasBlueprintDto>, StableError> {
    let rows: Vec<CanvasBlueprintRow> = sqlx::query_as(
        "SELECT id, name, description, app_scope, layout_json, is_builtin, created_at_ms FROM canvas_blueprints ORDER BY is_builtin DESC, name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, format!("list_canvas_blueprints failed: {e}")))?;

    Ok(rows
        .into_iter()
        .map(|r| CanvasBlueprintDto {
            id: r.id,
            name: r.name,
            description: r.description,
            app_scope: r.app_scope,
            layout_json: r.layout_json,
            is_builtin: r.is_builtin != 0,
            created_at_ms: r.created_at_ms,
        })
        .collect())
}

pub async fn save_canvas_blueprint(
    pool: &Pool<Sqlite>,
    blueprint: &CanvasBlueprintDto,
) -> Result<(), StableError> {
    let is_builtin = if blueprint.is_builtin { 1 } else { 0 };
    sqlx::query(
        r#"
        INSERT INTO canvas_blueprints (id, name, description, app_scope, layout_json, is_builtin, created_at_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            app_scope = excluded.app_scope,
            layout_json = excluded.layout_json
        "#,
    )
    .bind(&blueprint.id)
    .bind(&blueprint.name)
    .bind(&blueprint.description)
    .bind(&blueprint.app_scope)
    .bind(&blueprint.layout_json)
    .bind(is_builtin)
    .bind(blueprint.created_at_ms)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, format!("save_canvas_blueprint failed: {e}")))?;

    Ok(())
}

pub async fn delete_canvas_blueprint(
    pool: &Pool<Sqlite>,
    blueprint_id: &str,
) -> Result<(), StableError> {
    sqlx::query("DELETE FROM canvas_blueprints WHERE id = ?1 AND is_builtin = 0")
        .bind(blueprint_id)
        .execute(pool)
        .await
        .map_err(|e| {
            StableError::new(
                codes::DB_ERROR,
                format!("delete_canvas_blueprint failed: {e}"),
            )
        })?;

    Ok(())
}
