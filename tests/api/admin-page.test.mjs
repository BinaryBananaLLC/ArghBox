// Headers and shell of the admin page (arghbox/admin/index.php).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startArghBox, ARGHBOX_DIR } from '../helpers/server.mjs';

test('admin page: security headers, noindex, no inline script or style, relative URLs', async () => {
  const box = await startArghBox();
  try {
    const res = await fetch(`${box.url}admin/`);
    assert.equal(res.status, 200);
    const h = res.headers;
    assert.match(h.get('content-type'), /text\/html/);
    assert.match(h.get('cache-control'), /no-store/);
    assert.match(h.get('cache-control'), /no-transform/); // keeps Cloudflare from injecting its beacon
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.equal(h.get('content-security-policy'),
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
    assert.doesNotMatch(html, /<style|\sstyle=|\son\w+=/i);
    assert.match(html, /src="admin\.js"/);
    assert.match(html, /href="admin\.css"/);
    for (const f of ['admin.js', 'admin.css', 'logo.svg']) assert.equal((await fetch(`${box.url}admin/${f}`)).status, 200);
    assert.equal(fs.readFileSync(path.join(ARGHBOX_DIR, 'admin', 'logo.svg'), 'utf8').includes('ArghBox'), true);
    assert.doesNotMatch(fs.readFileSync(path.join(ARGHBOX_DIR, 'admin', 'admin.js'), 'utf8'), /innerHTML|insertAdjacentHTML|document\.write/);
  } finally {
    await box.stop();
  }
});
