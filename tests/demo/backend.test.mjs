// demo/backend.js against its own contract: it is driven through the overridden fetch, like the clients do.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, loadBackend, makeStorage, voterKey } from './browser.mjs';

const ME = voterKey('me');

/** A fresh demo box and a few helpers: a visitor with a pass, and the signed-in owner. */
async function setup() {
  const b = loadBackend();
  const pass = (await b.call('session', { body: { turnstile: 'token' } })).json.pass;
  const post = (action, body, voter = ME) => b.call(action, { body: { pass, voter, ...body } });
  const add = (extra = {}) => post('add', { type: 'idea', title: 'A perfectly fine idea', body: '', hp: '', elapsed_ms: 50, context: { page: '/x?y=1', lang: 'en', browser: 'Chrome', os: 'Mac', screen: 'large' }, ...extra });
  const csrf = (await b.call('admin.login', { body: { token: 'demo' } })).json.csrf;
  const admin = (action, o = {}) => b.call(action, { csrf, ...o });
  const adminPost = (action, body) => admin(action, { body });
  const entry = async (id) => (await admin('admin.entry', { query: { id: String(id) } })).json.entry;
  const stats = async () => (await admin('admin.stats')).json;
  const publicList = async (voter) => (await b.call('list', { voter })).json;
  const titles = async () => (await publicList()).entries.map((e) => e.title);
  return { b, pass, post, add, csrf, admin, adminPost, entry, stats, publicList, titles };
}

const idOf = async (t, title) => (await t.admin('admin.entries', { query: { q: title, limit: '5' } })).json.entries.find((e) => e.title === title).id;

describe('the seed', () => {
  test('the public list shows only published entries, most votes first', async () => {
    const { b } = await setup();
    const r = await b.call('list');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.match(r.headers.get('Content-Type'), /^application\/json/);
    assert.equal(r.json.site.name, 'Contoso Tasks');
    assert.equal(r.json.moderation, 'pending');
    assert.equal(r.json.app_pass, true);
    assert.equal(r.json.turnstile_site_key, '1x00000000000000000000AA');
    assert.equal(r.json.max_links, 2);
    assert.equal(r.json.credit, true);
    assert.equal(r.json.version, '0.1.2');
    assert.equal(r.json.entries.length, 13);
    const first = r.json.entries[0];
    assert.equal(first.title, 'Recurring tasks');
    assert.equal(first.votes, 31);
    assert.equal(first.similar, 2);
    assert.equal(first.aliases.length, 2);
    assert.ok(first.aliases.includes('Tâches récurrentes'));
    assert.equal(first.status, 'planned');
    assert.equal(first.comments[0].body, 'Planned for the next release. Weekly and monthly first, custom rules after that.');
    const votes = r.json.entries.map((e) => e.votes);
    assert.deepEqual(votes, [...votes].sort((a, c) => c - a));
    const titles = r.json.entries.map((e) => e.title);
    for (const hidden of ['Sync with my Outlook calendar', 'Reminders arrive twice', 'make it better', 'test', 'Write the help page for shared lists', 'Repeat a task every week']) {
      assert.ok(!titles.includes(hidden), hidden);
    }
    assert.ok(!titles.some((t) => t.startsWith('Best crypto')));
    assert.ok(titles.includes('Export to PDF cuts off long lists'));
    assert.ok(r.json.entries.some((e) => e.source === 'owner' && e.title.startsWith('Home screen widgets')));
    assert.deepEqual(r.json.tag_counts[0], { tag: 'design', count: 3 });
    assert.deepEqual(r.json.voted, []);
  });

  test('stats and queue show the story: 2 pending, 1 flagged, 1 reported, 1 block, a run 2 hours ago', async () => {
    const t = await setup();
    const s = await t.stats();
    assert.equal(s.counts.pending, 2);
    assert.equal(s.counts.flagged, 1);
    assert.equal(s.counts.reported, 1);
    assert.equal(s.counts.private, 1);
    assert.equal(s.counts.merged, 2);
    assert.equal(s.counts.rejected, 2);
    assert.equal(s.blocks, 1);
    assert.equal(s.last_run.reviewer, 'claude');
    const hours = (Date.now() - Date.parse(s.last_run.at)) / 3600000;
    assert.ok(hours > 1.9 && hours < 2.1, String(hours));
    assert.deepEqual(s.last_run.counts, { publish: 2, reject: 2, merge: 1, flag: 1, tag: 0, keep: 0, block: 1, skipped: 0 });
    const q = (await t.admin('admin.queue')).json;
    assert.deepEqual(q.pending.map((e) => e.title), ['Reminders arrive twice', 'Sync with my Outlook calendar']);
    assert.equal(q.pending[1].context.app.platform, 'android');
    assert.equal(q.flagged.length, 1);
    assert.equal(q.flagged[0].title, 'make it better');
    assert.equal(q.flagged[0].ai.applied, false);
    assert.equal(q.flagged[0].ai.confidence, 55);
    assert.equal(q.reported.length, 1);
    assert.equal(q.reported[0].reports.open, 2);
    assert.deepEqual(q.reported[0].reports.reasons, { spam: 0, abusive: 1, off_topic: 0, other: 1 });
    assert.equal(q.private.length, 1);
    assert.equal(q.auto_apply_min_confidence, 80);
    assert.ok(q.tags.some((x) => x.tag === 'export'));
  });

  test('the triage run is real: log rows, a digest, the blocked spammer', async () => {
    const t = await setup();
    const runs = (await t.admin('admin.runs')).json.runs;
    assert.equal(runs.length, 1);
    assert.match(runs[0].digest, /spam/);
    const log = (await t.admin('admin.log', { query: { run_id: '1' } })).json;
    assert.equal(log.total, 7);
    assert.deepEqual(log.actions.map((a) => a.kind).sort(), ['block', 'flag', 'merge', 'publish', 'publish', 'reject', 'reject']);
    const blocked = (await t.admin('admin.entries', { query: { blocked: '1' } })).json;
    assert.equal(blocked.total, 1);
    assert.ok(blocked.entries[0].title.startsWith('Best crypto'));
    assert.equal(blocked.entries[0].author_blocked, true);
    assert.equal(blocked.entries[0].state, 'rejected');
    assert.equal(blocked.entries[0].reject_reason, 'spam');
  });
});

