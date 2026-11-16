# LyricsDock

A small, always-on-top lyrics overlay for Windows. Play a song on YouTube or YouTube Music in Brave, minimize the browser, and keep singing along. The current line stays big and bright in a compact dark-glass window in the corner of your screen.

- **Free, no account, no API key.** Lyrics come from the public [LRCLIB](https://lrclib.net) database.
- **Synced when possible.** Timestamped lyrics follow the real playback position: pause, seek, speed changes and track changes are all tracked. Plain lyrics are shown when there are no timestamps, and clearly labelled "Not synced".
- **Private.** No telemetry, ads or tracking. No audio is recorded or captured. Only the track title, artist and length are sent to LRCLIB to find lyrics.
- **Light.** A ~5 MB Tauri app plus a ~17 KB browser extension. The overlay sleeps between lyric lines instead of polling.

```
┌──────────────────────────────────────────────┐
│ ♪  NEVER GONNA GIVE YOU UP — RICK ASTLEY  ··· × │
│              previous line                   │
│          CURRENT LINE, BIG AND BRIGHT        │
│                next line                     │
│ YouTube               − +0.00s +   ⏸  ⌖  ⚙  │
└──────────────────────────────────────────────┘
```

## How it works

```
YouTube tab ──content script──▶ extension service worker ──HTTP 127.0.0.1──▶ LyricsDock (Rust bridge)
                                                                                   │ validated events
                                          LRCLIB ◀── lookup (title, artist, length) ── overlay (React)
```

The extension reads the `<video>` element (position, duration, paused, rate) and the track title/artist. It sends them to the desktop app over a loopback-only, authenticated local connection. The app looks up lyrics and keeps the current line in sync with the media position. See [docs/DECISIONS.md](docs/DECISIONS.md) for the security model.

## Install (Windows 10/11 x64)

1. Install LyricsDock with the installer from `apps/desktop/src-tauri/target/release/bundle/nsis/` (see _Build_ below), or run it from source.
2. Load the extension in Brave, following **[docs/BRAVE_SETUP.md](docs/BRAVE_SETUP.md)**:
   1. Open `brave://extensions`.
   2. Turn on **Developer mode**.
   3. Click **Load unpacked** and select `apps/extension/dist`.
3. In LyricsDock, open **Settings → Browser** and click **Copy** next to the pairing key.
4. Click the LyricsDock extension icon in Brave, paste the key, and click **Pair**.
5. Play a song on YouTube or YouTube Music.

## Using it

| Action                 | How                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Move the overlay       | Drag it by the top bar or the lyrics area                                              |
| Resize                 | Drag any edge (300–760 px wide)                                                        |
| Show / hide            | **Ctrl+Alt+L** (configurable), or left-click the tray icon                             |
| Click-through mode     | Pointer button in the overlay; **Ctrl+Alt+K** or the tray menu turns it off again      |
| Nudge sync             | `−` / `+` in the footer, or `[` and `]` (reset with `\` or by clicking the value)      |
| Freeze lyrics          | Pause button in the footer                                                             |
| Wrong song / no lyrics | `···` opens _Find lyrics_: search by title and artist, then pick a result (remembered) |
| Lost the overlay       | Tray → **Reset position**                                                              |
| Quit                   | Tray → **Quit LyricsDock** (closing the overlay only hides it)                         |

## Development

Prerequisites: Node.js ≥ 20 (tested with 22.14), Rust stable (tested with 1.100, MSVC toolchain), Visual Studio C++ Build Tools, and WebView2 (preinstalled on Windows 11).

```bash
npm install                 # all workspaces
npm run dev                 # desktop app with hot reload (tauri dev)
npm run build:extension     # builds apps/extension/dist
npm run build:desktop       # release build + NSIS/MSI installers
```

Quality checks:

```bash
npm test                    # vitest: shared, desktop, extension
npm run lint                # eslint
npm run typecheck           # tsc --noEmit for all packages
npm run format:check        # prettier
npm run check               # all of the above + production builds
cd apps/desktop/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Opening `http://localhost:1420` in a normal browser while `npm run dev` runs shows the overlay in a browser fallback mode. Click **Try demo** to see the synced-lyrics UI with placeholder text. Add `?view=settings` to preview the settings screen.

### Repository layout

```
apps/desktop/            Tauri 2 + React overlay and settings UI
  src/features/lyrics/   LRC parser, sync engine, LRCLIB client, matching, cache
  src/features/overlay/  overlay UI, search panel, demo mode
  src-tauri/src/bridge/  loopback bridge: schema validation, auth, rate limits
apps/extension/          Manifest V3 extension (content script, service worker, popup)
packages/shared/         bridge protocol types/validators, text normalization
docs/                    decisions, testing, setup, troubleshooting
```

## Documentation

- [docs/BRAVE_SETUP.md](docs/BRAVE_SETUP.md): load and pair the extension
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): common problems, plus uninstalling
- [docs/DECISIONS.md](docs/DECISIONS.md): technology and security decisions
- [docs/TESTING.md](docs/TESTING.md): automated tests and the manual Windows checklist
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phase status
- [CHANGELOG.md](CHANGELOG.md): release notes

## Privacy

LyricsDock sends the current track's title, artist and duration to LRCLIB (lrclib.net) to search for lyrics. Nothing else leaves your computer. The extension only reads YouTube/YouTube Music player information. It does not read browsing history, comments, or account details. It only talks to the LyricsDock app on `127.0.0.1`. A small cache of recent lyrics lookups is stored locally.

## License

MIT. Lyrics are fetched at runtime from LRCLIB and are not bundled or redistributed.
