# ArghBox art

Logo, icons, social images and the "how it works" animation. All art is MIT licensed like the rest of the project. The fonts used for lettering keep their own licence (SIL OFL 1.1, see below).

The ArghBox name and logo are also trademarks of BinaryBanana LLC. The MIT licence covers these files. It does not let you use the logo as the logo of your own product or of a renamed fork. Using it to point at ArghBox is fine. See [TRADEMARKS.md](../TRADEMARKS.md).

The mark: a 16 x 16 pixel cardboard box with an open lid and an angry face (the "argh"). It is the same mascot as on [arghbox.com](https://arghbox.com), where it also looks happy or concentrated. Everything is drawn with `shape-rendering="crispEdges"` rectangles, so it stays sharp at any size.

## Files

| File | Use |
| --- | --- |
| `logo-mark.svg` | The pixel mascot, 256 px. |
| `logo-mark-small.svg` | The same art at 128 px, for 16 to 64 px uses (the grid is already 16 px, so it is crisp at 16, 32, 48 ...). |
| `logo-horizontal.svg` / `.png` | Mark + "ArghBox" for light backgrounds. PNG is 2x. |
| `logo-horizontal-dark.svg` / `.png` | Same for dark backgrounds (light lettering, transparent). |
| `banner.svg` / `.png` | Banner, 1280x400 (PNG 2560x800), solid rounded background so it works on GitHub light and dark. |
| `how-it-works.gif` | The animated machine (feedback drops into the AI funnel, spam is rejected, a clean list comes out). 959x334, 10 fps, 10 s loop. Used in the README. |
| `how-it-works.png` | A still frame of the same machine, 2084x724. |
| `social-github.png` | GitHub social preview, 1280x640. Upload in repository settings. |
| `tab-icon.svg` | 16x16 single-colour (`currentColor`) silhouette of the mascot with its face cut out. |
| `src/social.html` | Template for both social images (fonts from `fonts/`). |
| `src/svg-generator/gen.mjs` | Generates the SVGs (see "Provenance"). |
| `src/capture-machine.mjs` | Captures the GIF and still PNG from the arghbox.com home page. |
| `fonts/` | Fonts and licences used for lettering. |

In `art/brand/`: `favicon.svg`, `favicon.ico` (16, 32, 48 px PNGs), `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark inside the 60% safe zone), `site.webmanifest` (theme and background `#FFFFFF`), `og-image.png` (1200x630).

The widget's own tab icon and the "Powered by ArghBox" credit mark are the same pixel mascot, inlined in `arghbox/arghbox.js` and `arghbox/arghbox-app.js`.

## Palette

| Role | Hex (light / dark) |
| --- | --- |
| Page | `#FFFFFF` / `#0E131B` |
| Band | `#EEF2F6` / `#141A24` |
| Card | `#FFFFFF` / `#1A2130` |
| Ink (outlines, text) | `#1E2430` / `#E8EDF5` |
| Muted text | `#5B6475` / `#A3AEC2` |
| Lines | `#E2E8F0` / `#2A3344` |
| Primary, links, "Box" | `#0369A1` / `#7DD3FC` |
| Coral (art), with white text use `#E11D48` | `#F43F5E` |
| Sky (art), soft badge | `#0EA5E9`, `#E0F2FE` |

The mascot itself uses fixed colours on every background: outline and face features `#1E2430`, lid `#38BDF8`, lid shadow `#0EA5E9`, front `#7DD3FC`.

Contrast (WCAG 2.1, computed from the hex values):

| Pair | Ratio | Verdict |
| --- | --- | --- |
| Ink on white | 15.6 : 1 | AAA |
| Ink on band | 13.8 : 1 | AAA |
| Muted on white | 6.0 : 1 | AA |
| Muted on band | 5.3 : 1 | AA |
| Primary on white | 5.9 : 1 | AA |
| Primary on band | 5.3 : 1 | AA |
| Primary on soft badge | 5.2 : 1 | AA |
| White on primary | 5.9 : 1 | AA |
| Rose `#BE123C` on white (highlighted words) | 6.3 : 1 | AA |
| White on `#E11D48` | 4.7 : 1 | AA |
| White on coral `#F43F5E` | 3.7 : 1 | Large or bold text and graphics only |
| Sky `#0EA5E9` on white | 2.8 : 1 | Decoration only |
| Ink on mascot front `#7DD3FC` | 9.3 : 1 | AAA |
| Ink on mascot lid `#38BDF8` | 7.3 : 1 | AAA |
| Ink on dark page | 15.8 : 1 | AAA |
| Muted on dark page | 8.3 : 1 | AAA |
| Primary (dark) on dark page | 11.2 : 1 | AAA |
| Primary (dark) on dark card | 9.7 : 1 | AAA |

Light use: white or band background, ink lettering, `#0369A1` for "Box". Dark use: `#E8EDF5` for "Argh", `#7DD3FC` for "Box" (`logo-horizontal-dark.svg`). The mascot's light-blue front keeps it visible on a dark page, where its slate outline melts into the background.

## Fonts

- **Inter** (wordmark, headings, tagline): SIL Open Font License 1.1, `fonts/OFL-Inter.txt`.
- **IBM Plex Mono** (chips, labels, code): SIL Open Font License 1.1, `fonts/OFL-IBMPlexMono.txt`.
- **Pixelify Sans** (short words inside the machine art only): SIL Open Font License 1.1; it is baked into the captured machine, so it is not shipped here.

All three are from Google Fonts. The wordmark is Inter ExtraBold (800) with letter-spacing -0.03em. In the SVGs all lettering is converted to outlines (paths), so no font is needed to display them. `fonts/` holds Latin subsets of the static weights for the generator (`*.ttf`) and the web fonts for `src/social.html` (`*.woff2`).

## Re-rendering

```
node tools/render-art.mjs
```

Needs `@playwright/test` with Chromium (`npx playwright install chromium`). It renders every PNG from the SVG/HTML sources (2x for the lockups and banner), builds `favicon.ico`, the app icons and both social images. Running it again reproduces them. The GIF and `how-it-works.png` are not part of it because they are captures of a live page: see `src/capture-machine.mjs`.

## Provenance

The SVGs are committed as the source of truth; edit them by hand if you like. `src/svg-generator/gen.mjs` produced them: the pixel mascot is drawn on its 16 x 16 grid (the same blocks as `Mark.tsx` on arghbox.com), and the lettering is turned into outlines with `opentype.js`. To rerun: `npm install --no-save opentype.js`, then `node art/src/svg-generator/gen.mjs` and `node tools/render-art.mjs`. To refresh the animation: `npm install --no-save gifenc pngjs`, then `node art/src/capture-machine.mjs`.
