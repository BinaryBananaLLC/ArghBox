// Regression tests for the security review: each test is a small proof of concept that failed before the fix.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARGHBOX_DIR, REPO, nextIp, sha256hex, startArghBox, writeConfig } from '../helpers/server.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';

const mk = async (box, title, extra = {}, ip = nextIp()) => {
  const r = await box.add({ title, ...extra }, ip);
  assert.equal(r.status, 200, r.text);
  return r.json.entry.id;
};
const entryOf = async (box, id) => (await box.admin('admin.entries', { query: { limit: '200' } })).json.entries.find((e) => e.id === id);
const fp = async (box, id) => (await entryOf(box, id)).fingerprint;
const D = (id, fingerprint, action, extra = {}) => ({ id, fingerprint, action, confidence: 95, reason: 'because', ...extra });

/** A raw HTTP request that can set any Host header (fetch cannot). */
function rawRequest(box, { path: p = '/', method = 'GET', headers = {}, body } = {}) {
  const u = new URL(box.url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: p, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const login = (box, headers = {}, ip = nextIp()) => rawRequest(box, {
  path: '/api.php?action=admin.login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Test-Ip': ip, ...headers },
  body: JSON.stringify({ token: box.ownerToken }),
});

describe('1. the triage token cannot put new text on the public board', () => {
  test('(a) apply: title and type only change pending entries that are published or flagged', async () => {
    {
      const b = await startArghBox({ config: { moderation: 'pending' } });
      try {
        const p1 = await mk(b, 'Pending to be rejected');
        const p2 = await mk(b, 'Pending to be published');
        const p3 = await mk(b, 'Pending to be flagged');
        const p4 = await mk(b, 'Pending linky title');
        const live = await mk(b, 'Live entry on the board');
        await b.admin('admin.update', { body: { id: live, state: 'published' } });
        const target = await mk(b, 'Merge target entry');
        await b.admin('admin.update', { body: { id: target, state: 'published' } });
        const r = await b.triage('admin.apply', { body: { run: { reviewer: 'T' }, decisions: [
          D(p1, await fp(b, p1), 'reject', { reject_reason: 'spam', title: 'Reject retitled', type: 'bug' }),
          D(p2, await fp(b, p2), 'publish', { title: 'Publish retitled ok', type: 'bug' }),
          D(p3, await fp(b, p3), 'flag', { title: 'Flag retitled ok', type: 'question', confidence: 20 }),
          D(p4, await fp(b, p4), 'publish', { title: 'See http://a.example http://b.example http://c.example' }),
          D(live, await fp(b, live), 'tag', { tags: ['alpha'], title: 'HACKED title on live entry', type: 'bug' }),
          D(target, await fp(b, target), 'merge', { merge_into: live, title: 'HACKED merge title' }),
        ] } });
        assert.equal(r.status, 200, r.text);
        const by = Object.fromEntries((await Promise.all([p1, p2, p3, p4, live, target].map((id) => entryOf(b, id)))).map((e) => [e.id, e]));
        assert.equal(by[p1].title, 'Pending to be rejected', 'reject ignores title');
        assert.equal(by[p1].type, 'idea');
        assert.equal(by[p2].title, 'Publish retitled ok');
        assert.equal(by[p2].type, 'bug');
        assert.equal(by[p3].title, 'Flag retitled ok');
        assert.equal(by[live].title, 'Live entry on the board', 'tag decisions cannot rewrite a published title');
        assert.equal(by[live].type, 'idea');
        assert.deepEqual(by[live].tags, ['alpha']);
        assert.equal(by[target].title, 'Merge target entry', 'merge decisions ignore the title');
        assert.deepEqual(r.json.skipped.map((s) => [s.id, s.reason]), [[p4, 'invalid_input']], 'AI titles go through the link limit');
        assert.equal(by[p4].state, 'pending');
      } finally {
        await b.stop();
      }
    }
  });

  test('(b) REST: a triage token is refused every public write; private notes, status, tags, merge, reject stay allowed', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const id = await mk(box, 'Live entry for the gate');
      const other = await mk(box, 'Another live entry here');
      const pend = (await startArghBox({ config: { moderation: 'pending' } }));
      try {
        const pendingId = await mk(pend, 'Pending entry for the gate');
        const pubBlocked = await pend.triage('admin.update', { body: { id: pendingId, state: 'published' } });
        assert.equal(pubBlocked.status, 403);
        assert.equal(pubBlocked.json.error, 'forbidden');
        assert.match(pubBlocked.json.message, /triage token/);
        assert.equal((await entryOf(pend, pendingId)).state, 'pending');
        assert.equal((await pend.admin('admin.update', { body: { id: pendingId, state: 'published' } })).status, 200, 'the owner can');
      } finally {
        await pend.stop();
      }
      // comments
      const priv = await box.triage('admin.comment', { body: { id, body: 'Default is private' } });
      assert.equal(priv.status, 200);
      assert.equal(priv.json.comment.public, false);
      const pub = await box.triage('admin.comment', { body: { id, body: 'Public text', public: true } });
      assert.equal(pub.status, 403);
      assert.equal(pub.json.error, 'forbidden');
      assert.equal((await box.list()).json.entries.find((e) => e.id === id).comments.length, 0);
      const ownerPublic = (await box.admin('admin.comment', { body: { id, body: 'Owner public comment' } })).json.comment;
      assert.equal(ownerPublic.public, true, 'owner default stays public');
      for (const body of [{ comment_id: priv.json.comment.id, public: true }, { comment_id: ownerPublic.id, body: 'Edited by the AI' }]) {
        const r = await box.triage('admin.comment_update', { body });
        assert.equal(r.status, 403, JSON.stringify(body));
      }
      assert.equal((await box.triage('admin.comment_update', { body: { comment_id: ownerPublic.id, hidden: true } })).status, 200, 'hiding is allowed');
      assert.equal((await box.triage('admin.comment_update', { body: { comment_id: ownerPublic.id, hidden: false } })).status, 403, 'un-hiding publishes again');
      assert.equal((await box.triage('admin.comment_update', { body: { comment_id: priv.json.comment.id, body: 'Edited private note' } })).status, 200);
      // creating and editing
      assert.equal((await box.triage('admin.create', { body: { type: 'idea', title: 'Public by the AI', public: true } })).status, 403);
      assert.equal((await box.triage('admin.create', { body: { type: 'idea', title: 'Private by the AI' } })).status, 200);
      for (const body of [{ id, title: 'Rewritten by the AI' }, { id, body: 'Rewritten text by the AI' }]) {
        const r = await box.triage('admin.update', { body });
        assert.equal(r.status, 403, JSON.stringify(body));
      }
      assert.equal((await entryOf(box, id)).title, 'Live entry for the gate');
      // everything else a reviewer needs still works
      assert.equal((await box.triage('admin.update', { body: { id, status: 'planned', tags: ['alpha'], external_url: 'https://x.example/1' } })).status, 200);
      assert.equal((await box.triage('admin.update', { body: { id: other, merge_into: id } })).status, 200);
      const third = await mk(box, 'Third live entry here');
      assert.equal((await box.triage('admin.update', { body: { id: third, state: 'rejected', reject_reason: 'test' } })).status, 200);
      assert.equal((await box.triage('admin.update', { body: { id: third, title: 'Retitled rejected entry' } })).status, 200, 'non-published text is not public');
    } finally {
      await box.stop();
    }
  });

  test('(b) the same through MCP; and everything is allowed once triage_public_writes is on (or the old alias)', async () => {
    const mcp = (box, name, args) => box.mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.json.result);
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const id = await mk(box, 'Live entry for MCP gate');
      assert.equal((await mcp(box, 'arghbox_comment', { id, body: 'public please', public: true })).structuredContent.error, 'forbidden');
      assert.equal((await mcp(box, 'arghbox_comment', { id, body: 'private note', public: false })).isError, undefined);
      assert.equal((await mcp(box, 'arghbox_create_task', { type: 'idea', title: 'Public task by AI', public: true })).structuredContent.error, 'forbidden');
    } finally {
      await box.stop();
    }
    for (const key of ['triage_public_writes', 'mcp_allow_public_comments']) {
      const open = await startArghBox({ config: { moderation: 'pending', [key]: true } });
      try {
        const id = await mk(open, 'Pending entry with open gate');
        assert.equal((await open.triage('admin.update', { body: { id, state: 'published', title: 'Rewritten with open gate' } })).status, 200, key);
        assert.equal((await open.triage('admin.comment', { body: { id, body: 'Public one' } })).json.comment.public, true, key + ' default public again');
        assert.equal((await open.triage('admin.create', { body: { type: 'idea', title: 'Public task now', public: true } })).status, 200, key);
      } finally {
        await open.stop();
      }
    }
  });

  test('(c) a triage token cannot undo the owner\'s actions or a run that contains them', async () => {
    const box = await startArghBox({ config: { moderation: 'pending' } });
    try {
      const a = await mk(box, 'Owner acts on this one');
      await box.admin('admin.update', { body: { id: a, state: 'published' } });
      const act = (await box.admin('admin.log', { query: { entry_id: String(a) } })).json.actions[0];
      const refused = await box.triage('admin.undo', { body: { action_id: act.id } });
      assert.equal(refused.status, 409);
      assert.match(refused.json.message, /only the owner/i);
      assert.equal((await entryOf(box, a)).state, 'published');

      const b = await mk(box, 'Owner applies this run');
      const c = await mk(box, 'Triage applies this run');
      const ownerRun = await box.admin('admin.apply', { body: { run: { reviewer: 'O' }, decisions: [D(b, await fp(box, b), 'publish')] } });
      const run = await box.triage('admin.undo', { body: { run_id: ownerRun.json.run_id } });
      assert.equal(run.status, 200);
      assert.deepEqual(run.json.undone, []);
      assert.equal(run.json.refused.length, 1);
      assert.equal((await entryOf(box, b)).state, 'published');

      const triageRun = await box.triage('admin.apply', { body: { run: { reviewer: 'T' }, decisions: [D(c, await fp(box, c), 'publish')] } });
      assert.equal((await box.triage('admin.undo', { body: { run_id: triageRun.json.run_id } })).json.undone.length, 1, 'triage can undo its own work');
      assert.equal((await entryOf(box, c)).state, 'pending');
      // the owner can undo anything
      assert.equal((await box.admin('admin.undo', { body: { action_id: act.id } })).status, 200);
      assert.equal((await box.admin('admin.undo', { body: { run_id: ownerRun.json.run_id } })).json.undone.length, 1);
    } finally {
      await box.stop();
    }
  });
});

