//! Transport-independent bridge logic: authentication, origin pinning, rate
//! limiting and request routing. `server.rs` adapts this to HTTP.
//!
//! Security model (see docs/DECISIONS.md, "Bridge"):
//! - Only loopback, only `Host: 127.0.0.1:<port>` / `localhost:<port>`.
//! - Only `Origin: chrome-extension://<32 a-p chars>`; web pages can never
//!   pass this check because browsers set Origin themselves.
//! - A long-lived pairing key (80 bits) shown in the desktop app must be
//!   pasted into the extension once. The first origin that pairs is pinned.
//! - `hello` exchanges the pairing key for a random per-session token that
//!   lives only in memory and dies with the app process.
//! - Failed pairing attempts lock the endpoint; state updates are rate limited.

use super::schema::{self, PlaybackState, SchemaError, MAX_BODY_BYTES, PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub const STALE_AFTER: Duration = Duration::from_secs(7);
const MAX_SESSIONS: usize = 4;
const HELLO_WINDOW: Duration = Duration::from_secs(60);
const HELLO_MAX_FAILURES: usize = 5;
const HELLO_LOCKOUT: Duration = Duration::from_secs(60);
const STATE_BUCKET_CAPACITY: f64 = 20.0;
const STATE_REFILL_PER_SEC: f64 = 10.0;

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("OS random number generator unavailable");
    buf
}

/// 80-bit key rendered as 16 Crockford base32 characters.
pub fn generate_pairing_key() -> String {
    let bytes = random_bytes::<10>();
    let mut bits: u128 = 0;
    for b in bytes {
        bits = (bits << 8) | b as u128;
    }
    (0..16)
        .rev()
        .map(|i| CROCKFORD[((bits >> (i * 5)) & 31) as usize] as char)
        .collect()
}

pub fn format_pairing_key(key: &str) -> String {
    key.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-")
}

/// Mirrors `normalizePairingKey` in packages/shared.
pub fn normalize_pairing_key(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            u => u,
        })
        .collect()
}

fn generate_session_token() -> String {
    random_bytes::<32>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Constant-time comparison so response timing does not leak key prefixes.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn is_extension_origin(origin: &str) -> bool {
    match origin.strip_prefix("chrome-extension://") {
        Some(id) => id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)),
        None => false,
    }
}

#[derive(Debug, Clone)]
struct Session {
    token: String,
    client_name: String,
    last_seq: Option<u64>,
}

#[derive(Debug)]
struct TokenBucket {
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    fn new(now: Instant) -> Self {
        Self {
            tokens: STATE_BUCKET_CAPACITY,
            last: now,
        }
    }
    fn take(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * STATE_REFILL_PER_SEC).min(STATE_BUCKET_CAPACITY);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub host: Option<String>,
    pub origin: Option<String>,
    pub content_type: Option<String>,
    pub authorization: Option<String>,
    pub body: Vec<u8>,
    /// Set by the transport when the body exceeded MAX_BODY_BYTES.
    pub body_too_large: bool,
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub body: Value,
}

fn err(status: u16, code: &str) -> Response {
    Response {
        status,
        body: json!({ "error": code }),
    }
}

/// Side effects the caller must perform after a request is handled.
#[derive(Debug, PartialEq)]
pub enum Effect {
    /// Validated playback state (None = nothing playing).
    State(Option<PlaybackState>),
    /// Connection status changed; caller should re-emit status.
    StatusChanged,
    /// The pinned origin changed; caller should persist it.
    PersistPairing,
}

pub struct BridgeCore {
    pub port: u16,
    pub enabled: bool,
    pub app_version: String,
    pairing_key: String,
    pinned_origin: Option<String>,
    sessions: VecDeque<Session>,
    last_seen: Option<Instant>,
    connected: bool,
    hello_failures: VecDeque<Instant>,
    locked_until: Option<Instant>,
    bucket: TokenBucket,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub enabled: bool,
    pub port: u16,
    pub connected: bool,
    pub paired: bool,
    pub client_name: Option<String>,
}

