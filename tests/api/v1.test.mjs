import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARGHBOX_DIR, nextIp, startArghBox } from '../helpers/server.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';

const mk = async (box, title, extra = {}) => (await box.add({ title, ...extra }, nextIp())).json.entry.id;
const entryOf = async (box, id) => (await box.admin('admin.entries', { query: { limit: '200' } })).json.entries.find((e) => e.id === id);
const raw = async (box, action, opts = {}) => {
  const { token, query = {}, cookie } = opts;
  const qs = new URLSearchParams({ action, ...query });
  const res = await fetch(`${box.url}api.php?${qs}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
};

/** Minimal RFC 4180 CSV parser (handles quotes, commas, newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

describe('read-only token', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('may call every admin GET action', async () => {
    const id = await mk(box, 'Read token entry');
    for (const [action, query] of [['admin.me', {}], ['admin.queue', {}], ['admin.entry', { id: String(id) }], ['admin.entries', {}], ['admin.log', {}], ['admin.runs', {}], ['admin.stats', {}], ['admin.export', { format: 'json' }]]) {
      const r = await box.read(action, { query });
      assert.equal(r.status, 200, action);
    }
    assert.equal((await box.read('admin.me')).json.actor, 'read');
  });

  test('any POST answers 403 forbidden and changes nothing', async () => {
    const id = await mk(box, 'Read token untouched');
    for (const [action, body] of [['admin.update', { id, status: 'done' }], ['admin.apply', { decisions: [] }], ['admin.create', { type: 'idea', title: 'Nope nope' }],
      ['admin.comment', { id, body: 'hi' }], ['admin.comment_update', { comment_id: 1, hidden: true }], ['admin.undo', { action_id: 1 }], ['admin.logout', {}]]) {
      const r = await box.read(action, { body });
      assert.equal(r.status, 403, action);
      assert.equal(r.json.error, 'forbidden', action);
    }
    assert.equal((await entryOf(box, id)).status, 'open');
    assert.equal((await box.call('admin.login', { body: { token: box.readToken }, ip: nextIp() })).status, 401, 'cannot sign in with it');
  });
});

describe('external_url', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('is admin only, validated, undoable and part of exports', async () => {
    const id = await mk(box, 'Link me to an issue');
    assert.ok(!('external_url' in (await box.list()).json.entries[0]), 'never public');
    assert.equal((await box.admin('admin.entries')).json.entries[0].external_url, null);
    const set = await box.admin('admin.update', { body: { id, external_url: 'https://github.com/o/r/issues/7' } });
    assert.equal(set.json.entry.external_url, 'https://github.com/o/r/issues/7');
    for (const bad of ['javascript:alert(1)', 'ftp://x.example/a', 'not a url', 'https://', 'http://a b.example', 'https://x.example/' + 'a'.repeat(500), 5, '//evil.example']) {
      const r = await box.admin('admin.update', { body: { id, external_url: bad } });
      assert.equal(r.status, 400, String(bad).slice(0, 30));
      assert.equal(r.json.field, 'external_url');
    }
    assert.equal((await box.admin('admin.update', { body: { id, external_url: 'http://localhost:3000/x?y=1#z' } })).status, 200);
    const log = (await box.admin('admin.log', { query: { entry_id: String(id) } })).json.actions;
    assert.equal(log[0].kind, 'edit');
    assert.match(log[0].summary, /external_url/);
    // undo restores the previous link
    assert.equal((await box.admin('admin.undo', { body: { action_id: log[0].id } })).status, 200);
    assert.equal((await entryOf(box, id)).external_url, 'https://github.com/o/r/issues/7');
    // clear
    assert.equal((await box.admin('admin.update', { body: { id, external_url: '' } })).json.entry.external_url, null);
    await box.admin('admin.update', { body: { id, external_url: 'https://x.example/1' } });
    const csv = parseCsv((await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'csv' } })).buf.toString('utf8').replace(/^\uFEFF/, ''));
    assert.equal(csv[1][csv[0].indexOf('external_url')], 'https://x.example/1');
    const json = JSON.parse((await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'json' } })).buf.toString('utf8'));
    assert.equal(json.entries.find((e) => e.id === id).external_url, 'https://x.example/1');
    // owner items accept it on create
    const o = await box.admin('admin.create', { body: { type: 'idea', title: 'Owner item linked', external_url: 'https://x.example/2' } });
    assert.equal(o.json.entry.external_url, 'https://x.example/2');
  });

  test('an install migrated from schema version 1 gets the column and keeps its data', async () => {
    const b = await startArghBox();
    try {
      const file = path.join(b.dataDir, 'arghbox.sqlite');
      const script = `
        $db = new PDO('sqlite:' . $argv[1]);
        $db->exec("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', title_original TEXT NOT NULL, body_original TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'visitor', state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', status_at TEXT NULL, merged_into INTEGER NULL, reject_reason TEXT NULL, tags TEXT NOT NULL DEFAULT '[]', votes INTEGER NOT NULL DEFAULT 0, context TEXT NOT NULL DEFAULT '{}', ai TEXT NULL, author_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        $db->exec("CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, body TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        $db->exec("CREATE TABLE votes (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, voter_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, moved_from INTEGER NULL, created_at TEXT NOT NULL, UNIQUE(entry_id, voter_hash))");
        $db->exec("CREATE TABLE actions (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, run_id INTEGER NULL, kind TEXT NOT NULL, entry_id INTEGER NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, undone_by INTEGER NULL)");
        $db->exec("CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, reviewer TEXT NOT NULL, counts TEXT NOT NULL, digest TEXT NOT NULL DEFAULT '')");
        $db->exec("CREATE TABLE limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)");
        $db->exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        $db->exec("INSERT INTO meta VALUES ('schema_version', '1')");
        $db->exec("INSERT INTO entries (type, title, title_original, state, author_hash, receipt_hash, created_at, updated_at, votes) VALUES ('idea', 'Old entry from v1', 'Old entry from v1', 'published', 'a', 'b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)");`;
      const r = spawnSync(phpPath(), phpArgs(['-r', script, file]), { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const list = await b.list();
      assert.equal(list.json.entries[0].title, 'Old entry from v1');
      const set = await b.admin('admin.update', { body: { id: list.json.entries[0].id, external_url: 'https://x.example/old' } });
      assert.equal(set.json.entry.external_url, 'https://x.example/old');
      assert.equal((await b.admin('admin.stats')).status, 200);
    } finally {
      await b.stop();
    }
  });
});

describe('admin.entry and admin.entries filters', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('admin.entry returns the entry and its last 20 log rows', async () => {
    const id = await mk(box, 'Entry with a history');
    for (let i = 0; i < 12; i++) {
      await box.admin('admin.update', { body: { id, title: `Entry with a history ${i}` } });
      await box.admin('admin.comment', { body: { id, body: `note ${i}`, public: false } });
    }
    const r = await box.admin('admin.entry', { query: { id: String(id) } });
    assert.equal(r.status, 200);
    assert.equal(r.json.entry.id, id);
    assert.equal(r.json.entry.comments.length, 12);
    assert.equal(r.json.actions.length, 20);
    assert.equal(r.json.actions[0].kind, 'comment');
    assert.ok(r.json.actions.every((a) => a.entry_id === id));
    assert.ok('undoable' in r.json.actions[0] && 'summary' in r.json.actions[0]);
    assert.equal((await box.admin('admin.entry', { query: { id: '99999' } })).status, 404);
    assert.equal((await box.admin('admin.entry', {})).status, 404);
    assert.equal((await box.triage('admin.entry', { query: { id: String(id) } })).status, 200);
  });

  test('status filter and sort=newest|oldest|votes', async () => {
    const b = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const a = await mk(b, 'Sort alpha entry');
      const c = await mk(b, 'Sort charlie entry');
      const d = await mk(b, 'Sort delta entry');
      await b.vote(c, true, undefined, nextIp());
      await b.vote(c, true, undefined, nextIp());
      await b.vote(d, true, undefined, nextIp());
      await b.admin('admin.update', { body: { id: a, status: 'done' } });
      await b.admin('admin.update', { body: { id: d, status: 'done' } });
      const ids = async (query) => (await b.admin('admin.entries', { query })).json.entries.map((e) => e.id);
      assert.deepEqual((await ids({ status: 'done', sort: 'oldest' })), [a, d]);
      assert.deepEqual((await ids({ status: 'done', sort: 'newest' })), [d, a]);
      assert.deepEqual((await ids({ sort: 'votes' })), [c, d, a]);
      assert.deepEqual((await ids({})), [d, c, a], 'newest first by default');
      assert.equal((await b.admin('admin.entries', { query: { status: 'weird' } })).json.field, 'status');
      assert.equal((await b.admin('admin.entries', { query: { sort: 'random' } })).json.field, 'sort');
      assert.equal((await b.admin('admin.entries', { query: { status: 'open' } })).json.total, 1);
    } finally {
      await b.stop();
    }
  });
});

describe('export', () => {
  let box;
  let ids;
  before(async () => {
    box = await startArghBox({ config: { moderation: 'publish', site_name: 'Café "Test" Site!', tags: ['preset-tag'] } });
    const tricky = await mk(box, 'Quote "this", comma, ok', { body: 'line one\nline "two", with comma\r\nline three', type: 'bug' });
    const formula = await mk(box, '=HYPERLINK("http://evil.example","click")');
    const planned = await mk(box, 'Planned idea here');
    const done = await mk(box, 'Finished idea here');
    const spam = await mk(box, 'Spammy entry here');
    const pending = await mk(box, 'Plain question here', { type: 'question' });
    await box.admin('admin.update', { body: { id: planned, status: 'planned', tags: ['export', 'csv'] } });
    await box.admin('admin.update', { body: { id: done, status: 'done' } });
    await box.admin('admin.update', { body: { id: spam, state: 'rejected', reject_reason: 'spam' } });
    await box.admin('admin.update', { body: { id: pending, state: 'pending' } });
    await box.admin('admin.comment', { body: { id: planned, body: 'Public one.' } });
    await box.admin('admin.comment', { body: { id: planned, body: 'Second, "quoted"\npublic.' } });
    await box.admin('admin.comment', { body: { id: planned, body: 'secret note', public: false } });
    await box.admin('admin.create', { body: { type: 'idea', title: 'Owner private item' } });
    ids = { tricky, formula, planned, done, spam, pending };
  });
  after(async () => { await box.stop(); });

  test('csv: BOM, header, escaping, filename, default skips rejected, public comments only', async () => {
    const r = await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'csv' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="arghbox-caf-test-site-\d{8}\.csv"$/);
    assert.deepEqual([...r.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
    const text = r.buf.toString('utf8').slice(1);
    assert.ok(text.includes('\r\n'));
    const rows = parseCsv(text);
    assert.deepEqual(rows[0], ['id', 'type', 'state', 'status', 'title', 'body', 'votes', 'tags', 'created_at', 'updated_at', 'merged_into', 'reject_reason', 'external_url', 'source', 'comments']);
    const by = Object.fromEntries(rows.slice(1).map((x) => [x[0], x]));
    assert.ok(!(String(ids.spam) in by), 'rejected is skipped by default');
    assert.equal(rows.length - 1, 6, 'five visitor entries plus the owner item');
    const t = by[ids.tricky];
    assert.equal(t[4], 'Quote "this", comma, ok');
    assert.equal(t[5], 'line one\nline "two", with comma\nline three');
    assert.equal(t[1], 'bug');
    const p = by[ids.planned];
    assert.equal(p[3], 'planned');
    assert.equal(p[7], 'csv;export');
    assert.equal(p[14], 'Public one.\n\nSecond, "quoted"\npublic.');
    assert.ok(!text.includes('secret note'));
    assert.equal(p[13], 'visitor');
    assert.ok(rows.some((x) => x[13] === 'owner' && x[2] === 'private'));
    // formula injection is neutralised
    assert.equal(by[ids.formula][4].startsWith("'="), true);
  });

  test('csv state filter; json shape; invalid parameters', async () => {
    const rej = parseCsv((await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'csv', state: 'rejected' } })).buf.toString('utf8').slice(1));
    assert.equal(rej.length, 2);
    assert.equal(rej[1][11], 'spam');
    const pend = parseCsv((await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'csv', state: 'pending' } })).buf.toString('utf8').slice(1));
    assert.deepEqual(pend.slice(1).map((x) => x[0]), [String(ids.pending)]);

    const r = await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'json' } });
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.match(r.headers.get('content-disposition'), /filename="arghbox-caf-test-site-\d{8}\.json"/);
    const j = JSON.parse(r.buf.toString('utf8'));
    assert.deepEqual(Object.keys(j).sort(), ['entries', 'exported_at', 'runs', 'site', 'tags', 'version']);
    assert.equal(j.site.name, 'Café "Test" Site!');
    assert.match(j.exported_at, /^\d{4}-\d\d-\d\dT/);
    assert.ok(!j.entries.some((e) => e.id === ids.spam));
    const e = j.entries.find((x) => x.id === ids.planned);
    assert.equal(e.comments.length, 3, 'JSON includes every comment for moving to another tool');
    assert.ok('fingerprint' in e && 'title_original' in e);
    assert.ok(j.tags.some((t) => t.tag === 'preset-tag'));
    const all = JSON.parse((await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'json', state: 'rejected' } })).buf.toString('utf8'));
    assert.deepEqual(all.entries.map((x) => x.id), [ids.spam]);
    const def = await raw(box, 'admin.export', { token: box.ownerToken });
    assert.equal(def.status, 200, 'json is the default format');
    assert.equal((await box.admin('admin.export', { query: { format: 'xml' } })).json.field, 'format');
    assert.equal((await box.admin('admin.export', { query: { format: 'csv', state: 'bogus' } })).json.field, 'state');
  });

  test('jira-csv: open, planned and in-progress published entries with Jira columns', async () => {
    const r = await raw(box, 'admin.export', { token: box.ownerToken, query: { format: 'jira-csv' } });
    assert.equal(r.status, 200);
    assert.deepEqual([...r.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="arghbox-caf-test-site-\d{8}-jira\.csv"$/, 'never overwrites the plain csv');
    const rows = parseCsv(r.buf.toString('utf8').slice(1));
    assert.deepEqual(rows[0], ['Summary', 'Description', 'Issue Type', 'Labels']);
    const titles = rows.slice(1).map((x) => x[0]);
    assert.ok(titles.includes('Planned idea here'));
    assert.ok(titles.includes('Quote "this", comma, ok'));
    assert.ok(!titles.includes('Finished idea here'), 'done is not exported');
    assert.ok(!titles.includes('Spammy entry here'));
    assert.ok(!titles.includes('Plain question here'), 'pending is not exported');
    assert.ok(!titles.includes('Owner private item'));
    const bug = rows.find((x) => x[0] === 'Quote "this", comma, ok');
    assert.equal(bug[2], 'Bug');
    assert.match(bug[1], /From ArghBox #\d+, 1 vote$/);
    const idea = rows.find((x) => x[0] === 'Planned idea here');
    assert.equal(idea[2], 'Story');
    assert.equal(idea[3], 'csv export');
  });

  test('works for the owner, triage and read tokens and for a cookie session; refuses anonymous', async () => {
    for (const token of [box.ownerToken, box.triageToken, box.readToken]) {
      for (const format of ['json', 'csv', 'jira-csv']) assert.equal((await raw(box, 'admin.export', { token, query: { format } })).status, 200, format);
    }
    const login = await box.call('admin.login', { body: { token: box.ownerToken }, ip: nextIp() });
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('arghbox_admin=')).split(';')[0];
    const viaCookie = await raw(box, 'admin.export', { cookie, query: { format: 'csv' } });
    assert.equal(viaCookie.status, 200, 'cookie GET needs no CSRF');
    assert.equal((await raw(box, 'admin.export', { query: { format: 'csv' } })).status, 401);
    assert.equal((await raw(box, 'admin.export', { token: 'wrong' })).status, 401);
  });

  test('the filename is safe even for hostile site names', async () => {
    const b = await startArghBox({ config: { site_name: '"; evil=1\r\nX-Injected: yes ../../etc/passwd' } });
    try {
      const r = await raw(b, 'admin.export', { token: b.ownerToken, query: { format: 'csv' } });
      const cd = r.headers.get('content-disposition');
      assert.match(cd, /^attachment; filename="arghbox-[a-z0-9-]+-\d{8}\.csv"$/);
      assert.equal(r.headers.get('x-injected'), null);
    } finally {
      await b.stop();
    }
  });
});

describe('Atom feed', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', site_name: 'Feed & <Co> "Site"', site_url: 'https://example.com', turnstile_hostnames: ['localhost'] } }); });
  after(async () => { await box.stop(); });

  /** Tiny well-formedness check: balanced tags, no stray "<" or "&" in text, entities valid. */
  function checkXml(xml) {
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
    const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
    const stack = [];
    const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
    let m;
    let consumed = 0;
    while ((m = tagRe.exec(body)) !== null) {
      consumed += m[0].length;
      if (m[5] !== undefined) {
        assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[5]), 'unescaped & in text: ' + m[5].slice(0, 40));
        continue;
      }
      if (m[1]) assert.equal(stack.pop(), m[2], 'mismatched closing tag ' + m[2]);
      else if (!m[4]) stack.push(m[2]);
      assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[3] || ''), 'unescaped & in attribute');
    }
    assert.equal(consumed, body.length, 'unparsable markup');
    assert.deepEqual(stack, [], 'unclosed tags');
  }
  const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[ >][\\s\\S]*?</${name}>|<${name}[^>]*/>`, 'g'))].map((m) => m[0]);

  test('is well-formed Atom 1.0 with the required elements, escaped, newest first', async () => {
    const hostile = await mk(box, 'Tags <b>&</b> "quotes" \'single\' & more', { body: 'Body with <script>alert(1)</script> & ]]> text' });
    const planned = await mk(box, 'A planned idea');
    const done = await mk(box, 'A finished idea');
    const declined = await mk(box, 'A declined idea');
    await box.admin('admin.update', { body: { id: planned, status: 'planned', tags: ['feed-tag'] } });
    await box.admin('admin.update', { body: { id: done, status: 'done' } });
    await box.admin('admin.update', { body: { id: declined, status: 'declined' } });
    await box.admin('admin.comment', { body: { id: done, body: 'Shipped in 1.2 & <more>.' } });
    await box.admin('admin.comment', { body: { id: done, body: 'Private thing', public: false } });
    const r = await fetch(`${box.url}api.php?action=feed`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/atom+xml; charset=utf-8');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=600');
    const xml = await r.text();
    checkXml(xml);
    assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
    const head = xml.slice(0, xml.indexOf('<entry>'));
    assert.match(head, /<title>Feed &amp; &lt;Co&gt; &quot;Site&quot;<\/title>/);
    assert.match(head, /<id>https:\/\/example\.com\/#arghbox-feed<\/id>/);
    assert.match(head, /<updated>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/updated>/);
    assert.match(head, /<author><name>/);
    const entries = tag(xml, 'entry');
    assert.equal(entries.length, 4);
    for (const e of entries) {
      for (const el of ['title', 'id', 'updated']) assert.equal(tag(e, el).length, 1, el);
      assert.match(e, /<updated>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/updated>/);
      assert.match(e, /<link rel="alternate" href="https:\/\/example\.com\/#arghbox-\d+"\/>/);
    }
    const ids = entries.map((e) => e.match(/<id>([^<]*)<\/id>/)[1]);
    assert.equal(new Set(ids).size, 4, 'ids are unique');
    assert.ok(xml.includes('[Planned] A planned idea'));
    assert.ok(xml.includes('[Done] A finished idea'));
    assert.ok(xml.includes('[Declined] A declined idea'));
    assert.ok(xml.includes('<title>Tags &lt;b&gt;&amp;&lt;/b&gt; &quot;quotes&quot; &apos;single&apos; &amp; more</title>'), 'open entries have no prefix and are escaped');
    assert.ok(xml.includes('Body with &lt;script&gt;alert(1)&lt;/script&gt; &amp; ]]&gt; text'));
    assert.ok(xml.includes('Shipped in 1.2 &amp; &lt;more&gt;.'), 'latest public comment is in the content');
    assert.ok(!xml.includes('Private thing'));
    assert.ok(!xml.includes('<script>'));
    assert.ok(xml.includes('<category term="feed-tag"/>'));
    void hostile;
  });

  test('empty feed is still valid; private, pending and rejected entries are never included; most recent 50', async () => {
    const b = await startArghBox({ config: { moderation: 'pending', site_url: '' } });
    try {
      let xml = await (await fetch(`${b.url}api.php?action=feed`)).text();
      checkXml(xml);
      assert.equal(tag(xml, 'entry').length, 0);
      assert.match(xml, /<id>urn:arghbox:[0-9a-f]{32}<\/id>/, 'no site_url: a urn id');
      const hidden = await mk(b, 'Pending stays hidden');
      await b.admin('admin.create', { body: { type: 'idea', title: 'Private stays hidden' } });
      xml = await (await fetch(`${b.url}api.php?action=feed`)).text();
      assert.ok(!xml.includes('stays hidden'));
      void hidden;
    } finally {
      await b.stop();
    }
    const many = await startArghBox({ config: { moderation: 'publish', limits: { entries_per_hour: 100 } } });
    try {
      for (let i = 0; i < 55; i++) await mk(many, `Feed entry number ${i} here`);
      const xml = await (await fetch(`${many.url}api.php?action=feed`)).text();
      checkXml(xml);
      assert.equal(tag(xml, 'entry').length, 50);
    } finally {
      await many.stop();
    }
  });

  test('POST is refused as JSON', async () => {
    const r = await box.call('feed', { method: 'POST', body: {} });
    assert.equal(r.status, 405);
  });
});

