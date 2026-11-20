// Captures the animated "machine" of arghbox.com into art/how-it-works.gif (about 10 fps, loops) and art/how-it-works.png (a still).
// Usage: npm install --no-save gifenc pngjs     (do not commit the package.json change)
//        node art/src/capture-machine.mjs [url]       default https://arghbox.com/
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { PNG } = require('pngjs');
const art = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'https://arghbox.com/';
const STILL_AT = 6500; // ms into the 10 s loop

async function frames(scale, times) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: scale, colorScheme: 'light' });
  await page.goto(url);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: '.machine-toggle{display:none!important}' });
  const el = page.locator('.machine-svg.machine-wide');
  await el.scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.__a = document.querySelector('.machine').getAnimations({ subtree: true }); window.__a.forEach((a) => a.pause()); });
  const out = [];
  for (const t of times) {
    // the short loops (bob, roll, twinkle) keep their own period; the 10 s story animations follow t
    await page.evaluate((t) => window.__a.forEach((a) => { const c = a.effect.getComputedTiming(); a.currentTime = c.duration < 10000 && !c.delay ? t % c.duration : t; }), t);
    out.push(await el.screenshot());
  }
  await browser.close();
  return out;
}

writeFileSync(join(art, 'how-it-works.png'), (await frames(2, [STILL_AT]))[0]);

const shots = (await frames(0.92, Array.from({ length: 101 }, (_, i) => i * 100))).map((b) => PNG.sync.read(b));
const { width: w, height: h } = shots[0];
const palette = quantize(Buffer.concat(shots.filter((_, i) => i % 5 === 0).map((p) => p.data)), 255, { format: 'rgb565' });
palette.push([255, 0, 255]); // slot 255: transparent (unchanged pixels)
const gif = GIFEncoder();
let prev = null;
shots.forEach((p, i) => {
  const idx = Uint8Array.from(applyPalette(p.data, palette.slice(0, 255), 'rgb565'));
  const frame = Uint8Array.from(idx);
  if (prev) for (let k = 0; k < frame.length; k++) if (frame[k] === prev[k]) frame[k] = 255;
  gif.writeFrame(frame, w, h, i === 0 ? { palette, delay: 100, repeat: 0 } : { delay: 100, transparent: true, transparentIndex: 255, dispose: 1 });
  prev = idx;
});
gif.finish();
writeFileSync(join(art, 'how-it-works.gif'), gif.bytes());
console.log(`how-it-works.gif ${w}x${h}, ${shots.length} frames, ${(gif.bytes().length / 1e6).toFixed(2)} MB`);