describe('voting', () => {
  test('vote on and off, once per voter key', async () => {
    const t = await setup();
    const id = await idOf(t, 'Dark mode');
    let r = await t.post('vote', { id, on: true });
    assert.deepEqual(r.json, { ok: true, id, votes: 28, voted: true });
    r = await t.post('vote', { id, on: true });
    assert.equal(r.json.votes, 28, 'voting twice counts once');
    assert.deepEqual((await t.publicList(ME)).voted, [id]);
    assert.deepEqual((await t.publicList()).voted, []);
    r = await t.post('vote', { id, on: false });
    assert.deepEqual(r.json, { ok: true, id, votes: 27, voted: false });
    r = await t.post('vote', { id, on: false });
    assert.equal(r.json.votes, 27);
    r = await t.post('vote', { id }, voterKey('other'));
    assert.equal(r.json.votes, 28, 'a second voter key counts too');
  });

  test('errors: no pass, bad voter, bad id, hidden entries', async () => {
    const t = await setup();
    let r = await t.b.call('vote', { body: { voter: ME, id: 1, on: true } });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'pass_invalid');
    assert.equal(r.json.message, 'The pass is missing or invalid.');
    r = await t.post('vote', { id: 1 }, 'short');
    assert.equal(r.status, 400);
    assert.equal(r.json.field, 'voter');
    r = await t.post('vote', { id: 'x' });
    assert.equal(r.json.field, 'id');
    r = await t.post('vote', { id: 1, on: 'yes' });
    assert.equal(r.json.field, 'on');
    const pendingId = await idOf(t, 'Reminders arrive twice');
    r = await t.post('vote', { id: pendingId });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'not_found');
    r = await t.post('vote', { id: 99999 });
    assert.equal(r.status, 404);
  });

  test('a vote for a merged entry counts for its target', async () => {
    const t = await setup();
    const merged = await idOf(t, 'Repeat a task every week');
    const r = await t.post('vote', { id: merged });
    assert.deepEqual(r.json, { ok: true, id: 1, votes: 32, voted: true });
  });
});

describe('adding and following an entry', () => {
  test('add is pending, shows in mine, the owner publishes it, then everybody sees it', async () => {
    const t = await setup();
    const r = await t.add({ title: '  Offline   mode ', body: 'Please.' });
    assert.equal(r.status, 200);
    assert.equal(r.json.entry.state, 'pending');
    assert.equal(r.json.entry.title, 'Offline mode');
    assert.equal(r.json.entry.votes, 1);
    assert.ok(r.json.entry.id > 0, 'a fast form is not faked in the demo');
    const receipt = r.json.receipt;
    let mine = (await t.b.call('mine', { body: { receipts: [receipt, 'nope'] } })).json.entries;
    assert.equal(mine.length, 1);
    assert.deepEqual(Object.keys(mine[0]), ['receipt', 'id', 'type', 'title', 'state', 'status', 'tags', 'comments', 'merged_into', 'merged_into_title', 'reject_reason']);
    assert.equal(mine[0].state, 'pending');
    assert.ok(!(await t.titles()).includes('Offline mode'));
    const e = await t.entry(r.json.entry.id);
    assert.equal(e.author, '7c3e9a1f');
    assert.equal(e.context.page, '/x', 'the query is dropped');
    const up = await t.adminPost('admin.update', { id: r.json.entry.id, state: 'published' });
    assert.equal(up.json.entry.state, 'published');
    assert.ok((await t.titles()).includes('Offline mode'));
    mine = (await t.b.call('mine', { body: { receipts: [receipt] } })).json.entries;
    assert.equal(mine[0].state, 'published');
    assert.deepEqual((await t.publicList(ME)).voted, [r.json.entry.id]);
  });

  test('mine shows flagged as pending, rejected with a reason, merged with its target', async () => {
    const t = await setup();
    const a = (await t.add({ title: 'First thing here' })).json;
    const c = (await t.add({ title: 'Second thing here' })).json;
    await t.adminPost('admin.update', { id: a.entry.id, state: 'flagged' });
    await t.adminPost('admin.update', { id: c.entry.id, state: 'rejected', reject_reason: 'unclear' });
    const mine = (await t.b.call('mine', { body: { receipts: [a.receipt, c.receipt] } })).json.entries;
    assert.equal(mine[0].state, 'pending');
    assert.equal(mine[1].state, 'rejected');
    assert.equal(mine[1].reject_reason, 'unclear');
    await t.adminPost('admin.update', { id: a.entry.id, state: 'published' });
    await t.adminPost('admin.update', { id: c.entry.id, state: 'pending' });
    await t.adminPost('admin.update', { id: c.entry.id, merge_into: a.entry.id });
    const m2 = (await t.b.call('mine', { body: { receipts: [c.receipt] } })).json.entries[0];
    assert.equal(m2.state, 'merged');
    assert.equal(m2.merged_into, a.entry.id);
    assert.equal(m2.merged_into_title, 'First thing here');
    const tooMany = await t.b.call('mine', { body: { receipts: new Array(51).fill('x') } });
    assert.equal(tooMany.json.field, 'receipts');
  });

  test('validation errors name the field', async () => {
    const t = await setup();
    const cases = [
      [{ title: 'abc' }, 'title', 'The title is too short (at least 4 characters).'],
      [{ title: '   a   b   ' }, 'title', 'The title is too short (at least 4 characters).'],
      [{ title: '!!!!!!' }, 'title', 'The title needs at least one letter or digit.'],
      [{ title: 'x'.repeat(121) }, 'title', 'The title is too long (at most 120 characters).'],
      [{ title: 12345 }, 'title', 'Give your argh a title.'],
      [{ type: 'rant' }, 'type', 'The type must be idea, bug or question.'],
      [{ body: 'y'.repeat(2001) }, 'body', 'The details are too long (at most 2000 characters).'],
      [{ body: 'a http://a.com b https://b.com c www.c.com' }, 'body', 'Too many links. At most 2 allowed.'],
    ];
    for (const [extra, field, message] of cases) {
      const r = await t.add(extra);
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.equal(r.json.error, 'invalid_input');
      assert.equal(r.json.field, field);
      assert.equal(r.json.message, message);
    }
    assert.equal((await t.add({ title: 'x'.repeat(120), body: 'y'.repeat(2000) })).status, 200);
    assert.equal((await t.add({ body: 'see http://a.com and www.b.com' })).status, 200);
  });

  test('a filled honeypot gets the bots\' fake success, nothing stored', async () => {
    const t = await setup();
    const before = (await t.stats()).counts.pending;
    const r = await t.add({ hp: 'gotcha' });
    assert.equal(r.json.entry.id, 0);
    assert.equal((await t.stats()).counts.pending, before);
  });

  test('session: a token or {app: true} gets a pass, nothing gets 403', async () => {
    const t = await setup();
    let r = await t.b.call('session', { body: { app: true } });
    assert.equal(r.json.expires_in, 1800);
    assert.ok(r.json.pass && r.json.expires_at);
    r = await t.b.call('session', { body: {} });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'turnstile_failed');
    r = await t.b.call('add', { body: { voter: ME, type: 'idea', title: 'No pass here' } });
    assert.equal(r.json.error, 'pass_invalid');
  });
});