describe('welcome and config keys', () => {
  test('list returns welcome, cut to 500 characters; empty by default', async () => {
    const a = await startArghBox();
    const b = await startArghBox({ config: { welcome: 'w'.repeat(700) } });
    const c = await startArghBox({ config: { welcome: '  Tell us what bugs you.  ' } });
    try {
      assert.equal((await a.list()).json.welcome, '');
      assert.equal((await b.list()).json.welcome.length, 500);
      assert.equal((await c.list()).json.welcome, 'Tell us what bugs you.');
    } finally {
      await a.stop(); await b.stop(); await c.stop();
    }
  });

  test('config.example.php documents the new keys; .htaccess passes Authorization through', () => {
    const ex = fs.readFileSync(path.join(ARGHBOX_DIR, 'config.example.php'), 'utf8');
    for (const key of ['welcome', 'read_token_sha256', 'mcp_enabled', 'triage_public_writes', 'trusted_proxies', 'turnstile_hostnames', 'journal_mode', 'sessions_global_per_hour', 'auth_failures_global_per_hour', 'mine_per_hour', 'mcp_calls_per_minute', 'mcp_writes_per_minute']) assert.ok(ex.includes(`'${key}'`), key);
    const ht = fs.readFileSync(path.join(ARGHBOX_DIR, '.htaccess'), 'utf8');
    assert.match(ht, /<IfModule mod_rewrite\.c>[\s\S]*RewriteEngine On[\s\S]*RewriteRule \.\* - \[E=HTTP_AUTHORIZATION:%\{HTTP:Authorization\}\][\s\S]*<\/IfModule>/);
    const src = fs.readFileSync(path.join(ARGHBOX_DIR, 'lib', 'http.php'), 'utf8');
    assert.match(src, /REDIRECT_HTTP_AUTHORIZATION/);
  });

  test('the REST API still answers existing shapes (backward compatible)', async () => {
    const b = await startArghBox({ config: { moderation: 'publish' } });
    try {
      await mk(b, 'Compatibility check entry');
      const l = (await b.list()).json;
      for (const k of ['ok', 'site', 'version', 'turnstile_site_key', 'moderation', 'credit', 'entries', 'tag_counts', 'voted']) assert.ok(k in l, k);
      const q = (await b.admin('admin.queue')).json;
      for (const k of ['site', 'moderation', 'auto_apply_min_confidence', 'tags', 'pending', 'flagged', 'published', 'private']) assert.ok(k in q, k);
      const e = (await b.admin('admin.entries')).json.entries[0];
      for (const k of ['state', 'merged_into', 'reject_reason', 'title_original', 'body_original', 'context', 'ai', 'author', 'fingerprint', 'updated_at', 'external_url']) assert.ok(k in e, k);
    } finally {
      await b.stop();
    }
  });
});