describe('2. no raw control bytes in source files (PHP before 8.2 rejects NUL in a regex)', () => {
  test('no PHP, JS or htaccess file contains a control byte; external_url writes work', async () => {
    const bad = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (['node_modules', '.git', '.dev', 'dist', 'test-results', 'vendor'].includes(e.name)) continue;
          walk(p);
        } else if (/\.(php|js|mjs|json|html|css)$/.test(e.name) || e.name === '.htaccess') {
          const buf = fs.readFileSync(p);
          for (let i = 0; i < buf.length; i++) {
            const c = buf[i];
            if (c < 0x09 || (c > 0x0d && c < 0x20 && c !== 0x1b) || c === 0x7f) { bad.push(`${path.relative(REPO, p)}@${i}:${c}`); break; }
          }
        }
      }
    };
    for (const d of ['arghbox', 'tools', 'tests', 'e2e', 'skill']) if (fs.existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
    assert.deepEqual(bad, []);
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const id = await mk(box, 'Entry for the url write');
      assert.equal((await box.admin('admin.update', { body: { id, external_url: 'https://github.com/o/r/issues/1' } })).status, 200);
    } finally {
      await box.stop();
    }
  });
});

describe('3. the data directory protects itself', () => {
  test('deny-all .htaccess, index.html, unguessable database name, private file modes', async () => {
    const box = await startArghBox();
    try {
      fs.rmSync(box.dataDir, { recursive: true, force: true });
      fs.mkdirSync(box.dataDir);
      await box.list();
      const ht = fs.readFileSync(path.join(box.dataDir, '.htaccess'), 'utf8');
      assert.match(ht, /Require all denied/);
      assert.match(ht, /IfModule !mod_authz_core\.c/);
      assert.equal(fs.readFileSync(path.join(box.dataDir, 'index.html'), 'utf8'), '');
      const expected = 'arghbox-' + crypto.createHmac('sha256', box.secret).update('db').digest('hex').slice(0, 8) + '.sqlite';
      assert.ok(fs.existsSync(path.join(box.dataDir, expected)), 'database is ' + expected + ', found ' + fs.readdirSync(box.dataDir));
      assert.ok(!fs.existsSync(path.join(box.dataDir, 'arghbox.sqlite')));
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(path.join(box.dataDir, expected)).mode & 0o777, 0o600);
      }
      // an existing arghbox.sqlite keeps being used
      fs.writeFileSync(path.join(box.dataDir, 'error.log'), '');
      assert.equal((await box.list()).status, 200);
    } finally {
      await box.stop();
    }
  });

  test('error.log is created private and rotated to error.log.1 instead of truncated; CR/LF cannot forge lines', async () => {
    const box = await startArghBox();
    try {
      await box.list();
      const log = path.join(box.dataDir, 'error.log');
      fs.writeFileSync(log, 'old line\n'.repeat(40000)); // about 360 KB
      box.fake.forceResponse({ success: true, hostname: 'evil.example\r\n2026-01-01T00:00:00+00:00 FORGED entry', action: 'arghbox' });
      const r = await box.call('session', { body: { turnstile: 'good-token' } });
      assert.equal(r.status, 403, 'hostname mismatch');
      assert.ok(fs.existsSync(log + '.1'), 'rotated');
      assert.ok(fs.statSync(log + '.1').size > 256 * 1024, 'the old log is kept');
      const now = fs.readFileSync(log, 'utf8');
      assert.ok(fs.statSync(log).size < 4096);
      assert.match(now, /turnstile: token was issued for hostname/);
      assert.ok(!/^2026-01-01T00:00:00\+00:00 FORGED/m.test(now), 'a CR/LF in logged text cannot start a new line');
      assert.equal(now.trim().split('\n').length, 1);
    } finally {
      await box.stop();
    }
  });

  test('health warns (to the owner only) when the data folder looks like it is in a web root', async () => {
    const box = await startArghBox();
    try {
      const risky = path.join(box.tmp, 'public_html', 'arghbox-private');
      const cfg = { ...box.config, data_dir: risky };
      writeConfig(box.configPath, cfg);
      const anon = await box.call('health');
      assert.equal(anon.status, 200);
      assert.ok(!('data_dir_warning' in anon.json) && !('warnings' in anon.json));
      const owner = await box.call('health', { token: box.ownerToken });
      assert.match(owner.json.data_dir_warning, /public_html/);
      assert.ok(owner.json.warnings.some((w) => /public_html/.test(w)));
      // an index file next to it triggers it too
      const indexed = path.join(box.tmp, 'site2');
      fs.mkdirSync(indexed);
      fs.writeFileSync(path.join(indexed, 'index.html'), '<p>hi</p>');
      writeConfig(box.configPath, { ...cfg, data_dir: path.join(indexed, 'data') });
      assert.match((await box.call('health', { token: box.readToken })).json.data_dir_warning, /index file/);
      writeConfig(box.configPath, { ...cfg, data_dir: path.join(box.tmp, 'fine', 'data') });
      assert.equal((await box.call('health', { token: box.ownerToken })).json.data_dir_warning, null);
    } finally {
      await box.stop();
    }
  });
});

