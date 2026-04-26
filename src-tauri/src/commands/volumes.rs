use crate::disk_volume;
use crate::error::codes;
use crate::error::StableError;
use crate::models::PathDiskSpaceDto;

#[tauri::command]
pub async fn disk_space_for_paths(
    paths: Vec<String>,
) -> Result<Vec<PathDiskSpaceDto>, StableError> {
    tauri::async_runtime::spawn_blocking(move || disk_volume::path_disk_space_rows(&paths))
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))
}