impl BridgeCore {
    pub fn new(
        port: u16,
        pairing_key: String,
        pinned_origin: Option<String>,
        app_version: String,
        now: Instant,
    ) -> Self {
        Self {
            port,
            enabled: true,
            app_version,
            pairing_key,
            pinned_origin,
            sessions: VecDeque::new(),
            last_seen: None,
            connected: false,
            hello_failures: VecDeque::new(),
            locked_until: None,
            bucket: TokenBucket::new(now),
        }
    }

    pub fn pairing_key(&self) -> &str {
        &self.pairing_key
    }

    pub fn pinned_origin(&self) -> Option<&str> {
        self.pinned_origin.as_deref()
    }

    pub fn status(&self) -> StatusSnapshot {
        StatusSnapshot {
            enabled: self.enabled,
            port: self.port,
            connected: self.connected,
            paired: self.pinned_origin.is_some(),
            client_name: if self.connected {
                self.sessions.back().map(|s| s.client_name.clone())
            } else {
                None
            },
        }
    }

    /// New key, no pinned origin, all sessions revoked.
    pub fn reset_pairing(&mut self, new_key: String) {
        self.pairing_key = new_key;
        self.pinned_origin = None;
        self.disconnect();
    }

    /// Revoke all sessions. The extension must say hello again.
    pub fn disconnect(&mut self) {
        self.sessions.clear();
        self.connected = false;
        self.last_seen = None;
    }

    /// Called periodically; returns true when the connection just went stale.
    pub fn check_stale(&mut self, now: Instant) -> bool {
        if self.connected {
            if let Some(seen) = self.last_seen {
                if now.saturating_duration_since(seen) > STALE_AFTER {
                    self.connected = false;
                    return true;
                }
            }
        }
        false
    }

    fn check_transport(&self, req: &Request) -> Result<String, Response> {
        let host_ok = req.host.as_deref().is_some_and(|h| {
            h == format!("127.0.0.1:{}", self.port) || h == format!("localhost:{}", self.port)
        });
        if !host_ok {
            return Err(err(421, "bad_host"));
        }
        let origin = match req.origin.as_deref() {
            Some(o) if is_extension_origin(o) => o.to_string(),
            _ => return Err(err(403, "forbidden_origin")),
        };
        if req.method != "POST" {
            return Err(err(405, "method_not_allowed"));
        }
        let json_ct = req
            .content_type
            .as_deref()
            .is_some_and(|ct| ct.split(';').next().unwrap_or("").trim() == "application/json");
        if !json_ct {
            return Err(err(415, "json_required"));
        }
        if req.body_too_large || req.body.len() > MAX_BODY_BYTES {
            return Err(err(413, "payload_too_large"));
        }
        if !self.enabled {
            return Err(err(503, "bridge_disabled"));
        }
        if let Some(pinned) = &self.pinned_origin {
            if pinned != &origin {
                return Err(err(403, "origin_not_paired"));
            }
        }
        Ok(origin)
    }

    fn session_index(&self, req: &Request) -> Option<usize> {
        let token = req.authorization.as_deref()?.strip_prefix("Bearer ")?;
        self.sessions
            .iter()
            .position(|s| ct_eq(s.token.as_bytes(), token.as_bytes()))
    }

    pub fn handle(&mut self, req: &Request, now: Instant) -> (Response, Vec<Effect>) {
        let origin = match self.check_transport(req) {
            Ok(o) => o,
            Err(r) => return (r, vec![]),
        };
        match req.path.as_str() {
            "/v1/hello" => self.hello(req, origin, now),
            "/v1/state" => self.state(req, now),
            "/v1/status" => match self.session_index(req) {
                Some(_) => (
                    Response {
                        status: 200,
                        body: json!({ "ok": true, "appVersion": self.app_version }),
                    },
                    vec![],
                ),
                None => (err(401, "unauthorized"), vec![]),
            },
            "/v1/bye" => match self.session_index(req) {
                Some(i) => {
                    self.sessions.remove(i);
                    let was = self.connected;
                    if self.sessions.is_empty() {
                        self.connected = false;
                    }
                    let mut fx = vec![Effect::State(None)];
                    if was != self.connected {
                        fx.push(Effect::StatusChanged);
                    }
                    (
                        Response {
                            status: 200,
                            body: json!({ "ok": true }),
                        },
                        fx,
                    )
                }
                None => (err(401, "unauthorized"), vec![]),
            },
            _ => (err(404, "not_found"), vec![]),
        }
    }