describe('reports', () => {
  test('a third reporter hides the entry (it goes back to pending)', async () => {
    const t = await setup();
    const worst = await idOf(t, 'Worst app ever, total waste of time');
    const r = await t.post('report', { id: worst, reason: 'spam' });
    assert.deepEqual(r.json, { ok: true, id: worst });
    const e = await t.entry(worst);
    assert.equal(e.state, 'pending');
    assert.equal(e.reports.open, 3);
    assert.ok(!(await t.titles()).includes('Worst app ever, total waste of time'));
    const q = (await t.admin('admin.queue')).json;
    assert.ok(q.pending.some((p) => p.id === worst));
    assert.equal(q.reported.length, 0, 'a hidden entry shows in pending, not in reported');
    assert.equal((await t.stats()).counts.reported, 1, 'but it still counts as reported');
    const log = (await t.admin('admin.log', { query: { entry_id: String(worst) } })).json.actions;
    assert.equal(log[0].kind, 'report_hide');
    assert.equal(log[0].summary, 'Hidden after 3 reports.');
  });

  test('one report per voter key; bad reason; unknown, pending and owner entries are 404', async () => {
    const t = await setup();
    const dark = await idOf(t, 'Dark mode');
    assert.equal((await t.post('report', { id: dark, reason: 'spam' })).status, 200);
    assert.equal((await t.post('report', { id: dark, reason: 'abusive' })).status, 200);
    const reports = (await t.entry(dark)).reports;
    assert.deepEqual(reports.reasons, { spam: 1, abusive: 0, off_topic: 0, other: 0 });
    assert.equal(reports.open, 1);
    assert.equal(reports.total, 1);
    assert.ok(reports.last_at);
    const bad = await t.post('report', { id: dark, reason: 'rude' });
    assert.equal(bad.json.field, 'reason');
    for (const title of ['Reminders arrive twice', 'Write the help page for shared lists', 'Home screen widgets for iPhone and Android']) {
      const r = await t.post('report', { id: await idOf(t, title), reason: 'spam' });
      assert.equal(r.status, 404, title);
    }
    assert.equal((await t.post('report', { id: 4242, reason: 'spam' })).status, 404);
  });
});

describe('admin sign-in', () => {
  test('the wrong token is 401, the right one gives a csrf and stays signed in', async () => {
    const b = loadBackend();
    let r = await b.call('admin.login', { body: { token: 'nope' } });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { ok: false, error: 'unauthorized', message: 'That token is not right.' });
    assert.equal((await b.call('admin.login', { body: {} })).status, 401);
    assert.equal((await b.call('admin.login')).status, 405);
    assert.equal((await b.call('admin.me')).status, 401);
    r = await b.call('admin.login', { body: { token: 'demo' } });
    assert.equal(r.status, 200);
    assert.ok(r.json.csrf.length >= 32);
    assert.ok(b.storage.getItem('arghbox-demo:admin'));
    const me = await b.call('admin.me');
    assert.deepEqual(me.json, { ok: true, actor: 'owner', csrf: r.json.csrf });
    assert.equal(b.win.ArghBoxDemo.password, 'demo');
  });

  test('every admin POST needs the csrf; a bearer token works without it', async () => {
    const t = await setup();
    let r = await t.b.call('admin.comment', { body: { id: 1, body: 'hi' } });
    assert.equal(r.status, 401);
    assert.equal(r.json.message, 'The CSRF token is missing or wrong.');
    r = await t.b.call('admin.comment', { body: { id: 1, body: 'hi' }, csrf: 'wrong' });
    assert.equal(r.status, 401);
    r = await t.b.call('admin.comment', { body: { id: 1, body: 'hi' }, token: 'demo' });
    assert.equal(r.status, 200);
    const me = await t.b.call('admin.me', { token: 'demo' });
    assert.deepEqual(me.json, { ok: true, actor: 'owner' });
    const bad = await t.b.call('admin.me', { token: 'wrong' });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.message, 'Sign in with a valid token.');
  });

  test('logout ends the session; unknown actions and wrong methods answer like the PHP', async () => {
    const t = await setup();
    assert.equal((await t.adminPost('admin.logout', {})).status, 200);
    assert.equal((await t.admin('admin.stats')).status, 401);
    assert.equal(t.b.storage.getItem('arghbox-demo:admin'), null);
    let r = await t.b.call('admin.nothing');
    assert.deepEqual(r.json, { ok: false, error: 'not_found', message: 'Unknown action.' });
    assert.equal(r.status, 404);
    r = await t.b.call('vote');
    assert.equal(r.status, 405);
    assert.equal(r.json.message, 'Use POST for this action.');
    r = await t.b.call('list', { body: {} });
    assert.equal(r.status, 405);
    assert.equal((await t.b.call('add', { body: 'not json' })).status, 400);
    assert.equal((await t.b.call('add', { body: '[1]' })).json.message, 'The request body must be a JSON object.');
  });

  test('health answers for everyone, with more for the owner', async () => {
    const t = await setup();
    const anon = loadBackend();
    const a = (await anon.call('health')).json;
    assert.equal(a.ok, true);
    assert.equal(a.version, '0.1.2');
    assert.ok(!('config_location' in a));
    assert.ok('config_location' in (await t.admin('health')).json);
  });
});

