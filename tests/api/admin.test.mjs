import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { newVoter, nextIp, startArghBox } from '../helpers/server.mjs';

const ADMIN_ACTIONS = [
  ['admin.me', 'GET'], ['admin.logout', 'POST'], ['admin.queue', 'GET'], ['admin.apply', 'POST'], ['admin.create', 'POST'],
  ['admin.update', 'POST'], ['admin.comment', 'POST'], ['admin.comment_update', 'POST'], ['admin.undo', 'POST'],
  ['admin.entries', 'GET'], ['admin.log', 'GET'], ['admin.runs', 'GET'], ['admin.stats', 'GET'],
];

/** Add an entry through the public API; returns its id. */
async function mk(box, title, extra = {}, ip = nextIp()) {
  const r = await box.add({ title, ...extra }, ip);
  assert.equal(r.status, 200, r.text);
  return r.json.entry.id;
}
const fp = async (box, id) => {
  const q = (await box.admin('admin.entries', { query: { limit: '200' } })).json.entries;
  return q.find((e) => e.id === id).fingerprint;
};
const entry = async (box, id) => (await box.admin('admin.entries', { query: { limit: '200' } })).json.entries.find((e) => e.id === id);
const counts = async (box) => (await box.admin('admin.stats')).json.counts;

describe('authentication', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { limits: { admin_logins_per_hour: 3 } } }); });
  after(async () => { await box.stop(); });

  test('every admin action refuses anonymous callers and wrong tokens', async () => {
    for (const [action, method] of ADMIN_ACTIONS) {
      const anon = await box.call(action, { method, body: method === 'POST' ? {} : undefined, ip: nextIp() });
      assert.equal(anon.status, 401, action);
      assert.equal(anon.json.error, 'unauthorized', action);
      const wrong = await box.call(action, { method, token: 'not-the-token', body: method === 'POST' ? {} : undefined, ip: nextIp() });
      assert.equal(wrong.status, 401, action);
    }
    const badScheme = await box.call('admin.me', { headers: { Authorization: 'Basic abc' }, ip: nextIp() });
    assert.equal(badScheme.status, 401);
  });

  test('owner and triage bearer tokens work; actor reflects the token', async () => {
    const o = await box.admin('admin.me');
    assert.deepEqual([o.status, o.json.actor], [200, 'owner']);
    assert.equal('csrf' in o.json, false);
    const t = await box.triage('admin.me');
    assert.equal(t.json.actor, 'triage:triage');
    const named = await box.triage('admin.me', { query: { reviewer: 'Claude Test' } });
    assert.equal(named.json.actor, 'triage:Claude Test');
  });

  test('login sets a signed HttpOnly SameSite=Strict cookie; triage token cannot log in', async () => {
    const bad = await box.call('admin.login', { body: { token: box.triageToken }, ip: nextIp() });
    assert.equal(bad.status, 401);
    const ok = await box.call('admin.login', { body: { token: box.ownerToken }, ip: nextIp() });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.csrf);
    const sc = ok.headers.getSetCookie().find((c) => c.startsWith('arghbox_admin='));
    assert.ok(sc, 'cookie set');
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Strict/i);
    assert.match(sc, /path=\//i);
    assert.doesNotMatch(sc, /Secure/i, 'plain http');
    const secure = await box.call('admin.login', { body: { token: box.ownerToken }, ip: nextIp(), headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(secure.headers.getSetCookie().find((c) => c.startsWith('arghbox_admin=')), /Secure/i);
    const cookie = sc.split(';')[0];

    const me = await box.call('admin.me', { cookie });
    assert.equal(me.json.actor, 'owner');
    assert.equal(me.json.csrf, ok.json.csrf);
    assert.equal((await box.call('admin.stats', { cookie })).status, 200, 'GET needs no CSRF');

    const noCsrf = await box.call('admin.create', { cookie, body: { type: 'idea', title: 'Cookie without CSRF' } });
    assert.equal(noCsrf.status, 401);
    const wrongCsrf = await box.call('admin.create', { cookie, headers: { 'X-ArghBox-CSRF': 'nope' }, body: { type: 'idea', title: 'Cookie wrong CSRF' } });
    assert.equal(wrongCsrf.status, 401);
    const good = await box.call('admin.create', { cookie, headers: { 'X-ArghBox-CSRF': ok.json.csrf }, body: { type: 'idea', title: 'Cookie with CSRF' } });
    assert.equal(good.status, 200);
    assert.equal((await box.call('admin.logout', { method: 'POST', cookie, headers: { 'X-ArghBox-CSRF': ok.json.csrf }, body: {} })).status, 200);
    const tampered = await box.call('admin.me', { cookie: cookie.slice(0, -3) + 'AAA' });
    assert.equal(tampered.status, 401);
  });

  test('login attempts are rate limited per IP', async () => {
    const ip = nextIp();
    for (let i = 0; i < 3; i++) assert.equal((await box.call('admin.login', { body: { token: 'wrong' + i }, ip })).status, 401);
    const r = await box.call('admin.login', { body: { token: 'wrong-again' }, ip });
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
    // a correct token is accepted even from a throttled address
    assert.equal((await box.call('admin.login', { body: { token: box.ownerToken }, ip })).status, 200);
  });
});

