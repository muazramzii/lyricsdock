# Decisions

Each entry records what was chosen, why, and what it costs. Newest last.

## D1. Monorepo with npm workspaces

`apps/desktop` (Tauri), `apps/extension` (MV3), `packages/shared` (protocol + text utilities). npm comes with Node, so no extra package manager is required. The shared package is consumed as TypeScript source: Vite, esbuild and Vitest all compile it directly, so there is no build step to forget.

## D2. Tauri 2 + React 19 + Vite, plain CSS instead of Tailwind

The UI is two small screens. A few hundred lines of hand-written CSS with design tokens (`apps/desktop/src/styles`) is smaller and easier to read than adding Tailwind's toolchain. Versions are pinned via `package-lock.json` / `Cargo.lock` (Tauri 2.12, React 19.3, Vite 8, TypeScript 6.0).

TypeScript 7 (the native port) was available, but `typescript-eslint` only supports `<6.1`, so 6.0 was chosen.

## D3. Bridge: loopback HTTP with pairing, not Native Messaging

**Choice:** the desktop app runs a tiny HTTP server (`tiny_http`) bound to `127.0.0.1` on the first free port of 47811–47813. The extension's service worker POSTs JSON to it.

**Why not Native Messaging:** Native Messaging makes the _browser_ launch a host executable per connection and talk to it over stdio. The overlay is a long-running tray app, so a native host would need a second process plus its own IPC into the running app. It would also need registry keys per browser (`HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\…`), and a host manifest that hard-codes the extension ID, which differs for every unpacked install. That is more moving parts and more ways to fail, and the threat model below is no weaker.

**Security model** (implemented in `src-tauri/src/bridge/core.rs`, tested in the same file):

| Threat                                               | Mitigation                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Other machines on the LAN                            | Socket bound to `127.0.0.1` only (verified with `netstat`). Never `0.0.0.0`.                                                                                                                                                                                                  |
| A web page calling `fetch('http://127.0.0.1:47811')` | Browsers set `Origin` themselves; anything other than `chrome-extension://<32 a–p chars>` gets 403. No CORS headers are ever sent, so pages also cannot read responses. JSON `Content-Type` is required, which forces a CORS preflight that is always refused.                |
| DNS rebinding                                        | `Host` header must be exactly `127.0.0.1:<port>` or `localhost:<port>` (421 otherwise).                                                                                                                                                                                       |
| Another installed extension                          | Needs the pairing key. The first extension origin that pairs is **pinned**; other origins get `origin_not_paired` even with the right key.                                                                                                                                    |
| Guessing the pairing key                             | 80-bit random key (16 Crockford base32 chars). 5 failures within 60 s lock pairing for 60 s. Comparisons are constant-time.                                                                                                                                                   |
| Stolen session token                                 | Session tokens are 256-bit random values kept only in memory. They die when the app exits, can be revoked with **Disconnect**, and **New pairing key** revokes everything and clears the pin.                                                                                 |
| Malformed or hostile payloads                        | Bodies over 4 KB are rejected (413). Strict schema: field types, string lengths (title 300, artist 200), finite numeric ranges, video ID charset, allowed `source` values, protocol version. Control characters are stripped. Unknown fields are dropped and never forwarded. |
| Flooding                                             | Token bucket: 20 burst, 10/s refill for state updates (429 beyond).                                                                                                                                                                                                           |
| Replay or reordering                                 | Per-session monotonic `seq`. Old or duplicate sequence numbers are acknowledged and ignored.                                                                                                                                                                                  |
| Commands from web content                            | The bridge has exactly four routes: `hello`, `state`, `status`, `bye`. No filesystem, shell, URL-opening or Tauri command is reachable from it, and nothing received is executed.                                                                                             |

**Trade-offs:** any local process running as the same Windows user could read the pairing key from `%APPDATA%\com.lyricsdock.app\bridge.json`. Such a process could already read the browser profile, so this adds no new exposure. Tokens and payloads are never logged.

## D4. Settings and geometry persisted by Rust

`settings.json` in `%APPDATA%\com.lyricsdock.app\` is the single source of truth. The UI sends partial patches (`deny_unknown_fields`). Rust clamps every value, applies window effects (always-on-top, shortcuts, bridge on/off), saves atomically (temp file + rename), and broadcasts `settings://changed` to all windows. Window geometry is recorded on move/resize and flushed every 2 s and on exit.

## D5. Placement and off-screen recovery

The math lives in `src-tauri/src/placement.rs`, as pure functions with unit tests. A saved rectangle is reused only when at least half of it is on a connected monitor's **work area**; it is then nudged fully inside that monitor. Otherwise the overlay goes to the bottom-right of the primary work area with a 24-logical-pixel margin. The work area excludes the taskbar, so the notification area stays visible. All sizes are scaled by the monitor's DPI factor.

## D6. No OS-level blur (acrylic/mica)