describe('admin reads', () => {
  test('entries: filters, search, sort, paging', async () => {
    const t = await setup();
    const get = async (query) => (await t.admin('admin.entries', { query })).json;
    let r = await get({});
    assert.equal(r.total, 21);
    assert.equal(r.entries.length, 21);
    assert.deepEqual(Object.keys(r.entries[0]).slice(0, 13), ['id', 'type', 'title', 'body', 'votes', 'status', 'status_at', 'tags', 'comments', 'similar', 'aliases', 'source', 'created_at']);
    assert.equal((await get({ state: 'pending' })).total, 2);
    assert.equal((await get({ state: 'merged' })).total, 2);
    assert.equal((await get({ status: 'done' })).total, 2);
    assert.equal((await get({ type: 'question' })).total, 2);
    assert.equal((await get({ source: 'owner' })).total, 2);
    assert.equal((await get({ tag: 'mobile' })).total, 3);
    assert.equal((await get({ reported: '1' })).total, 1);
    assert.equal((await get({ q: 'SPREADSHEET' })).total, 1, 'q is case-insensitive');
    assert.equal((await get({ q: 'twice as big' })).total, 1, 'q searches comments');
    assert.equal((await get({ q: 'lisbon' })).total, 1, 'q searches bodies');
    r = await get({ sort: 'votes', limit: '3' });
    assert.deepEqual(r.entries.map((e) => e.votes), [31, 27, 21]);
    assert.equal(r.total, 21);
    r = await get({ sort: 'oldest', limit: '2', offset: '1' });
    assert.equal(r.entries.length, 2);
    const oldest = (await get({ sort: 'oldest' })).entries;
    assert.deepEqual(r.entries.map((e) => e.id), oldest.slice(1, 3).map((e) => e.id));
    for (const [q, field] of [[{ state: 'x' }, 'state'], [{ status: 'x' }, 'status'], [{ type: 'x' }, 'type'], [{ source: 'x' }, 'source'], [{ tag: 'X!' }, 'tag'], [{ sort: 'x' }, 'sort']]) {
      const e = await t.admin('admin.entries', { query: q });
      assert.equal(e.status, 400);
      assert.equal(e.json.field, field);
    }
  });

  test('entry carries its last 20 log rows; unknown id is 404', async () => {
    const t = await setup();
    const id = await idOf(t, 'Dark mode');
    for (let i = 0; i < 25; i++) await t.adminPost('admin.update', { id, title: `Dark mode ${i}` });
    const r = (await t.admin('admin.entry', { query: { id: String(id) } })).json;
    assert.equal(r.actions.length, 20);
    assert.deepEqual(Object.keys(r.actions[0]), ['id', 'at', 'actor', 'run_id', 'kind', 'entry_id', 'entry_title', 'summary', 'undone_by', 'undoable']);
    assert.equal(r.actions[0].summary, `Edited the title of #${id}.`);
    assert.equal((await t.admin('admin.entry', { query: { id: '9999' } })).status, 404);
    const log = (await t.admin('admin.log', { query: { entry_id: String(id), limit: '5', offset: '2' } })).json;
    assert.equal(log.total, 25);
    assert.equal(log.actions.length, 5);
  });
});

describe('admin changes', () => {
  test('update: status, type, title, body, tags, external_url', async () => {
    const t = await setup();
    const id = await idOf(t, 'Calendar view');
    const r = await t.adminPost('admin.update', { id, status: 'planned', type: 'question', title: 'Calendar   view!', body: 'New body', tags: ['Dates', 'mobile', 'dates'], external_url: 'https://example.com/issue/1' });
    assert.equal(r.status, 200);
    const e = r.json.entry;
    assert.equal(e.status, 'planned');
    assert.ok(e.status_at);
    assert.equal(e.type, 'question');
    assert.equal(e.title, 'Calendar view!');
    assert.equal(e.title_original, 'Calendar view');
    assert.equal(e.body, 'New body');
    assert.deepEqual(e.tags, ['dates', 'mobile']);
    assert.equal(e.external_url, 'https://example.com/issue/1');
    const kinds = (await t.admin('admin.log', { query: { entry_id: String(id) } })).json.actions.map((a) => a.kind);
    assert.deepEqual(kinds, ['set_status', 'tag', 'edit']);
    for (const [body, field] of [[{ status: 'x' }, 'status'], [{ type: 'x' }, 'type'], [{ title: 'ab' }, 'title'], [{ tags: ['a'] }, 'tags'], [{ tags: ['aa', 'bb', 'cc', 'dd'] }, 'tags'],
      [{ external_url: 'ftp://x.y' }, 'external_url'], [{ state: 'merged' }, 'state'], [{ reject_reason: 'x' }, 'reject_reason'], [{ state: 'private' }, 'state'], [{ id: 'x' }, 'id']]) {
      const bad = await t.adminPost('admin.update', { id, ...body });
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal(bad.json.field, field, JSON.stringify(body));
    }
    assert.equal((await t.adminPost('admin.update', { id: 9999, status: 'done' })).status, 404);
  });

  test('reject needs no reason (default other); a later reject_reason changes it', async () => {
    const t = await setup();
    const id = await idOf(t, 'Sync with my Outlook calendar');
    let e = (await t.adminPost('admin.update', { id, state: 'rejected' })).json.entry;
    assert.equal(e.state, 'rejected');
    assert.equal(e.reject_reason, 'other');
    e = (await t.adminPost('admin.update', { id, reject_reason: 'off_topic' })).json.entry;
    assert.equal(e.reject_reason, 'off_topic');
    assert.ok(!(await t.titles()).includes('Sync with my Outlook calendar'));
    assert.equal((await t.adminPost('admin.update', { id: await idOf(t, 'Dark mode'), state: 'pending' })).json.entry.state, 'pending');
    assert.equal((await t.adminPost('admin.update', { id: await idOf(t, 'Home screen widgets for iPhone and Android'), state: 'pending' })).json.field, 'state');
  });

  test('merge moves votes by copy, adds the title as an alias; a merged entry answers 409', async () => {
    const t = await setup();
    const keys = await idOf(t, 'Keyboard shortcuts');
    const cal = await idOf(t, 'Calendar view');
    let r = await t.adminPost('admin.update', { id: cal, merge_into: keys });
    assert.equal(r.status, 200);
    assert.equal(r.json.entry.state, 'merged');
    assert.equal(r.json.entry.merged_into, keys);
    const target = await t.entry(keys);
    assert.equal(target.votes, 11 + 17);
    assert.equal(target.similar, 1);
    assert.deepEqual(target.aliases, ['Calendar view']);
    assert.equal((await t.entry(cal)).votes, 17, 'the votes stay on the merged entry too');
    r = await t.adminPost('admin.update', { id: cal, status: 'done', state: 'published' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'conflict');
    r = await t.adminPost('admin.update', { id: cal, merge_into: keys });
    assert.equal(r.status, 409);
    for (const [body, msg] of [[{ merge_into: 99999 }, 'Cannot merge: merge target does not exist.'], [{ merge_into: keys, state: 'published' }, 'Send either state or merge_into, not both.']]) {
      r = await t.adminPost('admin.update', { id: keys, ...body });
      assert.equal(r.status, 400);
      assert.equal(r.json.field, 'merge_into');
      assert.equal(r.json.message, msg);
    }
    assert.equal((await t.adminPost('admin.update', { id: keys, merge_into: keys })).json.message, 'Cannot merge: an entry cannot be merged into itself.');
    const pending = await idOf(t, 'Reminders arrive twice');
    assert.equal((await t.adminPost('admin.update', { id: keys, merge_into: pending })).json.message, 'Cannot merge: merge target is not published.');
    const priv = await idOf(t, 'Write the help page for shared lists');
    assert.equal((await t.adminPost('admin.update', { id: priv, merge_into: keys })).json.message, 'Private items cannot be merged.');
  });

  test('comments: public shows on the board, hide withdraws it, private never shows', async () => {
    const t = await setup();
    const id = await idOf(t, 'Keyboard shortcuts');
    let r = await t.adminPost('admin.comment', { id, body: 'Coming soon.' });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json.comment), ['id', 'body', 'public', 'hidden', 'created_at', 'updated_at']);
    assert.equal(r.json.comment.public, true);
    const cid = r.json.comment.id;
    await t.adminPost('admin.comment', { id, body: 'Just for me.', public: false });
    const pub = async () => (await t.publicList()).entries.find((e) => e.id === id).comments.map((c) => c.body);
    assert.deepEqual(await pub(), ['Coming soon.']);
    assert.equal((await t.entry(id)).comments.length, 2);
    r = await t.adminPost('admin.comment_update', { comment_id: cid, hidden: true });
    assert.equal(r.json.comment.hidden, true);
    assert.deepEqual(await pub(), []);
    await t.adminPost('admin.comment_update', { comment_id: cid, hidden: false, body: 'Edited.' });
    assert.deepEqual(await pub(), ['Edited.']);
    assert.equal((await t.adminPost('admin.comment', { id, body: '   ' })).json.message, 'The comment is empty.');
    assert.equal((await t.adminPost('admin.comment', { id: 9999, body: 'x' })).status, 404);
    assert.equal((await t.adminPost('admin.comment_update', { comment_id: 9999, hidden: true })).status, 404);
    assert.equal((await t.adminPost('admin.comment_update', { comment_id: cid, body: '' })).json.message, 'The comment is empty. Hide it instead.');
    assert.equal((await t.adminPost('admin.comment_update', { comment_id: cid, hidden: 'x' })).json.field, 'hidden');
    const q = (await t.admin('admin.entries', { query: { q: 'just for me' } })).json;
    assert.equal(q.total, 1, 'private notes are searchable by the owner');
  });

  test('create: private by default, public when asked', async () => {
    const t = await setup();
    let r = await t.adminPost('admin.create', { type: 'idea', title: 'My private plan', tags: ['tasks'] });
    assert.equal(r.status, 200);
    assert.equal(r.json.entry.state, 'private');
    assert.equal(r.json.entry.source, 'owner');
    assert.equal(r.json.entry.votes, 0);
    assert.ok(!(await t.titles()).includes('My private plan'));
    r = await t.adminPost('admin.create', { type: 'bug', title: 'A public bug', body: 'x', status: 'in_progress', public: true, external_url: 'https://example.com/1' });
    assert.equal(r.json.entry.state, 'published');
    assert.equal(r.json.entry.status, 'in_progress');
    assert.ok((await t.titles()).includes('A public bug'));
    assert.equal((await t.adminPost('admin.create', { type: 'x', title: 'abcd' })).json.field, 'type');
    assert.equal((await t.adminPost('admin.create', { type: 'idea', title: 'abcd', public: 'yes' })).json.field, 'public');
    assert.equal((await t.adminPost('admin.create', { type: 'idea', title: 'abcd', status: 'x' })).json.field, 'status');
    const log = (await t.admin('admin.log', { query: { entry_id: String(r.json.entry.id) } })).json.actions[0];
    assert.equal(log.kind, 'create');
    assert.equal(log.undoable, false);
  });
});

