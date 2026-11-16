//! System tray: always-available recovery path (show, exit click-through,
//! reset position) even when the overlay is hidden or ignoring the mouse.

use crate::{overlay, AppState};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide lyrics", true, None::<&str>)?;
    let click_through = CheckMenuItem::with_id(
        app,
        "click-through",
        "Click-through mode",
        true,
        false,
        None::<&str>,
    )?;
    let reset = MenuItem::with_id(app, "reset", "Reset position", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LyricsDock", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &click_through,
            &reset,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    app.state::<AppState>()
        .tray_click_through
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .replace(click_through);

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("LyricsDock")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => overlay::toggle(app),
            "click-through" => {
                let on = !app
                    .state::<AppState>()
                    .click_through
                    .load(std::sync::atomic::Ordering::SeqCst);
                overlay::set_click_through(app, on);
            }
            "reset" => overlay::reset_position(app),
            "settings" => crate::open_settings_window(app),
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                overlay::toggle(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn sync_click_through(app: &AppHandle, enabled: bool) {
    if let Some(item) = app
        .state::<AppState>()
        .tray_click_through
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        let _ = item.set_checked(enabled);
    }
}
