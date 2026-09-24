use serde_json::Value;

use super::api::{DokployConnection, str_field};
use super::dto::{DokployGitProviderDto, DokployServiceCandidateDto};
use super::matching::{container_env_name, git_coords, project_list, service_containers, service_owner_repo};

pub(crate) fn service_linked(svc: &Value) -> bool {
    const REPO_KEYS: [&str; 12] = [
        "repository",
        "customGitUrl",
        "gitlabRepository",
        "giteaRepository",
        "bitbucketRepository",
        "bitbucketRepositorySlug",
        "dockerImage",
        "gitlabPathNamespace",
        "repositoryName",
        "repo",
        "composeFile",
        "dropBuildPath",
    ];
    REPO_KEYS.iter().any(|k| str_field(svc, k).is_some())
}

pub(crate) fn candidate_from_service(
    kind: &str,
    id_key: &str,
    project_name: &str,
    environment: Option<String>,
    server: &DokployConnection,
    svc: &Value,
) -> Option<DokployServiceCandidateDto> {
    let id = [id_key, "id"]
        .iter()
        .filter_map(|k| str_field(svc, k))
        .next()?;
    let (owner, repo) = service_owner_repo(svc);
    let (_, disp_owner, disp_repo, branch) = git_coords(svc);
    Some(DokployServiceCandidateDto {
        kind: kind.to_string(),
        id,
        name: str_field(svc, "name").unwrap_or_default(),
        project_name: project_name.to_string(),
        source_type: str_field(svc, "sourceType"),
        linked: service_linked(svc),
        repository: disp_repo.or_else(|| if repo.is_empty() { None } else { Some(repo) }),
        owner: disp_owner.or_else(|| if owner.is_empty() { None } else { Some(owner) }),
        branch,
        environment,
        server_id: server.id.clone(),
        server_name: server.name.clone(),
    })
}

pub(crate) fn collect_candidates_for_server(
    projects: &Value,
    server: &DokployConnection,
    query: &str,
) -> Vec<DokployServiceCandidateDto> {
    let q = query.trim().to_ascii_lowercase();
    let mut out = Vec::new();
    for p in project_list(projects) {
        let project_name = str_field(p, "name").unwrap_or_default();
        for container in service_containers(p) {
            let env_name = container_env_name(p, container);
            for (key, kind, id_key) in [
                ("applications", "application", "applicationId"),
                ("compose", "compose", "composeId"),
            ] {
                if let Some(arr) = container.get(key).and_then(|a| a.as_array()) {
                    for svc in arr {
                        if let Some(c) = candidate_from_service(
                            kind,
                            id_key,
                            &project_name,
                            env_name.clone(),
                            server,
                            svc,
                        ) {
                            let hay = format!("{} {} {}", c.name, c.project_name, c.id)
                                .to_ascii_lowercase();
                            if q.is_empty() || hay.contains(&q) || !c.linked {
                                out.push(c);
                            }
                            if out.len() >= 50 {
                                break;
                            }
                        }
                    }
                }
                if out.len() >= 50 {
                    break;
                }
            }
            if out.len() >= 50 {
                break;
            }
        }
        if out.len() >= 50 {
            break;
        }
    }
    out
}

pub(crate) fn sort_candidates(out: &mut [DokployServiceCandidateDto], query: &str) {
    let q = query.trim().to_ascii_lowercase();
    out.sort_by(|a, b| {
        let rank = |c: &DokployServiceCandidateDto| {
            let name_hit = !q.is_empty()
                && (c.name.to_ascii_lowercase().contains(&q)
                    || c.project_name.to_ascii_lowercase().contains(&q));
            (
                if name_hit { 0 } else { 1 },
                if c.linked { 1 } else { 0 },
                c.server_name.clone(),
                c.project_name.clone(),
                c.name.clone(),
            )
        };
        rank(a).cmp(&rank(b))
    });
}

#[cfg(test)]
pub(crate) fn collect_candidates(projects: &Value, query: &str) -> Vec<DokployServiceCandidateDto> {
    // Legacy single-server helper preserved for unit tests.
    let stub = DokployConnection {
        id: String::new(),
        name: String::new(),
        url: String::new(),
        api_key: String::new(),
    };
    let mut out = collect_candidates_for_server(projects, &stub, query);
    sort_candidates(&mut out, query);
    out
}

