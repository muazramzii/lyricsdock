# LyricsDock branding

| File                                               | Use                                                    |
| -------------------------------------------------- | ------------------------------------------------------ |
| `lyricsdock-logo-dark.svg` / `.png`                | Horizontal logo for dark backgrounds                   |
| `lyricsdock-logo-light.svg` / `.png`               | Horizontal logo for light backgrounds                  |
| `lyricsdock-mark.svg` / `lyricsdock-mark-1024.png` | App mark alone (app icon, avatar, favicon, thumbnails) |
| `preview.png`                                      | All versions side by side                              |

PNGs have transparent backgrounds and are rendered at 2× size. Prefer the SVGs on the web.

The mark is the source of the app and extension icons: `apps/desktop/assets/icon.svg` is a copy, `apps/desktop/src-tauri/icons/` was generated from `lyricsdock-mark-1024.png` with `npx tauri icon`, and `apps/extension/icons/` are renders of the SVG at 16, 32, 48 and 128 px.

## Colours

| Role                             | Hex                   |
| -------------------------------- | --------------------- |
| Tile gradient                    | `#2b303a` → `#15171c` |
| Current lyric line / text (dark) | `#f4f6fb`             |
| Accent "Dock" on dark            | `#8fb3ff`             |
| Text on light                    | `#15171c`             |
| Accent "Dock" on light           | `#3563d8`             |
| Note gradient                    | `#a9c4ff` → `#6f97f5` |

## Type

The wordmark is Inter Bold (SIL Open Font License), converted to outlines, so the SVGs don't need the font installed.