    fn hello(&mut self, req: &Request, origin: String, now: Instant) -> (Response, Vec<Effect>) {
        if let Some(until) = self.locked_until {
            if now < until {
                return (err(429, "too_many_attempts"), vec![]);
            }
            self.locked_until = None;
        }
        let hello = match schema::parse_hello(&req.body) {
            Ok(h) => h,
            Err(SchemaError::Protocol) => return (err(426, "unsupported_protocol"), vec![]),
            Err(e) => return (err(400, e.code()), vec![]),
        };
        let supplied = normalize_pairing_key(&hello.pairing_key);
        if !ct_eq(supplied.as_bytes(), self.pairing_key.as_bytes()) {
            while self
                .hello_failures
                .front()
                .is_some_and(|t| now.saturating_duration_since(*t) > HELLO_WINDOW)
            {
                self.hello_failures.pop_front();
            }
            self.hello_failures.push_back(now);
            if self.hello_failures.len() >= HELLO_MAX_FAILURES {
                self.locked_until = Some(now + HELLO_LOCKOUT);
                self.hello_failures.clear();
            }
            return (err(401, "bad_pairing_key"), vec![]);
        }
        self.hello_failures.clear();
        let mut effects = vec![];
        if self.pinned_origin.is_none() {
            self.pinned_origin = Some(origin);
            effects.push(Effect::PersistPairing);
        }
        let token = generate_session_token();
        if self.sessions.len() >= MAX_SESSIONS {
            self.sessions.pop_front();
        }
        self.sessions.push_back(Session {
            token: token.clone(),
            client_name: hello.client.name.chars().take(64).collect(),
            last_seq: None,
        });
        self.last_seen = Some(now);
        if !self.connected {
            self.connected = true;
        }
        effects.push(Effect::StatusChanged);
        (
            Response {
                status: 200,
                body: json!({
                    "protocol": PROTOCOL_VERSION,
                    "sessionToken": token,
                    "appVersion": self.app_version,
                }),
            },
            effects,
        )
    }

