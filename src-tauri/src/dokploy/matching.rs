use serde_json::Value;

use super::api::{DokployConnection, str_field};
use super::dto::{DokployMatchDto, GitTriple};

pub(crate) fn clean_repo_name(s: &str) -> String {
    s.trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_string()
}

/// Parse anything from `"repo"` to `"owner/repo"` to full clone URLs
/// (`https://host/owner/repo.git`, `git@host:owner/repo.git`,
/// `ssh://git@host/owner/repo`, URLs with `user:token@` credentials).
pub(crate) fn parse_git_remote(raw: &str) -> GitTriple {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return GitTriple::default();
    }
    // Strip scheme + credentials: "https://user:token@host/..." -> "host/..."
    if let Some(after_scheme) = s.split_once("://").map(|(_, rest)| rest) {
        s = after_scheme.to_string();
        if let Some(at) = s.find('@') {
            s = s[at + 1..].to_string();
        }
        // "host/owner/repo(.git)"
        let mut parts: Vec<&str> = s.split('/').collect();
        parts.retain(|p| !p.is_empty());
        if parts.len() >= 3 {
            let host = parts[0].to_ascii_lowercase();
            let owner = parts[parts.len() - 2].to_string();
            let repo = clean_repo_name(parts[parts.len() - 1]);
            if !repo.is_empty() {
                return GitTriple { host, owner, repo };
            }
        }
        return GitTriple::default();
    }
    // SCP-like SSH syntax: "git@host:owner/repo.git" (or "host:owner/repo").
    if let Some(colon) = s.find(':') {
        let left = &s[..colon];
        let right = &s[colon + 1..];
        if !right.starts_with('/') && !left.contains('/') {
            let host = left.rsplit('@').next().unwrap_or(left).to_ascii_lowercase();
            let right = right.trim_start_matches('/');
            if let Some((owner, repo)) = right.split_once('/') {
                let repo = clean_repo_name(repo);
                if !owner.is_empty() && !repo.is_empty() && !repo.contains('/') {
                    return GitTriple {
                        host,
                        owner: owner.to_string(),
                        repo,
                    };
                }
            }
            return GitTriple::default();
        }
    }
    // "owner/repo" or bare "repo".
    if let Some((owner, repo)) = s.split_once('/') {
        let repo = clean_repo_name(repo);
        if !owner.is_empty() && !repo.is_empty() && !repo.contains('/') {
            return GitTriple {
                host: String::new(),
                owner: owner.trim().to_string(),
                repo,
            };
        }
        return GitTriple::default();
    }
    GitTriple {
        host: String::new(),
        owner: String::new(),
        repo: clean_repo_name(&s),
    }
}

/// Dokploy stores git coordinates per provider; collect owner/repository/
/// branch best-effort so matching never fails hard. Returns the parsed
/// triple plus display values and the branch.
pub(crate) fn git_coords(v: &Value) -> (GitTriple, Option<String>, Option<String>, Option<String>) {
    // Candidate raw identity strings, richest first.
    let mut candidates: Vec<String> = Vec::new();
    if let Some(u) = str_field(v, "customGitUrl") {
        candidates.push(u);
    }
    let owner_keys = [
        "owner",
        "repositoryOwner",
        "gitOwner",
        "gitlabOwner",
        "giteaOwner",
        "bitbucketOwner",
    ];
    let repo_keys = [
        "repository",
        "repositoryName",
        "repo",
        "gitlabRepository",
        "giteaRepository",
        "bitbucketRepository",
        "bitbucketRepositorySlug",
    ];
    let owner = owner_keys.iter().filter_map(|k| str_field(v, k)).next();
    let repo_raw = repo_keys.iter().filter_map(|k| str_field(v, k)).next();
    if let (Some(o), Some(r)) = (owner.clone(), repo_raw.clone()) {
        candidates.push(format!("{o}/{r}"));
    } else if let Some(r) = repo_raw.clone() {
        candidates.push(r);
    }
    // gitlabPathNamespace can hold "group/subgroup" for nested groups.
    if let Some(ns) = str_field(v, "gitlabPathNamespace") {
        if let Some(r) = repo_raw.clone() {
            let tail = r.rsplit('/').next().unwrap_or(&r);
            candidates.push(format!("{ns}/{tail}"));
        }
    }

    let mut triple = GitTriple::default();
    for c in &candidates {
        let t = parse_git_remote(c);
        if !t.repo.is_empty() {
            triple = t;
            break;
        }
    }
    // Prefer an explicit owner field over one parsed out of the repo string.
    if let Some(o) = owner {
        if !o.trim().is_empty() {
            triple.owner = o.trim().to_string();
        }
    }
    let branch = str_field(v, "branch")
        .or_else(|| str_field(v, "defaultBranch"))
        .or_else(|| str_field(v, "customGitBranch"))
        .or_else(|| str_field(v, "gitlabBranch"))
        .or_else(|| str_field(v, "giteaBranch"))
        .or_else(|| str_field(v, "bitbucketBranch"));
    let display_repo = if triple.repo.is_empty() {
        None
    } else {
        Some(triple.repo.clone())
    };
    let display_owner = if triple.owner.is_empty() {
        None
    } else {
        Some(triple.owner.clone())
    };
    (triple, display_owner, display_repo, branch)
}

