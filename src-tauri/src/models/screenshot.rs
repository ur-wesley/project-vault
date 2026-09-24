use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfoDto {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfoDto {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionDto {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSelectionResultDto {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub image_base64: String,
    pub image_width: u32,
    pub image_height: u32,
}


