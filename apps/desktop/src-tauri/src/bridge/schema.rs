//! Message schema for the extension bridge. This is the authoritative
//! validation layer; the TypeScript validators in `packages/shared` mirror it.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_BODY_BYTES: usize = 4096;
const MAX_SECONDS: f64 = 24.0 * 60.0 * 60.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceType {
    Youtube,
    YoutubeMusic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub source: SourceType,
    pub title: String,
    pub artist: String,
    pub raw_title: String,
    pub channel: String,
    pub video_id: Option<String>,
    pub duration: Option<f64>,
    pub position: f64,
    pub playing: bool,
    pub playback_rate: f64,
    pub captured_at: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloRequest {
    pub protocol: u32,
    pub pairing_key: String,
    pub client: ClientInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateRequest {
    pub protocol: u32,
    pub seq: u64,
    pub state: Option<PlaybackState>,
}

#[derive(Debug, PartialEq)]
pub enum SchemaError {
    Json,
    Protocol,
    Field(&'static str),
}

impl SchemaError {
    pub fn code(&self) -> &'static str {
        match self {
            SchemaError::Json => "malformed_json",
            SchemaError::Protocol => "unsupported_protocol",
            SchemaError::Field(_) => "invalid_field",
        }
    }
}

/// Replace control characters (which never appear in real titles) with
/// spaces and enforce a maximum length in characters.
fn clean_text(
    s: &str,
    max: usize,
    field: &'static str,
    allow_empty: bool,
) -> Result<String, SchemaError> {
    if s.chars().count() > max {
        return Err(SchemaError::Field(field));
    }
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let trimmed = cleaned.trim().to_string();
    if !allow_empty && trimmed.is_empty() {
        return Err(SchemaError::Field(field));
    }
    Ok(trimmed)
}

fn in_range(v: f64, min: f64, max: f64) -> bool {
    v.is_finite() && v >= min && v <= max
}

fn valid_video_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn validate_state(s: PlaybackState) -> Result<PlaybackState, SchemaError> {
    let title = clean_text(&s.title, 300, "title", false)?;
    let artist = clean_text(&s.artist, 200, "artist", true)?;
    let raw_title = clean_text(&s.raw_title, 300, "rawTitle", true)?;
    let channel = clean_text(&s.channel, 200, "channel", true)?;
    if let Some(id) = &s.video_id {
        if !valid_video_id(id) {
            return Err(SchemaError::Field("videoId"));
        }
    }
    if let Some(d) = s.duration {
        if !in_range(d, 0.0, MAX_SECONDS) {
            return Err(SchemaError::Field("duration"));
        }
    }
    if !in_range(s.position, 0.0, MAX_SECONDS) {
        return Err(SchemaError::Field("position"));
    }
    if !in_range(s.playback_rate, 0.0625, 16.0) {
        return Err(SchemaError::Field("playbackRate"));
    }
    if !in_range(s.captured_at, 0.0, 9_007_199_254_740_991.0) {
        return Err(SchemaError::Field("capturedAt"));
    }
    Ok(PlaybackState {
        title,
        artist,
        raw_title,
        channel,
        ..s
    })
}

pub fn parse_hello(body: &[u8]) -> Result<HelloRequest, SchemaError> {
    let req: HelloRequest = serde_json::from_slice(body).map_err(|_| SchemaError::Json)?;
    if req.protocol != PROTOCOL_VERSION {
        return Err(SchemaError::Protocol);
    }
    if req.pairing_key.len() > 64 {
        return Err(SchemaError::Field("pairingKey"));
    }
    clean_text(&req.client.name, 64, "client.name", false)?;
    clean_text(&req.client.version, 32, "client.version", true)?;
    Ok(req)
}

pub fn parse_state(body: &[u8]) -> Result<StateRequest, SchemaError> {
    let mut req: StateRequest = serde_json::from_slice(body).map_err(|_| SchemaError::Json)?;
    if req.protocol != PROTOCOL_VERSION {
        return Err(SchemaError::Protocol);
    }
    if let Some(s) = req.state.take() {
        req.state = Some(validate_state(s)?);
    }
    Ok(req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn state_with(key: &str, value: Value) -> Vec<u8> {
        let mut state = json!({
            "source": "youtube", "title": "Song", "artist": "Artist",
            "rawTitle": "Artist - Song", "channel": "Artist", "videoId": "dQw4w9WgXcQ",
            "duration": 212.0, "position": 10.5, "playing": true,
            "playbackRate": 1.0, "capturedAt": 1_700_000_000_000u64
        });
        if !key.is_empty() {
            state[key] = value;
        }
        serde_json::to_vec(&json!({ "protocol": 1, "seq": 1, "state": state })).unwrap()
    }

    #[test]
    fn accepts_valid_state() {
        let r = parse_state(&state_with("", Value::Null)).expect("valid");
        assert_eq!(r.state.unwrap().title, "Song");
    }

    #[test]
    fn accepts_null_state_and_optional_fields() {
        assert!(parse_state(br#"{"protocol":1,"seq":2,"state":null}"#).is_ok());
        assert!(parse_state(&state_with("duration", Value::Null)).is_ok());
        assert!(parse_state(&state_with("videoId", Value::Null)).is_ok());
    }

    #[test]
    fn rejects_malformed_json_and_wrong_protocol() {
        assert_eq!(parse_state(b"{oops").unwrap_err(), SchemaError::Json);
        assert_eq!(parse_state(b"[]").unwrap_err(), SchemaError::Json);
        assert_eq!(
            parse_state(br#"{"protocol":9,"seq":1,"state":null}"#).unwrap_err(),
            SchemaError::Protocol
        );
    }

    #[test]
    fn rejects_bad_fields() {
        let cases: Vec<(&str, Value, SchemaError)> = vec![
            ("source", json!("spotify"), SchemaError::Json),
            ("playing", json!("yes"), SchemaError::Json),
            ("position", json!(-1), SchemaError::Field("position")),
            ("position", json!(1e9), SchemaError::Field("position")),
            ("playbackRate", json!(0), SchemaError::Field("playbackRate")),
            ("videoId", json!("../../etc"), SchemaError::Field("videoId")),
            ("title", json!("   "), SchemaError::Field("title")),
            ("title", json!("x".repeat(301)), SchemaError::Field("title")),
            (
                "artist",
                json!("x".repeat(201)),
                SchemaError::Field("artist"),
            ),
        ];
        for (key, value, expected) in cases {
            assert_eq!(
                parse_state(&state_with(key, value.clone())).unwrap_err(),
                expected,
                "{key}={value}"
            );
        }
    }

    #[test]
    fn strips_control_characters() {
        let r = parse_state(&state_with("title", json!("A\u{0}B\nC"))).unwrap();
        assert_eq!(r.state.unwrap().title, "A B C");
    }

    #[test]
    fn hello_validation() {
        assert!(parse_hello(
            br#"{"protocol":1,"pairingKey":"ABCD","client":{"name":"LyricsDock","version":"0.1.0"}}"#
        )
        .is_ok());
        assert!(parse_hello(br#"{"protocol":1,"pairingKey":"ABCD"}"#).is_err());
        let long_key =
            json!({"protocol":1,"pairingKey":"A".repeat(65),"client":{"name":"x","version":"1"}});
        assert!(parse_hello(&serde_json::to_vec(&long_key).unwrap()).is_err());
    }
}