pub(crate) fn domains_of(v: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(arr) = v.get("domains").and_then(|d| d.as_array()) {
        for d in arr {
            if let Some(host) = d
                .get("host")
                .and_then(|h| h.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                // Domains are shown without ports: Dokploy routes them
                // through Traefik, so the port is never part of the URL.
                let https = d.get("https").and_then(|h| h.as_bool()).unwrap_or(true);
                let scheme = if https { "https" } else { "http" };
                out.push(format!("{scheme}://{host}"));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Unwrap response envelopes: bare array, bare project object,
/// `{result:{data:...}}` (tRPC) or `{projects:[...]}` wrappers.
pub(crate) fn project_list(projects: &Value) -> Vec<&Value> {
    let mut v = projects;
    // Unwrap tRPC-style envelopes one level at a time.
    for _ in 0..3 {
        if let Some(inner) = v.get("result").and_then(|r| r.get("data")) {
            v = inner;
            continue;
        }
        if let Some(inner) = v.get("data") {
            if inner.is_array() || inner.is_object() {
                v = inner;
                continue;
            }
        }
        break;
    }
    if let Some(arr) = v.as_array() {
        return arr.iter().collect();
    }
    if let Some(arr) = v.get("projects").and_then(|p| p.as_array()) {
        return arr.iter().collect();
    }
    vec![v]
}

/// Containers that can hold services: the project itself (flat shape) plus
/// each entry of `environments[]` (nested shape, used by newer Dokploy
/// versions). Every consumer walks this so all shapes behave identically.
pub(crate) fn service_containers<'a>(project: &'a Value) -> Vec<&'a Value> {
    let mut out = vec![project];
    if let Some(envs) = project.get("environments").and_then(|e| e.as_array()) {
        out.extend(envs.iter());
    }
    for key in ["environment", "envs"] {
        if let Some(v) = project.get(key) {
            if v.is_object() {
                out.push(v);
            } else if let Some(arr) = v.as_array() {
                out.extend(arr.iter());
            }
        }
    }
    out
}

/// Raw (owner, repository) strings for a service, all providers considered.
/// Full clone URLs are reduced to their path parts.
pub(crate) fn service_owner_repo(v: &Value) -> (String, String) {
    const OWNER_KEYS: [&str; 6] = [
        "owner",
        "repositoryOwner",
        "gitOwner",
        "gitlabOwner",
        "giteaOwner",
        "bitbucketOwner",
    ];
    const REPO_KEYS: [&str; 7] = [
        "repository",
        "repositoryName",
        "repo",
        "gitlabRepository",
        "giteaRepository",
        "bitbucketRepository",
        "bitbucketRepositorySlug",
    ];
    let mut owner = OWNER_KEYS
        .iter()
        .filter_map(|k| str_field(v, k))
        .next()
        .unwrap_or_default();
    let mut repo = REPO_KEYS
        .iter()
        .filter_map(|k| str_field(v, k))
        .next()
        .unwrap_or_default();
    if repo.contains("://") {
        let t = parse_git_remote(&repo);
        if owner.is_empty() {
            owner = t.owner;
        }
        repo = t.repo;
    }
    if repo.is_empty() {
        if let Some(u) = str_field(v, "customGitUrl") {
            let t = parse_git_remote(&u);
            if owner.is_empty() {
                owner = t.owner;
            }
            repo = t.repo;
        }
    }
    (owner, repo)
}

/// The whole match decision: owner + repo strings only.
/// Case-insensitive, ignores whitespace and `.git` suffixes, accepts a
/// full-path `"owner/repo"` repository value. Host, provider, and branch
/// never influence matching.
pub(crate) fn owner_repo_matches(
    svc_owner: &str,
    svc_repo: &str,
    local_owner: &str,
    local_repo: &str,
) -> bool {
    let lo = local_owner.trim();
    let lr = clean_repo_name(local_repo);
    if lo.is_empty() || lr.is_empty() {
        return false;
    }
    let sr = clean_repo_name(svc_repo);
    if sr.is_empty() {
        return false;
    }
    // Repo must equal the tail segment (handles full-path values).
    let tail = sr.rsplit('/').next().unwrap_or("");
    if !tail.eq_ignore_ascii_case(&lr) {
        return false;
    }
    let so = svc_owner.trim();
    if !so.is_empty() && so.eq_ignore_ascii_case(lo) {
        return true;
    }
    // Fall back to an owner embedded in a full-path repository value.
    if sr.contains('/') {
        if let Some(o) = sr.split('/').next() {
            if !o.trim().is_empty() && o.eq_ignore_ascii_case(lo) {
                return true;
            }
        }
    }
    false
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn match_from_service(
    kind: &str,
    id_key: &str,
    status_keys: &[&str],
    project_name: &str,
    environment: Option<String>,
    server: &DokployConnection,
    svc: &Value,
    local_owner: &str,
    local_repo: &str,
) -> Option<DokployMatchDto> {
    let id = [id_key, "id"]
        .iter()
        .filter_map(|k| str_field(svc, k))
        .next()?;
    let (svc_owner, svc_repo) = service_owner_repo(svc);
    if !owner_repo_matches(&svc_owner, &svc_repo, local_owner, local_repo) {
        return None;
    }
    let (_, disp_owner, disp_repo, branch) = git_coords(svc);
    let status = status_keys.iter().filter_map(|k| str_field(svc, k)).next();
    Some(DokployMatchDto {
        kind: kind.to_string(),
        id,
        name: str_field(svc, "name").unwrap_or_else(|| id_key.to_string()),
        project_name: project_name.to_string(),
        status,
        domains: domains_of(svc),
        repository: disp_repo.or_else(|| {
            if svc_repo.is_empty() {
                None
            } else {
                Some(svc_repo.clone())
            }
        }),
        owner: disp_owner.or_else(|| {
            if svc_owner.is_empty() {
                None
            } else {
                Some(svc_owner.clone())
            }
        }),
        branch,
        environment,
        server_id: server.id.clone(),
        server_name: server.name.clone(),
        match_kind: "owner_repo".to_string(),
    })
}

/// Local (owner, repo) identity: the full remote URL wins, plain
/// owner/repo params are the fallback.
pub(crate) fn local_identity(owner: &str, repo: &str, remote_url: &str) -> (String, String) {
    let t = parse_git_remote(remote_url);
    if t.repo.is_empty() {
        (owner.trim().to_string(), clean_repo_name(repo))
    } else if t.owner.is_empty() {
        (owner.trim().to_string(), t.repo)
    } else {
        (t.owner, t.repo)
    }
}

/// Flat list of (kind, id, name, project_name, environment) for every
/// service, both response shapes included. Used for the phase-2 detail
/// fallback.
pub(crate) fn service_refs(projects: &Value) -> Vec<(String, String, String, String, Option<String>)> {
    let mut out = Vec::new();
    for p in project_list(projects) {
        let project_name = str_field(p, "name").unwrap_or_default();
        for (ci, container) in service_containers(p).iter().enumerate() {
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
                        if let Some(id) = [id_key, "id"]
                            .iter()
                            .filter_map(|k| str_field(svc, k))
                            .next()
                        {
                            out.push((
                                kind.to_string(),
                                id,
                                str_field(svc, "name").unwrap_or_default(),
                                project_name.clone(),
                                env_name.clone(),
                            ));
                        }
                    }
                }
            }
        }
    }
    out
}

