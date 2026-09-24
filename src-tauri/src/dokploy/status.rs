use serde_json::Value;

use super::api::str_field;
use super::dto::DokployDeploymentDto;

pub(crate) fn deployment_from_value(v: &Value) -> Option<DokployDeploymentDto> {
    let id = str_field(v, "deploymentId").or_else(|| str_field(v, "id"))?;
    let status = str_field(v, "status").unwrap_or_else(|| "unknown".to_string());
    Some(DokployDeploymentDto {
        id,
        title: str_field(v, "title").or_else(|| str_field(v, "description")),
        status,
        created_at: str_field(v, "createdAt").or_else(|| str_field(v, "created_at")),
    })
}

pub(crate) fn deployments_from_value(v: &Value) -> Vec<DokployDeploymentDto> {
    let arr: &[Value] = if let Some(a) = v.as_array() {
        a
    } else if let Some(a) = v.get("deployments").and_then(|d| d.as_array()) {
        a
    } else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(deployment_from_value)
        .take(5)
        .collect()
}

/// Deep link straight to the service page:
/// /dashboard/project/{projectId}/environment/{environmentId}/services/{application|compose}/{id}
/// Falls back to the project page (then the dashboard) when ids are missing.
pub(crate) fn dashboard_service_url(
    base_url: &str,
    project_id: &str,
    env_id: &str,
    kind: &str,
    id: &str,
) -> String {
    if project_id.is_empty() {
        format!("{base_url}/dashboard")
    } else if env_id.is_empty() {
        format!("{base_url}/dashboard/project/{project_id}")
    } else {
        format!(
            "{base_url}/dashboard/project/{project_id}/environment/{env_id}/services/{kind}/{id}"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_deployment_lists_and_wrappers() {
        let arr = json!([
            { "deploymentId": "d1", "title": "Deploy", "status": "done", "createdAt": "2026-01-01T00:00:00Z" },
            { "deploymentId": "d2", "status": "running" },
        ]);
        let out = deployments_from_value(&arr);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].status, "done");
        let wrapped = json!({ "deployments": arr });
        assert_eq!(deployments_from_value(&wrapped).len(), 2);
    }

    #[test]
    fn dashboard_url_links_straight_to_service() {
        assert_eq!(
            dashboard_service_url(
                "https://server.w4y.io",
                "_j867ZwRIkf6S4mq24c0j",
                "37k-JiY7UGFZg9tHPQ12U",
                "application",
                "reqSb8ckLjKPb3wVfxcWo",
            ),
            "https://server.w4y.io/dashboard/project/_j867ZwRIkf6S4mq24c0j/environment/37k-JiY7UGFZg9tHPQ12U/services/application/reqSb8ckLjKPb3wVfxcWo",
        );
        assert_eq!(
            dashboard_service_url("https://server.w4y.io", "proj_1", "", "compose", "c_1"),
            "https://server.w4y.io/dashboard/project/proj_1",
        );
        assert_eq!(
            dashboard_service_url("https://server.w4y.io", "", "", "application", "a_1"),
            "https://server.w4y.io/dashboard",
        );
    }
}
