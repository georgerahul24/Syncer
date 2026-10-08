use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      // Fires when the OS hands Syncer a file to open — macOS's "Open
      // With → Syncer" (see tauri.conf.json's bundle.fileAssociations) and
      // the equivalent Android share/open intent, once that's wired up
      // there too. The frontend (useNativeFileOpen) picks this up and
      // uploads the file like a normal "Add book".
      if let tauri::RunEvent::Opened { urls } = event {
        for url in urls {
          if let Ok(path) = url.to_file_path() {
            if let Some(path_str) = path.to_str() {
              let _ = app_handle.emit("file-opened", path_str.to_string());
            }
          }
        }
      }
    });
}
