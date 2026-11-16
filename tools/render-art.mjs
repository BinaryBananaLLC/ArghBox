// Renders every PNG (and the ICO) under art/ (brand output in art/brand/) from the SVG/HTML sources.
// Usage: node tools/render-art.mjs        (needs @playwright/test with Chromium installed)
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const art = join(root, 'art');
const brand = join(root, 'art', 'brand');
const url = (p) => pathToFileURL(p).href;
const PAPER = '#fff6e9';
mkdirSync(brand, { recursive: true });

const browser = await chromium.launch();
const tmp = mkdtempSync(join(tmpdir(), 'arghbox-art-'));
let n = 0;

/** Screenshots an HTML string (written to a temp file so file:// images load). */
async function shotHtml(html, w, h, scale, out, { transparent = true } = {}) {
  const f = join(tmp, `p${n++}.html`);
  writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>${html}`);
  return shotUrl(url(f), w, h, scale, out, { transparent });
}
async function shotUrl(u, w, h, scale, out, { transparent = true } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(u);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  if (out) writeFileSync(out, buf);
  return buf;
}
const svgSize = (file) => {
  const s = readFileSync(file, 'utf8');
  const m = s.match(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"[^>]*\sheight="(\d+(?:\.\d+)?)"/);
  if (!m) throw new Error('no width/height on ' + file);
  return [Math.round(+m[1]), Math.round(+m[2])];
};
/** Renders an SVG file to PNG at its intrinsic size times `scale`. */
async function svgToPng(svgFile, pngFile, scale = 2) {
  const [w, h] = svgSize(svgFile);
  await shotHtml(`<img src="${url(svgFile)}" width="${w}" height="${h}" style="display:block">`, w, h, scale, pngFile);
  console.log('  ', pngFile.replace(root, '.'), `${w * scale}x${h * scale}`);
}
/** Mark centred on a square canvas. kind: 'small' | 'full'. */
async function icon(size, out, { svgName, markFrac, bg = null, radius = 0 }) {
  const m = Math.round(size * markFrac);
  const html = `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg || 'transparent'};border-radius:${radius}px"><img src="${url(join(art, svgName))}" width="${m}" height="${m}"></div>`;
  const buf = await shotHtml(html, size, size, 1, out);
  if (out) console.log('  ', out.replace(root, '.'), `${size}x${size}`);
  return buf;
}

// ---- lockups, banner, diagram (SVG -> 2x PNG) ----
console.log('SVG -> PNG');
for (const name of ['logo-horizontal', 'logo-horizontal-dark', 'banner', 'how-it-works']) {
  await svgToPng(join(art, `${name}.svg`), join(art, `${name}.png`), 2);
}

// ---- favicons and app icons ----
console.log('Icons');
const png16 = await icon(16, null, { svgName: 'logo-mark-small.svg', markFrac: 1 });
const png32 = await icon(32, join(brand, 'favicon-32.png'), { svgName: 'logo-mark-small.svg', markFrac: 1 });
const png48 = await icon(48, null, { svgName: 'logo-mark-small.svg', markFrac: 1 });
writeFileSync(join(brand, 'favicon.ico'), buildIco([[16, png16], [32, png32], [48, png48]]));
console.log('   ./art/brand/favicon.ico 16+32+48');
await icon(180, join(brand, 'apple-touch-icon.png'), { svgName: 'logo-mark.svg', markFrac: 0.74, bg: PAPER });
await icon(192, join(brand, 'icon-192.png'), { svgName: 'logo-mark.svg', markFrac: 0.74, bg: PAPER, radius: 42 });
await icon(512, join(brand, 'icon-512.png'), { svgName: 'logo-mark.svg', markFrac: 0.74, bg: PAPER, radius: 112 });
await icon(512, join(brand, 'icon-maskable-512.png'), { svgName: 'logo-mark.svg', markFrac: 0.56, bg: PAPER });

// ---- social images ----
console.log('Social');
const social = url(join(art, 'src', 'social.html'));
await shotUrl(social, 1280, 640, 1, join(art, 'social-github.png'), { transparent: false });
await shotUrl(social, 1200, 630, 1, join(brand, 'og-image.png'), { transparent: false });
console.log('   ./art/social-github.png 1280x640, ./art/brand/og-image.png 1200x630');

await browser.close();
rmSync(tmp, { recursive: true, force: true });

/** ICO container with PNG-compressed images: 6-byte header, 16-byte entries, then the PNG data. */
function buildIco(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(([size, png]) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);       // palette size, reserved
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); // planes, bits per pixel
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map(([, p]) => p)]);
}