    fn state(&mut self, req: &Request, now: Instant) -> (Response, Vec<Effect>) {
        let Some(idx) = self.session_index(req) else {
            return (err(401, "unauthorized"), vec![]);
        };
        if !self.bucket.take(now) {
            return (err(429, "rate_limited"), vec![]);
        }
        let parsed = match schema::parse_state(&req.body) {
            Ok(p) => p,
            Err(SchemaError::Protocol) => return (err(426, "unsupported_protocol"), vec![]),
            Err(e) => return (err(400, e.code()), vec![]),
        };
        let session = &mut self.sessions[idx];
        if session.last_seq.is_some_and(|last| parsed.seq <= last) {
            // Out-of-order or replayed update: acknowledge but ignore.
            return (
                Response {
                    status: 200,
                    body: json!({ "ok": true, "ignored": true }),
                },
                vec![],
            );
        }
        session.last_seq = Some(parsed.seq);
        self.last_seen = Some(now);
        let mut effects = vec![Effect::State(parsed.state)];
        if !self.connected {
            self.connected = true;
            effects.push(Effect::StatusChanged);
        }
        (
            Response {
                status: 200,
                body: json!({ "ok": true }),
            },
            effects,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const KEY: &str = "7K3M9QZTXW2P4N8R";

    fn core(now: Instant) -> BridgeCore {
        BridgeCore::new(47811, KEY.into(), None, "0.1.0".into(), now)
    }

    fn req(path: &str, body: Value) -> Request {
        Request {
            method: "POST".into(),
            path: path.into(),
            host: Some("127.0.0.1:47811".into()),
            origin: Some(ORIGIN.into()),
            content_type: Some("application/json".into()),
            authorization: None,
            body: serde_json::to_vec(&body).unwrap(),
            body_too_large: false,
        }
    }

    fn hello_body(key: &str) -> Value {
        json!({ "protocol": 1, "pairingKey": key, "client": { "name": "LyricsDock", "version": "0.1.0" } })
    }

    fn sample_state(seq: u64) -> Value {
        json!({ "protocol": 1, "seq": seq, "state": {
            "source": "youtube-music", "title": "Song", "artist": "Artist", "rawTitle": "Song",
            "channel": "", "videoId": null, "duration": 200.0, "position": 1.0,
            "playing": true, "playbackRate": 1.0, "capturedAt": 1.0 } })
    }

    fn login(c: &mut BridgeCore, now: Instant) -> String {
        let (r, fx) = c.handle(&req("/v1/hello", hello_body("7k3m-9qzt-xw2p-4n8r")), now);
        assert_eq!(r.status, 200, "{:?}", r.body);
        assert!(fx.contains(&Effect::StatusChanged));
        r.body["sessionToken"].as_str().unwrap().to_string()
    }

    #[test]
    fn pairing_key_format() {
        let k = generate_pairing_key();
        assert_eq!(k.len(), 16);
        assert!(k.bytes().all(|b| CROCKFORD.contains(&b)));
        assert_ne!(k, generate_pairing_key());
        assert_eq!(
            format_pairing_key("ABCDEFGHJKMNPQRS"),
            "ABCD-EFGH-JKMN-PQRS"
        );
        assert_eq!(normalize_pairing_key("abcd-o1il"), "ABCD0111");
    }

    #[test]
    fn origin_rules() {
        assert!(is_extension_origin(ORIGIN));
        assert!(!is_extension_origin("https://www.youtube.com"));
        assert!(!is_extension_origin("chrome-extension://short"));
        assert!(!is_extension_origin(
            "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP"
        ));
        assert!(!is_extension_origin("null"));
    }

    #[test]
    fn rejects_web_pages_and_bad_transport() {
        let now = Instant::now();
        let mut c = core(now);
        let mut r = req("/v1/hello", hello_body(KEY));
        r.origin = Some("https://evil.example".into());
        assert_eq!(c.handle(&r, now).0.status, 403);
        r.origin = None;
        assert_eq!(c.handle(&r, now).0.status, 403);

        let mut r = req("/v1/hello", hello_body(KEY));
        r.host = Some("attacker.example:47811".into());
        assert_eq!(c.handle(&r, now).0.status, 421);

        let mut r = req("/v1/hello", hello_body(KEY));
        r.content_type = Some("text/plain".into());
        assert_eq!(c.handle(&r, now).0.status, 415);

        let mut r = req("/v1/hello", hello_body(KEY));
        r.method = "OPTIONS".into();
        assert_eq!(c.handle(&r, now).0.status, 405);

        let mut r = req("/v1/hello", hello_body(KEY));
        r.body_too_large = true;
        assert_eq!(c.handle(&r, now).0.status, 413);

        let mut r = req("/v1/hello", hello_body(KEY));
        r.body = b"{not json".to_vec();
        assert_eq!(c.handle(&r, now).0.status, 400);
    }

    #[test]
    fn hello_pins_origin_and_issues_token() {
        let now = Instant::now();
        let mut c = core(now);
        let (r, fx) = c.handle(&req("/v1/hello", hello_body(KEY)), now);
        assert_eq!(r.status, 200);
        assert!(fx.contains(&Effect::PersistPairing));
        assert_eq!(c.pinned_origin(), Some(ORIGIN));
        assert_eq!(r.body["sessionToken"].as_str().unwrap().len(), 64);

        // A different extension with the right key is still refused.
        let mut other = req("/v1/hello", hello_body(KEY));
        other.origin = Some(format!("chrome-extension://{}", "p".repeat(32)));
        assert_eq!(c.handle(&other, now).0.status, 403);
    }

    #[test]
    fn wrong_key_locks_out_after_repeated_failures() {
        let now = Instant::now();
        let mut c = core(now);
        for _ in 0..HELLO_MAX_FAILURES {
            assert_eq!(
                c.handle(&req("/v1/hello", hello_body("WRONGWRONGWRONG0")), now)
                    .0
                    .status,
                401
            );
        }
        // Locked: even the right key is refused until the lockout expires.
        assert_eq!(
            c.handle(&req("/v1/hello", hello_body(KEY)), now).0.status,
            429
        );
        let later = now + HELLO_LOCKOUT + Duration::from_secs(1);
        assert_eq!(
            c.handle(&req("/v1/hello", hello_body(KEY)), later).0.status,
            200
        );
    }

    #[test]
    fn state_requires_valid_session_token() {
        let now = Instant::now();
        let mut c = core(now);
        let mut r = req("/v1/state", sample_state(1));
        assert_eq!(c.handle(&r, now).0.status, 401);
        r.authorization = Some("Bearer deadbeef".into());
        assert_eq!(c.handle(&r, now).0.status, 401);

        let token = login(&mut c, now);
        r.authorization = Some(format!("Bearer {token}"));
        let (resp, fx) = c.handle(&r, now);
        assert_eq!(resp.status, 200);
        assert!(matches!(&fx[0], Effect::State(Some(s)) if s.title == "Song"));
    }

    #[test]
    fn replayed_or_old_sequence_numbers_are_ignored() {
        let now = Instant::now();
        let mut c = core(now);
        let token = login(&mut c, now);
        let mut r = req("/v1/state", sample_state(5));
        r.authorization = Some(format!("Bearer {token}"));
        assert_eq!(c.handle(&r, now).1.len(), 1);
        let (resp, fx) = c.handle(&r, now);
        assert_eq!(resp.body["ignored"], json!(true));
        assert!(fx.is_empty());
    }

    #[test]
    fn state_updates_are_rate_limited() {
        let now = Instant::now();
        let mut c = core(now);
        let token = login(&mut c, now);
        let mut limited = false;
        for seq in 1..=40u64 {
            let mut r = req("/v1/state", sample_state(seq));
            r.authorization = Some(format!("Bearer {token}"));
            if c.handle(&r, now).0.status == 429 {
                limited = true;
                break;
            }
        }
        assert!(limited);
        // Bucket refills over time.
        let mut r = req("/v1/state", sample_state(100));
        r.authorization = Some(format!("Bearer {token}"));
        assert_eq!(c.handle(&r, now + Duration::from_secs(1)).0.status, 200);
    }

    #[test]
    fn invalid_state_payload_is_rejected() {
        let now = Instant::now();
        let mut c = core(now);
        let token = login(&mut c, now);
        let mut bad = sample_state(1);
        bad["state"]["position"] = json!(-5);
        let mut r = req("/v1/state", bad);
        r.authorization = Some(format!("Bearer {token}"));
        let (resp, fx) = c.handle(&r, now);
        assert_eq!(resp.status, 400);
        assert!(fx.is_empty());
    }

    #[test]
    fn stale_detection_disconnect_and_reset() {
        let now = Instant::now();
        let mut c = core(now);
        let token = login(&mut c, now);
        assert!(c.status().connected);
        assert!(!c.check_stale(now + Duration::from_secs(2)));
        assert!(c.check_stale(now + STALE_AFTER + Duration::from_secs(1)));
        assert!(!c.status().connected);

        c.disconnect();
        let mut r = req("/v1/state", sample_state(1));
        r.authorization = Some(format!("Bearer {token}"));
        assert_eq!(c.handle(&r, now).0.status, 401);

        c.reset_pairing("NEWKEYNEWKEY0000".into());
        assert!(c.pinned_origin().is_none());
        assert_eq!(
            c.handle(&req("/v1/hello", hello_body(KEY)), now).0.status,
            401
        );
    }

    #[test]
    fn disabled_bridge_refuses_everything() {
        let now = Instant::now();
        let mut c = core(now);
        c.enabled = false;
        assert_eq!(
            c.handle(&req("/v1/hello", hello_body(KEY)), now).0.status,
            503
        );
    }
}
