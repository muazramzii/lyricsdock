# Troubleshooting

## The extension popup says "Desktop app not connected"

- Make sure LyricsDock is running (tray icon present).
- Play or pause the video once. The extension connects when it has something to send.
- In LyricsDock Settings → Browser, check that **Accept connections** is on and the status shows a port such as `127.0.0.1:47811`.
- If the status says _Ports 47811-47813 are all in use_, another program holds those ports. Close it, or restart Windows.
- Security software that blocks loopback connections can also cause this. Allow `lyricsdock.exe` to accept connections on `127.0.0.1`.

## "Wrong pairing key"

Copy the key again from Settings → Browser (use the **Copy** button) and paste it into the popup. Dashes and letter case don't matter.

## "Paired with a different extension"

The app only talks to the first extension that paired. This happens after loading the extension from a different folder, because unpacked extension IDs depend on the path. In LyricsDock Settings click **New pairing key**, then paste the new key into the extension.

## "Too many attempts"

Five wrong keys within a minute lock pairing for a minute. Wait, then paste the correct key.

## The overlay says "No lyrics found"

LRCLIB doesn't have this song, or the YouTube title was too different from the real song name. Click **Search** (or `···`), correct the title and artist, and pick a result. Your choice is remembered for this video.

## Lyrics are slightly early or late

Use `−` / `+` in the overlay footer (0.25 s steps), or `[` and `]` while the overlay has focus. Click the value or press `\` to reset. The finer slider is in Settings → Sync.

## Lyrics drift on a cover or live version

The lyrics follow the original recording's timing. Click the target icon in the overlay footer (**Sync**), then click the line being sung right now. Click another line later in the song to match the tempo. The overlay shows **Custom sync** and remembers this for that video. **Reset** in the Sync panel goes back to the original timing.

## The lyrics are for the wrong version (live, remix…)

Open `···` and pick the right recording. Results show the duration to help match the video length.

## "Not synced" badge

LRCLIB only has plain text for this song. It's shown in full but can't follow playback.

## I can't click the overlay anymore

Click-through mode is on. Press **Ctrl+Alt+K** (or your configured shortcut), or right-click the tray icon and uncheck **Click-through mode**. Click-through is also always off after a restart.

## The overlay is gone / off-screen

- Press **Ctrl+Alt+L** to show it.
- Tray icon → **Reset position** puts it back in the bottom-right corner.
- If a monitor was unplugged, LyricsDock moves the overlay back onto a visible screen at the next start.

## A shortcut doesn't work

Another app may already use it. In Settings → Behaviour, type another combination such as `CommandOrControl+Shift+F9` and press Enter. An error appears if it cannot be registered, and the old one stays active.

## Popup says "Connected" but "Nothing playing on YouTube"

- An ad is playing. Ads are ignored on purpose; the song appears when the video starts.
- The extension was loaded with a version older than 0.1.1 while the tab was already open. Refresh the YouTube tab once. Newer versions inject into open tabs automatically.
- After reloading the extension in `brave://extensions`, press play or pause once so the tab reports again.

## Nothing happens on YouTube's home page

That's intentional. Only watch pages (`/watch`, `/shorts/`) and YouTube Music are followed, so muted previews on the home page are ignored. Ads are ignored too.

## Brave Shields or "localhost access" prompts

Requests come from the extension, not from youtube.com, so Brave's per-site localhost permission doesn't apply. If you've hardened Brave with policies that block extensions' loopback requests, allow `http://127.0.0.1`.

## Logs and data locations

| What                            | Where                                          |
| ------------------------------- | ---------------------------------------------- |
| Settings                        | `%APPDATA%\com.lyricsdock.app\settings.json`   |
| Pairing key + paired extension  | `%APPDATA%\com.lyricsdock.app\bridge.json`     |
| Lyrics cache (WebView2 storage) | `%LOCALAPPDATA%\com.lyricsdock.app\EBWebView\` |

Deleting `settings.json` restores defaults. Deleting `bridge.json` creates a new pairing key at the next start.

## Uninstalling cleanly

1. Quit LyricsDock (tray → **Quit LyricsDock**).
2. Windows Settings → Apps → Installed apps → **LyricsDock** → Uninstall. This works for both the NSIS and MSI installers.
3. Delete `%APPDATA%\com.lyricsdock.app` and `%LOCALAPPDATA%\com.lyricsdock.app` to remove settings, the pairing key and the lyrics cache.
4. In `brave://extensions`, remove the LyricsDock extension.

LyricsDock doesn't install services, startup entries, registry-based native messaging hosts or firewall rules. Nothing else is left behind.
