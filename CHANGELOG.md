# Changelog

## Desktop 0.2.0 — 2026-11-22

- Fix: "Song - Artist" titles (common for Malay and Indonesian uploads) found no lyrics because only the "Artist - Song" reading was searched. Both readings are now tried.
- Covers such as `Song - Artist (X Cover)` now find the original song's lyrics. If the cover's length differs from the original by more than 5 s, the overlay asks you to choose instead of showing lyrics that would drift.
- The "Choose match" list no longer repeats the same recording several times.
- Fix: "Song (Lirik) - Artist" titles found nothing, and manual search used the fields exactly as typed. Manual search now cleans the fields and also tries them swapped, the title alone, and free text.
- A song with the same title by a different artist is no longer accepted automatically.
- Fix: "Song by Artist (cover by X)" titles found nothing; the "by" form is now understood.
- "No lyrics" results remembered by an older version are retried instead of being trusted for an hour.
- New **Sync** panel (target icon in the footer): click the line being sung right now to line the lyrics up with this video, and click again at least 30 s later to match its tempo. Made for covers and live versions whose timing differs from the original. Saved per video; **Reset** restores the original timing.

## Extension 0.1.3 — 2026-11-18

- "(Lirik)", "(Video Klip)", "Terjemahan", "Letra", "Paroles" and similar non-English tags are removed from titles like "(Lyrics)" already was.

## Extension 0.1.2 — 2026-11-17

- Fix: titles from lyric channels with search tags after a bar, such as `Artist - Song (Lyrics) | Other Artist, …`, found no lyrics because the tags were searched as part of the song name. Text after `|`, `｜` or `//` is now ignored.

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