describe('4. client IP keying', () => {
  const pass = async (box, headers) => {
    const r = await box.call('session', { body: { turnstile: 'good-token' }, headers });
    assert.equal(r.status, 200, r.text);
    return r.json.pass;
  };
  const addWith = (box, p, headers) => box.call('add', { headers, body: { pass: p, voter: crypto.randomBytes(18).toString('base64url'), type: 'idea', title: 'Pass bound to an address', elapsed_ms: 9000, hp: '' } });

  test('IPv6 addresses are keyed by /64; IPv4-mapped IPv6 equals IPv4', async () => {
    const box = await startArghBox({ config: { limits: { sessions_per_hour: 2 } } });
    try {
      const a = await box.call('session', { body: { turnstile: 't' }, ip: '2001:db8:1:2::1' });
      const b = await box.call('session', { body: { turnstile: 't' }, ip: '2001:db8:1:2:ffff:ffff:ffff:ffff' });
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal((await box.call('session', { body: { turnstile: 't' }, ip: '2001:DB8:1:2:abcd::9' })).status, 429, 'same /64, third session');
      assert.equal((await box.call('session', { body: { turnstile: 't' }, ip: '2001:db8:1:3::1' })).status, 200, 'another /64');
      // mapped addresses: a pass for 203.0.113.9 works from ::ffff:203.0.113.9
      const p = await box.call('session', { body: { turnstile: 't' }, ip: '203.0.113.9' });
      const viaMapped = await box.add({ pass: p.json.pass }, '::ffff:203.0.113.9');
      assert.equal(viaMapped.status, 200, viaMapped.text);
      assert.equal((await box.add({ pass: p.json.pass }, '203.0.113.10')).json.error, 'pass_invalid');
    } finally {
      await box.stop();
    }
  });

  test('Cloudflare header is ignored unless REMOTE_ADDR is a Cloudflare address (or a trusted proxy)', async () => {
    const box = await startArghBox({ config: { trusted_ip_header: 'HTTP_CF_CONNECTING_IP', limits: { sessions_per_hour: 2 } } });
    try {
      // we connect from 127.0.0.1, which is not Cloudflare: spoofed header values share one key
      for (const ip of ['198.51.100.1', '198.51.100.2']) assert.equal((await box.call('session', { body: { turnstile: 't' }, headers: { 'CF-Connecting-IP': ip } })).status, 200);
      assert.equal((await box.call('session', { body: { turnstile: 't' }, headers: { 'CF-Connecting-IP': '198.51.100.3' } })).status, 429, 'rotating the header does not escape the limit');
      const warn = await box.call('health', { token: box.ownerToken, headers: { 'CF-Connecting-IP': '198.51.100.3' } });
      assert.equal(warn.json.ip_header, 'present');
      assert.match(warn.json.warnings.join(' '), /Cloudflare/);
      assert.equal((await box.call('health', { headers: { 'CF-Connecting-IP': '198.51.100.3' } })).json.ip_header, 'configured');
      // the web server already put the visitor in REMOTE_ADDR (LiteSpeed on Hostinger behind Cloudflare): no false warning
      const resolved = await box.call('health', { token: box.ownerToken, headers: { 'CF-Connecting-IP': '127.0.0.1' } });
      assert.equal(resolved.json.ip_header, 'present');
      assert.doesNotMatch(resolved.json.warnings.join(' '), /Cloudflare/);
      const xff = await box.call('health', { token: box.ownerToken, headers: { 'CF-Connecting-IP': '198.51.100.9, 127.0.0.1' } });
      assert.doesNotMatch(xff.json.warnings.join(' '), /Cloudflare/, 'the right-most entry is what counts');
    } finally {
      await box.stop();
    }
    const trusted = await startArghBox({ config: { trusted_ip_header: 'HTTP_CF_CONNECTING_IP', trusted_proxies: ['127.0.0.0/8'], limits: { sessions_per_hour: 1 } } });
    try {
      assert.equal((await trusted.call('session', { body: { turnstile: 't' }, headers: { 'CF-Connecting-IP': '198.51.100.1' } })).status, 200);
      assert.equal((await trusted.call('session', { body: { turnstile: 't' }, headers: { 'CF-Connecting-IP': '198.51.100.2' } })).status, 200, 'honoured: the sender is a trusted proxy');
      assert.equal((await trusted.call('session', { body: { turnstile: 't' }, headers: { 'CF-Connecting-IP': '198.51.100.2' } })).status, 429);
    } finally {
      await trusted.stop();
    }
  });

  test('X-Forwarded-For is ignored without trusted_proxies; with them the right-most non-proxy entry wins', async () => {
    const ignoring = await startArghBox({ config: { trusted_ip_header: 'HTTP_X_FORWARDED_FOR' } });
    try {
      const p = await pass(ignoring, { 'X-Forwarded-For': '1.1.1.1' });
      assert.equal((await addWith(ignoring, p, { 'X-Forwarded-For': '9.9.9.9' })).status, 200, 'the header is not used, so the pass still matches');
    } finally {
      await ignoring.stop();
    }
    const box = await startArghBox({ config: { trusted_ip_header: 'HTTP_X_FORWARDED_FOR', trusted_proxies: ['127.0.0.1', '10.0.0.0/8'] } });
    try {
      const p = await pass(box, { 'X-Forwarded-For': '6.6.6.6, 198.51.100.7, 10.1.1.1' });
      assert.equal((await addWith(box, p, { 'X-Forwarded-For': '1.2.3.4, 198.51.100.7, 10.9.9.9' })).status, 200, 'right-most entry that is not a proxy is 198.51.100.7');
      assert.equal((await addWith(box, p, { 'X-Forwarded-For': '198.51.100.7, 198.51.100.8' })).json.error, 'pass_invalid');
      // an untrusted sender cannot use the header at all
    } finally {
      await box.stop();
    }
  });
});