pub(crate) fn parse_git_provider_row(p: &Value, server: &DokployConnection) -> Option<DokployGitProviderDto> {
    let gh = p.get("github");
    let github_id = gh
        .and_then(|g| str_field(g, "githubId"))
        .or_else(|| str_field(p, "githubId"))
        .or_else(|| str_field(p, "id"))
        .or_else(|| str_field(p, "providerId"))?;
    let configured = gh
        .and_then(|g| g.get("isConfigured"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let name = gh
        .and_then(|g| str_field(g, "githubAppName"))
        .or_else(|| str_field(p, "githubAppName"))
        .or_else(|| str_field(p, "name"))
        .unwrap_or_default();
    Some(DokployGitProviderDto {
        id: github_id,
        name,
        provider_type: str_field(p, "providerType").or_else(|| str_field(p, "type")),
        git_provider_id: str_field(p, "gitProviderId"),
        configured,
        server_id: server.id.clone(),
        server_name: server.name.clone(),
    })
}

/// Build the saveGithubProvider payload, preserving the service's existing
/// trigger/build config so linking a repo never flips e.g. tag → push.
pub(crate) fn github_provider_payload(
    id_key: &str,
    id: &str,
    github_id: &str,
    owner: &str,
    repository: &str,
    branch: &str,
    detail: &Value,
) -> Value {
    let trigger = str_field(detail, "triggerType").unwrap_or_else(|| "push".to_string());
    let build_path = str_field(detail, "buildPath")
        .or_else(|| str_field(detail, "customGitBuildPath"))
        .unwrap_or_else(|| "/".to_string());
    let submodules = detail
        .get("enableSubmodules")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut payload = serde_json::json!({
        id_key: id,
        "githubId": github_id,
        "owner": owner,
        "repository": repository,
        "branch": branch,
        "buildPath": build_path,
        "triggerType": trigger,
        "enableSubmodules": submodules,
    });
    if let Some(paths) = detail.get("watchPaths") {
        if paths.is_array() || paths.is_null() {
            payload["watchPaths"] = paths.clone();
        }
    }
    payload
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn git_providers_parse_nested_github_object() {
        // Real gitProvider.getAll shape: nested `github: {...} | null`.
        let raw = json!([
            {
                "gitProviderId": "gp_1",
                "name": "Dokploy-vps-netcup",
                "providerType": "github",
                "github": {
                    "githubId": "QGUJE2IE6VUFFFY-Uq80B",
                    "githubAppName": "Dokploy-vps-netcup",
                    "isConfigured": true,
                },
            },
            {
                "gitProviderId": "gp_2",
                "name": "gitlab",
                "providerType": "gitlab",
                "github": null,
                "gitlab": { "gitlabId": "gl_1" },
            },
        ]);
        let stub = DokployConnection {
            id: "s1".to_string(),
            name: "Main".to_string(),
            url: "https://dokploy.local".to_string(),
            api_key: "key".to_string(),
        };
        let out: Vec<DokployGitProviderDto> = project_list(&raw)
            .iter()
            .filter_map(|p| parse_git_provider_row(p, &stub))
            .collect();
        // Only the GitHub entry yields a usable id.
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "QGUJE2IE6VUFFFY-Uq80B");
        assert_eq!(out[0].name, "Dokploy-vps-netcup");
        assert!(out[0].configured);
    }

    #[test]
    fn candidates_rank_name_hits_and_unlinked_first() {
        let projects = json!([{
            "name": "Other",
            "applications": [
                { "applicationId": "a1", "name": "other-app", "sourceType": "github",
                  "owner": "acme", "repository": "other", "branch": "main" },
                { "applicationId": "a2", "name": "cairn", "sourceType": "github" },
            ],
            "compose": [],
        }]);
        let out = collect_candidates(&projects, "cairn");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "a2");
        assert!(!out[0].linked);
        assert!(out[1].linked);
    }

    #[test]
    fn link_payload_preserves_trigger_config() {
        let detail = json!({
            "triggerType": "tag",
            "buildPath": "/apps/web",
            "enableSubmodules": true,
            "watchPaths": ["apps/web/**"],
        });
        let p = github_provider_payload(
            "applicationId",
            "app_1",
            "gh_1",
            "acme",
            "web",
            "main",
            &detail,
        );
        assert_eq!(p["owner"], json!("acme"));
        assert_eq!(p["repository"], json!("web"));
        assert_eq!(p["branch"], json!("main"));
        assert_eq!(p["githubId"], json!("gh_1"));
        assert_eq!(p["triggerType"], json!("tag"));
        assert_eq!(p["buildPath"], json!("/apps/web"));
        assert_eq!(p["enableSubmodules"], json!(true));
        assert_eq!(p["watchPaths"], json!(["apps/web/**"]));
    }

    #[test]
    fn link_payload_defaults_for_fresh_services() {
        let p = github_provider_payload(
            "composeId",
            "c_1",
            "gh_1",
            "acme",
            "web",
            "main",
            &Value::Null,
        );
        assert_eq!(p["composeId"], json!("c_1"));
        assert_eq!(p["triggerType"], json!("push"));
        assert_eq!(p["buildPath"], json!("/"));
        assert_eq!(p["enableSubmodules"], json!(false));
        assert!(p.get("watchPaths").is_none());
    }
}
