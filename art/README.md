# ArghBox art

Logo, icons, social images and diagrams. All art is MIT licensed like the rest of the project. The fonts used for rendering keep their own licence (SIL OFL 1.1, see below).

The mark: a friendly complaint box with a slot on top and a yellow "argh" burst popping out of it.

## Files

| File | Use |
| --- | --- |
| `logo-mark.svg` | Full logo mark (box with face, burst with "!"). Use at 48 px and up. |
| `logo-mark-small.svg` | Simplified mark (no face, no "!"), for 16 to 32 px. |
| `logo-horizontal.svg` / `.png` | Mark + "ArghBox" for light backgrounds. PNG is 2x. |
| `logo-horizontal-dark.svg` / `.png` | Same for dark backgrounds (cream outline and lettering, transparent). |
| `banner.svg` / `.png` | README banner, 1280x400 (PNG 2560x800), solid rounded background so it works on GitHub light and dark. |
| `how-it-works.svg` / `.png` | Three-step diagram (visitors argh, your AI triages, clean list), 1200x440 (PNG 2400x880), solid background. |
| `social-github.png` | GitHub social preview, 1280x640. Upload in repository settings. |
| `tab-icon.svg` | 16x16 single-colour (`currentColor`) icon for the widget's tab, 269 bytes. |
| `src/social.html` | Template for both social images (fluid layout, fonts from `fonts/`). |
| `src/svg-generator/` | The Node scripts that generated the SVGs (see "Provenance"). |
| `fonts/` | Fonts and licences used for the lettering. |

In `art/brand/`: `favicon.svg` (small mark, outline switches to cream in dark mode), `favicon.ico` (16, 32, 48 px PNGs), `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark inside the 80% safe zone), `site.webmanifest`, `og-image.png` (1200x630).

## Palette

| Role | Name | Hex |
| --- | --- | --- |
| Accent | Argh red | `#e8553d` |
| Ink (outlines, text) | Soot | `#2b1d1a` |
| Paper (light background) | Cream | `#fff6e9` |
| Highlight (the scream) | Yellow | `#ffc83d` |
| Dark background | Night | `#1f1613` |
| Muted text | Dust | `#7a6a63` |
| Soft panel | Peach | `#ffe7c7` |

Contrast (WCAG 2.1):

| Pair | Ratio | Verdict |
| --- | --- | --- |
| Ink on paper | 15.2 : 1 | AAA |
| Ink on white | 16.2 : 1 | AAA |
| Ink on yellow | 10.5 : 1 | AAA |
| Ink on accent | 4.5 : 1 | AA (use for large or bold text) |
| Muted on paper | 4.8 : 1 | AA |
| Paper on night | 16.6 : 1 | AAA |
| Accent on night | 4.9 : 1 | AA (text and graphics on dark) |
| Accent on paper | 3.4 : 1 | Graphics and large text only |
| White on accent | 3.6 : 1 | Large or bold text only (buttons with 16 px+ bold) |

`#e8553d` is kept as the brand accent (it is the widget's default `data-accent`), but it does not reach 4.5 : 1 against white or paper for small text. For small accent-coloured text or white text on an accent fill use the darker `#c93a22` (4.8 : 1 on paper, 5.1 : 1 with white text). On dark backgrounds `#e8553d` works as is, and `#ff7a5f` (6.9 : 1 on night) is available for small text.

Light use: cream or white background, soot outlines and text, red for the box and "Box" in the wordmark, yellow only for the burst or highlights. Dark use: night background, cream outlines and "Argh" lettering, red and yellow unchanged (use `logo-horizontal-dark.svg`).

## Fonts

- **Lilita One** (wordmark, headings): SIL Open Font License 1.1, `fonts/OFL-LilitaOne.txt`.
- **Varela Round** (tagline, UI text): SIL Open Font License 1.1, `fonts/OFL-VarelaRound.txt`.

Both are from Google Fonts. In the SVGs all lettering is converted to outlines (paths), so no font is needed to display them. Only `src/social.html` loads the TTF files from `fonts/`.

## Re-rendering

```
node tools/render-art.mjs
```

Needs `@playwright/test` with Chromium (`npx playwright install chromium`). It renders every PNG from the SVG/HTML sources (2x for the lockups, banner and diagram), builds `favicon.ico`, the app icons and both social images. Running it again reproduces them.

## Provenance

The SVGs are committed as the source of truth; edit them by hand if you like. `src/svg-generator/` holds the scripts that produced them (marks, illustrations, lettering as outlines via `opentype.js`). To rerun: `npm install --no-save opentype.js` then `node art/src/svg-generator/gen.mjs`, and `node tools/render-art.mjs` afterwards.