describe('undo', () => {
  test('one action, then the 409 rule for an action with a later one', async () => {
    const t = await setup();
    const id = await idOf(t, 'Sync with my Outlook calendar');
    await t.adminPost('admin.update', { id, state: 'published' });
    await t.adminPost('admin.update', { id, status: 'planned' });
    const [setStatus, publish] = (await t.admin('admin.log', { query: { entry_id: String(id) } })).json.actions;
    let r = await t.adminPost('admin.undo', { action_id: publish.id });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'conflict');
    assert.equal(r.json.message, 'A later action on this entry must be undone first.');
    assert.deepEqual(r.json.refused, [{ action_id: publish.id, reason: r.json.message }]);
    assert.equal(publish.undoable, false);
    assert.equal(setStatus.undoable, true);
    r = await t.adminPost('admin.undo', { action_id: setStatus.id });
    assert.deepEqual(r.json, { ok: true, undone: [setStatus.id], refused: [] });
    assert.equal((await t.entry(id)).status, 'open');
    r = await t.adminPost('admin.undo', { action_id: setStatus.id });
    assert.equal(r.json.message, 'Already undone.');
    r = await t.adminPost('admin.undo', { action_id: publish.id });
    assert.equal(r.status, 200);
    assert.equal((await t.entry(id)).state, 'pending');
    assert.equal((await t.adminPost('admin.undo', { action_id: 99999 })).json.message, 'No such action.');
    assert.equal((await t.adminPost('admin.undo', {})).json.field, 'action_id');
    assert.equal((await t.adminPost('admin.undo', { run_id: 99 })).status, 404);
  });

  test('undoing the whole seeded run puts everything back, votes included', async () => {
    const t = await setup();
    const r = await t.adminPost('admin.undo', { run_id: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.json.undone.length, 7);
    assert.deepEqual(r.json.refused, []);
    const s = await t.stats();
    assert.equal(s.counts.pending, 8);
    assert.equal(s.counts.flagged, 0);
    assert.equal(s.counts.merged, 1);
    assert.equal(s.counts.rejected, 0);
    assert.equal(s.blocks, 0);
    const list = await t.publicList();
    assert.equal(list.entries.find((e) => e.id === 1).votes, 30);
    assert.equal(list.entries.find((e) => e.id === 1).similar, 1);
    assert.equal(list.entries.length, 11);
    const again = await t.adminPost('admin.undo', { run_id: 1 });
    assert.equal(again.json.undone.length, 0);
    assert.equal(again.json.refused.length, 7);
    assert.equal(again.json.refused[0].reason, 'Already undone.');
  });

  test('a run undo skips an action that a later change blocks', async () => {
    const t = await setup();
    const pdf = await idOf(t, 'Export to PDF cuts off long lists');
    await t.adminPost('admin.update', { id: pdf, status: 'planned' });
    const r = await t.adminPost('admin.undo', { run_id: 1 });
    assert.equal(r.json.undone.length, 6);
    assert.equal(r.json.refused.length, 1);
    assert.equal(r.json.refused[0].reason, 'A later action on this entry must be undone first.');
  });

  test('undo a comment edit, a comment, and a merge', async () => {
    const t = await setup();
    const id = await idOf(t, 'Keyboard shortcuts');
    const c = (await t.adminPost('admin.comment', { id, body: 'Soon.' })).json.comment;
    await t.adminPost('admin.comment_update', { comment_id: c.id, body: 'Later.' });
    const [edit, add] = (await t.admin('admin.log', { query: { entry_id: String(id) } })).json.actions;
    assert.equal((await t.adminPost('admin.undo', { action_id: add.id })).json.message, 'A later change to this comment must be undone first.');
    assert.equal((await t.adminPost('admin.undo', { action_id: edit.id })).status, 200);
    assert.equal((await t.entry(id)).comments[0].body, 'Soon.');
    assert.equal((await t.adminPost('admin.undo', { action_id: add.id })).status, 200);
    assert.equal((await t.entry(id)).comments[0].hidden, true);
    const cal = await idOf(t, 'Calendar view');
    await t.adminPost('admin.update', { id: cal, merge_into: id });
    const merge = (await t.admin('admin.log', { query: { entry_id: String(cal) } })).json.actions[0];
    assert.equal(merge.summary, `Merged #${cal} into #${id} (17 votes moved).`);
    await t.adminPost('admin.undo', { action_id: merge.id });
    assert.equal((await t.entry(id)).votes, 11);
    assert.equal((await t.entry(cal)).state, 'published');
  });
});

