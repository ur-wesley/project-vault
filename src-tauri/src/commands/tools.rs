use crate::error::StableError;
use crate::models::ToolCandidateDto;

#[tauri::command]
pub fn list_discovered_tools() -> Result<Vec<ToolCandidateDto>, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(Vec::new())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        Ok(crate::tools::discover_tools())
    }
}
