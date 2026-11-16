# Brave setup

The extension isn't published in a store yet, so Brave loads it as an unpacked extension. This takes about a minute.

## 1. Build the extension (skip if `apps/extension/dist` already exists)

```bash
npm install
npm run build:extension
```

## 2. Load it in Brave

1. Open `brave://extensions` in the address bar.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the folder `apps/extension/dist`. Pick the `dist` folder itself, not `apps/extension`.
5. **LyricsDock** appears in the list. Click the puzzle-piece icon in the toolbar and pin it so the popup is one click away.

Chrome and Edge work the same way (`chrome://extensions`, `edge://extensions`).

## 3. Pair with the desktop app

1. Start LyricsDock. A small overlay appears in the bottom-right corner and an icon appears in the system tray.
2. Open **Settings** (gear icon on the overlay, or tray → _Settings…_) and find **Browser → Pairing key**. Click **Copy**.
3. Click the LyricsDock extension icon in Brave, paste the key, and click **Pair**.
4. The popup shows **Connected** once the app answers. Play a song on YouTube or YouTube Music and the overlay follows it.

You only pair once. The key is stored in the extension's local storage, and the desktop app remembers which extension paired.

## Updating the extension

After pulling new code, run `npm run build:extension` again. Then click the circular **reload** arrow on the LyricsDock card in `brave://extensions`, and reload any open YouTube tabs.

## Removing it

- In `brave://extensions`, click **Remove** on the LyricsDock card. That also deletes the stored pairing key.
- To also invalidate the key on the desktop side, click **New pairing key** in LyricsDock Settings.

## What the extension can access

- Only `youtube.com`, `m.youtube.com` and `music.youtube.com` pages, and only the player: title, channel/artist, video ID, position, duration, play state.
- Network access only to `http://127.0.0.1` (the LyricsDock app on your own PC).
- No history, tabs list, cookies, downloads or other sites.
