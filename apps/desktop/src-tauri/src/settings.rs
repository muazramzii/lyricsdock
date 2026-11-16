//! Persistent user settings. Stored as JSON in the platform config directory
//! (`%APPDATA%\com.lyricsdock.app\settings.json` on Windows).
//!
//! Every value coming from the UI is clamped/validated here so a corrupted or
//! hand-edited file can never put the overlay into an unusable state.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayMode {
    #[default]
    Context,
    Single,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum MotionPreference {
    #[default]
    System,
    Reduce,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub opacity: f64,
    pub font_scale: f64,
    pub always_on_top: bool,
    pub start_hidden: bool,
    pub toggle_shortcut: String,
    pub click_through_shortcut: String,
    pub display_mode: DisplayMode,
    pub sync_offset_ms: i32,
    pub accent_color: String,
    pub motion: MotionPreference,
    pub bridge_enabled: bool,
    /// Physical-pixel window rectangle from the last session.
    pub window: Option<WindowRect>,
}

pub const DEFAULT_TOGGLE_SHORTCUT: &str = "CommandOrControl+Alt+L";
pub const DEFAULT_CLICK_THROUGH_SHORTCUT: &str = "CommandOrControl+Alt+K";

impl Default for Settings {
    fn default() -> Self {
        Self {
            opacity: 0.88,
            font_scale: 1.0,
            always_on_top: true,
            start_hidden: false,
            toggle_shortcut: DEFAULT_TOGGLE_SHORTCUT.into(),
            click_through_shortcut: DEFAULT_CLICK_THROUGH_SHORTCUT.into(),
            display_mode: DisplayMode::Context,
            sync_offset_ms: 0,
            accent_color: "#8fb3ff".into(),
            motion: MotionPreference::System,
            bridge_enabled: true,
            window: None,
        }
    }
}

/// Partial update sent by the settings UI. `window` is intentionally absent:
/// only the Rust side records window geometry.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub opacity: Option<f64>,
    pub font_scale: Option<f64>,
    pub always_on_top: Option<bool>,
    pub start_hidden: Option<bool>,
    pub toggle_shortcut: Option<String>,
    pub click_through_shortcut: Option<String>,
    pub display_mode: Option<DisplayMode>,
    pub sync_offset_ms: Option<i32>,
    pub accent_color: Option<String>,
    pub motion: Option<MotionPreference>,
    pub bridge_enabled: Option<bool>,
}

pub fn is_hex_color(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

impl Settings {
    /// Clamp every field into its valid range.
    pub fn sanitized(mut self) -> Self {
        let d = Settings::default();
        if !self.opacity.is_finite() {
            self.opacity = d.opacity;
        }
        self.opacity = self.opacity.clamp(0.35, 1.0);
        if !self.font_scale.is_finite() {
            self.font_scale = d.font_scale;
        }
        self.font_scale = self.font_scale.clamp(0.8, 1.6);
        self.sync_offset_ms = self.sync_offset_ms.clamp(-10_000, 10_000);
        if !is_hex_color(&self.accent_color) {
            self.accent_color = d.accent_color;
        }
        if self.toggle_shortcut.trim().is_empty() || self.toggle_shortcut.len() > 64 {
            self.toggle_shortcut = d.toggle_shortcut;
        }
        if self.click_through_shortcut.trim().is_empty() || self.click_through_shortcut.len() > 64 {
            self.click_through_shortcut = d.click_through_shortcut;
        }
        if let Some(w) = self.window {
            if w.width < 200 || w.height < 60 || w.width > 4000 || w.height > 3000 {
                self.window = None;
            }
        }
        self
    }

    pub fn apply_patch(&self, p: SettingsPatch) -> Settings {
        let mut s = self.clone();
        if let Some(v) = p.opacity {
            s.opacity = v;
        }
        if let Some(v) = p.font_scale {
            s.font_scale = v;
        }
        if let Some(v) = p.always_on_top {
            s.always_on_top = v;
        }
        if let Some(v) = p.start_hidden {
            s.start_hidden = v;
        }
        if let Some(v) = p.toggle_shortcut {
            s.toggle_shortcut = v.trim().to_string();
        }
        if let Some(v) = p.click_through_shortcut {
            s.click_through_shortcut = v.trim().to_string();
        }
        if let Some(v) = p.display_mode {
            s.display_mode = v;
        }
        if let Some(v) = p.sync_offset_ms {
            s.sync_offset_ms = v;
        }
        if let Some(v) = p.accent_color {
            s.accent_color = v;
        }
        if let Some(v) = p.motion {
            s.motion = v;
        }
        if let Some(v) = p.bridge_enabled {
            s.bridge_enabled = v;
        }
        s.sanitized()
    }
}

pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
        .sanitized()
}

/// Write atomically (temp file + rename) so a crash never leaves half a file.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_out_of_range_values() {
        let s = Settings {
            opacity: 5.0,
            font_scale: f64::NAN,
            sync_offset_ms: 99_999,
            accent_color: "red; background:url(x)".into(),
            toggle_shortcut: "  ".into(),
            window: Some(WindowRect {
                x: 0,
                y: 0,
                width: 5,
                height: 5,
            }),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.opacity, 1.0);
        assert_eq!(s.font_scale, 1.0);
        assert_eq!(s.sync_offset_ms, 10_000);
        assert_eq!(s.accent_color, "#8fb3ff");
        assert_eq!(s.toggle_shortcut, DEFAULT_TOGGLE_SHORTCUT);
        assert!(s.window.is_none());
    }

    #[test]
    fn patch_rejects_unknown_fields() {
        let r: Result<SettingsPatch, _> = serde_json::from_str(r#"{"window":{"x":1}}"#);
        assert!(r.is_err());
        let p: SettingsPatch =
            serde_json::from_str(r#"{"opacity":0.5,"displayMode":"single"}"#).expect("valid patch");
        let s = Settings::default().apply_patch(p);
        assert_eq!(s.opacity, 0.5);
        assert_eq!(s.display_mode, DisplayMode::Single);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("lyricsdock-test-{}", std::process::id()));
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, "{not json").unwrap();
        assert_eq!(load(&path), Settings::default());
        let custom = Settings {
            opacity: 0.6,
            ..Settings::default()
        };
        save(&path, &custom).unwrap();
        assert_eq!(load(&path).opacity, 0.6);
        let _ = fs::remove_dir_all(&dir);
    }
}
