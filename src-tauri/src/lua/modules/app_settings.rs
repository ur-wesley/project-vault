const READABLE_APP_SETTING_KEYS: &[&str] = &[
    "ui_locale",
    "ui_theme",
    "ui_density",
    "shell_path",
    "default_shell_path",
    "default_ide_path",
    "auto_index_projects",
    "auto_check_updates",
    "auto_start",
    "scan_interval_minutes",
    "global_terminal_cwd",
    "screenshot_save_dir",
    "tunnel_portless_enabled",
    "tunnel_proxy_port",
    "tunnel_tls_enabled",
    "notification_quiet",
    "notification_os_enabled",
    "shortcut_registry_v1",
    "disabled_plugins",
    "project_cleaner_unused_days",
    "project_cleaner_protect_recent_days",
    "project_cleaner_protect_favorites",
    "project_cleaner_min_playtime_ms",
];

pub fn is_readable_app_setting(key: &str) -> bool {
    READABLE_APP_SETTING_KEYS.contains(&key)
}

pub fn validate_readable_app_setting(key: &str) -> Result<(), String> {
    if is_readable_app_setting(key) {
        Ok(())
    } else {
        Err(format!(
            "app setting key '{key}' is not readable by plugins"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_safe_app_keys() {
        assert!(is_readable_app_setting("ui_locale"));
        assert!(is_readable_app_setting("shell_path"));
        assert!(is_readable_app_setting("auto_index_projects"));
    }

    #[test]
    fn rejects_secret_keys() {
        assert!(!is_readable_app_setting("github_token"));
    }

    #[test]
    fn rejects_unknown_keys() {
        assert!(!is_readable_app_setting("random_key"));
    }

    #[test]
    fn validate_returns_error_for_disallowed_keys() {
        let err = validate_readable_app_setting("github_token").unwrap_err();
        assert!(err.contains("github_token"));
        assert!(err.contains("not readable"));
    }
}
