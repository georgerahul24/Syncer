use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    // Opens the new APK's download link on Android (see useAppUpdate.ts).
    .plugin(tauri_plugin_opener::init())
    // Restarts the desktop app after an update has been installed.
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      // Desktop installs its own updates from the GitHub release feed
      // (tauri.conf.json's plugins.updater). Android has no equivalent: a
      // sideloaded app can't replace itself, so it only links to the APK.
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
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