describe('blocks and dismissing reports', () => {
  test('block: the next add from that author is silently rejected, reports are ignored', async () => {
    const t = await setup();
    const first = (await t.add({ title: 'Nice idea number one' })).json.entry.id;
    await t.adminPost('admin.update', { id: first, state: 'published' });
    const r = await t.adminPost('admin.block', { id: first, note: 'testing' });
    assert.equal(r.status, 200);
    assert.equal(r.json.entry.author_blocked, true);
    assert.equal((await t.stats()).blocks, 2);
    const again = await t.adminPost('admin.block', { id: first });
    assert.equal(again.status, 200);
    const blockRows = (await t.admin('admin.log', { query: { entry_id: String(first), limit: '50' } })).json.actions.filter((a) => a.kind === 'block');
    assert.equal(blockRows.length, 1, 'blocking twice logs nothing');
    const second = await t.add({ title: 'Nice idea number two' });
    assert.equal(second.json.entry.state, 'pending', 'the author learns nothing');
    const e = await t.entry(second.json.entry.id);
    assert.equal(e.state, 'rejected');
    assert.equal(e.reject_reason, 'abuse');
    const dark = await idOf(t, 'Dark mode');
    assert.deepEqual((await t.post('report', { id: dark, reason: 'spam' })).json, { ok: true, id: dark });
    assert.equal((await t.entry(dark)).reports.open, 0, 'a blocked reporter changes nothing');
    assert.equal((await t.admin('admin.entries', { query: { blocked: '1' } })).json.total, 3);
    const lifted = await t.adminPost('admin.unblock', { id: first });
    assert.equal(lifted.json.entry.author_blocked, false);
    assert.equal((await t.stats()).blocks, 1);
    const ok = await t.add({ title: 'Nice idea number three' });
    assert.equal((await t.entry(ok.json.entry.id)).state, 'pending');
    const owner = await t.adminPost('admin.block', { id: await idOf(t, 'Home screen widgets for iPhone and Android') });
    assert.equal(owner.status, 409);
    assert.equal(owner.json.error, 'conflict');
  });

  test('dismiss_reports keeps a reported entry; undo opens the reports again', async () => {
    const t = await setup();
    const worst = await idOf(t, 'Worst app ever, total waste of time');
    const r = await t.adminPost('admin.dismiss_reports', { id: worst });
    assert.equal(r.json.entry.reports.open, 0);
    assert.equal(r.json.entry.reports.total, 2);
    assert.equal((await t.stats()).counts.reported, 0);
    const log = (await t.admin('admin.log', { query: { entry_id: String(worst) } })).json.actions[0];
    assert.equal(log.kind, 'dismiss_reports');
    assert.equal(log.summary, 'Dismissed 2 reports.');
    await t.adminPost('admin.undo', { action_id: log.id });
    assert.equal((await t.entry(worst)).reports.open, 2);
    assert.equal((await t.adminPost('admin.dismiss_reports', { id: 9999 })).status, 404);
  });

  test('publishing a hidden, reported entry clears its reports (and undo re-opens them)', async () => {
    const t = await setup();
    const worst = await idOf(t, 'Worst app ever, total waste of time');
    await t.post('report', { id: worst, reason: 'spam' });
    assert.equal((await t.entry(worst)).state, 'pending');
    const r = await t.adminPost('admin.update', { id: worst, state: 'published' });
    assert.equal(r.json.entry.reports.open, 0);
    const log = (await t.admin('admin.log', { query: { entry_id: String(worst) } })).json.actions[0];
    assert.equal(log.summary, `Published #${worst}. Cleared 3 reports.`);
    await t.adminPost('admin.undo', { action_id: log.id });
    assert.equal((await t.entry(worst)).reports.open, 3);
  });
});