describe('owner items, tags and comments', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', tags: ['preset-tag'] } }); });
  after(async () => { await box.stop(); });

  test('admin.create makes a private owner item without votes', async () => {
    const r = await box.admin('admin.create', { body: { type: 'bug', title: '  Fix   the thing ', body: 'details', status: 'in_progress', tags: ['Zeta', 'alpha', 'alpha'] } });
    assert.equal(r.status, 200, r.text);
    const e = r.json.entry;
    assert.equal(e.state, 'private');
    assert.equal(e.source, 'owner');
    assert.equal(e.votes, 0);
    assert.equal(e.title, 'Fix the thing');
    assert.equal(e.status, 'in_progress');
    assert.deepEqual(e.tags, ['alpha', 'zeta']);
    assert.ok(e.status_at);
    assert.equal(e.author, '');
    // never in the public API
    assert.equal((await box.list()).json.entries.length, 0);
    assert.equal((await box.vote(e.id, true, newVoter(), nextIp())).status, 404);
    // listed as context in the queue
    const q = (await box.admin('admin.queue')).json;
    assert.deepEqual(q.private.map((p) => p.id), [e.id]);
    assert.deepEqual(Object.keys(q.private[0]).sort(), ['id', 'status', 'tags', 'title', 'type']);
    assert.equal((await counts(box)).private, 1);
  });

  test('admin.create validation and public:true', async () => {
    const bad = [{ type: 'x', title: 'Valid title' }, { type: 'idea', title: 'abc' }, { type: 'idea', title: 'Valid title', status: 'nope' },
      { type: 'idea', title: 'Valid title', tags: ['a', 'b', 'c', 'd'] }, { type: 'idea', title: 'Valid title', tags: ['bad tag!'] },
      { type: 'idea', title: 'Valid title', tags: 'x' }, { type: 'idea', title: 'Valid title', public: 'yes' }];
    for (const body of bad) {
      const r = await box.admin('admin.create', { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error, 'invalid_input');
    }
    const pub = await box.admin('admin.create', { body: { type: 'idea', title: 'Public owner idea', public: true, tags: ['roadmap'] } });
    assert.equal(pub.json.entry.state, 'published');
    const l = (await box.list()).json.entries.find((e) => e.id === pub.json.entry.id);
    assert.equal(l.source, 'owner');
    assert.equal(l.votes, 0);
    // links are not limited for the owner
    const links = await box.admin('admin.create', { body: { type: 'idea', title: 'Many links', body: 'http://a http://b http://c http://d' } });
    assert.equal(links.status, 200);
  });

  test('owner items switch between private and published; visitor items cannot go private', async () => {
    const o = (await box.admin('admin.create', { body: { type: 'idea', title: 'Switchable owner item' } })).json.entry;
    const up = await box.admin('admin.update', { body: { id: o.id, state: 'published' } });
    assert.equal(up.json.entry.state, 'published');
    assert.ok((await box.list()).json.entries.some((e) => e.id === o.id));
    const down = await box.admin('admin.update', { body: { id: o.id, state: 'private' } });
    assert.equal(down.json.entry.state, 'private');
    assert.ok(!(await box.list()).json.entries.some((e) => e.id === o.id));
    const v = await mk(box, 'A visitor entry here');
    const r = await box.admin('admin.update', { body: { id: v, state: 'private' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.field, 'state');
    const p = await box.admin('admin.update', { body: { id: o.id, state: 'pending' } });
    assert.equal(p.status, 400);
    const log = (await box.admin('admin.log', { query: { entry_id: String(o.id) } })).json.actions.map((a) => a.kind);
    assert.deepEqual(log, ['private', 'publish', 'create']);
  });

  test('tags: update replaces, validates, sorts; vocabulary includes presets; admin.entries filters', async () => {
    const id = await mk(box, 'Taggable visitor entry');
    const r = await box.admin('admin.update', { body: { id, tags: ['b-tag', 'a-tag'] } });
    assert.deepEqual(r.json.entry.tags, ['a-tag', 'b-tag']);
    for (const tags of [['A_B'], ['x'], ['a-tag', 'b-tag', 'c-tag', 'd-tag'], ['-bad'], [5], 'nope', ['x'.repeat(25)]]) {
      const bad = await box.admin('admin.update', { body: { id, tags } });
      assert.equal(bad.status, 400, JSON.stringify(tags));
      assert.equal(bad.json.field, 'tags');
    }
    const q = (await box.admin('admin.queue')).json;
    const vocab = Object.fromEntries(q.tags.map((t) => [t.tag, t.count]));
    assert.equal(vocab['preset-tag'], 0);
    assert.equal(vocab['a-tag'], 1);
    assert.deepEqual(q.published.find((p) => p.id === id).tags, ['a-tag', 'b-tag']);
    const byTag = (await box.admin('admin.entries', { query: { tag: 'a-tag' } })).json;
    assert.deepEqual(byTag.entries.map((e) => e.id), [id]);
    assert.equal((await box.admin('admin.entries', { query: { source: 'owner' } })).json.entries.every((e) => e.source === 'owner'), true);
    assert.equal((await box.admin('admin.entries', { query: { source: 'visitor' } })).json.entries.every((e) => e.source === 'visitor'), true);
    assert.equal((await box.admin('admin.entries', { query: { tag: 'Bad Tag' } })).status, 400);
    const l = (await box.list()).json;
    assert.deepEqual(l.tag_counts.filter((t) => t.tag === 'a-tag'), [{ tag: 'a-tag', count: 1 }]);
  });

  test('status changes set status_at', async () => {
    const id = await mk(box, 'Status moving entry');
    const before = await entry(box, id);
    assert.equal(before.status_at, null);
    const r = await box.admin('admin.update', { body: { id, status: 'planned' } });
    assert.equal(r.json.entry.status, 'planned');
    assert.ok(r.json.entry.status_at);
    const same = await box.admin('admin.update', { body: { id, status: 'planned' } });
    assert.equal(same.json.entry.status_at, r.json.entry.status_at);
    assert.equal((await box.admin('admin.update', { body: { id, status: 'weird' } })).json.field, 'status');
    assert.equal((await box.admin('admin.update', { body: { id: 99999, status: 'done' } })).status, 404);
  });

  test('comments: public vs private, hide, edit, nothing deleted, undo', async () => {
    const id = await mk(box, 'Comment target entry');
    const c1 = await box.admin('admin.comment', { body: { id, body: 'Public answer.' } });
    assert.equal(c1.status, 200, c1.text);
    assert.equal(c1.json.comment.public, true);
    assert.equal(c1.json.comment.hidden, false);
    const c2 = await box.admin('admin.comment', { body: { id, body: 'Private note.', public: false } });
    assert.equal(c2.json.comment.public, false);
    assert.equal(c2.json.entry.comments.length, 2, 'admin sees every comment');
    const pubView = () => box.list().then((r) => r.json.entries.find((e) => e.id === id));
    assert.deepEqual((await pubView()).comments.map((c) => c.body), ['Public answer.']);
    assert.equal('reply' in (await pubView()), false);
    assert.equal('reply_at' in (await pubView()), false);

    const edit = await box.admin('admin.comment_update', { body: { comment_id: c1.json.comment.id, body: 'Edited answer.' } });
    assert.equal(edit.json.comment.body, 'Edited answer.');
    assert.deepEqual((await pubView()).comments.map((c) => c.body), ['Edited answer.']);
    const makePublic = await box.admin('admin.comment_update', { body: { comment_id: c2.json.comment.id, public: true } });
    assert.equal(makePublic.json.comment.public, true);
    assert.equal((await pubView()).comments.length, 2);
    const hide = await box.admin('admin.comment_update', { body: { comment_id: c2.json.comment.id, hidden: true } });
    assert.equal(hide.json.comment.hidden, true);
    assert.equal((await pubView()).comments.length, 1);
    assert.equal(hide.json.entry.comments.length, 2, 'hidden comments are kept for the owner');

    // undo the hide (a comment_edit) restores it
    const log = (await box.admin('admin.log', { query: { entry_id: String(id) } })).json.actions;
    assert.deepEqual(log.slice(0, 4).map((a) => a.kind), ['comment_edit', 'comment_edit', 'comment_edit', 'comment']);
    const hideAction = log[0];
    assert.equal(hideAction.undoable, true);
    assert.match(hideAction.summary, /comment/i);
    const undo = await box.admin('admin.undo', { body: { action_id: hideAction.id } });
    assert.deepEqual(undo.json.undone, [hideAction.id]);
    assert.equal((await pubView()).comments.length, 2);
    // undoing the original `comment` hides it; blocked while later edits of it are not undone
    const first = log.find((a) => a.kind === 'comment' && a.summary.includes('Commented publicly'));
    assert.equal((await box.admin('admin.undo', { body: { action_id: first.id } })).status, 409);
    for (const a of log.slice(1, 3)) {
      const u = await box.admin('admin.undo', { body: { action_id: a.id } });
      assert.equal(u.status, 200, JSON.stringify(u.json));
    }
    const u = await box.admin('admin.undo', { body: { action_id: first.id } });
    assert.equal(u.status, 200);
    const final = (await entry(box, id)).comments;
    assert.equal(final.length, 2);
    assert.equal(final.filter((c) => c.hidden).length, 1);
    assert.ok(final.every((c) => c.body));
  });

  test('comment validation; commenting on private items works; comments are searchable', async () => {
    const id = (await box.admin('admin.create', { body: { type: 'idea', title: 'Private with comment' } })).json.entry.id;
    assert.equal((await box.admin('admin.comment', { body: { id, body: '   ' } })).json.field, 'body');
    assert.equal((await box.admin('admin.comment', { body: { id, body: 'x'.repeat(2001) } })).json.field, 'body');
    assert.equal((await box.admin('admin.comment', { body: { id: 99999, body: 'hello' } })).status, 404);
    assert.equal((await box.admin('admin.comment', { body: { id, body: 'hello', public: 'no' } })).json.field, 'public');
    assert.equal((await box.admin('admin.comment', { body: { id, body: 'zebra-crossing note' } })).status, 200);
    const found = (await box.admin('admin.entries', { query: { q: 'zebra-crossing' } })).json;
    assert.deepEqual(found.entries.map((e) => e.id), [id]);
    assert.equal((await box.admin('admin.comment_update', { body: { comment_id: 99999, hidden: true } })).status, 404);
    assert.equal((await box.admin('admin.comment_update', { body: { comment_id: 1, public: 'x' } })).status, 400);
  });

  test('at most 20 public comments are shown, oldest first', async () => {
    const id = await mk(box, 'Chatty entry here');
    for (let i = 1; i <= 22; i++) await box.admin('admin.comment', { body: { id, body: `comment ${i}` } });
    const l = (await box.list()).json.entries.find((e) => e.id === id);
    assert.equal(l.comments.length, 20);
    assert.equal(l.comments[0].body, 'comment 1');
    assert.equal((await entry(box, id)).comments.length, 22);
  });
});

describe('admin.update', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'pending' } }); });
  after(async () => { await box.stop(); });

  test('state changes, one action per group, reject reasons, merged entries are locked', async () => {
    const id = await mk(box, 'Needs a decision');
    const pub = await box.admin('admin.update', { body: { id, state: 'published', type: 'bug', title: 'Reworded decision entry', status: 'planned' } });
    assert.equal(pub.status, 200, pub.text);
    assert.equal(pub.json.entry.state, 'published');
    assert.equal(pub.json.entry.type, 'bug');
    assert.equal(pub.json.entry.title, 'Reworded decision entry');
    assert.equal(pub.json.entry.title_original, 'Needs a decision');
    const kinds = (await box.admin('admin.log', { query: { entry_id: String(id) } })).json.actions.map((a) => a.kind);
    assert.deepEqual(kinds.reverse(), ['edit', 'set_status', 'publish']);
    const rej = await box.admin('admin.update', { body: { id, state: 'rejected' } });
    assert.equal(rej.json.entry.reject_reason, 'other');
    const rej2 = await box.admin('admin.update', { body: { id, reject_reason: 'spam' } });
    assert.equal(rej2.json.entry.reject_reason, 'spam');
    assert.equal((await box.admin('admin.update', { body: { id, reject_reason: 'because' } })).json.field, 'reject_reason');
    const back = await box.admin('admin.update', { body: { id, state: 'pending' } });
    assert.equal(back.json.entry.reject_reason, null);
    assert.equal((await box.admin('admin.update', { body: { id, state: 'nonsense' } })).json.field, 'state');
    assert.equal((await box.admin('admin.update', { body: { id, state: 'published', merge_into: 1 } })).status, 400);
    assert.equal((await box.admin('admin.update', { body: { id, title: 'abc' } })).json.field, 'title');
    assert.equal((await box.admin('admin.update', { body: { id } })).status, 200, 'no change is fine');
    assert.equal((await box.admin('admin.update', { body: {} })).status, 400);
  });

  test('merge: target must be published, no self merge, no cycle; merged entries need undo', async () => {
    const a = await mk(box, 'Merge entry alpha');
    const b = await mk(box, 'Merge entry bravo');
    const c = await mk(box, 'Merge entry charlie');
    for (const id of [a, b]) await box.admin('admin.update', { body: { id, state: 'published' } });
    assert.equal((await box.admin('admin.update', { body: { id: a, merge_into: a } })).status, 400);
    assert.equal((await box.admin('admin.update', { body: { id: a, merge_into: c } })).status, 400, 'target is pending');
    assert.equal((await box.admin('admin.update', { body: { id: a, merge_into: 99999 } })).status, 400);
    assert.equal((await box.admin('admin.update', { body: { id: a, merge_into: 'x' } })).status, 400);
    const m = await box.admin('admin.update', { body: { id: a, merge_into: b } });
    assert.equal(m.json.entry.state, 'merged');
    assert.equal(m.json.entry.merged_into, b);
    const cycle = await box.admin('admin.update', { body: { id: b, merge_into: a } });
    assert.equal(cycle.status, 400, 'merging B into its own merged child would be a cycle');
    assert.match(cycle.json.message, /cycle/);
    assert.equal((await box.admin('admin.update', { body: { id: a, state: 'published' } })).status, 409);
    assert.equal((await box.admin('admin.update', { body: { id: a, merge_into: b } })).status, 409);
    // chains resolve to the final target
    await box.admin('admin.update', { body: { id: c, state: 'published' } });
    assert.equal((await box.admin('admin.update', { body: { id: b, merge_into: c } })).status, 200);
    const l = (await box.list()).json.entries.find((e) => e.id === c);
    assert.equal(l.similar, 2);
    assert.equal(l.aliases.length, 2);
    const viaChain = await box.admin('admin.update', { body: { id: await mk(box, 'Another chained one'), merge_into: a } });
    assert.equal(viaChain.status, 200, 'merging into a merged entry resolves to the final target');
    assert.equal(viaChain.json.entry.merged_into, c);
  });
});

