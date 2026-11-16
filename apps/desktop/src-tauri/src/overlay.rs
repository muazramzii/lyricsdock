//! Overlay window management: placement, geometry persistence, visibility,
//! click-through and the temporary "expanded" mode used by search panels.

use crate::placement::{self, Rect};
use crate::settings::WindowRect;
use crate::AppState;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const LABEL: &str = "overlay";
pub const DEFAULT_SIZE: (f64, f64) = (400.0, 150.0);
const EXPANDED_HEIGHT: f64 = 360.0;
const MARGIN: f64 = 24.0;

pub const EVENT_CLICK_THROUGH: &str = "overlay://click-through";

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn to_rect(r: tauri::PhysicalRect<i32, u32>) -> Rect {
    Rect {
        x: r.position.x,
        y: r.position.y,
        w: r.size.width as i32,
        h: r.size.height as i32,
    }
}

fn monitor_rects(win: &WebviewWindow) -> (Vec<Rect>, Option<(Rect, f64)>) {
    let all = win
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| to_rect(*m.work_area()))
        .collect();
    let primary = win
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (to_rect(*m.work_area()), m.scale_factor()));
    (all, primary)
}

fn apply_rect(win: &WebviewWindow, r: Rect) {
    let _ = win.set_size(PhysicalSize::new(r.w.max(1) as u32, r.h.max(1) as u32));
    let _ = win.set_position(PhysicalPosition::new(r.x, r.y));
}

fn default_rect(win: &WebviewWindow) -> Option<Rect> {
    let (_, primary) = monitor_rects(win);
    let (work, scale) = primary?;
    let size = (
        (DEFAULT_SIZE.0 * scale).round() as i32,
        (DEFAULT_SIZE.1 * scale).round() as i32,
    );
    Some(placement::resolve(
        None,
        &[work],
        work,
        size,
        (MARGIN * scale).round() as i32,
    ))
}

/// Position the overlay on startup from saved geometry, falling back to the
/// bottom-right corner of the primary display.
pub fn restore(app: &AppHandle, saved: Option<WindowRect>) {
    let Some(win) = window(app) else { return };
    let (all, primary) = monitor_rects(&win);
    let Some((work, scale)) = primary else { return };
    let size = (
        (DEFAULT_SIZE.0 * scale).round() as i32,
        (DEFAULT_SIZE.1 * scale).round() as i32,
    );
    let saved = saved.map(|w| Rect {
        x: w.x,
        y: w.y,
        w: w.width as i32,
        h: w.height as i32,
    });
    let r = placement::resolve(saved, &all, work, size, (MARGIN * scale).round() as i32);
    apply_rect(&win, r);
}

pub fn reset_position(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.set_expanded(None);
    if let Some(win) = window(app) {
        if let Some(r) = default_rect(&win) {
            apply_rect(&win, r);
            state.record_geometry(r);
        }
        let _ = win.show();
    }
}

pub fn current_rect(win: &WebviewWindow) -> Option<Rect> {
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    Some(Rect {
        x: pos.x,
        y: pos.y,
        w: size.width as i32,
        h: size.height as i32,
    })
}

pub fn toggle(app: &AppHandle) {
    if let Some(win) = window(app) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            show(app);
        }
    }
}

pub fn show(app: &AppHandle) {
    if let Some(win) = window(app) {
        let _ = win.show();
        let _ = win.unminimize();
    }
}

pub fn set_click_through(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    state
        .click_through
        .store(enabled, std::sync::atomic::Ordering::SeqCst);
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(enabled);
        if enabled {
            let _ = win.show();
        }
    }
    crate::tray::sync_click_through(app, enabled);
    let _ = app.emit(EVENT_CLICK_THROUGH, enabled);
}

/// Grow the window upwards (it lives near the bottom of the screen) to make
/// room for search/match panels, then restore the exact previous geometry.
pub fn set_expanded(app: &AppHandle, expanded: bool) {
    let Some(win) = window(app) else { return };
    let state = app.state::<AppState>();
    if expanded {
        if state.expanded_from().is_some() {
            return;
        }
        let Some(r) = current_rect(&win) else { return };
        let scale = win.scale_factor().unwrap_or(1.0);
        let target_h = ((EXPANDED_HEIGHT * scale).round() as i32).max(r.h);
        let grown = Rect {
            x: r.x,
            y: r.y + r.h - target_h,
            w: r.w,
            h: target_h,
        };
        let (all, _) = monitor_rects(&win);
        let work = all
            .iter()
            .copied()
            .find(|m| r.x >= m.x && r.x < m.x + m.w && r.y >= m.y && r.y < m.y + m.h)
            .unwrap_or(grown);
        state.set_expanded(Some(r));
        apply_rect(&win, placement::clamp_into(grown, work));
    } else if let Some(prev) = state.expanded_from() {
        state.set_expanded(None);
        apply_rect(&win, prev);
    }
}