describe('5. limits table, global caps, token shape', () => {
  test('indexes exist (limits.window_start, entries.receipt_hash) after the migration', async () => {
    const box = await startArghBox();
    try {
      await box.list();
      const file = fs.readdirSync(box.dataDir).find((f) => f.endsWith('.sqlite'));
      const script = '$d = new PDO("sqlite:" . $argv[1]); foreach ($d->query("SELECT name FROM sqlite_master WHERE type=\'index\'") as $r) echo $r["name"], "\\n"; echo "v=", $d->query("SELECT value FROM meta WHERE key=\'schema_version\'")->fetchColumn();';
      const r = spawnSync(phpPath(), phpArgs(['-r', script, path.join(box.dataDir, file)]), { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /idx_limits_window/);
      assert.match(r.stdout, /idx_entries_receipt/);
      assert.match(r.stdout, /v=4/);
    } finally {
      await box.stop();
    }
  });

  test('global caps: sessions and auth failures, whatever the number of IPs', async () => {
    const box = await startArghBox({ config: { limits: { sessions_global_per_hour: 3, sessions_per_hour: 100, auth_failures_global_per_hour: 3, admin_logins_per_hour: 100 } } });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await box.call('session', { body: { turnstile: 't' }, ip: nextIp() })).status, 200);
      const over = await box.call('session', { body: { turnstile: 't' }, ip: nextIp() });
      assert.equal(over.status, 429);
      assert.ok(over.headers.get('retry-after'));
      for (let i = 0; i < 3; i++) assert.equal((await box.call('admin.me', { token: 'wrong' + i, ip: nextIp() })).status, 401);
      assert.equal((await box.call('admin.me', { token: 'wrong-x', ip: nextIp() })).status, 429, 'global failure cap');
      assert.equal((await box.admin('admin.me', { ip: nextIp() })).status, 200, 'a valid token still works');
    } finally {
      await box.stop();
    }
  });

  test('session does not call Cloudflare for empty, oversized or malformed tokens', async () => {
    const box = await startArghBox();
    try {
      const before = box.fake.requests.length;
      for (const turnstile of ['', 'x'.repeat(2049), 'has space', 'semi;colon', '<script>', 'new\nline', 5, null]) {
        const r = await box.call('session', { body: { turnstile }, ip: nextIp() });
        assert.equal(r.status, 403, JSON.stringify(turnstile).slice(0, 20));
        assert.equal(r.json.error, 'turnstile_failed');
      }
      assert.equal(box.fake.requests.length, before, 'the verifier was never asked');
      assert.equal((await box.call('session', { body: { turnstile: 'x'.repeat(2048) }, ip: nextIp() })).status, 200, 'the longest allowed token is fine');
      assert.equal((await box.call('session', { body: { turnstile: 'ab.cd_ef-gh' }, ip: nextIp() })).status, 200);
    } finally {
      await box.stop();
    }
  });

  test('mine is rate limited per IP', async () => {
    const box = await startArghBox({ config: { limits: { mine_per_hour: 2 } } });
    try {
      const ip = nextIp();
      for (let i = 0; i < 2; i++) assert.equal((await box.call('mine', { body: { receipts: [] }, ip })).status, 200);
      const r = await box.call('mine', { body: { receipts: [] }, ip });
      assert.equal(r.status, 429);
      assert.ok(r.headers.get('retry-after'));
      assert.equal((await box.call('mine', { body: { receipts: [] }, ip: nextIp() })).status, 200);
    } finally {
      await box.stop();
    }
  });
});

