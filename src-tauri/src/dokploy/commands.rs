use serde_json::Value;

use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};

use super::api::{
    api_get, api_post, connection_from_parts, read_connections, select_connection, str_field,
    DOKPLOY_API_VERSION, DokployConnection,
};
use super::candidates::*;
use super::dto::*;
use super::matching::*;
use super::status::*;

#[tauri::command]
pub async fn dokploy_api_version() -> Result<u32, StableError> {
    Ok(DOKPLOY_API_VERSION)
}

#[tauri::command]
pub async fn dokploy_test_connection(url: String, api_key: String) -> Result<usize, StableError> {
    let conn = connection_from_parts(&url, &api_key)?;
    let projects = api_get(&conn, "/api/project.all").await?;
    Ok(project_list(&projects).len())
}

#[tauri::command]
pub async fn dokploy_list_matches(
    db: State<'_, DbInstances>,
    owner: String,
    repo: String,
    remote_url: Option<String>,
) -> Result<Vec<DokployMatchDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let remote = remote_url.as_deref().unwrap_or("").to_string();
    let (local_owner, local_repo) = local_identity(&owner, &repo, &remote);
    let mut out = Vec::new();
    // Fan-out over all servers; per-server failures are skipped so one
    // unreachable instance never hides the others.
    let mut projects_per_server: Vec<(&DokployConnection, Value)> = Vec::new();
    for conn in &conns {
        let Ok(projects) = api_get(conn, "/api/project.all").await else {
            continue;
        };
        let mut matches = collect_matches_for_server(&projects, conn, &owner, &repo, &remote);
        out.append(&mut matches);
        projects_per_server.push((conn, projects));
    }
    if !out.is_empty() {
        sort_matches(&mut out);
        return Ok(out);
    }
    if local_owner.is_empty() || local_repo.is_empty() {
        return Ok(out);
    }
    // Phase 2: some instances omit provider fields from the project list.
    // Resolve owner/repo per service via the detail endpoints (bounded per
    // server).
    for (conn, projects) in &projects_per_server {
        for (kind, id, name, project_name, env_name) in service_refs(projects).into_iter().take(15)
        {
            let detail_path = if kind == "application" {
                format!("/api/application.one?applicationId={id}")
            } else {
                format!("/api/compose.one?composeId={id}")
            };
            let Ok(detail) = api_get(conn, &detail_path).await else {
                continue;
            };
            let (id_key, status_keys): (&str, &[&str]) = if kind == "application" {
                ("applicationId", &["applicationStatus", "status"])
            } else {
                ("composeId", &["composeStatus", "status"])
            };
            if let Some(m) = match_from_service(
                &kind,
                id_key,
                status_keys,
                &project_name,
                env_name.clone(),
                conn,
                &detail,
                &local_owner,
                &local_repo,
            ) {
                // match_from_service derives name from detail; keep list name as fallback.
                let mut m = m;
                if m.name == id_key {
                    m.name = name.clone();
                }
                out.push(m);
            }
        }
    }
    sort_matches(&mut out);
    Ok(out)
}


#[tauri::command]
pub async fn dokploy_debug_scan(
    db: State<'_, DbInstances>,
    owner: String,
    repo: String,
    remote_url: Option<String>,
) -> Result<DokployDebugScanDto, StableError> {
    #[cfg(not(debug_assertions))]
    return Err(StableError::new(
        codes::INTERNAL,
        "debug command disabled in release builds",
    ));
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let (local_owner, local_repo) =
        local_identity(&owner, &repo, remote_url.as_deref().unwrap_or(""));
    let local = GitTriple {
        host: String::new(),
        owner: local_owner,
        repo: local_repo,
    };
    let mut services = Vec::new();
    let mut project_count = 0;
    let mut unreachable_servers = Vec::new();
    for conn in &conns {
        let Ok(projects) = api_get(conn, "/api/project.all").await else {
            unreachable_servers.push(conn.name.clone());
            continue;
        };
        for p in project_list(&projects) {
            project_count += 1;
            let project_name = str_field(p, "name").unwrap_or_default();
            for (ci, container) in service_containers(p).iter().enumerate() {
                // First container is the project itself (flat shape); the rest
                // are environments (nested shape).
                let env_name = if ci == 0 {
                    None
                } else {
                    str_field(container, "name")
                };
                for (key, kind, id_key) in [
                    ("applications", "application", "applicationId"),
                    ("compose", "compose", "composeId"),
                ] {
                    if let Some(arr) = container.get(key).and_then(|a| a.as_array()) {
                        for svc in arr {
                            let _ = str_field(svc, id_key);
                            let (svc_owner, svc_repo) = service_owner_repo(svc);
                            let (_, disp_owner, disp_repo, branch) = git_coords(svc);
                            services.push(DokployDebugServiceDto {
                                kind: kind.to_string(),
                                name: str_field(svc, "name").unwrap_or_default(),
                                source_type: str_field(svc, "sourceType"),
                                owner: disp_owner.or_else(|| {
                                    if svc_owner.is_empty() {
                                        None
                                    } else {
                                        Some(svc_owner.clone())
                                    }
                                }),
                                repository: disp_repo.or_else(|| {
                                    if svc_repo.is_empty() {
                                        None
                                    } else {
                                        Some(svc_repo.clone())
                                    }
                                }),
                                branch,
                                environment: env_name.clone(),
                                project_name: project_name.clone(),
                                server_id: conn.id.clone(),
                                server_name: conn.name.clone(),
                            });
                            if services.len() >= 20 {
                                break;
                            }
                        }
                    }
                    if services.len() >= 20 {
                        break;
                    }
                }
                if services.len() >= 20 {
                    break;
                }
            }
            if services.len() >= 20 {
                break;
            }
        }
        if services.len() >= 20 {
            break;
        }
    }
    Ok(DokployDebugScanDto {
        project_count,
        service_count: services.len(),
        local_host: if local.host.is_empty() {
            None
        } else {
            Some(local.host.clone())
        },
        local_owner: if local.owner.is_empty() {
            None
        } else {
            Some(local.owner.clone())
        },
        local_repo: if local.repo.is_empty() {
            None
        } else {
            Some(local.repo.clone())
        },
        services,
        unreachable_servers,
    })
}


