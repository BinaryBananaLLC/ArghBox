import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARGHBOX_DIR, REPO, nextIp, startArghBox } from '../helpers/server.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';

describe('health and configuration', () => {
  let none;
  let box;
  before(async () => {
    none = await startArghBox({ noConfig: true });
    box = await startArghBox();
  });
  after(async () => {
    await none.stop();
    await box.stop();
  });

  test('health without config', async () => {
    const r = await none.call('health');
    assert.equal(r.status, 503, 'not ready to serve requests');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.config, 'missing');
    assert.ok(!('config_location' in r.json), 'anonymous callers do not learn where the config is');
    assert.equal(r.json.admin, false);
    assert.equal(r.json.turnstile, false);
    assert.match(r.json.version, /^\d+\.\d+\.\d+$/);
  });

  test('every other action answers 503 not_configured without config', async () => {
    for (const [action, opts] of [['list', {}], ['session', { body: {} }], ['add', { body: {} }], ['vote', { body: {} }], ['mine', { body: {} }], ['admin.me', {}]]) {
      const r = await none.call(action, opts);
      assert.equal(r.status, 503, action);
      assert.equal(r.json.error, 'not_configured', action);
    }
  });

  test('health with config reports status without leaking anything', async () => {
    const r = await box.call('health');
    assert.equal(r.status, 200);
    const j = r.json;
    assert.equal(j.config, 'found');
    assert.ok(!('config_location' in j));
    assert.equal(j.data_dir, 'outside_webroot');
    assert.equal(j.turnstile, true);
    assert.equal(j.admin, true);
    assert.equal(j.moderation, 'pending');
    assert.equal(j.ip_header, 'configured', 'anonymous callers only learn that a header is configured');
    assert.match(j.php, /^\d+\.\d+$/, 'major.minor only');
    const owner = (await box.call('health', { token: box.ownerToken })).json;
    assert.equal(owner.config_location, 'env');
    assert.equal(owner.ip_header, 'missing');
    assert.match(owner.php, /^\d+\.\d+\.\d+/);
    const withHeader = await box.call('health', { ip: '1.2.3.4', token: box.readToken });
    assert.equal(withHeader.json.ip_header, 'present');
    assert.ok(j.sqlite);
    for (const secret of [box.secret, box.ownerToken, box.triageToken, box.dataDir, box.tmp]) {
      assert.ok(!r.text.includes(secret), 'health leaks ' + secret.slice(0, 6));
    }
  });

  test('responses carry the required headers and only JSON', async () => {
    const r = await box.call('list');
    assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/i);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    for (const [action, method] of [['nope', 'GET'], ['', 'GET'], ['list', 'POST'], ['add', 'GET'], ['admin.nope', 'GET']]) {
      const x = await box.call(action, { method, body: method === 'POST' ? {} : undefined });
      assert.match(x.headers.get('content-type'), /application\/json/, action);
      assert.ok(x.json && x.json.ok === false, action);
    }
    assert.equal((await box.call('nope')).status, 404);
    assert.equal((await box.call('list', { method: 'POST', body: {} })).status, 405);
    assert.equal((await box.call('list', { method: 'POST', body: {} })).json.error, 'method_not_allowed');
  });

  test('list is empty on a fresh install', async () => {
    const r = await box.list();
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.entries, []);
    assert.deepEqual(r.json.voted, []);
    assert.deepEqual(r.json.tag_counts, []);
    assert.equal(r.json.site.name, 'Test Box');
    assert.equal(r.json.turnstile_site_key, 'site-key');
    assert.equal(r.json.moderation, 'pending');
    assert.equal(r.json.credit, true);
  });

  test('malformed JSON, wrong content type and oversized bodies are refused as JSON', async () => {
    const bad = await box.call('session', { method: 'POST', raw: '{nope' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'bad_request');
    const list = await box.call('session', { method: 'POST', raw: '[1,2]' });
    assert.equal(list.json.error, 'bad_request');
    const ct = await box.call('session', { method: 'POST', raw: '{"turnstile":"x"}', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(ct.json.error, 'bad_request');
    const big = await box.call('add', { method: 'POST', raw: JSON.stringify({ title: 'x'.repeat(20000) }) });
    assert.equal(big.status, 413);
    assert.equal(big.json.error, 'bad_request');
  });
});

describe('CORS', () => {
  let box;
  before(async () => { box = await startArghBox(); });
  after(async () => { await box.stop(); });

  test('allowed origin gets CORS headers and a 204 preflight', async () => {
    const r = await box.call('list', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(r.headers.get('vary') || '', /Origin/);
    const o = await box.call('add', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(o.status, 204);
    assert.equal(o.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(o.headers.get('access-control-allow-methods'), /POST/);
    assert.match(o.headers.get('access-control-allow-headers'), /X-ArghBox-Voter/i);
    assert.equal(o.headers.get('access-control-max-age'), '600');
  });

  test('refused origins: POST gets 403, GET gets no CORS headers, preflight refused', async () => {
    const evil = { Origin: 'https://evil.example' };
    const p = await box.call('session', { body: { turnstile: 'x' }, headers: evil });
    assert.equal(p.status, 403);
    assert.equal(p.json.error, 'origin_not_allowed');
    assert.equal(p.headers.get('access-control-allow-origin'), null);
    const g = await box.call('list', { headers: evil });
    assert.equal(g.headers.get('access-control-allow-origin'), null);
    const o = await box.call('add', { method: 'OPTIONS', headers: evil });
    assert.equal(o.status, 403);
  });

  test('an allowed_origins entry ending in ":*" allows that scheme and host on any port, nothing else', async () => {
    const dev = await startArghBox({ config: { allowed_origins: ['http://localhost:*', 'http://127.0.0.1:*'] } });
    try {
      for (const origin of ['http://localhost:5174', 'http://localhost:3000', 'http://localhost', 'http://127.0.0.1:5500']) {
        const r = await dev.call('list', { headers: { Origin: origin } });
        assert.equal(r.headers.get('access-control-allow-origin'), origin, origin);
        const o = await dev.call('add', { method: 'OPTIONS', headers: { Origin: origin } });
        assert.equal(o.status, 204, origin);
      }
      for (const origin of ['https://localhost:5174', 'http://localhost.evil.example', 'http://localhost:5174.evil.example', 'http://evil.localhost:5174', 'http://127.0.0.10:80']) {
        const p = await dev.call('session', { body: { turnstile: 'x' }, headers: { Origin: origin } });
        assert.equal(p.status, 403, origin);
        assert.equal(p.json.error, 'origin_not_allowed', origin);
        const g = await dev.call('list', { headers: { Origin: origin } });
        assert.equal(g.headers.get('access-control-allow-origin'), null, origin);
      }
    } finally {
      await dev.stop();
    }
  });

  test('same origin always works', async () => {
    const origin = new URL(box.url).origin;
    const r = await box.call('session', { body: { turnstile: 'good' }, headers: { Origin: origin }, ip: nextIp() });
    assert.equal(r.status, 200);
  });

  test('admin actions never send CORS headers and refuse foreign origins', async () => {
    const r = await box.admin('admin.me', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const p = await box.admin('admin.update', { body: { id: 1 }, headers: { Origin: 'http://localhost:5173' } });
    assert.equal(p.status, 403);
    const o = await box.call('admin.me', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(o.status, 204);
    assert.equal(o.headers.get('access-control-allow-origin'), null);
  });
});

describe('server errors and file protection', () => {
  test('a broken database becomes a clean server_error and is logged privately', async () => {
    const box = await startArghBox();
    try {
      fs.writeFileSync(path.join(box.dataDir, 'arghbox.sqlite'), 'this is not a database, it is a secret-ish file');
      const r = await box.list();
      assert.equal(r.status, 500);
      assert.equal(r.json.error, 'server_error');
      for (const leak of [box.dataDir, box.tmp, 'sqlite', box.secret, '.php', 'Stack']) {
        assert.ok(!r.text.includes(leak), 'response leaks ' + leak);
      }
      assert.ok(fs.existsSync(path.join(box.dataDir, 'error.log')), 'error.log exists');
      assert.match(fs.readFileSync(path.join(box.dataDir, 'error.log'), 'utf8'), /PDOException|SQLSTATE|not a database/i);
    } finally {
      await box.stop();
    }
  });

  test('.htaccess files deny lib/, data/, config, version and sqlite files', () => {
    const root = fs.readFileSync(path.join(ARGHBOX_DIR, '.htaccess'), 'utf8');
    assert.match(root, /Options -Indexes/);
    assert.match(root, /config/);
    assert.match(root, /\\\.sqlite/);
    assert.match(root, /VERSION/);
    assert.match(root, /Require all denied/);
    assert.match(root, /IfModule !mod_authz_core\.c/);
    assert.match(root, /Cache-Control "public, max-age=3600"/);
    assert.match(root, /HTTP_AUTHORIZATION/);
    for (const dir of ['lib', 'data']) {
      const f = fs.readFileSync(path.join(ARGHBOX_DIR, dir, '.htaccess'), 'utf8');
      assert.match(f, /Require all denied/, dir);
      assert.match(f, /IfModule !mod_authz_core\.c/, dir);
      assert.match(f, /Deny from all/, dir);
    }
    assert.equal(fs.readFileSync(path.join(ARGHBOX_DIR, 'data', 'index.html'), 'utf8'), '');
  });

  test('lib files print nothing when requested directly (php -S ignores .htaccess)', async () => {
    const box = await startArghBox();
    try {
      for (const f of fs.readdirSync(path.join(ARGHBOX_DIR, 'lib')).filter((x) => x.endsWith('.php'))) {
        const res = await fetch(`${box.url}lib/${f}`);
        assert.equal(await res.text(), '', f);
      }
      const cfg = await fetch(`${box.url}config.example.php`);
      assert.equal(await cfg.text(), '', 'config.example.php only returns an array, prints nothing');
    } finally {
      await box.stop();
    }
  });
});

describe('versions and syntax', () => {
  test('VERSION, version.php and package.json agree', () => {
    const v = fs.readFileSync(path.join(ARGHBOX_DIR, 'VERSION'), 'utf8').trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    const php = fs.readFileSync(path.join(ARGHBOX_DIR, 'lib', 'version.php'), 'utf8').match(/ARGHBOX_VERSION = '([^']+)'/)[1];
    assert.equal(php, v);
    assert.equal(pkg, v);
  });

  test('php -l passes on every PHP file we own', () => {
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (['node_modules', '.git', '.dev', 'website', 'e2e', 'dist'].includes(e.name)) continue;
          walk(p);
        } else if (e.name.endsWith('.php')) files.push(p);
      }
    };
    walk(ARGHBOX_DIR);
    walk(path.join(REPO, 'tools'));
    assert.ok(files.length >= 10);
    for (const f of files) {
      const r = spawnSync(phpPath(), phpArgs(['-l', f]), { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stdout}${r.stderr}`);
    }
  });

  test('no PHP 8.2+ only syntax sneaks in', () => {
    const banned = [/\breadonly\s+class\b/, /json_validate\(/, /#\[\\?SensitiveParameter\]/, /\|>/, /\bconst\s+(?:string|int|array|bool)\s+[A-Z_]+\s*=/];
    const dirs = [path.join(ARGHBOX_DIR, 'lib'), path.join(REPO, 'tools')];
    for (const d of dirs) {
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.php'))) {
        const src = fs.readFileSync(path.join(d, f), 'utf8');
        for (const re of banned) assert.ok(!re.test(src), `${f} matches ${re}`);
      }
    }
  });
});