describe('admin.apply', () => {
  test('decisions: low confidence flags, stale fingerprints and bad states are skipped', async () => {
    const t = await setup();
    const q = (await t.admin('admin.queue')).json;
    const [a, b] = q.pending;
    const published = q.published[0];
    const decisions = [
      { id: a.id, fingerprint: a.fingerprint, action: 'publish', confidence: 60, reason: 'unsure' },
      { id: b.id, fingerprint: 'stale', action: 'publish', confidence: 99 },
      { id: published.id, fingerprint: published.fingerprint, action: 'publish', confidence: 99 },
      { id: published.id, fingerprint: published.fingerprint, action: 'merge', merge_into: published.id, confidence: 99 },
      { id: 99999, fingerprint: 'x', action: 'publish', confidence: 99 },
      { id: a.id, action: 'nope' },
      'junk',
    ];
    const r = await t.adminPost('admin.apply', { run: { reviewer: 'Tester', digest: 'hello' }, decisions });
    assert.equal(r.status, 200);
    assert.equal(r.json.run_id, 2);
    assert.deepEqual(r.json.applied, [{ id: a.id, action: 'flag', flagged_instead: true }]);
    assert.deepEqual(r.json.skipped.map((s) => s.reason).sort(), ['changed', 'invalid_input', 'invalid_input', 'invalid_state', 'merge_target_invalid', 'not_found']);
    const run = (await t.admin('admin.runs', { query: { limit: '1' } })).json.runs[0];
    assert.equal(run.reviewer, 'Tester');
    assert.deepEqual(run.counts, { publish: 0, reject: 0, merge: 0, flag: 1, tag: 0, keep: 0, block: 0, skipped: 6 });
    assert.equal((await t.adminPost('admin.apply', { decisions: 'x' })).json.field, 'decisions');
  });

  test('keep clears reports of a published entry; tag needs tags; reject with block_author', async () => {
    const t = await setup();
    const q = (await t.admin('admin.queue')).json;
    const rep = q.reported[0];
    const keep = await t.adminPost('admin.apply', { decisions: [{ id: rep.id, fingerprint: rep.fingerprint, action: 'keep', confidence: 90, reason: 'fine' }] });
    assert.equal(keep.json.applied[0].action, 'keep');
    assert.equal((await t.entry(rep.id)).reports.open, 0);
    const [p] = q.pending;
    const bad = await t.adminPost('admin.apply', { decisions: [{ id: p.id, fingerprint: p.fingerprint, action: 'reject', reject_reason: 'other', block_author: true, confidence: 90 }] });
    assert.equal(bad.json.skipped[0].reason, 'invalid_input');
    const ok = await t.adminPost('admin.apply', { decisions: [{ id: p.id, fingerprint: p.fingerprint, action: 'reject', reject_reason: 'abuse', block_author: true, confidence: 90 }] });
    assert.deepEqual(ok.json.applied, [{ id: p.id, action: 'reject', flagged_instead: false, blocked: true }]);
    const dark = q.published.find((e) => e.title === 'Dark mode');
    const noTags = await t.adminPost('admin.apply', { decisions: [{ id: dark.id, fingerprint: dark.fingerprint, action: 'tag', confidence: 90 }] });
    assert.equal(noTags.json.skipped[0].reason, 'invalid_input');
    const tag = await t.adminPost('admin.apply', { decisions: [{ id: dark.id, fingerprint: dark.fingerprint, action: 'tag', tags: ['design'], confidence: 10 }] });
    assert.equal(tag.json.applied[0].action, 'tag');
  });
});

describe('export', () => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileOf = async (t, query) => {
    const r = await t.admin('admin.export', { query });
    assert.equal(r.status, 200);
    return r;
  };

  test('json: the whole box except rejected entries, with runs and tags', async () => {
    const t = await setup();
    const r = await fileOf(t, { format: 'json' });
    assert.match(r.headers.get('Content-Disposition'), new RegExp(`filename="arghbox-contoso-tasks-${day}.json"`));
    const doc = JSON.parse(r.text);
    assert.deepEqual(Object.keys(doc), ['exported_at', 'version', 'site', 'tags', 'entries', 'runs']);
    assert.equal(doc.site.name, 'Contoso Tasks');
    assert.equal(doc.entries.length, 19);
    assert.ok(doc.entries.every((e) => e.state !== 'rejected'));
    assert.equal(doc.runs.length, 1);
    assert.ok(r.text.includes('\n    "'), 'pretty printed');
    const pending = JSON.parse((await fileOf(t, { format: 'json', state: 'pending' })).text);
    assert.equal(pending.entries.length, 2);
    assert.equal((await t.admin('admin.export', { query: { format: 'xml' } })).json.field, 'format');
    assert.equal((await t.admin('admin.export', { query: { state: 'x' } })).json.field, 'state');
    assert.ok(JSON.parse((await t.admin('admin.export')).text).entries, 'json is the default');
  });

  test('csv: a BOM, the columns, formulas neutralised, comments joined', async () => {
    const t = await setup();
    await t.adminPost('admin.create', { type: 'idea', title: '=SUM(1,2) trick', body: 'a "quoted", line', public: true });
    const r = await fileOf(t, { format: 'csv', state: 'published' });
    assert.match(r.headers.get('Content-Disposition'), new RegExp(`filename="arghbox-contoso-tasks-${day}.csv"`));
    assert.ok(r.text.startsWith('﻿id,type,state,status,title,body,votes,tags,created_at,updated_at,merged_into,reject_reason,external_url,source,comments\r\n'));
    assert.ok(r.text.includes('"\'=SUM(1,2) trick"'));
    assert.ok(r.text.includes('"a ""quoted"", line"'));
    assert.ok(r.text.includes('Planned for the next release'));
    assert.equal(r.text.split('\r\n').filter(Boolean).length, 1 + 14);
  });

  test('jira-csv: published entries that are open, planned or in progress', async () => {
    const t = await setup();
    const r = await fileOf(t, { format: 'jira-csv', state: 'pending' });
    assert.match(r.headers.get('Content-Disposition'), new RegExp(`filename="arghbox-contoso-tasks-${day}-jira.csv"`));
    const lines = r.text.split('\r\n').filter(Boolean);
    assert.equal(lines[0], '﻿Summary,Description,Issue Type,Labels');
    assert.ok(r.text.includes('Story'));
    assert.ok(r.text.includes('Bug'));
    assert.ok(r.text.includes('From ArghBox #1, 31 votes'));
    assert.ok(!r.text.includes('A desktop app'), 'declined and done are left out');
    assert.ok(!r.text.includes('Outlook'), 'pending entries are left out, whatever the state says');
    assert.equal(lines.length - 1, 10);
  });

  test('a click on an export link downloads the file; signed out, it is left alone', async () => {
    const t = await setup();
    const handlers = t.b.listeners.click;
    assert.equal(handlers.length, 1);
    assert.equal(handlers[0].capture, true);
    const click = (href) => {
      const ev = { target: { closest: () => ({ href }) }, prevented: false, preventDefault() { this.prevented = true; } };
      handlers[0].fn(ev);
      return ev;
    };
    const ev = click(`${API}?action=admin.export&format=csv&state=published`);
    assert.equal(ev.prevented, true);
    assert.equal(t.b.downloads.length, 1);
    assert.match(t.b.downloads[0].download, /^arghbox-contoso-tasks-\d{8}\.csv$/);
    assert.ok(Buffer.from(await t.b.win.lastBlob.arrayBuffer()).toString('utf8').startsWith('﻿id,type'));
    assert.equal(click('http://localhost/other').prevented, false);
    assert.equal(click(`${API}?action=list`).prevented, false);
    await t.adminPost('admin.logout', {});
    assert.equal(click(`${API}?action=admin.export&format=json`).prevented, false);
    assert.equal(t.b.downloads.length, 1);
  });
});