#[tauri::command]
pub async fn dokploy_service_status(
    db: State<'_, DbInstances>,
    kind: String,
    id: String,
    server_id: Option<String>,
) -> Result<DokployServiceStatusDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let conn = select_connection(&conns, server_id.as_deref())?.clone();
    let kind = kind.trim().to_ascii_lowercase();
    if kind != "application" && kind != "compose" {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Unknown Dokploy service kind (expected application or compose).",
        ));
    }

    // Reuse project.all to resolve names + dashboard context, then fetch
    // detail + deployments for the selected service.
    let projects = api_get(&conn, "/api/project.all").await?;
    let mut found: Option<(String, String, String, Option<String>, Value)> = None;
    'outer: for p in project_list(&projects) {
        let project_name = str_field(p, "name").unwrap_or_default();
        let project_id = str_field(p, "projectId").unwrap_or_default();
        let key = if kind == "application" {
            "applications"
        } else {
            "compose"
        };
        let id_key = if kind == "application" {
            "applicationId"
        } else {
            "composeId"
        };
        for container in service_containers(p) {
            // Nested shape: the environment carries its id; flat shape and
            // most service objects carry `environmentId` themselves.
            let container_env =
                str_field(container, "environmentId").or_else(|| str_field(container, "id"));
            let env_name = container_env_name(p, container);
            if let Some(arr) = container.get(key).and_then(|a| a.as_array()) {
                for svc in arr {
                    let sid = [id_key, "id"]
                        .iter()
                        .filter_map(|k| str_field(svc, k))
                        .next()
                        .unwrap_or_default();
                    if sid == id {
                        let env_id = str_field(svc, "environmentId")
                            .or(container_env.clone())
                            .unwrap_or_default();
                        found = Some((
                            project_name.clone(),
                            project_id.clone(),
                            env_id,
                            env_name.clone(),
                            svc.clone(),
                        ));
                        break 'outer;
                    }
                }
            }
        }
    }
    let (project_name, project_id, mut env_id, mut env_name, svc) = found.ok_or_else(|| {
        StableError::new(
            codes::DOKPLOY_NOT_FOUND,
            "Dokploy service not found. It may have been deleted.",
        )
    })?;

    let (detail_path, deploy_path) = if kind == "application" {
        (
            format!("/api/application.one?applicationId={id}"),
            format!("/api/deployment.all?applicationId={id}"),
        )
    } else {
        (
            format!("/api/compose.one?composeId={id}"),
            format!("/api/deployment.allByCompose?composeId={id}"),
        )
    };
    // Detail endpoint may vary across Dokploy versions; fall back to the
    // project.all snapshot when it 404s.
    let detail = match api_get(&conn, &detail_path).await {
        Ok(v) => v,
        Err(e) if e.code == codes::DOKPLOY_NOT_FOUND => svc.clone(),
        Err(e) => return Err(e),
    };
    let base = if detail.is_object() && detail.get("applicationStatus").is_some() {
        detail.clone()
    } else {
        svc.clone()
    };
    let deployments = match api_get(&conn, &deploy_path).await {
        Ok(v) => deployments_from_value(&v),
        Err(_) => Vec::new(),
    };

    let status_keys: &[&str] = if kind == "application" {
        &["applicationStatus", "status"]
    } else {
        &["composeStatus", "status"]
    };
    let status = status_keys
        .iter()
        .filter_map(|k| str_field(&base, k))
        .next();
    let (_, repo_owner, repository, branch) = git_coords(&base);
    // The detail response is the most reliable environmentId source.
    if env_id.is_empty() {
        if let Some(e) = str_field(&base, "environmentId").filter(|s| !s.is_empty()) {
            env_id = e;
        }
    }
    if env_name.is_none() {
        env_name = str_field(&base, "environmentName").or_else(|| str_field(&svc, "environment"));
    }
    let dashboard_url = dashboard_service_url(&conn.url, &project_id, &env_id, &kind, &id);

    Ok(DokployServiceStatusDto {
        kind,
        id: id.clone(),
        name: str_field(&base, "name").unwrap_or(id),
        project_name,
        status,
        domains: domains_of(&base),
        repository,
        owner: repo_owner,
        branch,
        environment: env_name,
        server_id: conn.id.clone(),
        server_name: conn.name.clone(),
        dashboard_url,
        deployments,
    })
}

