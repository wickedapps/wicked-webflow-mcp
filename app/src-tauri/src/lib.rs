mod pty;
mod wwm;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::LoginState::default())
        .invoke_handler(tauri::generate_handler![
            wwm::wwm_run,
            wwm::wwm_locate,
            wwm::wwm_upgrade,
            pty::login_start,
            pty::login_write,
            pty::login_resize,
            pty::login_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wicked Webflow MCP Manager");
}