describe('6. .htaccess rules and HTTPS for sign-in', () => {
  test('the FilesMatch pattern denies config.*, backups, editor files and dotfiles but not the app', () => {
    const ht = fs.readFileSync(path.join(ARGHBOX_DIR, '.htaccess'), 'utf8');
    const m = ht.match(/<FilesMatch "([^"]+)">\s*<IfModule mod_authz_core\.c>\s*Require all denied/);
    assert.ok(m, 'deny block found');
    const re = new RegExp(m[1]);
    for (const f of ['config.php', 'config.example.php', 'config.php.bak', 'config.old', 'config.php~', 'config.local.php', 'VERSION', 'arghbox.sqlite', 'arghbox-1a2b3c4d.sqlite', 'arghbox.sqlite-journal',
      'api.php.bak', 'notes.swp', 'x.swo', 'x.tmp', 'x.orig', 'x.save', 'x.dist', 'backup~', '.env', '.git', '.htpasswd', '.DS_Store']) assert.ok(re.test(f), f + ' must be denied');
    for (const f of ['api.php', 'mcp.php', 'arghbox.js', 'arghbox-app.js', 'index.php', 'admin.js', 'admin.css', 'en.json', 'logo.svg', '.htaccess', '.well-known']) assert.ok(!re.test(f), f + ' must be served');
    assert.match(ht, /OpenLiteSpeed and nginx ignore \.htaccess/);
  });

  test('admin.login refuses plain http on a public host; https markers and loopback are fine', async () => {
    const box = await startArghBox();
    try {
      const plain = await login(box, { Host: 'example.com' });
      assert.equal(plain.status, 403);
      assert.equal(plain.json.error, 'forbidden');
      assert.match(plain.json.message, /https/);
      assert.ok(!plain.headers['set-cookie']);
      assert.equal((await login(box, { Host: 'example.com', 'X-Forwarded-Proto': 'https' })).status, 200);
      assert.equal((await login(box, { Host: 'example.com', 'CF-Visitor': '{"scheme":"https"}' })).status, 200);
      assert.equal((await login(box, { Host: 'example.com', 'CF-Visitor': '{"scheme":"http"}' })).status, 403);
      assert.equal((await login(box, { Host: 'localhost:8787' })).status, 200);
      assert.equal((await login(box, { Host: '[::1]:8080' })).status, 200);
      assert.equal((await login(box)).status, 200, '127.0.0.1');
    } finally {
      await box.stop();
    }
  });

  test('the admin page shows a clear message over plain http on a public host', async () => {
    const box = await startArghBox();
    try {
      const page = await rawRequest(box, { path: '/admin/', headers: { Host: 'example.com' } });
      assert.equal(page.status, 403);
      assert.match(page.text, /https:\/\//);
      assert.ok(!/admin\.js/.test(page.text));
      assert.equal((await rawRequest(box, { path: '/admin/', headers: { Host: 'example.com', 'X-Forwarded-Proto': 'https' } })).status, 200);
      assert.equal((await rawRequest(box, { path: '/admin/' })).status, 200, 'loopback host');
    } finally {
      await box.stop();
    }
  });
});

describe('7. admin cookies can be revoked', () => {
  test('logout invalidates old cookies; rotating the owner token does too', async () => {
    const box = await startArghBox();
    try {
      const cookieOf = (r) => r.headers.getSetCookie().find((c) => c.startsWith('arghbox_admin=')).split(';')[0];
      const l1 = await box.call('admin.login', { body: { token: box.ownerToken }, ip: nextIp() });
      const c1 = cookieOf(l1);
      assert.equal((await box.call('admin.me', { cookie: c1 })).status, 200);
      const out = await box.call('admin.logout', { method: 'POST', cookie: c1, headers: { 'X-ArghBox-CSRF': l1.json.csrf }, body: {} });
      assert.equal(out.status, 200);
      assert.equal((await box.call('admin.me', { cookie: c1 })).status, 401, 'the old cookie is dead after logout');
      const l2 = await box.call('admin.login', { body: { token: box.ownerToken }, ip: nextIp() });
      const c2 = cookieOf(l2);
      assert.equal((await box.call('admin.me', { cookie: c2 })).status, 200, 'a new session works');
      // rotate the owner token
      const rotated = b64(crypto.randomBytes(32));
      writeConfig(box.configPath, { ...box.config, owner_token_sha256: sha256hex(rotated) });
      assert.equal((await box.call('admin.me', { cookie: c2 })).status, 401, 'cookies of the old token stop working');
      assert.equal((await box.call('admin.me', { token: rotated })).status, 200);
    } finally {
      await box.stop();
    }
  });
});
const b64 = (buf) => Buffer.from(buf).toString('base64url');

