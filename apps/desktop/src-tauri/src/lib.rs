mod bridge;
mod overlay;
mod placement;
mod settings;
mod shortcuts;
mod tray;

use bridge::{Bridge, BridgeInfo};
use placement::Rect;
use settings::{Settings, SettingsPatch, WindowRect};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::CheckMenuItem, AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
    WindowEvent, Wry,
};

pub const EVENT_SETTINGS: &str = "settings://changed";

pub struct AppState {
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    dirty: AtomicBool,
    pub click_through: AtomicBool,
    expanded_from: Mutex<Option<Rect>>,
    pub bridge: Arc<Bridge>,
    pub tray_click_through: Mutex<Option<CheckMenuItem<Wry>>>,
}

impl AppState {
    pub fn settings(&self) -> Settings {
        self.settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn replace_settings(&self, s: Settings) {
        *self.settings.lock().unwrap_or_else(|e| e.into_inner()) = s;
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub fn expanded_from(&self) -> Option<Rect> {
        *self.expanded_from.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_expanded(&self, r: Option<Rect>) {
        *self.expanded_from.lock().unwrap_or_else(|e| e.into_inner()) = r;
    }

    /// Remember overlay geometry (ignored while temporarily expanded).
    pub fn record_geometry(&self, r: Rect) {
        if self.expanded_from().is_some() {
            return;
        }
        let mut s = self.settings.lock().unwrap_or_else(|e| e.into_inner());
        let rect = WindowRect {
            x: r.x,
            y: r.y,
            width: r.w.max(0) as u32,
            height: r.h.max(0) as u32,
        };
        if s.window != Some(rect) {
            s.window = Some(rect);
            self.dirty.store(true, Ordering::SeqCst);
        }
    }

    fn flush(&self) {
        if self.dirty.swap(false, Ordering::SeqCst) {
            if let Err(e) = settings::save(&self.settings_path, &self.settings()) {
                log::warn!("could not save settings: {e}");
                self.dirty.store(true, Ordering::SeqCst);
            }
        }
    }
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    let old = state.settings();
    let new = old.apply_patch(patch);
    if new.toggle_shortcut != old.toggle_shortcut
        || new.click_through_shortcut != old.click_through_shortcut
    {
        shortcuts::apply(&app, &new)?;
    }
    if new.always_on_top != old.always_on_top {
        if let Some(w) = overlay::window(&app) {
            w.set_always_on_top(new.always_on_top)
                .map_err(|e| e.to_string())?;
        }
    }
    if new.bridge_enabled != old.bridge_enabled {
        state.bridge.set_enabled(new.bridge_enabled);
    }
    state.replace_settings(new.clone());
    state.flush();
    let _ = app.emit(EVENT_SETTINGS, &new);
    Ok(new)
}

#[tauri::command]
fn get_bridge_info(state: tauri::State<'_, AppState>) -> BridgeInfo {
    state.bridge.info()
}

#[tauri::command]
fn reset_pairing(state: tauri::State<'_, AppState>) -> BridgeInfo {
    state.bridge.reset_pairing();
    state.bridge.info()
}

#[tauri::command]
fn disconnect_bridge(state: tauri::State<'_, AppState>) -> BridgeInfo {
    state.bridge.disconnect();
    state.bridge.info()
}

#[tauri::command]
fn set_click_through(app: AppHandle, enabled: bool) {
    overlay::set_click_through(&app, enabled);
}

#[tauri::command]
fn get_click_through(state: tauri::State<'_, AppState>) -> bool {
    state.click_through.load(Ordering::SeqCst)
}

#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if let Some(w) = overlay::window(&app) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn reset_overlay_position(app: AppHandle) {
    overlay::reset_position(&app);
}

#[tauri::command]
fn set_overlay_expanded(app: AppHandle, expanded: bool) {
    overlay::set_expanded(&app, expanded);
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    open_settings_window(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}

// ---------------------------------------------------------------- helpers

/// Show (or create) the settings window.
///
/// Creating a webview from the main thread — a synchronous command or a tray
/// menu handler — deadlocks WebView2 on Windows, so creation always happens
/// on a background task.
pub fn open_settings_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if app.get_webview_window("settings").is_some() {
            return;
        }
        let built =
            WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html".into()))
                .title("LyricsDock Settings")
                .inner_size(520.0, 640.0)
                .min_inner_size(420.0, 420.0)
                .resizable(true)
                .center()
                .build();
        if let Err(e) = built {
            log::error!("could not open settings: {e}");
        }
    });
}

pub fn quit(app: &AppHandle) {
    app.state::<AppState>().flush();
    app.exit(0);
}

fn spawn_flusher(app: AppHandle) {
    std::thread::Builder::new()
        .name("settings-flush".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            app.state::<AppState>().flush();
        })
        .expect("spawn flusher");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            overlay::show(app);
        }))
        .plugin(shortcuts::plugin())
        .setup(|app| {
            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let settings_path = config_dir.join("settings.json");
            let settings = settings::load(&settings_path);
            let bridge = Bridge::new(handle.clone(), config_dir, settings.bridge_enabled);

            app.manage(AppState {
                settings: Mutex::new(settings.clone()),
                settings_path,
                dirty: AtomicBool::new(false),
                click_through: AtomicBool::new(false),
                expanded_from: Mutex::new(None),
                bridge: Arc::clone(&bridge),
                tray_click_through: Mutex::new(None),
            });

            tray::build(&handle)?;
            if let Err(e) = shortcuts::apply(&handle, &settings) {
                log::warn!("shortcut registration failed: {e}");
            }

            overlay::restore(&handle, settings.window);
            if let Some(win) = overlay::window(&handle) {
                let _ = win.set_always_on_top(settings.always_on_top);
                if !settings.start_hidden {
                    let _ = win.show();
                }
            }

            bridge.start();
            spawn_flusher(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != overlay::LABEL {
                return;
            }
            let app = window.app_handle();
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    if let Some(w) = overlay::window(app) {
                        if !w.is_minimized().unwrap_or(false) {
                            if let Some(r) = overlay::current_rect(&w) {
                                app.state::<AppState>().record_geometry(r);
                            }
                        }
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    // Alt+F4 on the overlay hides it; quitting is in the tray.
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            get_bridge_info,
            reset_pairing,
            disconnect_bridge,
            set_click_through,
            get_click_through,
            hide_overlay,
            reset_overlay_position,
            set_overlay_expanded,
            open_settings,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building LyricsDock")
        .run(|app, event| {
            if let RunEvent::ExitRequested { code, api, .. } = &event {
                // Closing the settings window must not quit the tray app.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            if let RunEvent::Exit = event {
                app.state::<AppState>().flush();
            }
        });
}
