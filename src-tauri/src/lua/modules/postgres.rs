//! `vault.postgres` — portable PostgreSQL version manager + SQL engine.
//!
//! Thin async bridge over [`crate::postgres`]. All list/query calls return
//! JSON strings so Luau stays simple (`vault.json.parse`). Long operations
//! (install/start) emit `plugin:notification` progress like `vault.mise`.

use mlua::{Lua, Result, Table};
use tauri::{AppHandle, Emitter, Manager};

use super::ModuleContext;

fn app_data_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn notify(app: &AppHandle, level: &str, message: String) {
    let _ = app.emit(
        "plugin:notification",
        serde_json::json!({ "level": level, "message": message }),
    );
}

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".to_string())
}

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let pg = lua.create_table()?;

    // ── versions ─────────────────────────────────────────────────────────
    if let Some(app) = ctx.app.clone() {
        let a = app.clone();
        pg.set(
            "supported_versions",
            lua.create_function(move |_, _: ()| Ok(json(&crate::postgres::SUPPORTED_VERSIONS)))?,
        )?;
        let _ = a;

        let a = app.clone();
        pg.set(
            "list_versions",
            lua.create_function(move |_, _: ()| {
                let dir = app_data_dir(&a);
                Ok(json(&crate::postgres::list_versions(&dir)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "install_version",
            lua.create_async_function(move |_, version: String| {
                let app = a.clone();
                async move {
                    notify(&app, "info", format!("Installing PostgreSQL {version}…"));
                    let dir = app_data_dir(&app);
                    let app_c = app.clone();
                    // NOTE: this future already runs inside the global runtime
                    // (the loader drives commands via block_on on lua-worker).
                    // Await directly — never spawn_blocking+block_on here;
                    // nesting runtimes panics ("Cannot start a runtime from
                    // within a runtime"). install_version keeps its blocking
                    // unzip on spawn_blocking internally (sync-only closure).
                    match crate::postgres::install_version(&dir, &version).await {
                        Ok(()) => {
                            notify(&app_c, "success", format!("PostgreSQL {version} installed"));
                            Ok(())
                        }
                        Err(e) => {
                            notify(&app_c, "error", format!("Install failed: {e}"));
                            Err(mlua::Error::RuntimeError(e))
                        }
                    }
                }
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "remove_version",
            lua.create_async_function(move |_, version: String| {
                let app = a.clone();
                async move {
                    let dir = app_data_dir(&app);
                    crate::postgres::remove_version(&dir, &version)
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                    Ok(())
                }
            })?,
        )?;

        pg.set(
            "detect_system",
            lua.create_function(|_, _: ()| Ok(json(&crate::postgres::detect_system())))?,
        )?;

        // ── clusters ─────────────────────────────────────────────────────
        let a = app.clone();
        pg.set(
            "list_clusters",
            lua.create_function(move |_, _: ()| {
                let dir = app_data_dir(&a);
                Ok(json(&crate::postgres::list_statuses(&dir)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "cluster_status",
            lua.create_function(move |_, name: String| {
                let dir = app_data_dir(&a);
                let st = crate::postgres::cluster_status(&dir, &name)
                    .map_err(mlua::Error::RuntimeError)?;
                Ok(json(&st))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "create_cluster",
            lua.create_async_function(
                move |_, (name, version, port): (String, String, Option<u16>)| {
                    let app = a.clone();
                    async move {
                        // Port 0 = auto (UI convention).
                        let port = match port {
                            Some(0) | None => None,
                            Some(p) => Some(p),
                        };
                        let dir = app_data_dir(&app);
                        let rec = crate::postgres::create_cluster(&dir, &name, &version, port)
                            .await
                            .map_err(mlua::Error::RuntimeError)?;
                        notify(
                            &app,
                            "success",
                            format!("Cluster '{}' created on :{}", rec.name, rec.port),
                        );
                        Ok(json(&rec))
                    }
                },
            )?,
        )?;

        // Full customizable create: vault.postgres.create_cluster_ex(name, version, opts?)
        // opts = { port?, backend?, image?, extensions?, db_user?, db_name?, locale?, encoding?, max_connections? }
        let a = app.clone();
        pg.set(
            "create_cluster_ex",
            lua.create_async_function(
                move |_, (name, version, opts): (String, String, Option<mlua::Table>)| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let mut o = crate::postgres::CreateClusterOptions::default();
                        if let Some(t) = opts {
                            if let Ok(v) = t.get::<Option<u16>>("port") {
                                o.port = match v {
                                    Some(0) => None,
                                    other => other,
                                };
                            }
                            if let Ok(v) = t.get::<Option<String>>("backend") {
                                o.backend = v;
                            }
                            if let Ok(v) = t.get::<Option<String>>("image") {
                                o.image = v;
                            }
                            if let Ok(v) = t.get::<Vec<String>>("extensions") {
                                o.extensions = v;
                            }
                            if let Ok(v) = t.get::<Option<String>>("db_user") {
                                o.db_user = v;
                            }
                            if let Ok(v) = t.get::<Option<String>>("db_name") {
                                o.db_name = v;
                            }
                            if let Ok(v) = t.get::<Option<String>>("locale") {
                                o.locale = v;
                            }
                            if let Ok(v) = t.get::<Option<String>>("encoding") {
                                o.encoding = v;
                            }
                            if let Ok(v) = t.get::<Option<u32>>("max_connections") {
                                o.max_connections = v;
                            }
                        }
                        let rec =
                            crate::postgres::create_cluster_full(&dir, &name, &version, o)
                                .await
                                .map_err(mlua::Error::RuntimeError)?;
                        notify(
                            &app,
                            "success",
                            format!("Cluster '{}' created on :{}", rec.name, rec.port),
                        );
                        Ok(json(&rec))
                    }
                },
            )?,
        )?;

        // ── ports ──────────────────────────────────────────────────────
        let a = app.clone();
        pg.set(
            "get_free_port",
            lua.create_function(move |_, preferred: Option<u16>| {
                let dir = app_data_dir(&a);
                Ok(crate::postgres::alloc_free_port(&dir, preferred.unwrap_or(5433)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "port_status",
            lua.create_function(move |_, _: ()| {
                let dir = app_data_dir(&a);
                Ok(json(&crate::postgres::port_status(&dir)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "set_cluster_port",
            lua.create_async_function(move |_, (name, port): (String, Option<u16>)| {
                let app = a.clone();
                async move {
                    let dir = app_data_dir(&app);
                    let st = crate::postgres::set_cluster_port(&dir, &name, port)
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                    Ok(json(&st))
                }
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "load_settings",
            lua.create_function(move |_, _: ()| {
                let dir = app_data_dir(&a);
                Ok(json(&crate::postgres::load_settings(&dir)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "save_settings",
            lua.create_function(move |_, tbl: mlua::Table| {
                let dir = app_data_dir(&a);
                let mut s = crate::postgres::load_settings(&dir);
                if let Ok(v) = tbl.get::<Option<bool>>("auto_port") {
                    if let Some(b) = v {
                        s.auto_port = b;
                    }
                }
                if let Ok(v) = tbl.get::<Option<u16>>("port_range_start") {
                    if let Some(p) = v {
                        s.port_range_start = p;
                    }
                }
                if let Ok(v) = tbl.get::<Option<u16>>("port_range_end") {
                    if let Some(p) = v {
                        s.port_range_end = p;
                    }
                }
                if let Ok(v) = tbl.get::<Option<String>>("default_version") {
                    if let Some(x) = v {
                        s.default_version = x;
                    }
                }
                if let Ok(v) = tbl.get::<Option<String>>("default_backend") {
                    if let Some(x) = v {
                        s.default_backend = x;
                    }
                }
                crate::postgres::save_settings(&dir, &s).map_err(mlua::Error::RuntimeError)?;
                Ok(json(&s))
            })?,
        )?;

        // ── custom versions ────────────────────────────────────────────
        let a = app.clone();
        pg.set(
            "list_custom_versions",
            lua.create_function(move |_, _: ()| {
                let dir = app_data_dir(&a);
                Ok(json(&crate::postgres::list_custom_versions(&dir)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "add_custom_version",
            lua.create_function(move |_, (major, url): (String, String)| {
                let dir = app_data_dir(&a);
                let rec = crate::postgres::add_custom_version(&dir, &major, &url)
                    .map_err(mlua::Error::RuntimeError)?;
                Ok(json(&rec))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "remove_custom_version",
            lua.create_function(move |_, major: String| {
                let dir = app_data_dir(&a);
                crate::postgres::remove_custom_version(&dir, &major)
                    .map_err(mlua::Error::RuntimeError)?;
                Ok(())
            })?,
        )?;

        // ── extensions ─────────────────────────────────────────────────
        pg.set(
            "supported_extensions",
            lua.create_function(|_, _: ()| {
                Ok(json(&crate::postgres::supported_extensions()))
            })?,
        )?;

        pg.set(
            "docker_image_for",
            lua.create_function(
                |_, (version, extensions, custom): (String, Vec<String>, Option<String>)| {
                    Ok(crate::postgres::docker_image_for(
                        &version,
                        &extensions,
                        custom.as_deref(),
                    ))
                },
            )?,
        )?;

        pg.set(
            "docker_image_warnings_for",
            lua.create_function(
                |_, (version, extensions, custom): (String, Vec<String>, Option<String>)| {
                    Ok(json(&crate::postgres::docker_image_warnings_for(
                        &version,
                        &extensions,
                        custom.as_deref(),
                    )))
                },
            )?,
        )?;

        pg.set(
            "detect_docker",
            lua.create_function(|_, _: ()| Ok(json(&crate::postgres::detect_docker())))?,
        )?;

        let a = app.clone();
        pg.set(
            "install_extension",
            lua.create_async_function(
                move |_,
                      (target, ext, database, custom_sql): (
                    String,
                    String,
                    String,
                    Option<String>,
                )| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let res = crate::postgres::install_extension(
                            &dir,
                            &target,
                            &ext,
                            &database,
                            custom_sql.as_deref(),
                        )
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                        Ok(json(&res))
                    }
                },
            )?,
        )?;

        // ── test stubs note: headless branch below mirrors these ───────;

        macro_rules! lifecycle {
            ($name:literal, $fn:path, $verb:literal) => {{
                let a = app.clone();
                pg.set(
                    $name,
                    lua.create_async_function(move |_, name: String| {
                        let app = a.clone();
                        async move {
                            let dir = app_data_dir(&app);
                            let st = $fn(&dir, &name).await.map_err(mlua::Error::RuntimeError)?;
                            Ok(json(&st))
                        }
                    })?,
                )?;
            }};
        }
        lifecycle!("start_cluster", crate::postgres::start_cluster, "started");
        lifecycle!("stop_cluster", crate::postgres::stop_cluster, "stopped");

        let a = app.clone();
        pg.set(
            "restart_cluster",
            lua.create_async_function(move |_, name: String| {
                let app = a.clone();
                async move {
                    let dir = app_data_dir(&app);
                    let _ = crate::postgres::stop_cluster(&dir, &name)
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                    let st = crate::postgres::start_cluster(&dir, &name)
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                    Ok(json(&st))
                }
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "destroy_cluster",
            lua.create_async_function(move |_, name: String| {
                let app = a.clone();
                async move {
                    let dir = app_data_dir(&app);
                    crate::postgres::destroy_cluster(&dir, &name)
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                    Ok(())
                }
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "get_log",
            lua.create_function(move |_, (name, lines): (String, Option<usize>)| {
                let dir = app_data_dir(&a);
                crate::postgres::read_log_tail(&dir, &name, lines.unwrap_or(120))
                    .map_err(mlua::Error::RuntimeError)
            })?,
        )?;

        // ── external connections ─────────────────────────────────────────
        let a = app.clone();
        pg.set(
            "list_connections",
            lua.create_function(move |_, _: ()| {
                let dir = app_data_dir(&a);
                Ok(json(&crate::postgres::list_connections(&dir)))
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "add_connection",
            lua.create_function(
                move |_,
                      (name, host, port, database, user): (
                    String,
                    String,
                    Option<u16>,
                    Option<String>,
                    Option<String>,
                )| {
                    let dir = app_data_dir(&a);
                    let rec = crate::postgres::add_connection(
                        &dir,
                        &name,
                        &host,
                        port.unwrap_or(5432),
                        &database.unwrap_or_default(),
                        &user.unwrap_or_default(),
                    )
                    .map_err(mlua::Error::RuntimeError)?;
                    Ok(json(&rec))
                },
            )?,
        )?;

        let a = app.clone();
        pg.set(
            "remove_connection",
            lua.create_function(move |_, id: String| {
                let dir = app_data_dir(&a);
                crate::postgres::remove_connection(&dir, &id).map_err(mlua::Error::RuntimeError)?;
                Ok(())
            })?,
        )?;

        // ── content engine (target = "cluster:<name>" | "ext:<id>") ─────────
        let a = app.clone();
        pg.set(
            "list_databases",
            lua.create_async_function(move |_, (target, password): (String, Option<String>)| {
                let app = a.clone();
                async move {
                    let dir = app_data_dir(&app);
                    let res = crate::postgres::list_databases(&dir, &target, password.as_deref())
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                    Ok(json(&res))
                }
            })?,
        )?;

        let a = app.clone();
        pg.set(
            "list_tables",
            lua.create_async_function(
                move |_,
                      (target, database, schema, password): (
                    String,
                    String,
                    Option<String>,
                    Option<String>,
                )| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let schema = schema.unwrap_or_else(|| "public".to_string());
                        let res = crate::postgres::list_tables(
                            &dir,
                            &target,
                            &database,
                            &schema,
                            password.as_deref(),
                        )
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                        Ok(json(&res))
                    }
                },
            )?,
        )?;

        let a = app.clone();
        pg.set(
            "preview_table",
            lua.create_async_function(
                move |_,
                      (target, database, schema, table, limit, offset, password): (
                    String,
                    String,
                    Option<String>,
                    String,
                    Option<i64>,
                    Option<i64>,
                    Option<String>,
                )| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let res = crate::postgres::preview_table(
                            &dir,
                            &target,
                            &database,
                            &schema.unwrap_or_else(|| "public".to_string()),
                            &table,
                            limit.unwrap_or(50),
                            offset.unwrap_or(0),
                            password.as_deref(),
                        )
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                        Ok(json(&res))
                    }
                },
            )?,
        )?;

        let a = app.clone();
        pg.set(
            "run_select",
            lua.create_async_function(
                move |_,
                      (target, database, sql, limit, password): (
                    String,
                    String,
                    String,
                    Option<i64>,
                    Option<String>,
                )| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let res = crate::postgres::run_select(
                            &dir,
                            &target,
                            &database,
                            &sql,
                            limit.unwrap_or(100),
                            password.as_deref(),
                        )
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                        Ok(json(&res))
                    }
                },
            )?,
        )?;

        // ── database / table management ──────────────────────────────────
        let a = app.clone();
        pg.set(
            "create_database",
            lua.create_async_function(
                move |_, (target, name, password): (String, String, Option<String>)| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let msg = crate::postgres::create_database(&dir, &target, &name, password.as_deref())
                            .await
                            .map_err(mlua::Error::RuntimeError)?;
                        Ok(msg)
                    }
                },
            )?,
        )?;

        let a = app.clone();
        pg.set(
            "drop_database",
            lua.create_async_function(
                move |_, (target, name, password): (String, String, Option<String>)| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let msg = crate::postgres::drop_database(&dir, &target, &name, password.as_deref())
                            .await
                            .map_err(mlua::Error::RuntimeError)?;
                        Ok(msg)
                    }
                },
            )?,
        )?;

        let a = app.clone();
        pg.set(
            "drop_table",
            lua.create_async_function(
                move |_,
                      (target, database, schema, table, password): (
                    String,
                    String,
                    Option<String>,
                    String,
                    Option<String>,
                )| {
                    let app = a.clone();
                    async move {
                        let dir = app_data_dir(&app);
                        let msg = crate::postgres::drop_table(
                            &dir,
                            &target,
                            &database,
                            &schema.unwrap_or_else(|| "public".to_string()),
                            &table,
                            password.as_deref(),
                        )
                        .await
                        .map_err(mlua::Error::RuntimeError)?;
                        Ok(msg)
                    }
                },
            )?,
        )?;
    } else {
        // Test / headless context: pure no-op stubs.
        pg.set(
            "supported_versions",
            lua.create_function(|_, _: ()| Ok("[\"16\"]".to_string()))?,
        )?;
        pg.set(
            "list_versions",
            lua.create_function(|_, _: ()| Ok("[]".to_string()))?,
        )?;
        pg.set(
            "install_version",
            lua.create_function(|_, _: String| Ok(()))?,
        )?;
        pg.set(
            "remove_version",
            lua.create_function(|_, _: String| Ok(()))?,
        )?;
        pg.set(
            "detect_system",
            lua.create_function(|_, _: ()| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "list_clusters",
            lua.create_function(|_, _: ()| Ok("[]".to_string()))?,
        )?;
        pg.set(
            "cluster_status",
            lua.create_function(|_, _: String| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "create_cluster",
            lua.create_function(|_, _: (String, String, Option<u16>)| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "start_cluster",
            lua.create_function(|_, _: String| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "stop_cluster",
            lua.create_function(|_, _: String| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "restart_cluster",
            lua.create_function(|_, _: String| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "destroy_cluster",
            lua.create_function(|_, _: String| Ok(()))?,
        )?;
        pg.set(
            "get_log",
            lua.create_function(|_, _: (String, Option<usize>)| Ok("".to_string()))?,
        )?;
        pg.set(
            "list_connections",
            lua.create_function(|_, _: ()| Ok("[]".to_string()))?,
        )?;
        pg.set(
            "add_connection",
            lua.create_function(
                |_,
                 _: (
                    String,
                    String,
                    Option<u16>,
                    Option<String>,
                    Option<String>,
                )| { Ok("{}".to_string()) },
            )?,
        )?;
        pg.set(
            "remove_connection",
            lua.create_function(|_, _: String| Ok(()))?,
        )?;
        pg.set(
            "list_databases",
            lua.create_function(|_, _: (String, Option<String>)| {
                Ok("{\"columns\":[],\"rows\":[],\"row_count\":0,\"truncated\":false}".to_string())
            })?,
        )?;
        pg.set(
            "list_tables",
            lua.create_function(|_, _: (String, String, Option<String>, Option<String>)| {
                Ok("{\"columns\":[],\"rows\":[],\"row_count\":0,\"truncated\":false}".to_string())
            })?,
        )?;
        pg.set(
            "preview_table",
            lua.create_function(
                |_,
                 _: (
                    String,
                    String,
                    Option<String>,
                    String,
                    Option<i64>,
                    Option<i64>,
                    Option<String>,
                )| {
                    Ok(
                        "{\"columns\":[],\"rows\":[],\"row_count\":0,\"truncated\":false}"
                            .to_string(),
                    )
                },
            )?,
        )?;
        pg.set(
            "run_select",
            lua.create_function(|_, _: (String, String, String, Option<i64>, Option<String>)| {
                Ok("{\"columns\":[],\"rows\":[],\"row_count\":0,\"truncated\":false}".to_string())
            })?,
        )?;
        pg.set(
            "create_cluster_ex",
            lua.create_function(|_, _: (String, String, Option<mlua::Table>)| {
                Ok("{}".to_string())
            })?,
        )?;
        pg.set(
            "get_free_port",
            lua.create_function(|_, _: Option<u16>| Ok(5433))?,
        )?;
        pg.set(
            "port_status",
            lua.create_function(|_, _: ()| Ok("{\"used\":[]}".to_string()))?,
        )?;
        pg.set(
            "set_cluster_port",
            lua.create_function(|_, _: (String, Option<u16>)| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "load_settings",
            lua.create_function(|_, _: ()| {
                Ok("{\"auto_port\":true,\"port_range_start\":5433,\"port_range_end\":5499,\"default_version\":\"16\",\"default_backend\":\"portable\"}".to_string())
            })?,
        )?;
        pg.set(
            "save_settings",
            lua.create_function(|_, _: mlua::Table| {
                Ok("{\"auto_port\":true,\"port_range_start\":5433,\"port_range_end\":5499,\"default_version\":\"16\",\"default_backend\":\"portable\"}".to_string())
            })?,
        )?;
        pg.set(
            "list_custom_versions",
            lua.create_function(|_, _: ()| Ok("[]".to_string()))?,
        )?;
        pg.set(
            "add_custom_version",
            lua.create_function(|_, _: (String, String)| Ok("{}".to_string()))?,
        )?;
        pg.set(
            "remove_custom_version",
            lua.create_function(|_, _: String| Ok(()))?,
        )?;
        pg.set(
            "supported_extensions",
            lua.create_function(|_, _: ()| Ok("[]".to_string()))?,
        )?;
        pg.set(
            "docker_image_for",
            lua.create_function(
                |_, (v, _, _): (String, Vec<String>, Option<String>)| Ok(format!("postgres:{v}")),
            )?,
        )?;
        pg.set(
            "docker_image_warnings_for",
            lua.create_function(|_, _: (String, Vec<String>, Option<String>)| Ok("[]".to_string()))?,
        )?;
        pg.set(
            "detect_docker",
            lua.create_function(|_, _: ()| Ok("{\"available\":false}".to_string()))?,
        )?;
        pg.set(
            "install_extension",
            lua.create_function(|_, _: (String, String, String, Option<String>)| {
                Ok("{\"columns\":[],\"rows\":[],\"row_count\":0,\"truncated\":false}".to_string())
            })?,
        )?;
        pg.set(
            "create_database",
            lua.create_function(|_, _: (String, String, Option<String>)| Ok("created".to_string()))?,
        )?;
        pg.set(
            "drop_database",
            lua.create_function(|_, _: (String, String, Option<String>)| Ok("dropped".to_string()))?,
        )?;
        pg.set(
            "drop_table",
            lua.create_function(
                |_, _: (String, String, Option<String>, String, Option<String>)| Ok("dropped".to_string()),
            )?,
        )?;
    }
    vault.set("postgres", pg)?;
    Ok(())
}