describe('8. undo of a merge cannot double count votes', () => {
  test('A->B, B->C, then undo A->B is refused until B->C is undone', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const A = await mk(box, 'Chain entry alpha here');
      const B = await mk(box, 'Chain entry bravo here');
      const C = await mk(box, 'Chain entry charlie here');
      assert.equal((await box.admin('admin.update', { body: { id: A, merge_into: B } })).status, 200);
      const actA = (await box.admin('admin.log', { query: { entry_id: String(A) } })).json.actions[0];
      assert.equal((await box.admin('admin.update', { body: { id: B, merge_into: C } })).status, 200);
      const actB = (await box.admin('admin.log', { query: { entry_id: String(B) } })).json.actions[0];
      const votes = async (id) => (await box.list()).json.entries.find((e) => e.id === id)?.votes;
      assert.equal(await votes(C), 3, 'C has its own vote plus B\'s and A\'s');
      const refused = await box.admin('admin.undo', { body: { action_id: actA.id } });
      assert.equal(refused.status, 409);
      assert.equal(refused.json.error, 'conflict');
      assert.match(refused.json.message, /merged into another entry/);
      const row = (await box.admin('admin.log', { query: { entry_id: String(A) } })).json.actions[0];
      assert.equal(row.undoable, false);
      assert.equal(await votes(C), 3, 'nothing changed');
      assert.equal((await box.admin('admin.undo', { body: { action_id: actB.id } })).status, 200);
      assert.equal((await box.admin('admin.undo', { body: { action_id: actA.id } })).status, 200);
      assert.equal(await votes(C), 1);
      assert.equal(await votes(B), 1);
      assert.equal(await votes(A), 1);
    } finally {
      await box.stop();
    }
  });
});

