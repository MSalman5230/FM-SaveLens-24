#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use fm_savelens_backend::{service, VERSION};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;

#[cfg(windows)]
fn configure_bundled_webview() -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    let exe = std::env::current_exe()?;
    let runtime = exe.parent().unwrap().join("WebView2Runtime");
    if runtime.join("msedgewebview2.exe").is_file() {
        let os = windows_version::OsVersion::current();
        // Microsoft requires these read/execute grants for the Fixed Runtime's
        // AppContainer renderer on Windows 10 (runtime 120 and newer).
        // Only the public bundled runtime directory is affected.
        if os.major == 10 && os.build < 22000 {
            let status = std::process::Command::new(
                std::path::PathBuf::from(
                    std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
                )
                .join("System32/icacls.exe"),
            )
            .arg(&runtime)
            .args([
                "/grant",
                "*S-1-15-2-2:(OI)(CI)(RX)",
                "*S-1-15-2-1:(OI)(CI)(RX)",
                "/Q",
            ])
            .creation_flags(0x08000000)
            .output()?;
            if !status.status.success() {
                return Err(std::io::Error::other(
                    "Extract the portable ZIP to a local folder you own so its bundled browser runtime can be prepared.",
                ));
            }
        }
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
    }
    Ok(())
}

fn main() {
    let runtime = Arc::new(tokio::runtime::Runtime::new().expect("async runtime"));
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args
        .iter()
        .any(|a| ["--browser", "--version", "--help"].contains(&a.as_str()))
    {
        if let Err(e) = runtime.block_on(service::run_browser(args.into_iter())) {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }
    let server: Arc<Mutex<Option<service::RunningServer>>> = Arc::new(Mutex::new(None));
    let owned = server.clone();
    let executor = runtime.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            #[cfg(windows)]
            if let Err(error) = configure_bundled_webview() {
                app.dialog()
                    .message(error.to_string())
                    .title("FM SaveLens 24 could not start")
                    .blocking_show();
                return Err(error.into());
            }
            let started = match executor.block_on(service::start(0, &service::default_data_dir())) {
                Ok(server) => server,
                Err(e) => {
                    app.dialog()
                        .message(e.to_string())
                        .title("FM SaveLens 24 could not start")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .blocking_show();
                    return Err(e.into());
                }
            };
            let url = started.url();
            let allowed = url.clone();
            let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
            let about = PredefinedMenuItem::about(
                app,
                Some("About FM SaveLens 24"),
                Some(tauri::menu::AboutMetadata {
                    name: Some("FM SaveLens 24".into()),
                    version: Some(VERSION.into()),
                    icon: app.default_window_icon().cloned(),
                    ..Default::default()
                }),
            )?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
            #[cfg(target_os = "macos")]
            {
                let application = tauri::menu::Submenu::with_items(
                    app,
                    "FM SaveLens 24",
                    true,
                    &[&about, &browser, &quit],
                )?;
                app.set_menu(Menu::with_items(app, &[&application])?)?;
            }
            #[cfg(not(target_os = "macos"))]
            app.set_menu(Menu::with_items(app, &[&browser, &about, &quit])?)?;
            let browser_url = url.clone();
            app.on_menu_event(move |_, event| {
                if event.id().as_ref() == "browser" {
                    let _ = open::that_detached(&browser_url);
                }
            });
            *owned.lock().unwrap() = Some(started);
            let development = std::env::var("FMSAVELENS_DEV_URL").ok();
            let page = development.as_deref().unwrap_or(&url).parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(page))
                .title("FM SaveLens 24")
                .inner_size(1440.0, 940.0)
                .min_inner_size(900.0, 640.0)
                .on_navigation(move |target| {
                    target.origin().ascii_serialization() == allowed
                        || (cfg!(debug_assertions)
                            && target.origin().ascii_serialization() == "http://127.0.0.1:5173")
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(move |_, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(server) = server.lock().unwrap().take() {
                    let _ = runtime.block_on(server.shutdown());
                }
            }
        }),
        Err(e) => {
            if let Some(server) = server.lock().unwrap().take() {
                let _ = runtime.block_on(server.shutdown());
            }
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
