# Implementation plan and status

Status key: ✅ done and verified · 🟡 implemented, needs manual Windows check · ⛔ blocked

Environment used: Windows 11 Home (26300), Node 22.14, npm 10.9, Rust 1.100 (MSVC), Brave 157 (Chromium), WebView2 runtime present.

## Phase 0: Repository and setup ✅

- Empty folder → npm-workspaces monorepo (`apps/desktop`, `apps/extension`, `packages/shared`).
- Rust installed via the official rustup. MSVC 2022 Build Tools were already present.
- ESLint (flat config, typescript-eslint, react-hooks), Prettier, `tsc` strict, Vitest, `cargo fmt`, `cargo clippy -D warnings`.

## Phase 1: Overlay foundation ✅

- Frameless, transparent, always-on-top, skip-taskbar Tauri window (400×150 logical), plus a tray icon.
- Bottom-right placement in the primary work area with DPI-scaled margins. Verified on the real window with Win32 `GetWindowRect`: 500×188 physical px at 125 % scaling, 30 px from the bottom-right, `WS_EX_TOPMOST` set.
- Geometry persisted. Verified: a moved window's rectangle was written to `settings.json`. Saved positions that are off-screen are recovered (unit-tested placement math).
- Drag regions, hide on ×/Alt+F4, tray toggle, global show/hide shortcut. 🟡 Dragging with a real mouse and edge-resize of the frameless window still need a manual check.
- Demo mode with original placeholder text.

## Phase 2: Lyrics provider and sync engine ✅

- LRCLIB client (`/api/get`, `/api/search`), runtime-validated records, typed errors (offline/timeout/rate-limited/server/bad-response).
- LRC parser, binary-search line selection, drift-free playback clock, user offset.
- Matching/ranking with an ambiguity state instead of silent wrong matches. Manual search and choose-match panel.
- Plain-lyrics fallback labelled "Not synced", instrumental state, LRU cache with expiry.
- Live API verified: "Never Gonna Give You Up" resolved to synced lyrics end to end.

## Phase 3: Brave extension ✅

- MV3: content script (YouTube + YouTube Music), service worker, popup with status/track/troubleshooting and pairing.
- Selectors isolated in `content/selectors.ts` with fallbacks. Media Session API and `<video>` used first.
- SPA navigation (`yt-navigate-finish`, `popstate`, throttled `<title>` observer), video element swaps, ad detection.
- 2 Hz updates while playing; immediate on play/pause/seek/rate/track change; 2.5 s heartbeat while paused.
- Verified in real Brave 157 (isolated temporary profile, muted).

## Phase 4: Secure bridge ✅

- Loopback HTTP, pairing key → in-memory session token, origin pinning, Host check, size/rate limits, schema validation, replay protection, stale detection (7 s).
- Verified against the running app: web-origin 403, wrong key 401, rebinding Host 421, text/plain 415, >4 KB 413, malformed 400, protocol 426, replayed seq ignored, burst → 429, `netstat` shows only `127.0.0.1:47811`.

## Phase 5: End-to-end ✅

Automated run (real extension in Brave → bridge → running overlay, read via the WebView2 DevTools port):

- Popup: _Connected_, track "Never Gonna Give You Up — Rick Astley" (title cleaned from "… (Official Video) (4K Remaster)").
- Overlay advanced through 5 distinct synced lines in 20 s of playback.
- Pause → "Paused" badge, line frozen. Seek to 100 s → jumped to the correct section.
- Tab closed → overlay returned to "Waiting for music" within ~2.5 s.

## Phase 6: Polish and accessibility ✅ / 🟡

- Settings window: opacity, text size, lines shown, accent colour, motion, always-on-top, start hidden, both shortcuts, reset position, offset, bridge status/pairing/disconnect/new key/enable, LRCLIB test, cache clear, about, quit.
- Click-through with shortcut + tray recovery. Reduced-motion (system/forced). Visible focus rings, labelled icon buttons, keyboard offset keys, Esc closes panels.
- App icon and consistent dark visual identity.
- 🟡 Contrast was checked by design tokens, not with a measuring tool. High-contrast Windows themes were not tested.

## Phase 7: Packaging

- `tauri build` → NSIS (per-user) and MSI. See `docs/TESTING.md` for the build result and paths.
- Uninstall steps are in `docs/TROUBLESHOOTING.md`. There is no native-messaging registration to remove.

## Known gaps / next steps

- Store publication of the extension (needs a developer account; out of MVP scope).
- Code-signing the installer (needs a certificate). Windows SmartScreen will warn on first run.
- Word-level karaoke timing (LRCLIB `hasWordSync`) is ignored on purpose. The overlay renders whole lines.
