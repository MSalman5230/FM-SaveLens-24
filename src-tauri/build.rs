fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["open_in_browser"])),
    )
    .expect("failed to build desktop application")
}