describe('admin.apply', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'pending', auto_apply_min_confidence: 80 } }); });
  after(async () => { await box.stop(); });

  const D = (id, fingerprint, action, extra = {}) => ({ id, fingerprint, action, confidence: 95, reason: 'because', ...extra });
  const apply = (decisions, run = { reviewer: 'Test Reviewer', digest: 'line one\nline two' }, who = 'admin') => box[who]('admin.apply', { body: { run, decisions } });

  test('ordering, low confidence, stale, invalid targets, tags, reject reasons, run counts', async () => {
    const p1 = await mk(box, 'Pending one wording');
    const p2 = await mk(box, 'Pending two spammy');
    const p3 = await mk(box, 'Pending three duplicate');
    const p4 = await mk(box, 'Pending four unsure');
    const p5 = await mk(box, 'Pending five lowconf');
    const p6 = await mk(box, 'Pending six to p5');
    const p7 = await mk(box, 'Pending seven stale');
    const p8 = await mk(box, 'Pending eight no reason');
    const p9 = await mk(box, 'Pending nine tag on pending');
    const f = {};
    for (const id of [p1, p2, p3, p4, p5, p6, p7, p8, p9]) f[id] = await fp(box, id);
    await box.admin('admin.update', { body: { id: p7, title: 'Pending seven edited' } });

    const r = await apply([
      D(p3, f[p3], 'merge', { merge_into: p1 }), // listed first, but merges run last
      D(p1, f[p1], 'publish', { title: 'Cleaned wording for one', type: 'bug', tags: ['export', 'csv'], title_en: 'English one' }),
      D(p2, f[p2], 'reject', { reject_reason: 'spam', reason: 'link farm' }),
      D(p4, f[p4], 'flag', { confidence: 40, tags: ['maybe'] }),
      D(p5, f[p5], 'publish', { confidence: 50 }),
      D(p6, f[p6], 'merge', { merge_into: p5 }),
      D(p7, f[p7], 'publish'),
      D(99999, 'abcdabcdabcdabcd', 'publish'),
      D(p8, f[p8], 'reject'),
      D(p9, f[p9], 'tag', { tags: ['x-tag'] }),
      { id: p1, action: 'nonsense' },
      'not an object',
    ]);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    const byId = Object.fromEntries(r.json.applied.map((a) => [a.id, a]));
    assert.deepEqual(r.json.applied.map((a) => a.id), [p1, p2, p4, p5, p3], 'publish/reject/flag first, merges last');
    assert.deepEqual(byId[p1], { id: p1, action: 'publish', flagged_instead: false });
    assert.deepEqual(byId[p4], { id: p4, action: 'flag', flagged_instead: false });
    assert.deepEqual(byId[p5], { id: p5, action: 'flag', flagged_instead: true });
    assert.deepEqual(byId[p3], { id: p3, action: 'merge', flagged_instead: false });
    const sk = Object.fromEntries(r.json.skipped.map((s) => [s.id, s.reason]));
    assert.equal(sk[p6], 'merge_target_invalid', 'p5 was flagged, so it is not a valid merge target');
    assert.equal(sk[p7], 'changed');
    assert.equal(sk[99999], 'not_found');
    assert.equal(sk[p8], 'invalid_input', 'reject needs a reason');
    assert.equal(sk[p9], 'invalid_state', 'tag only on published entries');
    assert.equal(r.json.skipped.filter((s) => s.id === null).length, 1, 'non-object decision');
    assert.equal(r.json.skipped.filter((s) => s.id === p1).length, 1, 'unknown action');

    const e1 = await entry(box, p1);
    assert.equal(e1.state, 'published');
    assert.equal(e1.title, 'Cleaned wording for one');
    assert.equal(e1.title_original, 'Pending one wording');
    assert.equal(e1.type, 'bug');
    assert.deepEqual(e1.tags, ['csv', 'export']);
    assert.equal(e1.ai.action, 'publish');
    assert.equal(e1.ai.reviewer, 'Test Reviewer');
    assert.equal(e1.ai.run_id, r.json.run_id);
    assert.equal(e1.ai.applied, true);
    assert.equal(e1.ai.title_en, 'English one');
    assert.equal(e1.ai.confidence, 95);
    const e2 = await entry(box, p2);
    assert.equal(e2.state, 'rejected');
    assert.equal(e2.reject_reason, 'spam');
    assert.equal(e2.ai.reason, 'link farm');
    const e4 = await entry(box, p4);
    assert.equal(e4.state, 'flagged');
    assert.deepEqual(e4.tags, ['maybe']);
    const e5 = await entry(box, p5);
    assert.equal(e5.state, 'flagged');
    assert.equal(e5.ai.action, 'publish', 'the suggestion is kept');
    assert.equal(e5.ai.applied, false);
    assert.equal(e5.title, 'Pending five lowconf', 'wording changes are not applied when flagged instead');
    const e3 = await entry(box, p3);
    assert.equal(e3.state, 'merged');
    assert.equal(e3.merged_into, p1);
    assert.equal((await entry(box, p1)).votes, 2, 'the merged entry has its own voter, moved to the target');

    const run = (await box.admin('admin.runs')).json.runs[0];
    assert.equal(run.id, r.json.run_id);
    assert.equal(run.reviewer, 'Test Reviewer');
    assert.equal(run.digest, 'line one\nline two');
    assert.deepEqual(run.counts, { publish: 1, reject: 1, merge: 1, flag: 2, tag: 0, keep: 0, block: 0, skipped: 7 });
    assert.equal((await box.admin('admin.stats')).json.last_run.id, run.id);
    const log = (await box.admin('admin.log', { query: { run_id: String(run.id) } })).json;
    assert.equal(log.total, 5);
    assert.ok(log.actions.every((a) => a.run_id === run.id && a.actor === 'owner'));
    assert.ok(log.actions.every((a) => typeof a.summary === 'string' && a.summary.length > 0));
  });

  test('tag decisions replace tags on published entries and are never turned into a flag', async () => {
    const id = await mk(box, 'Tag me please now');
    await box.admin('admin.update', { body: { id, state: 'published', tags: ['old-tag'] } });
    const r = await apply([D(id, await fp(box, id), 'tag', { tags: ['new-tag', 'other-tag'], confidence: 5 })]);
    assert.deepEqual(r.json.applied, [{ id, action: 'tag', flagged_instead: false }]);
    const e = await entry(box, id);
    assert.deepEqual(e.tags, ['new-tag', 'other-tag']);
    assert.equal(e.state, 'published');
    assert.equal((await box.admin('admin.runs')).json.runs[0].counts.tag, 1);
    const missing = await apply([D(id, await fp(box, id), 'tag')]);
    assert.equal(missing.json.skipped[0].reason, 'invalid_input', 'tags are required for a tag decision');
    const bad = await apply([D(id, await fp(box, id), 'tag', { tags: ['a', 'bb', 'cc', 'dd'] })]);
    assert.equal(bad.json.skipped[0].reason, 'invalid_input');
  });

  test('merge decisions on published entries; low confidence merges are skipped; cycles and self refused', async () => {
    const a = await mk(box, 'Published alpha entry');
    const b = await mk(box, 'Published bravo entry');
    for (const id of [a, b]) await box.admin('admin.update', { body: { id, state: 'published' } });
    const low = await apply([D(a, await fp(box, a), 'merge', { merge_into: b, confidence: 30 })]);
    assert.equal(low.json.skipped[0].reason, 'low_confidence');
    assert.equal((await entry(box, a)).state, 'published', 'a published entry is never flagged by triage');
    const self = await apply([D(a, await fp(box, a), 'merge', { merge_into: a })]);
    assert.equal(self.json.skipped[0].reason, 'merge_target_invalid');
    const publishAgain = await apply([D(a, await fp(box, a), 'publish')]);
    assert.equal(publishAgain.json.skipped[0].reason, 'invalid_state');
    const ok = await apply([D(a, await fp(box, a), 'merge', { merge_into: b })]);
    assert.equal(ok.json.applied[0].action, 'merge');
    const cyc = await apply([D(b, await fp(box, b), 'merge', { merge_into: a })]);
    assert.equal(cyc.json.skipped[0].reason, 'merge_target_invalid');
  });

  test('a merge may target an entry published in the same batch', async () => {
    const a = await mk(box, 'Batch source entry');
    const b = await mk(box, 'Batch target entry');
    const r = await apply([D(a, await fp(box, a), 'merge', { merge_into: b }), D(b, await fp(box, b), 'publish')]);
    assert.deepEqual(r.json.applied.map((x) => x.action), ['publish', 'merge']);
    assert.equal((await entry(box, a)).merged_into, b);
  });

  test('votes are moved without double counting, and undoing the merge restores the counts', async () => {
    const b2 = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const vA = [newVoter(), newVoter()];
      const vB = [newVoter(), newVoter()];
      const A = (await b2.add({ title: 'Votes source entry', voter: vA[0] }, nextIp())).json.entry.id;
      const B = (await b2.add({ title: 'Votes target entry', voter: vB[0] }, nextIp())).json.entry.id;
      const shared = newVoter();
      await b2.vote(A, true, vA[1], nextIp());
      await b2.vote(A, true, shared, nextIp());
      await b2.vote(B, true, shared, nextIp());
      await b2.vote(B, true, vB[1], nextIp());
      assert.equal((await b2.list()).json.entries.find((e) => e.id === B).votes, 3);
      assert.equal((await b2.list()).json.entries.find((e) => e.id === A).votes, 3);
      const m = await b2.admin('admin.update', { body: { id: A, merge_into: B } });
      assert.equal(m.json.ok, true);
      assert.equal((await b2.list()).json.entries.find((e) => e.id === B).votes, 5, '3 + 2 moved (shared voter counted once)');
      const e = (await b2.admin('admin.entries', { query: { state: 'merged' } })).json.entries[0];
      assert.equal(e.votes, 3, 'the merged entry keeps its own votes');
      const log = (await b2.admin('admin.log', { query: { entry_id: String(A) } })).json.actions;
      assert.match(log[0].summary, /2 votes moved/);
      assert.equal(log[0].undoable, true);
      const u = await b2.admin('admin.undo', { body: { action_id: log[0].id } });
      assert.deepEqual(u.json, { ok: true, undone: [log[0].id], refused: [] });
      const l = (await b2.list()).json.entries;
      assert.equal(l.find((e2) => e2.id === B).votes, 3);
      assert.equal(l.find((e2) => e2.id === A).votes, 3);
      assert.equal(l.find((e2) => e2.id === A).similar, 0);
      assert.equal(l.find((e2) => e2.id === B).similar, 0);
      const again = await b2.admin('admin.undo', { body: { action_id: log[0].id } });
      assert.equal(again.status, 409, 'already undone');
    } finally {
      await b2.stop();
    }
  });

  test('undo is refused when a later action exists; undo of an undo is refused', async () => {
    const id = await mk(box, 'Undo ordering entry');
    await box.admin('admin.update', { body: { id, state: 'published' } });
    await box.admin('admin.update', { body: { id, status: 'planned' } });
    const log = (await box.admin('admin.log', { query: { entry_id: String(id) } })).json.actions;
    const [setStatus, publish] = log;
    assert.equal(setStatus.kind, 'set_status');
    assert.equal(publish.undoable, false);
    const refused = await box.admin('admin.undo', { body: { action_id: publish.id } });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, 'conflict');
    assert.equal(refused.json.refused[0].action_id, publish.id);
    assert.equal((await box.admin('admin.undo', { body: { action_id: setStatus.id } })).status, 200);
    const e = await entry(box, id);
    assert.equal(e.status, 'open');
    const log2 = (await box.admin('admin.log', { query: { entry_id: String(id) } })).json.actions;
    assert.equal(log2[0].kind, 'undo');
    assert.equal(log2[0].undoable, false);
    assert.equal((await box.admin('admin.undo', { body: { action_id: log2[0].id } })).status, 409);
    assert.equal((await box.admin('admin.undo', { body: { action_id: publish.id } })).status, 200, 'now the later action is undone');
    assert.equal((await entry(box, id)).state, 'pending');
    assert.equal((await box.admin('admin.undo', { body: { action_id: 99999 } })).status, 409);
    assert.equal((await box.admin('admin.undo', { body: {} })).status, 400);
    assert.equal((await box.admin('admin.undo', { body: { run_id: 99999 } })).status, 404);
  });

  test('undoing a whole run restores everything and reports what it could not undo; nothing is deleted', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await mk(box, `Run undo entry ${i} here`));
    const before = await counts(box);
    const total = Object.values(before).reduce((a, b) => a + b, 0);
    const r = await apply([
      D(ids[0], await fp(box, ids[0]), 'publish', { tags: ['run-tag'] }),
      D(ids[1], await fp(box, ids[1]), 'reject', { reject_reason: 'test' }),
      D(ids[2], await fp(box, ids[2]), 'flag', { confidence: 20 }),
      D(ids[3], await fp(box, ids[3]), 'merge', { merge_into: ids[0] }),
    ], { reviewer: 'Undo Run', digest: 'd' }, 'triage');
    assert.equal(r.json.applied.length, 4);
    // a later owner action blocks undoing the publish of ids[0]
    await box.admin('admin.update', { body: { id: ids[0], status: 'done' } });
    const u = await box.admin('admin.undo', { body: { run_id: r.json.run_id } });
    assert.equal(u.status, 200);
    assert.equal(u.json.undone.length, 3);
    assert.equal(u.json.refused.length, 1);
    assert.match(u.json.refused[0].reason, /later action/);
    assert.equal((await entry(box, ids[1])).state, 'pending');
    assert.equal((await entry(box, ids[1])).reject_reason, null);
    assert.equal((await entry(box, ids[2])).state, 'pending');
    assert.equal((await entry(box, ids[3])).state, 'pending');
    assert.equal((await entry(box, ids[0])).state, 'published');
    // unblock and finish the run
    const doneAction = (await box.admin('admin.log', { query: { entry_id: String(ids[0]) } })).json.actions.find((a) => a.kind === 'set_status');
    await box.admin('admin.undo', { body: { action_id: doneAction.id } });
    const u2 = await box.admin('admin.undo', { body: { run_id: r.json.run_id } });
    assert.equal(u2.json.undone.length, 1);
    assert.equal(u2.json.refused.length, 3, 'already undone');
    const e0 = await entry(box, ids[0]);
    assert.equal(e0.state, 'pending');
    assert.deepEqual(e0.tags, []);
    assert.equal(e0.ai, null);
    const after = await counts(box);
    assert.equal(Object.values(after).reduce((a, b) => a + b, 0), total, 'nothing was deleted');
    assert.equal(after.pending, before.pending);
  });

  test('triage bearer is the actor of its run; admin.apply accepts large batches', async () => {
    const id = await mk(box, 'Triage actor entry');
    const r = await apply([D(id, await fp(box, id), 'publish')], { reviewer: 'Claude Opus', digest: 'x'.repeat(3000) }, 'triage');
    assert.equal(r.json.applied.length, 1);
    const log = (await box.admin('admin.log', { query: { run_id: String(r.json.run_id) } })).json.actions;
    assert.equal(log[0].actor, 'triage:Claude Opus');
    assert.equal((await box.admin('admin.runs')).json.runs[0].digest.length, 2000);
    const big = Array.from({ length: 120 }, (_, i) => D(900000 + i, 'abcdabcdabcdabcd', 'publish', { reason: 'r'.repeat(300) }));
    const rr = await apply(big);
    assert.equal(rr.status, 200);
    assert.equal(rr.json.skipped.length, 120);
    assert.equal((await apply('nope')).status, 400);
  });

  test('queue lists pending oldest first with admin fields, flagged, published and private context', async () => {
    const b = await startArghBox();
    try {
      const x = (await b.add({ title: 'Queue first entry' }, nextIp())).json.entry.id;
      const y = (await b.add({ title: 'Queue second entry' }, nextIp())).json.entry.id;
      await b.admin('admin.update', { body: { id: y, state: 'flagged' } });
      const q = (await b.admin('admin.queue')).json;
      assert.deepEqual(q.pending.map((e) => e.id), [x]);
      assert.deepEqual(q.flagged.map((e) => e.id), [y]);
      assert.equal(q.site.name, 'Test Box');
      assert.equal(q.site.about, 'A test site.');
      assert.equal(q.moderation, 'pending');
      assert.equal(q.auto_apply_min_confidence, 80);
      for (const k of ['state', 'merged_into', 'reject_reason', 'title_original', 'body_original', 'context', 'ai', 'author', 'fingerprint', 'updated_at', 'comments', 'tags', 'status_at', 'source']) {
        assert.ok(k in q.pending[0], k);
      }
      assert.match(q.pending[0].fingerprint, /^[0-9a-f]{16}$/);
      assert.equal(q.pending[0].author.length, 8);
      assert.ok(!JSON.stringify(q).includes('author_hash'));
    } finally {
      await b.stop();
    }
  });
});

