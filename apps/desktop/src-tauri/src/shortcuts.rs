//! Global keyboard shortcuts: show/hide the overlay and toggle click-through.
//! The click-through shortcut is the keyboard escape hatch when the overlay
//! ignores the mouse (the tray menu is the other one).

use crate::{overlay, settings::Settings, AppState};
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

static ACTIVE: Mutex<Option<(Shortcut, Shortcut)>> = Mutex::new(None);

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let active = *ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((toggle, click)) = active {
                if shortcut == &toggle {
                    overlay::toggle(app);
                } else if shortcut == &click {
                    let on = !app
                        .state::<AppState>()
                        .click_through
                        .load(std::sync::atomic::Ordering::SeqCst);
                    overlay::set_click_through(app, on);
                }
            }
        })
        .build()
}

pub fn parse(s: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(s).map_err(|e| format!("Invalid shortcut \"{s}\": {e}"))
}

/// Re-register both shortcuts. On failure the previous ones stay active.
pub fn apply<R: Runtime>(app: &AppHandle<R>, s: &Settings) -> Result<(), String> {
    let toggle = parse(&s.toggle_shortcut)?;
    let click = parse(&s.click_through_shortcut)?;
    if toggle == click {
        return Err("The two shortcuts must be different".into());
    }
    let gs = app.global_shortcut();
    let previous = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some((a, b)) = previous {
        let _ = gs.unregister(a);
        let _ = gs.unregister(b);
    }
    let result = gs
        .register(toggle)
        .and_then(|_| gs.register(click))
        .map_err(|e| format!("Could not register shortcut (is another app using it?): {e}"));
    match result {
        Ok(()) => {
            *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some((toggle, click));
            Ok(())
        }
        Err(e) => {
            let _ = gs.unregister(toggle);
            let _ = gs.unregister(click);
            if let Some((a, b)) = previous {
                if gs.register(a).is_ok() && gs.register(b).is_ok() {
                    *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some((a, b));
                }
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_shortcuts() {
        assert!(parse(crate::settings::DEFAULT_TOGGLE_SHORTCUT).is_ok());
        assert!(parse(crate::settings::DEFAULT_CLICK_THROUGH_SHORTCUT).is_ok());
        assert!(parse("NotAKey+++").is_err());
    }
}
