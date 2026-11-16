//! Loopback HTTP bridge between the browser extension and the overlay.

pub mod core;
pub mod schema;
mod server;

use self::core::{format_pairing_key, generate_pairing_key, BridgeCore, Effect, StatusSnapshot};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub const PORTS: [u16; 3] = [47811, 47812, 47813];
pub const EVENT_STATE: &str = "bridge://state";
pub const EVENT_STATUS: &str = "bridge://status";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingFile {
    pairing_key: Option<String>,
    pinned_origin: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    #[serde(flatten)]
    pub core: StatusSnapshot,
    pub listening: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub status: BridgeStatus,
    /// Formatted as XXXX-XXXX-XXXX-XXXX for display.
    pub pairing_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    state: Option<schema::PlaybackState>,
    received_at: u64,
}

pub struct Bridge {
    core: Mutex<BridgeCore>,
    listening: Mutex<Option<u16>>,
    error: Mutex<Option<String>>,
    pairing_path: PathBuf,
    app: AppHandle,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Bridge {
    pub fn new(app: AppHandle, config_dir: PathBuf, enabled: bool) -> Arc<Self> {
        let pairing_path = config_dir.join("bridge.json");
        let mut file: PairingFile = fs::read_to_string(&pairing_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let key_valid = file
            .pairing_key
            .as_deref()
            .is_some_and(|k| k.len() == 16 && k.bytes().all(|b| b.is_ascii_alphanumeric()));
        let needs_save = !key_valid;
        if !key_valid {
            file.pairing_key = Some(generate_pairing_key());
            file.pinned_origin = None;
        }
        let mut core = BridgeCore::new(
            PORTS[0],
            file.pairing_key.clone().unwrap_or_default(),
            file.pinned_origin
                .filter(|o| self::core::is_extension_origin(o)),
            app.package_info().version.to_string(),
            Instant::now(),
        );
        core.enabled = enabled;
        let bridge = Arc::new(Self {
            core: Mutex::new(core),
            listening: Mutex::new(None),
            error: Mutex::new(None),
            pairing_path,
            app,
        });
        if needs_save {
            bridge.persist_pairing();
        }
        bridge
    }

    pub fn start(self: &Arc<Self>) {
        server::spawn(Arc::clone(self));
        let me = Arc::clone(self);
        std::thread::Builder::new()
            .name("bridge-watchdog".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let went_stale = me.lock().check_stale(Instant::now());
                if went_stale {
                    me.emit_state(None);
                    me.emit_status();
                }
            })
            .expect("spawn watchdog");
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BridgeCore> {
        // A panic while holding the lock must not take the bridge down forever.
        self.core.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn set_listening(&self, port: Option<u16>, error: Option<String>) {
        if let Some(p) = port {
            self.lock().port = p;
        }
        *self.listening.lock().unwrap_or_else(|e| e.into_inner()) = port;
        *self.error.lock().unwrap_or_else(|e| e.into_inner()) = error;
        self.emit_status();
    }

    pub(crate) fn handle(&self, req: &self::core::Request) -> self::core::Response {
        let (resp, effects) = self.lock().handle(req, Instant::now());
        for fx in effects {
            match fx {
                Effect::State(s) => self.emit_state(s),
                Effect::StatusChanged => self.emit_status(),
                Effect::PersistPairing => self.persist_pairing(),
            }
        }
        resp
    }

    pub fn status(&self) -> BridgeStatus {
        BridgeStatus {
            core: self.lock().status(),
            listening: self
                .listening
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_some(),
            error: self.error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        }
    }

    pub fn info(&self) -> BridgeInfo {
        let key = format_pairing_key(self.lock().pairing_key());
        BridgeInfo {
            status: self.status(),
            pairing_key: key,
        }
    }

    pub fn reset_pairing(&self) {
        self.lock().reset_pairing(generate_pairing_key());
        self.persist_pairing();
        self.emit_state(None);
        self.emit_status();
    }

    pub fn disconnect(&self) {
        self.lock().disconnect();
        self.emit_state(None);
        self.emit_status();
    }

    pub fn set_enabled(&self, enabled: bool) {
        let changed = {
            let mut c = self.lock();
            let changed = c.enabled != enabled;
            c.enabled = enabled;
            if !enabled {
                c.disconnect();
            }
            changed
        };
        if changed {
            if !enabled {
                self.emit_state(None);
            }
            self.emit_status();
        }
    }

    fn persist_pairing(&self) {
        let file = {
            let c = self.lock();
            PairingFile {
                pairing_key: Some(c.pairing_key().to_string()),
                pinned_origin: c.pinned_origin().map(str::to_string),
            }
        };
        if let Some(dir) = self.pairing_path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            if let Err(e) = fs::write(&self.pairing_path, json) {
                log::warn!("could not save pairing file: {e}");
            }
        }
    }

    fn emit_state(&self, state: Option<schema::PlaybackState>) {
        let _ = self.app.emit(
            EVENT_STATE,
            StatePayload {
                state,
                received_at: now_ms(),
            },
        );
    }

    fn emit_status(&self) {
        let _ = self.app.emit(EVENT_STATUS, self.status());
    }
}
