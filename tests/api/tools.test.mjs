import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, writeConfig } from '../helpers/server.mjs';
import { startFakeTurnstile } from '../helpers/fake-turnstile.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';
import { seed } from '../../tools/seed.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('tools/new-secrets.mjs', () => {
  test('prints a secret, two tokens and matching sha256 values, and explains one-time display', () => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'new-secrets.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    const out = r.stdout;
    assert.match(out, /shown ONCE/i);
    const secret = out.match(/'secret' => '([0-9a-f]{64})'/)[1];
    const ownerHash = out.match(/'owner_token_sha256' => '([0-9a-f]{64})'/)[1];
    const triageHash = out.match(/'triage_token_sha256' => '([0-9a-f]{64})'/)[1];
    const owner = out.match(/Owner token[^\n]*:\s+(\S+)\s*$/m)[1];
    const triage = out.match(/Triage token[^\n]*:\s+(\S+)\s*$/m)[1];
    assert.equal(sha(owner), ownerHash);
    assert.equal(sha(triage), triageHash);
    assert.match(owner, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(owner, triage);
    assert.ok(secret);
    const again = spawnSync(process.execPath, [path.join(REPO, 'tools', 'new-secrets.mjs')], { encoding: 'utf8' }).stdout;
    assert.notEqual(again.match(/'secret' => '([0-9a-f]{64})'/)[1], secret);
  });
});

describe('tools/seed.mjs and the demo seed file', () => {
  test('seed.php refuses to run under a web SAPI', () => {
    const src = fs.readFileSync(path.join(REPO, 'tools', 'seed.php'), 'utf8');
    assert.match(src, /PHP_SAPI !== 'cli'/);
  });

  test('loads the demo seed with votes, statuses, tags, comments, merges and owner items', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-seed-'));
    const fake = await startFakeTurnstile();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    const ownerToken = 'owner-token-for-seed-test';
    const configPath = path.join(tmp, 'config.php');
    writeConfig(configPath, {
      site_name: 'Seed', secret: crypto.randomBytes(32).toString('hex'), owner_token_sha256: sha(ownerToken),
      turnstile_secret_key: 's', turnstile_site_key: 'k', turnstile_verify_url: fake.url, data_dir: dataDir, moderation: 'publish',
    });
    const file = path.join(REPO, 'tests', 'fixtures', 'demo-seed.json');
    const items = JSON.parse(fs.readFileSync(file, 'utf8'));
    const first = seed({ config: configPath, file });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).seeded, items.length);
    const second = seed({ config: configPath, file, ifEmpty: true });
    assert.equal(second.status, 0);
    assert.equal(JSON.parse(second.stdout).seeded, 0);

    // Serve the seeded data with a real php -S (reuse the helper with the same config).
    const { startPhpServer } = await import('../helpers/php.mjs');
    const { ARGHBOX_DIR } = await import('../helpers/server.mjs');
    const php = await startPhpServer({ docroot: ARGHBOX_DIR, env: { ARGHBOX_CONFIG: configPath } });
    try {
      const get = async (action, auth) => (await fetch(`${php.origin}/api.php?action=${action}`, { headers: auth ? { Authorization: `Bearer ${ownerToken}` } : {} })).json();
      const list = await get('list');
      const published = items.filter((i) => i.state === 'published');
      assert.equal(list.entries.length, published.length);
      assert.ok(list.entries.length >= 12);
      const dark = list.entries.find((e) => e.title.startsWith('Dark mode'));
      assert.equal(dark.status, 'planned');
      assert.equal(dark.votes, 41 + 5 + 3, 'merged entries move their votes to the target');
      assert.equal(dark.similar, 2);
      assert.deepEqual(dark.aliases.sort(), ['Night theme please', 'Tryb ciemny']);
      assert.ok(dark.comments.length >= 1);
      assert.ok(list.entries.every((e) => e.tags.length > 0), 'every entry has tags');
      assert.ok(list.entries.filter((e) => e.status === 'done').length >= 2);
      const declined = list.entries.filter((e) => e.status === 'declined');
      assert.equal(declined.length, 1);
      assert.ok(declined[0].comments[0].body.length > 40);
      assert.ok(list.entries.some((e) => e.source === 'owner'));
      assert.ok(!list.entries.some((e) => /Hostinger install guide/.test(e.title)), 'private owner items stay private');
      assert.ok(list.tag_counts.length > 3);
      const stats = await get('admin.stats', true);
      assert.equal(stats.counts.private, 1);
      assert.equal(stats.counts.merged, 2);
      const q = await get('admin.queue', true);
      assert.equal(q.private.length, 1);
    } finally {
      await php.stop();
      await fake.stop();
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file lock */ }
    }
  });

  test('seed.php reports problems with a bad file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-seed-'));
    const configPath = path.join(tmp, 'config.php');
    fs.mkdirSync(path.join(tmp, 'data'));
    writeConfig(configPath, { secret: 'a'.repeat(64), data_dir: path.join(tmp, 'data') });
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{"not":"a list"');
    const r = seed({ config: configPath, file: bad });
    assert.notEqual(r.status, 0);
    const r2 = spawnSync(phpPath(), phpArgs([path.join(REPO, 'tools', 'seed.php')]), { encoding: 'utf8', env: { ...process.env, ARGHBOX_CONFIG: configPath } });
    assert.equal(r2.status, 2, 'usage error without a file');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

describe('fake Turnstile server', () => {
  test('success unless the token starts with fail; records requests', async () => {
    const t = await startFakeTurnstile();
    try {
      const post = (response) => fetch(t.url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: 's', response, remoteip: '1.2.3.4' }) }).then((r) => r.json());
      assert.equal((await post('anything')).success, true);
      assert.equal((await post('fail-this')).success, false);
      assert.equal((await post('')).success, false);
      assert.equal(t.requests.length, 3);
      assert.equal(t.requests[0].remoteip, '1.2.3.4');
    } finally {
      await t.stop();
    }
  });
});

describe('dev router', () => {
  test('maps /arghbox/ to the arghbox folder, denies lib/data/config, serves a demo page', async () => {
    const { startPhpServer } = await import('../helpers/php.mjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-dev-'));
    const www = path.join(tmp, 'www');
    fs.mkdirSync(www);
    const php = await startPhpServer({ docroot: www, router: path.join(REPO, 'tools', 'dev-router.php'), env: { ARGHBOX_CONFIG: path.join(tmp, 'none.php') } });
    try {
      const health = await (await fetch(`${php.origin}/arghbox/api.php?action=health`)).json();
      assert.equal(health.config, 'missing', 'the router reaches api.php (no config here, so ok is false)');
      assert.equal(health.ok, false);
      for (const p of ['/arghbox/lib/db.php', '/arghbox/data/index.html', '/arghbox/config.example.php', '/arghbox/VERSION', '/arghbox/x.sqlite']) {
        assert.equal((await fetch(php.origin + p)).status, 403, p);
      }
      assert.equal((await fetch(`${php.origin}/arghbox/../tools/seed.php`)).status >= 400, true);
      const home = await (await fetch(`${php.origin}/`)).text();
      if (!fs.existsSync(path.join(REPO, 'demo', 'index.html'))) assert.match(home, /\/arghbox\/arghbox\.js/);
      assert.equal((await fetch(`${php.origin}/arghbox/api.php?action=list`)).status, 503, 'no config in this router test');
    } finally {
      await php.stop();
      // Windows may hold the folder for a moment after php exits: retry, and never fail a test over cleanup
      try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp folder is cleaned later */ }
    }
  });
});