/// Environment display name for a service container: the environment entry
/// carries `name` in the nested shape; the flat shape has none.
pub(crate) fn container_env_name(project: &Value, container: &Value) -> Option<String> {
    let containers = service_containers(project);
    let idx = containers
        .iter()
        .position(|c| std::ptr::eq(*c, container))?;
    if idx == 0 {
        None
    } else {
        str_field(container, "name")
    }
}

pub(crate) fn collect_matches_for_server(
    projects: &Value,
    server: &DokployConnection,
    owner: &str,
    repo: &str,
    remote_url: &str,
) -> Vec<DokployMatchDto> {
    let (local_owner, local_repo) = local_identity(owner, repo, remote_url);
    let mut out = Vec::new();
    for p in project_list(projects) {
        let project_name = str_field(p, "name").unwrap_or_default();
        for container in service_containers(p) {
            let env_name = container_env_name(p, container);
            if let Some(apps) = container.get("applications").and_then(|a| a.as_array()) {
                for app in apps {
                    if let Some(m) = match_from_service(
                        "application",
                        "applicationId",
                        &["applicationStatus", "status"],
                        &project_name,
                        env_name.clone(),
                        server,
                        app,
                        &local_owner,
                        &local_repo,
                    ) {
                        out.push(m);
                    }
                }
            }
            if let Some(compose) = container.get("compose").and_then(|c| c.as_array()) {
                for svc in compose {
                    if let Some(m) = match_from_service(
                        "compose",
                        "composeId",
                        &["composeStatus", "status"],
                        &project_name,
                        env_name.clone(),
                        server,
                        svc,
                        &local_owner,
                        &local_repo,
                    ) {
                        out.push(m);
                    }
                }
            }
        }
    }
    out
}

