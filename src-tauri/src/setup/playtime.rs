//! Background playtime tracker: +10s every 10s for active projects.
//! (Extracted verbatim from the `run()` setup closure in `lib.rs`.)

/// Start the background playtime tracker.
pub fn spawn_playtime_tracker(pool: sqlx::Pool<sqlx::Sqlite>) {
    // Start background playtime tracker
    let pool_for_tracker = pool.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            ticker.tick().await;
            let _ = crate::db::increment_active_projects_playtime(&pool_for_tracker, 10000).await;
        }
    });
}
