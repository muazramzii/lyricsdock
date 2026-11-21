# Testing

## Automated

| Suite                                     | Command                                     | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result (2026-11-17) |
| ----------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Shared (Vitest)                           | `npm test`                                  | bridge validators (valid/invalid/oversized/unknown fields), pairing-key normalization, track identity, text normalization (Unicode, quotes, `&`), artist splitting, YouTube title parsing (noise vs. version info, Topic/VEVO channels, CJK brackets)                                                                                                                                                                                                                                                                         | 40 passed           |
| Desktop (Vitest + Testing Library, jsdom) | `npm test`                                  | LRC parser (formats, multi-stamp, duplicates, offset tag, malformed, word tags), line selection, playback clock (rate, pause, stale cap, skew, restart), LRCLIB client (URL building, 404, 429, 5xx, offline, bad JSON, record validation), matching/ranking, resolution strategy, cache (TTL, LRU, corrupt storage), `LyricsView` (context/single/plain/instrumental/pre-roll), status states (loading/no lyrics/offline/idle/ambiguous), `useLyrics` (debounce, no duplicate fetch, manual choice, idle), overlay demo mode | 49 passed           |
| Extension (Vitest, jsdom)                 | `npm test`                                  | host/page detection, video ID parsing, ad detection, DOM + Media Session + `document.title` extraction for YouTube and YouTube Music fixtures, state normalization (live streams, NaN, buffering, clipping), update throttling, multi-tab selection rule, bridge client (pairing, ports fallback, back-off, 401 re-auth, error mapping, token validation), message guards                                                                                                                                                     | 26 passed           |
| Rust (cargo)                              | `cd apps/desktop/src-tauri && cargo test`   | settings clamping/patch/corrupt file, placement (first launch, multi-monitor, unplugged monitor, nudge, tiny work area), schema validation, bridge core (origin/host/method/content-type/size checks, pairing + pin, lockout, session auth, replay, rate limit, invalid payload, stale/disconnect/reset, disabled), shortcut parsing                                                                                                                                                                                          | 28 passed           |
| Lint                                      | `npm run lint`                              | ESLint + typescript-eslint + react-hooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | clean               |
| Types                                     | `npm run typecheck`                         | `tsc` strict, all packages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | clean               |
| Format                                    | `npm run format:check`, `cargo fmt --check` | Prettier, rustfmt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | clean               |
| Clippy                                    | `cargo clippy --all-targets -- -D warnings` |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | clean               |
| Builds                                    | `npm run build`                             | Vite production build, esbuild extension bundle                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | pass                |

## Verified on this Windows machine

Everything below was exercised against the real running app (`tauri dev`), not mocks.

- **Window:** Win32 `GetWindowRect`/`GetWindowLong` showed the overlay at 500×188 physical px (400×150 logical at 125 %), 30 px from the bottom-right of the work area, `WS_EX_TOPMOST` set. Moving it via `SetWindowPos` persisted the new rectangle to `settings.json` within 2 s.
- **Commands:** settings window opens (after fixing a WebView2 creation deadlock, see DECISIONS D13). Settings save and broadcast. Invalid shortcut, duplicate shortcuts and unknown fields are rejected; an out-of-range offset is clamped. Click-through on/off works. Expanded mode grows the window upwards and collapsing restores the exact geometry. Closing the settings window keeps the app running.
- **Bridge (curl against the live server):** web origin → 403, wrong key → 401, correct key → 200 + 64-hex token, no/invalid token → 401, valid state → 200, replayed seq → ignored, bad schema → 400, malformed JSON → 400, wrong protocol → 426, 6 KB body → 413, `text/plain` → 415, foreign Host → 421, burst of 41 requests → 429s after ~28. `netstat`: listening on `127.0.0.1:47811` only.
- **End to end:** the built extension in Brave 157 (temporary isolated profile, muted, headless, driven via puppeteer-core) paired with the app through its real popup. The overlay was read through the WebView2 DevTools port:
  - Popup showed _Connected_ and the track "Never Gonna Give You Up — Rick Astley".
  - The overlay fetched synced lyrics from live LRCLIB and advanced through 5 lines in 20 s.
  - Pausing showed the _Paused_ badge and the line held. Seeking to 100 s jumped to the matching lines.
  - Closing the tab returned the overlay to _Waiting for music_.
- **Visual:** overlay (idle, demo with hover controls) and settings screens checked in a browser at real overlay size.

## Packaging (`npm run build:desktop`)

- Release build: `apps/desktop/src-tauri/target/release/lyricsdock.exe` (3.5 MB).
- Installers:
  - `apps/desktop/src-tauri/target/release/bundle/nsis/LyricsDock_0.2.0_x64-setup.exe` (1.27 MiB, per-user)
  - `apps/desktop/src-tauri/target/release/bundle/msi/LyricsDock_0.2.0_x64_en-US.msi` (1.80 MiB)
- Release exe smoke test: overlay at bottom-right, topmost, bridge listening on `127.0.0.1:47811` and refusing web origins, about 7 MB private memory (excluding shared WebView2 processes).
- Not done: running the installers themselves (it would modify this machine). The installers are unsigned, so SmartScreen will warn.

## Manual Windows checklist (needs a person at the machine)

Run the installed app or `npm run dev`, with Brave and the extension loaded.

- [ ] Overlay appears bottom-right, above the taskbar, not covering the clock/notification area.
- [ ] Drag by the title bar and by the lyrics area. The window follows the mouse smoothly.
- [ ] Resize from an edge/corner; the min (300×96) and max (760×420) limits hold.
- [ ] Always-on-top: overlay stays above a maximized browser/editor. Turning it off in Settings works.
- [ ] Ctrl+Alt+L hides/shows. Left-clicking the tray icon toggles. × hides (app keeps running in the tray).
- [ ] Click-through: clicks pass through to the window below; Ctrl+Alt+K and tray item both restore it.
- [ ] Quit from the tray, relaunch: same position and size.
- [ ] Move the overlay to a second monitor, quit, unplug the monitor, relaunch: overlay comes back to the primary bottom-right.
- [ ] 100 %, 125 %, 150 % display scaling: text crisp, margins proportional.
- [ ] Brave: play → lyrics follow; pause → _Paused_; seek → jumps; next video in playlist → new lyrics; close tab → _Waiting for music_.
- [ ] Two YouTube tabs: start the second → overlay switches; pause it → switches back to the first.
- [ ] YouTube Music: song title and artist shown correctly, lyrics follow.
- [ ] Song without lyrics → _No lyrics found_ → _Search_ finds and remembers a manual pick.
- [ ] Disconnect Wi-Fi with a new song → _Offline_ → reconnect → _Retry_ works.
- [ ] Sleep/resume the PC during playback: overlay recovers within a few seconds of the next update.
- [ ] Windows "Show animations" off → line changes without motion.
- [ ] Install with the NSIS installer, run from the Start menu, uninstall from Settings → Apps.

## Notes

- Tests never call the real LRCLIB. A mocked `fetch` is injected. The live API was only used in the manual and end-to-end checks.
- jsdom is pinned to 29 because newer releases require Node ≥ 22.22, and this machine has 22.14.