describe('log, stats, entries filters', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('stats counts include private; entries filter by state, type and q; pagination', async () => {
    const a = await mk(box, 'Searchable pineapple idea', { type: 'idea' });
    await mk(box, 'Another bug report here', { type: 'bug' });
    await box.admin('admin.create', { body: { type: 'idea', title: 'Owner private task' } });
    const s = (await box.admin('admin.stats')).json;
    assert.deepEqual(s.counts, { pending: 0, published: 2, rejected: 0, merged: 0, flagged: 0, private: 1, reported: 0 });
    assert.equal(s.votes, 2);
    assert.equal(s.entries_last_7_days, 2);
    assert.equal(s.last_run, null);
    assert.equal((await box.admin('admin.entries', { query: { state: 'private' } })).json.total, 1);
    assert.equal((await box.admin('admin.entries', { query: { type: 'bug' } })).json.total, 1);
    assert.deepEqual((await box.admin('admin.entries', { query: { q: 'pineapple' } })).json.entries.map((e) => e.id), [a]);
    assert.equal((await box.admin('admin.entries', { query: { q: '100%_' } })).json.total, 0);
    const page = await box.admin('admin.entries', { query: { limit: '1', offset: '1' } });
    assert.equal(page.json.total, 3);
    assert.equal(page.json.entries.length, 1);
    assert.equal((await box.admin('admin.entries', { query: { state: 'bogus' } })).status, 400);
    const newest = (await box.admin('admin.entries')).json.entries;
    assert.ok(newest[0].id > newest[1].id, 'newest first');
    assert.equal((await box.admin('admin.log', { query: { limit: '1' } })).json.actions.length, 1);
    assert.equal((await box.admin('admin.runs', { query: { limit: '5' } })).json.runs.length, 0);
  });
});