describe('the browser side', () => {
  test('two tabs share one box through localStorage, signed in too', async () => {
    const storage = makeStorage();
    const one = loadBackend({ storage });
    const two = loadBackend({ storage });
    const pass = (await one.call('session', { body: { app: true } })).json.pass;
    const r = await one.call('add', { body: { pass, voter: ME, type: 'bug', title: 'Seen from a second tab' } });
    assert.equal(r.status, 200);
    const login = await one.call('admin.login', { body: { token: 'demo' } });
    const stats = await two.call('admin.stats');
    assert.equal(stats.json.counts.pending, 3, 'the admin session and the entry are shared');
    await two.call('admin.update', { csrf: login.json.csrf, body: { id: r.json.entry.id, state: 'published' } });
    assert.ok((await one.call('list')).json.entries.some((e) => e.title === 'Seen from a second tab'));
    assert.ok(one.events.includes('arghbox-demo:change'));
    assert.ok(two.events.includes('arghbox-demo:change'));
    assert.equal(JSON.parse(storage.getItem('arghbox-demo:v1')).v, 1);
    assert.equal(one.state().entries.length, two.state().entries.length);
  });

  test('a stored state with another schema version is replaced by a fresh seed', async () => {
    const storage = makeStorage();
    storage.setItem('arghbox-demo:v1', JSON.stringify({ v: 0, entries: [] }));
    const b = loadBackend({ storage });
    assert.equal((await b.call('list')).json.entries.length, 13);
    storage.setItem('arghbox-demo:v1', 'not json');
    assert.equal((await b.call('list')).json.entries.length, 13);
  });

  test('reset wipes the box, the session and every widget key, and leaves other keys alone', async () => {
    const t = await setup();
    t.b.storage.setItem('arghbox:voter', 'x');
    t.b.storage.setItem('arghbox:receipts', '[]');
    t.b.storage.setItem('arghbox:reported', '[1]');
    t.b.storage.setItem('unrelated', 'keep');
    await t.add({ title: 'Gone after reset' });
    t.b.win.ArghBoxDemo.reset();
    assert.deepEqual([...t.b.storage.map.keys()], ['unrelated']);
    assert.equal((await t.admin('admin.stats')).status, 401);
    assert.equal((await t.b.call('admin.stats', { token: 'demo' })).json.counts.pending, 2);
  });

  test('state() is a deep copy', async () => {
    const b = loadBackend();
    await b.call('list');
    const s = b.state();
    s.entries.length = 0;
    assert.equal(b.state().entries.length, 21);
  });

  test('without usable localStorage the demo keeps working in memory', async () => {
    const b = loadBackend({ brokenStorage: true });
    const pass = (await b.call('session', { body: { app: true } })).json.pass;
    const r = await b.call('add', { body: { pass, voter: ME, type: 'idea', title: 'Memory only entry' } });
    assert.equal(r.status, 200);
    assert.equal((await b.call('admin.login', { body: { token: 'demo' } })).status, 200);
    assert.equal((await b.call('admin.stats')).json.counts.pending, 3);
  });

  test('only the API is answered; other URLs go to the real fetch; Requests and aborts work', async () => {
    const seen = [];
    const b = loadBackend({ originalFetch: async (u) => { seen.push(String(u)); return { ok: true }; } });
    await b.win.fetch('http://localhost/arghbox/i18n/en.json');
    await b.win.fetch('https://example.com/api.php?action=list');
    assert.deepEqual(seen, ['http://localhost/arghbox/i18n/en.json', 'https://example.com/api.php?action=list']);
    const viaRequest = await b.win.fetch(new Request(`${API}?action=list`));
    assert.equal((await viaRequest.json()).entries.length, 13);
    const viaUrl = await b.win.fetch(new URL(`${API}?action=health`));
    assert.equal((await viaUrl.json()).ok, true);
    const rel = await b.win.fetch('../api.php?action=health');
    assert.equal(rel.status, 200);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(b.win.fetch(`${API}?action=list`, { signal: ac.signal }), { name: 'AbortError' });
    assert.equal(seen.length, 2);
  });

  test('the Turnstile stand-in passes without loading anything, unless one already exists', async () => {
    const b = loadBackend();
    const ts = b.win.turnstile;
    const tokens = [];
    const id = ts.render({}, { execution: 'execute', callback: (t) => tokens.push(t) });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(tokens, []);
    ts.execute(id);
    await new Promise((r) => setImmediate(r));
    assert.equal(tokens.length, 1);
    assert.equal(ts.getResponse(id), tokens[0]);
    ts.reset(id);
    assert.equal(ts.getResponse(id), null);
    ts.remove(id);
    assert.equal(ts.getResponse(id), undefined);
    const own = { render() {} };
    assert.equal(loadBackend({ extra: { turnstile: own } }).win.turnstile, own);
  });
});

describe('review fixes', () => {
  test('a damaged stored box is reseeded instead of failing every request', async () => {
    for (const bad of ['{"v":1}', '{"v":1,"settings":{},"next":{},"entries":[]}', 'not json', '[]']) {
      const storage = makeStorage();
      storage.setItem('arghbox-demo:v1', bad);
      const b = loadBackend({ storage });
      const r = await b.call('list');
      assert.equal(r.status, 200, bad);
      assert.equal(r.json.entries.length, 13, bad);
    }
  });

  test('null means "use the default", like PHP ??', async () => {
    const t = await setup();
    const on = await t.post('vote', { id: 3, on: null });
    assert.equal(on.status, 200);
    assert.equal(on.json.voted, true);
    const created = await t.adminPost('admin.create', { type: 'idea', title: 'Null defaults', status: null, public: null });
    assert.equal(created.status, 200);
    assert.equal(created.json.entry.state, 'private');
    assert.equal(created.json.entry.status, 'open');
    const c = await t.adminPost('admin.comment', { id: created.json.entry.id, body: 'Hello', public: null });
    assert.equal(c.status, 200);
    assert.equal((await t.entry(created.json.entry.id)).comments[0].public, true);
  });

  test('a linked issue URL must be a real http(s) URL, as strict as the PHP', async () => {
    const t = await setup();
    for (const bad of ['http:example.com', 'http:/example.com', 'http://-', 'https://a..b', 'ftp://example.com', 'https://exa mple.com']) {
      const r = await t.adminPost('admin.update', { id: 3, external_url: bad });
      assert.equal(r.status, 400, bad);
      assert.equal(r.json.field, 'external_url', bad);
    }
    for (const good of ['https://github.com/acme/app/issues/12', 'http://jira.example.com:8080/browse/APP-1', 'https://[::1]/x']) {
      const r = await t.adminPost('admin.update', { id: 3, external_url: good });
      assert.equal(r.status, 200, good);
    }
  });
});
