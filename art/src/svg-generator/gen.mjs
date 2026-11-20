// Generates the SVG art in art/ (marks, tab icon, favicon, horizontal logos, banner) in the ArghBox brand.
// The pixel mascot is drawn on a 16 x 16 grid; all lettering becomes outlined paths (opentype.js) so GitHub
// shows the files without any font.
//
// Usage:  npm install --no-save opentype.js   (do not commit the package.json change)
//         node art/src/svg-generator/gen.mjs
//         node tools/render-art.mjs           (PNGs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// OPENTYPE can point at an opentype.js install outside the repo (e.g. a scratch folder).
const ot = await import(process.env.OPENTYPE ? pathToFileURL(process.env.OPENTYPE).href : 'opentype.js');
const opentype = ot.default ?? ot;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); console.log('  ', p, s.length + ' bytes'); };
const loadFont = (name) => {
  const b = readFileSync(join(root, 'art', 'fonts', name));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
const inter800 = loadFont('Inter-ExtraBold.ttf');
const inter600 = loadFont('Inter-SemiBold.ttf');
const plex600 = loadFont('IBMPlexMono-SemiBold.ttf');

// ---- palette (see art/README.md) ----
const C = {
  ink: '#1E2430', lid: '#38BDF8', shade: '#0EA5E9', face: '#7DD3FC', coral: '#F43F5E',
  primary: '#0369A1', primaryDark: '#7DD3FC', inkDark: '#E8EDF5',
  band: '#EEF2F6', line: '#E2E8F0', soft: '#E0F2FE', muted: '#5B6475', rose: '#BE123C',
};

// ---- the pixel mascot: one path per colour, painted in this order ----
const FEATURES = 'M3 7h2v1H3zM5 8h1v1H5zM11 7h2v1h-2zM10 8h1v1h-1zM4 9h2v2H4zM10 9h2v2h-2zM6 12h4v1H6zM5 13h1v1H5zM10 13h1v1h-1z';
const PARTS = [
  ['M0 1h16v4H0zM1 5h14v10H1z', C.ink],   // lid and body outline
  ['M1 2h14v1H1z', C.lid],                // lid
  ['M1 3h14v1H1z', C.shade],              // lid shadow
  ['M2 5h12v9H2z', C.face],               // face
  [FEATURES, C.ink],                      // angry brows, eyes, frown
];
const mascot = () => PARTS.map(([d, f]) => `<path fill="${f}" d="${d}"/>`).join('');
const mascotAt = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" shape-rendering="crispEdges">${mascot()}</g>`;

// ---- lettering as outlines ----
/** Path data for `text`, left edge at x, on baseline y; tracking in em. Returns { d, width }. */
function text(font, str, x, y, size, tracking = 0) {
  const glyphs = font.stringToGlyphs(str);
  const k = size / font.unitsPerEm;
  let cx = x, d = '';
  glyphs.forEach((g, i) => {
    d += g.getPath(cx, y, size).toPathData(2);
    cx += g.advanceWidth * k + tracking * size;
    if (glyphs[i + 1]) cx += font.getKerningValue(g, glyphs[i + 1]) * k;
  });
  return { d, width: cx - x - tracking * size };
}
const P = (d, fill) => `<path fill="${fill}" d="${d}"/>`;
const svgOpen = (w, h, extra = '', vb = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"${extra}>`;

// 1. marks
const markSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="ArghBox">\n${mascot()}\n</svg>\n`;
out('art/logo-mark.svg', markSvg(256));
out('art/logo-mark-small.svg', markSvg(128));
out('art/brand/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${mascot()}</svg>\n`);

// 2. tab icon: one colour (currentColor), the outline and the face cut out of / drawn into it
out('art/tab-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" fill="currentColor"><path fill-rule="evenodd" d="M0 1h16v4H0zM1 5h14v10H1zM1 2h14v2H1zM2 5h12v9H2z${FEATURES}"/></svg>\n`);

// 3. horizontal logos: 128 px tall mark, then "ArghBox" (Inter ExtraBold, -0.03em)
function lockup(dark) {
  const size = 92, track = -0.03, capH = 0.727 * size;
  const baseline = 64 + capH / 2; // cap height centred on the mark
  const x0 = 136;
  const a = text(inter800, 'Argh', x0, baseline, size, track);
  const bx = x0 + a.width + inter800.getKerningValue(inter800.charToGlyph('h'), inter800.charToGlyph('B')) * size / inter800.unitsPerEm + track * size;
  const b = text(inter800, 'Box', bx, baseline, size, track);
  const w = Math.ceil(bx + b.width + 8);
  return `${svgOpen(w, 128, ' role="img" aria-label="ArghBox"')}\n${mascotAt(0, 0, 8)}\n${P(a.d, dark ? C.inkDark : C.ink)}\n${P(b.d, dark ? C.primaryDark : C.primary)}\n</svg>\n`;
}
out('art/logo-horizontal.svg', lockup(false));
out('art/logo-horizontal-dark.svg', lockup(true));

// 4. banner 1280 x 400, solid rounded band so it reads on GitHub light and dark
{
  const W = 1280, H = 400, x0 = 340;
  const word = (size, y) => {
    const a = text(inter800, 'Argh', x0, y, size, -0.03);
    const bx = x0 + a.width + inter800.getKerningValue(inter800.charToGlyph('h'), inter800.charToGlyph('B')) * size / inter800.unitsPerEm - 0.03 * size;
    return P(a.d, C.ink) + P(text(inter800, 'Box', bx, y, size, -0.03).d, C.primary);
  };
  const t1 = text(inter600, 'The complaint box your ', x0, 232, 36);
  const t2 = text(inter600, 'AI empties', x0 + t1.width, 232, 36);
  const t3 = text(inter600, ' for you.', x0 + t1.width + t2.width, 232, 36);
  let cx = x0, chips = '';
  for (const label of ['Free hosting', 'Free AI', 'Open source']) {
    const t = text(plex600, label, 0, 0, 22);
    const w = Math.round(t.width + 40), y = 276;
    chips += `<rect x="${cx + .5}" y="${y + .5}" width="${w - 1}" height="43" rx="21.5" fill="${C.soft}" stroke="#CBD5E1"/>`;
    chips += P(text(plex600, label, cx + 20, y + 29, 22).d, C.primary);
    cx += w + 12;
  }
  out('art/banner.svg', `${svgOpen(W, H, ' role="img" aria-label="ArghBox: the complaint box your AI empties for you. Free hosting, free AI, open source."')}
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="24" fill="${C.band}" stroke="${C.line}"/>
<rect x="58" y="62" width="248" height="276" rx="24" fill="#fff" stroke="${C.line}"/>
${mascotAt(72, 88, 14)}
${word(112, 168)}
${P(t1.d, C.ink)}${P(t2.d, C.rose)}${P(t3.d, C.ink)}
${chips}
</svg>
`);
}
