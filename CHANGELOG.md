# Changelog

## Extension 0.1.1 — 2026-11-17

- Fix: YouTube tabs that were already open when the extension was loaded were never detected (the popup said "Nothing playing on YouTube" until the tab was refreshed). The extension now injects into open YouTube tabs on install or update. This adds the `scripting` permission.

## 0.1.0 — 2026-11-17

First MVP.

- Floating dark-glass overlay: always on top, draggable, resizable, bottom-right by default, remembers its position and recovers when a saved position is off-screen.
- Synced lyrics from LRCLIB that follow YouTube / YouTube Music playback, including pause, seek, speed changes, track changes and tab close.
- Plain-lyrics fallback (labelled), instrumental and no-lyrics states, offline/timeout/rate-limit errors with retry.
- Manual search and "choose match" when the automatic match isn't confident; choices are remembered.
- Sync offset (±10 s), freeze, current-line-only mode, opacity, text size, accent colour, reduced motion.
- Global shortcuts (show/hide, click-through), tray menu with recovery actions.
- Brave/Chromium MV3 extension with a pairing flow and status popup.
- Loopback-only authenticated bridge with origin pinning, schema validation and rate limits.
- NSIS and MSI installers for Windows x64.