Windows acrylic/mica applies to the whole rectangular window, which would show square blurred corners behind the rounded card. On some Windows 10 builds it also makes dragging lag. The overlay uses a translucent charcoal fill, a hairline border and a top highlight instead, and the opacity slider controls only the background, never the text. CSS `backdrop-filter` cannot blur other applications' windows, so it is not used either.

## D7. Click-through with three ways out

Click-through uses `set_ignore_cursor_events(true)`. Because the overlay can then no longer be clicked, it can always be turned off by:

1. the global shortcut (default **Ctrl+Alt+K**),
2. the tray menu's checked **Click-through mode** item,
3. restarting the app (click-through is never persisted).

## D8. Lyrics lookup strategy

1. `GET /api/get` with title, artist and rounded duration. LRCLIB matches duration within ±2 s. This is used only when both artist and duration are known. The result is accepted directly only if title and artist scores are high.
2. `GET /api/search` by title + artist, then by title alone, then free text with the raw YouTube title (noise stripped).
3. Candidates are ranked deterministically: score (title 50 %, artist 30 %, duration 20 %, with penalties for version mismatches such as live/remix/acoustic and for >30 s length gaps), then synced-first, then smaller duration gap, then id.
4. Results are accepted automatically only when the score is ≥ 0.72 and the title similarity is ≥ 0.8. Otherwise the overlay shows **"Not sure which song this is → Choose match"** instead of guessing. Searching stops early only on a near-exact title (≥ 0.95), so a later, better attempt can still win.
5. Both readings of `A - B` are tried. Uploads use "Artist - Song" and "Song - Artist" about equally often, especially for Malay and Indonesian music. Each candidate keeps its best score across the two readings.
6. Covers (`(X Cover)`, `[Cover by X]`, `cover by X`) are searched as the original song. LRCLIB rarely has the cover itself. The original is accepted automatically only when its length is within 5 s of the video. Otherwise the user chooses, because a cover's tempo usually differs and the original's timing would drift. Duplicate uploads of one recording are offered once in the chooser.

Title cleanup removes only promotional noise ("Official Video", "Lyrics", "4K", "Remastered 2011"). It keeps "(Live)", "(Acoustic)", "(Remix)" and "(Taylor's Version)", because those change the words or timing. Normalization keeps all Unicode letters, so CJK, Hangul and accented titles still compare correctly.

Requests send the `Lrclib-Client` header (LRCLIB's documented alternative to `User-Agent` for browsers) and `credentials: 'omit'`. The CSP allows `connect-src` only to `https://lrclib.net`.

## D9. Lyrics cache

`localStorage` in the WebView2 profile: at most 200 entries, LRU. Hits expire after 30 days, misses after 1 hour, manual choices after 180 days. The key is normalized artist|title|rounded duration. The settings window can clear it; other windows reload on the `storage` event.

## D10. Sync engine

The browser's media position is the source of truth. Each update carries `position` and `capturedAt`. Between updates the overlay extrapolates `position + elapsed × playbackRate`, capped at 5 s, so a stalled feed cannot run ahead. Every new report replaces the anchor, so drift never accumulates. The current line is found by binary search. A timer sleeps until the next line boundary (re-checking at least once per second) instead of ticking at a fixed rate. The user offset is added to the playback time: positive values show lines earlier.

LRC parsing accepts `[mm:ss]`, `[mm:ss.x…]`, `[mm:ss:xx]`, `[h:mm:ss.xx]`, multiple tags per line and `[offset:±ms]`. It strips `<word>` timing tags, merges duplicate timestamps (e.g. translations) and skips malformed lines.

## D11. Multiple YouTube tabs

The background worker keeps one entry per tab. The rule is: a playing tab beats a paused one. Among playing tabs, the one that most recently _started_ playing wins (pressing play in another tab switches the overlay to it). Among paused tabs, the most recently updated wins. Ties go to the lower tab ID. Tabs silent for 12 s, closed, or showing nothing are dropped.

## D12. Extension permissions

`storage` (the pairing key) and `scripting`, plus host access to `http://127.0.0.1/*` and the three YouTube hosts. Content scripts run only on `www.youtube.com`, `m.youtube.com` and `music.youtube.com`. `scripting` is used once, on install or update, to inject the content script into YouTube tabs that were already open; Chromium only adds manifest content scripts to pages loaded afterwards. Brave shows the same "read and change your data on youtube.com" warning either way. There is no `tabs`, `history`, `webRequest` or `<all_urls>`. On regular YouTube, only `/watch` and `/shorts/` pages are reported, so home-page previews are ignored. Ads (`.ad-showing`) are not reported.

## D13. Settings window created off the main thread

Creating a WebView2 window from a synchronous Tauri command deadlocks the Windows event loop. This was observed during testing: every IPC call hung. `open_settings_window` therefore builds the window on the async runtime.

## D14. Git attribution

Following the blueprint, commits use the user's existing Git identity and carry no AI co-author trailer.