#[tauri::command]
pub async fn dokploy_redeploy(
    db: State<'_, DbInstances>,
    kind: String,
    id: String,
    server_id: Option<String>,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let conn = select_connection(&conns, server_id.as_deref())?;
    let kind = kind.trim().to_ascii_lowercase();
    let (path, payload) = if kind == "application" {
        (
            "/api/application.deploy".to_string(),
            serde_json::json!({
                "applicationId": id,
                "title": "Redeploy from Project Vault",
                "description": "Triggered manually from Project Vault",
            }),
        )
    } else if kind == "compose" {
        (
            "/api/compose.deploy".to_string(),
            serde_json::json!({
                "composeId": id,
                "title": "Redeploy from Project Vault",
                "description": "Triggered manually from Project Vault",
            }),
        )
    } else {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Unknown Dokploy service kind (expected application or compose).",
        ));
    };
    api_post(&conn, &path, payload).await?;
    Ok(())
}

#[tauri::command]
pub async fn dokploy_git_providers(
    db: State<'_, DbInstances>,
) -> Result<Vec<DokployGitProviderDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let mut out = Vec::new();
    for conn in &conns {
        let Ok(raw) = api_get(conn, "/api/gitProvider.getAll").await else {
            continue;
        };
        // Real shape: [{ gitProviderId, name, providerType,
        //   github: { githubId, githubAppName, isConfigured, ... } | null, ... }]
        out.extend(
            project_list(&raw)
                .iter()
                .filter_map(|p| parse_git_provider_row(p, conn)),
        );
    }
    Ok(out)
}

#[tauri::command]
pub async fn dokploy_list_services(
    db: State<'_, DbInstances>,
    query: String,
) -> Result<Vec<DokployServiceCandidateDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let mut out = Vec::new();
    for conn in &conns {
        let Ok(projects) = api_get(conn, "/api/project.all").await else {
            continue;
        };
        out.extend(collect_candidates_for_server(&projects, conn, &query));
        if out.len() >= 50 {
            break;
        }
    }
    out.truncate(50);
    sort_candidates(&mut out, &query);
    Ok(out)
}

#[tauri::command]
pub async fn dokploy_link_github(
    db: State<'_, DbInstances>,
    kind: String,
    id: String,
    github_id: String,
    owner: String,
    repository: String,
    branch: String,
    server_id: Option<String>,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let conns = read_connections(&pool).await?;
    let conn = select_connection(&conns, server_id.as_deref())?.clone();
    let kind = kind.trim().to_ascii_lowercase();
    let owner = owner.trim().to_string();
    let repository = repository.trim().to_string();
    let branch = branch.trim().to_string();
    if owner.is_empty() || repository.is_empty() || branch.is_empty() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Owner, repository and branch are required to link.",
        ));
    }
    if github_id.trim().is_empty() {
        return Err(StableError::new(
            codes::DOKPLOY_NOT_CONFIGURED,
            "No GitHub provider found in Dokploy. Connect the GitHub App in the Dokploy dashboard first.",
        ));
    }
    let (detail_path, save_path, id_key) = if kind == "application" {
        (
            format!("/api/application.one?applicationId={id}"),
            "/api/application.saveGithubProvider",
            "applicationId",
        )
    } else if kind == "compose" {
        (
            format!("/api/compose.one?composeId={id}"),
            "/api/compose.saveGithubProvider",
            "composeId",
        )
    } else {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Unknown Dokploy service kind (expected application or compose).",
        ));
    };
    let detail = match api_get(&conn, &detail_path).await {
        Ok(v) => v,
        Err(e) if e.code == codes::DOKPLOY_NOT_FOUND => Value::Null,
        Err(e) => return Err(e),
    };
    let payload = github_provider_payload(
        id_key,
        &id,
        github_id.trim(),
        &owner,
        &repository,
        &branch,
        &detail,
    );
    api_post(&conn, save_path, payload).await?;
    Ok(())
}