pub(crate) fn sort_matches(out: &mut [DokployMatchDto]) {
    out.sort_by(|a, b| {
        (&a.server_name, &a.project_name, &a.kind, &a.name).cmp(&(
            &b.server_name,
            &b.project_name,
            &b.kind,
            &b.name,
        ))
    });
}

#[cfg(test)]
pub(crate) fn collect_matches(
    projects: &Value,
    owner: &str,
    repo: &str,
    remote_url: &str,
) -> Vec<DokployMatchDto> {
    // Legacy single-server helper preserved for unit tests: tags results
    // with a stub server identity.
    let stub = DokployConnection {
        id: String::new(),
        name: String::new(),
        url: String::new(),
        api_key: String::new(),
    };
    let mut out = collect_matches_for_server(projects, &stub, owner, repo, remote_url);
    // Tests predate server tagging: keep their sort order (no server key).
    out.sort_by(|a, b| {
        (&a.project_name, &a.kind, &a.name).cmp(&(&b.project_name, &b.kind, &b.name))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn app(owner: &str, repo: &str) -> Value {
        json!({
            "applicationId": "app_1",
            "name": "web",
            "applicationStatus": "done",
            "owner": owner,
            "repository": repo,
            "branch": "main",
            "domains": [{ "host": "app.example.com", "port": 443, "https": true }],
        })
    }

    #[test]
    fn matches_owner_and_repo_case_insensitively() {
        let projects = json!([{ "name": "P", "applications": [app("Acme", "Web")] }]);
        let out = collect_matches(&projects, "acme", "web", "");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].match_kind, "owner_repo");
        assert_eq!(out[0].domains, vec!["https://app.example.com".to_string()]);
    }

    #[test]
    fn full_remote_url_matches_owner_repo() {
        let projects = json!([{ "name": "P", "applications": [app("acme", "web")] }]);
        let out = collect_matches(&projects, "acme", "web", "git@github.com:acme/web.git");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].match_kind, "owner_repo");
    }

    #[test]
    fn full_path_repository_matches() {
        let projects = json!([{ "name": "P", "applications": [app("", "acme/web")] }]);
        let out = collect_matches(&projects, "acme", "web", "");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].match_kind, "owner_repo");
    }

    #[test]
    fn custom_git_url_matches_remote() {
        let svc = json!({
            "composeId": "c1",
            "name": "stack",
            "composeStatus": "done",
            "customGitUrl": "https://git.internal.com/team/web.git",
            "customGitBranch": "main",
        });
        let projects = json!([{ "name": "P", "compose": [svc] }]);
        let out = collect_matches(&projects, "", "", "https://git.internal.com/team/web.git");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].match_kind, "owner_repo");
    }

    #[test]
    fn skips_unrelated_services() {
        let projects = json!([{ "name": "P", "applications": [app("acme", "other")] }]);
        assert!(collect_matches(&projects, "acme", "web", "").is_empty());
    }

    #[test]
    fn owner_mismatch_does_not_match() {
        let projects = json!([{ "name": "P", "applications": [app("other", "web")] }]);
        assert!(collect_matches(&projects, "acme", "web", "").is_empty());
    }

    #[test]
    fn service_without_owner_does_not_match() {
        let mut svc = app("acme", "web");
        svc.as_object_mut().unwrap().remove("owner");
        let projects = json!([{ "name": "P", "applications": [svc] }]);
        assert!(collect_matches(&projects, "acme", "web", "").is_empty());
    }

    #[test]
    fn branch_is_ignored_for_matching() {
        let mut svc = app("acme", "web");
        svc["branch"] = json!("develop");
        let projects = json!([{ "name": "P", "applications": [svc] }]);
        let out = collect_matches(&projects, "acme", "web", "");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn nested_environments_shape_matches() {
        // Newer Dokploy versions nest services under environments[].
        let projects = json!([{
            "name": "wesley.fyi",
            "projectId": "proj_1",
            "environments": [{
                "name": "production",
                "applications": [app("ur-wesley", "cairn")],
                "compose": [],
            }],
        }]);
        let out = collect_matches(
            &projects,
            "ur-wesley",
            "cairn",
            "https://github.com/ur-wesley/cairn.git",
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "web");
        assert_eq!(out[0].project_name, "wesley.fyi");
    }

    #[test]
    fn git_suffix_and_case_are_ignored() {
        let projects = json!([{ "name": "P", "applications": [app("ACME", "Web.git")] }]);
        let out = collect_matches(&projects, "acme", "web", "");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn empty_expected_values_never_match() {
        let projects = json!([{ "name": "P", "applications": [app("acme", "web")] }]);
        assert!(collect_matches(&projects, "", "", "").is_empty());
    }

    #[test]
    fn unwraps_trpc_envelope() {
        let inner = json!([{ "name": "P", "applications": [app("acme", "web")] }]);
        let wrapped = json!({ "result": { "data": inner } });
        let out = collect_matches(&wrapped, "acme", "web", "");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn parses_remote_variants() {
        let t = parse_git_remote("git@github.com:Acme/Web.git");
        assert_eq!(t.host, "github.com");
        assert_eq!(t.owner, "Acme");
        assert_eq!(t.repo, "Web");
        let t = parse_git_remote("https://oauth2:token@gitlab.com/group/sub/repo.git");
        assert_eq!(t.host, "gitlab.com");
        assert_eq!(t.repo, "repo");
        let t = parse_git_remote("acme/web");
        assert_eq!(t.host, "");
        assert_eq!(t.owner, "acme");
        assert_eq!(t.repo, "web");
        let t = parse_git_remote("  web  ");
        assert_eq!(t.repo, "web");
        assert!(parse_git_remote("").repo.is_empty());
    }

    #[test]
    fn service_refs_walks_nested_environments() {
        let projects = json!([{
            "name": "wesley.fyi",
            "projectId": "proj_1",
            "environments": [{
                "name": "production",
                "applications": [{ "applicationId": "app_1", "name": "cairn" }],
                "compose": [{ "composeId": "c_1", "name": "stack" }],
            }],
        }]);
        let refs = service_refs(&projects);
        assert_eq!(refs.len(), 2);
        assert!(refs.iter().any(|(k, id, n, p, env)| k == "application"
            && id == "app_1"
            && n == "cairn"
            && p == "wesley.fyi"
            && *env == Some("production".to_string())));
        assert!(refs
            .iter()
            .any(|(k, id, _, _, _)| k == "compose" && id == "c_1"));
    }

    #[test]
    fn local_identity_prefers_remote_url() {
        let (o, r) = local_identity("someone", "else", "git@github.com:ur-wesley/cairn.git");
        assert_eq!((o.as_str(), r.as_str()), ("ur-wesley", "cairn"));
        let (o, r) = local_identity("ur-wesley", "cairn", "");
        assert_eq!((o.as_str(), r.as_str()), ("ur-wesley", "cairn"));
    }


    fn stub_server(id: &str, name: &str) -> DokployConnection {
        DokployConnection {
            id: id.to_string(),
            name: name.to_string(),
            url: "https://dokploy.local".to_string(),
            api_key: "key".to_string(),
        }
    }

    #[test]
    fn matches_carry_server_identity_and_environment() {
        let projects = json!([{
            "name": "P",
            "environments": [{
                "name": "production",
                "applications": [app("acme", "web")],
                "compose": [],
            }],
        }]);
        let server = stub_server("s1", "Main");
        let out = collect_matches_for_server(&projects, &server, "acme", "web", "");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].server_id, "s1");
        assert_eq!(out[0].server_name, "Main");
        assert_eq!(out[0].environment.as_deref(), Some("production"));
    }
}