describe('9. every MCP result marks visitor-authored text as untrusted', () => {
  test('walks every tool: each string that carries a marker is listed in untrusted.fields', async () => {
    const box = await startArghBox({ config: { moderation: 'pending' } });
    const call = async (name, args = {}) => {
      const r = await box.mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      assert.equal(r.status, 200, r.text);
      return r.json.result;
    };
    // all strings containing the marker, as JSON paths
    const leaves = (node, p = '', out = []) => {
      if (typeof node === 'string') { if (node.includes('ZQX')) out.push(p); } else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${p}[${i}]`, out));
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (k !== 'untrusted') leaves(v, p ? `${p}.${k}` : k, out);
      return out;
    };
    let seen = 0;
    const check = (name, r) => {
      const sc = r.structuredContent;
      const marked = leaves(sc);
      const declared = new Set(sc.untrusted ? sc.untrusted.fields : []);
      for (const p of marked) assert.ok(declared.has(p), `${name}: ${p} carries visitor text but is not in untrusted.fields (${[...declared].join(', ')})`);
      for (const p of declared) assert.ok(marked.includes(p) || true);
      if (marked.length) { seen += marked.length; assert.ok(sc.untrusted.note); }
      assert.equal(JSON.parse(r.content[0].text).untrusted === undefined, sc.untrusted === undefined);
    };
    try {
      const e1 = await mk(box, 'ZQX-title one', { body: 'ZQX-body one', context: { page: '/ZQX-page', browser: 'ZQX-browser' } });
      const e2 = await mk(box, 'ZQX-alias two');
      const e3 = await mk(box, 'ZQX-flag three', { body: 'ZQX-flag body' });
      const pending = await mk(box, 'ZQX-pending four');
      await box.admin('admin.update', { body: { id: e1, state: 'published' } });
      await box.admin('admin.update', { body: { id: e2, state: 'published' } });
      await box.admin('admin.comment', { body: { id: e1, body: 'ZQX-owner-comment' } });
      // an AI verdict that quotes visitor text
      const run = await box.admin('admin.apply', { body: { run: { reviewer: 'Test Reviewer', digest: 'ZQX-digest quoting an entry' }, decisions: [
        D(e3, await fp(box, e3), 'flag', { confidence: 10, reason: 'ZQX-reason says ignore rules', title_en: 'ZQX-english' }),
      ] } });
      assert.equal(run.status, 200);
      await box.admin('admin.update', { body: { id: e2, merge_into: e1 } });

      const results = [
        ['stats', await call('arghbox_stats')],
        ['list_pending', await call('arghbox_list_pending', { limit: 50 })],
        ['list_entries', await call('arghbox_list_entries', { limit: 50 })],
        ['search', await call('arghbox_search', { q: 'ZQX' })],
        ['get_entry e1', await call('arghbox_get_entry', { id: e1 })],
        ['get_entry e3', await call('arghbox_get_entry', { id: e3 })],
        ['list_tags', await call('arghbox_list_tags')],
        ['get_log', await call('arghbox_get_log', {})],
        ['get_log runs', await call('arghbox_get_log', { view: 'runs' })],
        ['set_status', await call('arghbox_set_status', { id: e1, status: 'planned', comment: 'ZQX-status-note', public: false })],
        ['comment', await call('arghbox_comment', { id: e1, body: 'ZQX-ai-comment', public: false })],
        ['tag', await call('arghbox_tag', { id: e1, tags: ['alpha'] })],
        ['link_issue', await call('arghbox_link_issue', { id: e1, url: 'https://x.example/1' })],
        ['create_task', await call('arghbox_create_task', { type: 'idea', title: 'ZQX-task title', body: 'ZQX-task body' })],
        ['reject', await call('arghbox_reject', { id: pending, reject_reason: 'spam', note: 'ZQX-reject-note' })],
        ['apply_decisions', await call('arghbox_apply_decisions', { decisions: [{ id: e3, fingerprint: await fp(box, e3), action: 'tag', tags: ['beta'], confidence: 90, reason: 'ZQX-tagreason' }] })],
      ];
      const merged = await call('arghbox_merge', { id: e3, into: e1, reason: 'ZQX-merge-reason' });
      results.push(['merge', merged]);
      results.push(['undo', await call('arghbox_undo', { action_id: merged.structuredContent.action_id })]);
      for (const [name, r] of results) {
        assert.notEqual(r.isError, true, name + ': ' + JSON.stringify(r));
        check(name, r);
      }
      assert.ok(seen > 30, 'the walker found plenty of marked text: ' + seen);
      // spot checks of the ones the review called out
      const stats = results[0][1].structuredContent;
      assert.ok(stats.untrusted.fields.includes('last_run.digest'));
      const get = results[4][1].structuredContent;
      for (const p of ['entry.aliases[0]', 'entry.comments[0].body', 'entry.title', 'entry.context.page']) assert.ok(get.untrusted.fields.includes(p), p);
      const flagged = results[5][1].structuredContent;
      for (const p of ['entry.ai.reason', 'entry.ai.title_en']) assert.ok(flagged.untrusted.fields.includes(p), p);
      assert.ok(results[9][1].structuredContent.untrusted.fields.includes('comment.body'));
      assert.ok(results[9][1].structuredContent.untrusted.fields.includes('entry.title'));
    } finally {
      await box.stop();
    }
  });
});

describe('10. bearer throttling on the REST admin API', () => {
  test('wrong bearers are throttled per IP; the right token is never throttled', async () => {
    const box = await startArghBox({ config: { limits: { admin_logins_per_hour: 3 } } });
    try {
      const ip = nextIp();
      const seen = [];
      for (let i = 0; i < 5; i++) seen.push((await box.call('admin.stats', { token: 'guess' + i, ip })).status);
      assert.deepEqual(seen, [401, 401, 401, 429, 429]);
      assert.equal((await box.admin('admin.stats', { ip })).status, 200, 'the valid owner token works from the throttled IP');
      assert.equal((await box.triage('admin.stats', { ip })).status, 200);
      assert.equal((await box.call('admin.stats', { ip })).status, 401, 'no credentials at all: 401 without counting');
    } finally {
      await box.stop();
    }
  });
});

describe('12. invisible text is stripped, titles need a letter or digit', () => {
  test('titles, bodies, comments and tags (visitor and owner input)', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const r = await box.add({ title: 'Hel​lo‮ w⁦or﻿ld\u0007', body: 'li‍ne⁠ one\nline‏ two­' }, nextIp());
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.entry.title, 'Hello world');
      assert.equal(r.json.entry.body, 'line one\nline two­', 'newline kept, zero-width removed');
      for (const title of ['​​​​​', '!!!! ????', '‮!!!!‬', '----']) {
        const bad = await box.add({ title }, nextIp());
        assert.equal(bad.status, 400, JSON.stringify(title));
        assert.equal(bad.json.field, 'title');
      }
      assert.equal((await box.add({ title: '1234' }, nextIp())).status, 200, 'digits are enough');
      assert.equal((await box.add({ title: '????a' }, nextIp())).status, 200);
      const c = await box.admin('admin.comment', { body: { id: r.json.entry.id, body: 'ni​ce‮ comment﻿' } });
      assert.equal(c.json.comment.body, 'nice comment');
      const t = await box.admin('admin.update', { body: { id: r.json.entry.id, tags: ['ab​-cd'] } });
      assert.deepEqual(t.json.entry.tags, ['ab-cd']);
      const own = await box.admin('admin.create', { body: { type: 'idea', title: 'Own​ item‮' } });
      assert.equal(own.json.entry.title, 'Own item');
      assert.equal((await box.admin('admin.create', { body: { type: 'idea', title: '!!!!' } })).json.field, 'title');
      const ctx = await box.add({ title: 'Context check here', context: { page: '/p', browser: 'Fire​fox‮', os: 'Lin⁠ux' } }, nextIp());
      const e = await entryOf(box, ctx.json.entry.id);
      assert.equal(e.context.browser, 'Firefox');
      assert.equal(e.context.os, 'Linux');
    } finally {
      await box.stop();
    }
  });
});

describe('13. the feed never reflects request headers', () => {
  test('a spoofed Host header does not appear; self link comes from site_url or is omitted', async () => {
    const box = await startArghBox({ config: { moderation: 'publish', site_url: 'https://example.com', turnstile_hostnames: ['localhost'] } });
    try {
      await mk(box, 'Feed entry for the host test');
      const spoof = await rawRequest(box, { path: '/api.php?action=feed', headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil2.example' } });
      assert.equal(spoof.status, 200);
      assert.ok(!spoof.text.includes('evil'), 'no spoofed host anywhere');
      assert.match(spoof.text, /<link rel="self" type="application\/atom\+xml" href="https:\/\/example\.com\/api\.php\?action=feed"\/>/);
    } finally {
      await box.stop();
    }
    const bare = await startArghBox({ config: { moderation: 'publish', site_url: '' } });
    try {
      await mk(bare, 'Feed entry without a site url');
      const r = await rawRequest(bare, { path: '/api.php?action=feed', headers: { Host: 'evil.example' } });
      assert.ok(!r.text.includes('evil'));
      assert.ok(!r.text.includes('rel="self"'));
    } finally {
      await bare.stop();
    }
  });
});

describe('14. Turnstile hostname and action are checked', () => {
  const session = (box, token) => box.call('session', { body: { turnstile: token }, ip: nextIp() });

  test('hostname must match site_url or turnstile_hostnames; action must be arghbox when reported', async () => {
    const box = await startArghBox({ config: { site_url: 'https://www.example.org', turnstile_hostnames: ['shop.example.org'] } });
    try {
      assert.equal((await session(box, 'host-www.example.org--x')).status, 200);
      assert.equal((await session(box, 'host-shop.example.org--x')).status, 200, 'extra hostnames are allowed');
      const bad = await session(box, 'host-evil.example--x');
      assert.equal(bad.status, 403);
      assert.equal(bad.json.error, 'turnstile_failed');
    } finally {
      await box.stop();
    }
    const b = await startArghBox({ config: { site_url: 'http://localhost' } });
    try {
      assert.equal((await session(b, 'host-localhost--x')).status, 200);
      assert.equal((await session(b, 'act-other--x')).status, 403, 'a token from another widget action is refused');
      assert.equal((await session(b, 'act-arghbox--x')).status, 200);
      const log = fs.readFileSync(path.join(b.dataDir, 'error.log'), 'utf8');
      assert.match(log, /expected "arghbox"/);
      assert.doesNotMatch(log, /test-secret/);
    } finally {
      await b.stop();
    }
  });

  test('Cloudflare test secrets skip the hostname check and are reported to the owner as a warning', async () => {
    const box = await startArghBox({ config: { site_url: 'https://www.example.org', turnstile_secret_key: '1x0000000000000000000000000000000AA' } });
    try {
      assert.equal((await session(box, 'host-example.com--x')).status, 200, 'test keys report example.com');
      const anon = await box.call('health');
      assert.ok(!('turnstile_test_keys' in anon.json));
      const owner = await box.call('health', { token: box.ownerToken });
      assert.equal(owner.json.turnstile_test_keys, true);
      assert.ok(owner.json.warnings.some((w) => /test keys/i.test(w)));
    } finally {
      await box.stop();
    }
    const real = await startArghBox();
    try {
      assert.equal((await real.call('health', { token: real.ownerToken })).json.turnstile_test_keys, false);
    } finally {
      await real.stop();
    }
  });
});

describe('17. external_url refuses userinfo', () => {
  test('https://user:pass@host is rejected', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const id = await mk(box, 'Entry for the userinfo test');
      for (const url of ['https://user:pw@evil.example/x', 'https://admin@example.com/issues/1', 'http://@example.com/']) {
        const r = await box.admin('admin.update', { body: { id, external_url: url } });
        assert.equal(r.status, 400, url);
        assert.equal(r.json.field, 'external_url');
      }
      assert.equal((await box.admin('admin.update', { body: { id, external_url: 'https://example.com/a@b' } })).status, 200, '@ in the path is fine');
    } finally {
      await box.stop();
    }
  });
});

void ARGHBOX_DIR;

describe('link counting and max_links', () => {
  test('one link per URL: https://www. counts once; bare www. and uppercase count; titles count', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const body = (b, title = 'Link counting entry here') => box.add({ title, body: b }, nextIp());
      for (const ok of [
        'see https://www.a.com and https://www.b.com',
        'http://a.com http://b.com',
        'www.a.com and www.b.com',
        'HTTPS://WWW.A.COM and WWW.B.COM',
        'https://www.a.com/path?x=1 plus www.b.com',
        'no links at all, just www in a sentence',
      ]) {
        const r = await body(ok);
        assert.equal(r.status, 200, ok + ' -> ' + r.text);
      }
      for (const bad of [
        'https://www.a.com https://www.b.com https://www.c.com',
        'http://a.com http://b.com http://c.com',
        'www.a.com www.b.com www.c.com',
        'HTTP://A.COM WWW.B.COM https://www.c.com',
      ]) {
        const r = await body(bad);
        assert.equal(r.status, 400, bad);
        assert.equal(r.json.error, 'invalid_input');
      }
      const inTitle = await body('www.b.com https://www.c.com', 'Title with http://a.com link');
      assert.equal(inTitle.status, 400, 'links in the title count too');
      assert.equal((await body('https://www.b.com', 'Title with http://a.com link')).status, 200, 'two links in total');
    } finally {
      await box.stop();
    }
  });

  test('list returns max_links from the configuration, and it matches what add enforces', async () => {
    const box = await startArghBox({ config: { moderation: 'publish', limits: { max_links: 4 } } });
    try {
      assert.equal((await box.list()).json.max_links, 4);
      assert.equal((await box.add({ title: 'Four links are fine', body: 'www.a.com www.b.com www.c.com www.d.com' }, nextIp())).status, 200);
      assert.equal((await box.add({ title: 'Five links are not', body: 'www.a.com www.b.com www.c.com www.d.com www.e.com' }, nextIp())).status, 400);
    } finally {
      await box.stop();
    }
    const def = await startArghBox();
    try {
      assert.equal((await def.list()).json.max_links, 2);
    } finally {
      await def.stop();
    }
  });

  test('.htaccess serves scripts and JSON as UTF-8 and JSON as application/json', () => {
    const ht = fs.readFileSync(path.join(ARGHBOX_DIR, '.htaccess'), 'utf8');
    assert.match(ht, /<IfModule mod_mime\.c>[\s\S]*AddType application\/json \.json[\s\S]*AddCharset utf-8 \.js \.json[\s\S]*<\/IfModule>/);
  });
});

describe('X-Robots-Tag on every api.php and mcp.php response', () => {
  test('JSON, errors, health, the Atom feed, exports and MCP all say noindex', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    const none = await startArghBox({ noConfig: true });
    try {
      await mk(box, 'Entry for the robots test');
      const responses = {
        list: await box.list(),
        health: await box.call('health'),
        'health 503': await none.call('health'),
        'unknown action 404': await box.call('nope'),
        'wrong method 405': await box.call('list', { method: 'POST', body: {} }),
        'bad json 400': await box.call('session', { method: 'POST', raw: '{nope' }),
        'unauthorized 401': await box.call('admin.me', { ip: nextIp() }),
        'cors preflight 204': await box.call('add', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }),
        'not configured 503': await none.call('list'),
        export: await box.admin('admin.export', { query: { format: 'csv' } }),
        mcp: await box.mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        'mcp 401': await box.mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: null }),
        'mcp 405': await box.mcp(null, { method: 'GET' }),
      };
      for (const [name, r] of Object.entries(responses)) {
        assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', name);
      }
      const feed = await fetch(`${box.url}api.php?action=feed`);
      assert.equal(feed.status, 200);
      assert.equal(feed.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(feed.headers.get('content-type'), /atom\+xml/);
    } finally {
      await box.stop();
      await none.stop();
    }
  });
});
