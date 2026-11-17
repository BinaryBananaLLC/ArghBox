// Reports, auto-hide, blocks, triage keep / block_author and the schema 3 -> 4 migration (docs/SPEC.md section 6b).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { newVoter, nextIp, startArghBox } from '../helpers/server.mjs';
import { dbRows } from '../helpers/db.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';

const mk = async (box, title, extra = {}, ip = nextIp()) => {
  const r = await box.add({ title, ...extra }, ip);
  assert.equal(r.status, 200, r.text);
  r.json.ip = ip;
  return r.json.entry.id;
};
const entry = async (box, id) => (await box.admin('admin.entry', { query: { id: String(id) } })).json.entry;
const log = async (box, entryId) => (await box.admin('admin.log', { query: { entry_id: String(entryId), limit: '50' } })).json.actions;
const kinds = async (box, entryId) => (await log(box, entryId)).map((a) => a.kind).reverse();

/** POST report. Fresh IP, voter and pass unless given. */
async function report(box, id, reason = 'spam', { ip = nextIp(), voter = newVoter(), pass } = {}) {
  pass = pass ?? (await box.session(ip));
  const r = await box.call('report', { body: { pass, voter, id, reason }, ip });
  r.ip = ip;
  r.voter = voter;
  return r;
}
async function reportMany(box, id, n, reason = 'spam') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await report(box, id, reason);
    assert.equal(r.status, 200, r.text);
    out.push(r);
  }
  return out;
}
const decide = (box, id, fingerprint, action, extra = {}) => ({ id, fingerprint, action, confidence: 95, reason: 'test', ...extra });
const apply = (box, decisions, opts = {}) => box.admin('admin.apply', { body: { run: { reviewer: 'Tester', digest: 'digest' }, decisions }, ...opts });

describe('report action', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('a report is stored, answers only {ok, id}, and shows up on the admin entry', async () => {
    const id = await mk(box, 'Please add a unicorn mode');
    const before = await entry(box, id);
    assert.deepEqual(before.reports, { open: 0, total: 0, reasons: { spam: 0, abusive: 0, off_topic: 0, other: 0 }, last_at: null });
    assert.equal(before.author_blocked, false);
    const r = await report(box, id, 'abusive');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, id });
    const e = await entry(box, id);
    assert.equal(e.reports.open, 1);
    assert.equal(e.reports.total, 1);
    assert.deepEqual(e.reports.reasons, { spam: 0, abusive: 1, off_topic: 0, other: 0 });
    assert.match(e.reports.last_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(e.state, 'published', 'one report does not hide it');
    // Raw IPs and voter keys are never stored.
    const rows = dbRows(box, 'SELECT * FROM reports WHERE entry_id = ?', [id]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].ip_hash, /^[0-9a-f]{64}$/);
    assert.match(rows[0].voter_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(rows[0]).includes(r.ip));
    assert.ok(!JSON.stringify(rows[0]).includes(r.voter));
  });

  test('all four reasons are accepted and counted per reason', async () => {
    const id = await mk(box, 'Entry that collects every reason');
    const ip = nextIp(); // one network, so the entry is not hidden along the way
    for (const reason of ['spam', 'abusive', 'off_topic', 'other']) {
      assert.equal((await report(box, id, reason, { ip })).status, 200, reason);
    }
    const e = await entry(box, id);
    assert.deepEqual(e.reports.reasons, { spam: 1, abusive: 1, off_topic: 1, other: 1 });
    assert.equal(e.reports.open, 4);
  });

  test('validation: reason, id, voter, pass and method', async () => {
    const id = await mk(box, 'Entry for validation checks');
    const ip = nextIp();
    const pass = await box.session(ip);
    const voter = newVoter();
    const post = (body, opts = {}) => box.call('report', { body, ip, ...opts });
    for (const reason of [undefined, '', 'rude', 'SPAM', 7, null, ['spam'], { a: 1 }]) {
      const r = await post({ pass, voter, id, reason });
      assert.equal(r.status, 400, JSON.stringify(reason));
      assert.equal(r.json.error, 'invalid_input');
      assert.equal(r.json.field, 'reason');
    }
    for (const bad of [undefined, 0, -1, '5', 1.5, null, true]) {
      const r = await post({ pass, voter, id: bad, reason: 'spam' });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.json.field, 'id');
    }
    const badVoter = await post({ pass, voter: 'short', id, reason: 'spam' });
    assert.equal(badVoter.status, 400);
    assert.equal(badVoter.json.field, 'voter');
    const noPass = await post({ voter, id, reason: 'spam' });
    assert.equal(noPass.status, 401);
    assert.equal(noPass.json.error, 'pass_invalid');
    const otherIp = await post({ pass, voter, id, reason: 'spam' }, { ip: nextIp() });
    assert.equal(otherIp.status, 401, 'a pass belongs to one network');
    const get = await box.call('report', { method: 'GET', ip });
    assert.equal(get.status, 405);
    assert.equal((await entry(box, id)).reports.total, 0, 'nothing was stored by the bad requests');
  });

  test('not_found: unknown, pending, merged, rejected, flagged and owner items', async () => {
    const pub = await mk(box, 'A published target to merge into');
    const merged = await mk(box, 'This one gets merged away');
    const rejected = await mk(box, 'This one gets rejected');
    const flagged = await mk(box, 'This one gets flagged');
    const pending = await mk(box, 'This one goes back to pending');
    assert.equal((await box.admin('admin.update', { body: { id: merged, merge_into: pub } })).status, 200);
    assert.equal((await box.admin('admin.update', { body: { id: rejected, state: 'rejected' } })).status, 200);
    assert.equal((await box.admin('admin.update', { body: { id: flagged, state: 'flagged' } })).status, 200);
    assert.equal((await box.admin('admin.update', { body: { id: pending, state: 'pending' } })).status, 200);
    const priv = (await box.admin('admin.create', { body: { type: 'idea', title: 'Private owner task' } })).json.entry.id;
    const ownerPublic = (await box.admin('admin.create', { body: { type: 'idea', title: 'Public owner announcement', public: true } })).json.entry.id;
    for (const id of [999999, merged, rejected, flagged, pending, priv, ownerPublic]) {
      const r = await report(box, id);
      assert.equal(r.status, 404, `id ${id}`);
      assert.equal(r.json.error, 'not_found');
    }
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM reports WHERE entry_id IN (?, ?, ?, ?, ?, ?)', [merged, rejected, flagged, pending, priv, ownerPublic])[0].n, 0);
    assert.equal((await report(box, pub)).status, 200, 'the published visitor entry can be reported');
  });

  test('reporting twice with the same voter key changes nothing, even from another network', async () => {
    const id = await mk(box, 'Entry reported twice by one person');
    const first = await report(box, id, 'spam');
    const again = await report(box, id, 'abusive', { voter: first.voter });
    assert.equal(again.status, 200);
    assert.deepEqual(again.json, { ok: true, id });
    const e = await entry(box, id);
    assert.equal(e.reports.open, 1);
    assert.equal(e.reports.reasons.spam, 1);
    assert.equal(e.reports.reasons.abusive, 0, 'the first reason stands');
  });

  test('the rate limit is per network address and counts only new reports', async () => {
    const small = await startArghBox({ config: { moderation: 'publish', limits: { reports_per_hour: 2 }, report_hide_at: 0 } });
    try {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(await mk(small, `Rate limit target number ${i}`));
      const ip = nextIp();
      const pass = await small.session(ip);
      const voter = newVoter();
      const send = (id) => small.call('report', { body: { pass, voter, id, reason: 'other' }, ip });
      assert.equal((await send(ids[0])).status, 200);
      assert.equal((await send(ids[0])).status, 200, 'a repeat does not use the allowance');
      assert.equal((await send(ids[1])).status, 200);
      const limited = await send(ids[2]);
      assert.equal(limited.status, 429);
      assert.equal(limited.json.error, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      // Another network address is unaffected.
      assert.equal((await report(small, ids[2])).status, 200);
    } finally {
      await small.stop();
    }
  });
});

describe('auto-hide', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('hides at report_hide_at distinct reporting networks, not at distinct voter keys', async () => {
    const id = await mk(box, 'Entry that deserves some reports');
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      assert.equal((await report(box, id, 'spam', { ip })).status, 200); // five voter keys, one network
    }
    let e = await entry(box, id);
    assert.equal(e.reports.open, 5);
    assert.equal(e.state, 'published', 'five reports from one network are one reporter');
    await report(box, id, 'off_topic');
    e = await entry(box, id);
    assert.equal(e.state, 'published', 'two reporters');
    const third = await report(box, id, 'other');
    assert.deepEqual(third.json, { ok: true, id }, 'the answer never says that it was hidden');
    e = await entry(box, id);
    assert.equal(e.state, 'pending', 'three reporters hide it');
    assert.equal(e.reports.open, 7);
  });

  test('a hidden entry leaves the list and the feed, is pending for "mine", and is logged by the system', async () => {
    const author = await box.add({ title: 'Entry that will be hidden soon' }, nextIp());
    const id = author.json.entry.id;
    await reportMany(box, id, 3);
    const list = await box.list();
    assert.ok(!list.json.entries.some((e) => e.id === id));
    const feed = await box.call('feed');
    assert.ok(!feed.text.includes('Entry that will be hidden soon'));
    const mine = await box.call('mine', { body: { receipts: [author.json.receipt] } });
    assert.equal(mine.json.entries[0].state, 'pending');
    assert.equal(mine.json.entries[0].reject_reason, null);
    const rows = await log(box, id);
    const hide = rows.find((a) => a.kind === 'report_hide');
    assert.equal(hide.actor, 'system');
    assert.equal(hide.summary, 'Hidden after 3 reports.');
    assert.equal(hide.undoable, true);
    const queue = (await box.admin('admin.queue')).json;
    const q = queue.pending.find((e) => e.id === id);
    assert.ok(q, 'it waits in the pending queue');
    assert.equal(q.reports.open, 3, 'pending entries keep their reports for the reviewer');
    assert.ok(!queue.reported.some((e) => e.id === id), 'the Reported list holds published entries only');
  });

  test('undoing the hide restores published and leaves the reports open', async () => {
    const id = await mk(box, 'Entry whose hiding gets undone');
    await reportMany(box, id, 3);
    const hide = (await log(box, id)).find((a) => a.kind === 'report_hide');
    const u = await box.admin('admin.undo', { body: { action_id: hide.id } });
    assert.equal(u.status, 200, u.text);
    const e = await entry(box, id);
    assert.equal(e.state, 'published');
    assert.equal(e.reports.open, 3);
    assert.ok((await box.list()).json.entries.some((x) => x.id === id));
  });

  test('report_hide is an entry-field action: a later change blocks its undo', async () => {
    const id = await mk(box, 'Entry with a later change');
    await reportMany(box, id, 3);
    const hide = (await log(box, id)).find((a) => a.kind === 'report_hide');
    await box.admin('admin.update', { body: { id, status: 'planned' } });
    const u = await box.admin('admin.undo', { body: { action_id: hide.id } });
    assert.equal(u.status, 409);
    assert.equal(u.json.error, 'conflict');
  });

  test('more reports after the entry is hidden do not hide it twice; a hidden entry cannot be reported', async () => {
    const id = await mk(box, 'Entry reported after hiding');
    await reportMany(box, id, 3);
    const late = await report(box, id);
    assert.equal(late.status, 404, 'pending entries are not reportable');
    assert.equal((await kinds(box, id)).filter((k) => k === 'report_hide').length, 1);
  });

  test('the threshold is configurable: 1 hides at once, 0 never hides', async () => {
    const one = await startArghBox({ config: { moderation: 'publish', report_hide_at: 1 } });
    const zero = await startArghBox({ config: { moderation: 'publish', report_hide_at: 0 } });
    try {
      const a = await mk(one, 'Hidden by a single report');
      await report(one, a);
      assert.equal((await entry(one, a)).state, 'pending');
      const b = await mk(zero, 'Never hidden automatically');
      await reportMany(zero, b, 6);
      const e = await entry(zero, b);
      assert.equal(e.state, 'published');
      assert.equal(e.reports.open, 6);
      assert.equal((await zero.admin('admin.stats')).json.counts.reported, 1, 'it still lands in the Reported count');
      assert.deepEqual(await kinds(zero, b), [], 'no system action was logged');
    } finally {
      await one.stop();
      await zero.stop();
    }
  });
});

describe('clearing reports', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('admin.dismiss_reports clears every open report, is logged, and can be undone', async () => {
    const id = await mk(box, 'Entry that the owner decides to keep');
    await reportMany(box, id, 2, 'off_topic');
    const r = await box.admin('admin.dismiss_reports', { body: { id } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.entry.id, id);
    assert.equal(r.json.entry.reports.open, 0);
    assert.equal(r.json.entry.reports.total, 2, 'cleared reports still count as total');
    assert.deepEqual(r.json.entry.reports.reasons, { spam: 0, abusive: 0, off_topic: 0, other: 0 });
    assert.equal(r.json.entry.reports.last_at, null);
    const row = (await log(box, id)).find((a) => a.kind === 'dismiss_reports');
    assert.equal(row.summary, 'Dismissed 2 reports.');
    assert.equal(row.actor, 'owner');
    assert.equal(row.undoable, true);
    const cleared = dbRows(box, 'SELECT cleared_at, cleared_by FROM reports WHERE entry_id = ?', [id]);
    assert.ok(cleared.every((c) => c.cleared_at && Number(c.cleared_by) === row.id));
    // Undo re-opens them.
    const u = await box.admin('admin.undo', { body: { action_id: row.id } });
    assert.equal(u.status, 200, u.text);
    assert.equal((await entry(box, id)).reports.open, 2);
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM reports WHERE entry_id = ? AND cleared_at IS NULL', [id])[0].n, 2);
  });

  test('dismissing with nothing open is a harmless no-op; unknown ids are 404; bad ids 400', async () => {
    const id = await mk(box, 'Entry nobody reported at all');
    const before = (await log(box, id)).length;
    const r = await box.admin('admin.dismiss_reports', { body: { id } });
    assert.equal(r.status, 200);
    assert.equal((await log(box, id)).length, before, 'nothing logged');
    assert.equal((await box.admin('admin.dismiss_reports', { body: { id: 987654 } })).status, 404);
    const bad = await box.admin('admin.dismiss_reports', { body: { id: 'x' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.field, 'id');
  });

  test('a cleared voter cannot re-open the case by reporting again', async () => {
    const id = await mk(box, 'Entry kept after reports');
    const first = await report(box, id, 'spam');
    await box.admin('admin.dismiss_reports', { body: { id } });
    const again = await report(box, id, 'spam', { voter: first.voter });
    assert.equal(again.status, 200);
    assert.equal((await entry(box, id)).reports.open, 0);
    const fresh = await report(box, id, 'spam');
    assert.equal(fresh.status, 200);
    assert.equal((await entry(box, id)).reports.open, 1, 'a different person can still report');
  });

  test('the triage token may dismiss; the read token may not', async () => {
    const id = await mk(box, 'Entry for the triage token');
    await report(box, id);
    const ro = await box.read('admin.dismiss_reports', { body: { id } });
    assert.equal(ro.status, 403);
    assert.equal(ro.json.error, 'forbidden');
    assert.equal((await entry(box, id)).reports.open, 1);
    const tr = await box.triage('admin.dismiss_reports', { body: { id } });
    assert.equal(tr.status, 200, tr.text);
    assert.equal(tr.json.entry.reports.open, 0);
    assert.match((await log(box, id)).find((a) => a.kind === 'dismiss_reports').actor, /^triage:/);
    assert.equal((await box.call('admin.dismiss_reports', { body: { id } })).status, 401);
  });

  test('publishing a hidden entry again clears its reports; undoing the publish re-opens them', async () => {
    const id = await mk(box, 'Entry hidden then published again');
    await reportMany(box, id, 3);
    assert.equal((await entry(box, id)).state, 'pending');
    const r = await box.admin('admin.update', { body: { id, state: 'published' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.entry.reports.open, 0);
    assert.equal(r.json.entry.reports.total, 3);
    const pub = (await log(box, id)).find((a) => a.kind === 'publish');
    assert.equal(pub.summary, 'Published #' + id + '. Cleared 3 reports.');
    const u = await box.admin('admin.undo', { body: { action_id: pub.id } });
    assert.equal(u.status, 200, u.text);
    const e = await entry(box, id);
    assert.equal(e.state, 'pending');
    assert.equal(e.reports.open, 3, 'the undo re-opens exactly what the publish cleared');
  });

  test('an admin.apply publish decision clears the reports of a hidden entry; undoing the run re-opens them', async () => {
    const id = await mk(box, 'Entry published by a triage run');
    await reportMany(box, id, 3);
    const e = await entry(box, id);
    const r = await apply(box, [decide(box, id, e.fingerprint, 'publish')]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.applied, [{ id, action: 'publish', flagged_instead: false }]);
    assert.equal((await entry(box, id)).reports.open, 0);
    const u = await box.admin('admin.undo', { body: { run_id: r.json.run_id } });
    assert.deepEqual(u.json.refused, []);
    const back = await entry(box, id);
    assert.equal(back.state, 'pending');
    assert.equal(back.reports.open, 3);
  });

  test('rejecting, flagging and merging do not clear reports', async () => {
    const target = await mk(box, 'Merge target for the reports test');
    const a = await mk(box, 'Entry that gets rejected with reports');
    const b = await mk(box, 'Entry that gets flagged with reports');
    const c = await mk(box, 'Entry that gets merged with reports');
    for (const id of [a, b, c]) await reportMany(box, id, 1);
    await box.admin('admin.update', { body: { id: a, state: 'rejected', reject_reason: 'spam' } });
    await box.admin('admin.update', { body: { id: b, state: 'flagged' } });
    await box.admin('admin.update', { body: { id: c, merge_into: target } });
    for (const id of [a, b, c]) assert.equal((await entry(box, id)).reports.open, 1, `#${id}`);
  });

  test('dismiss, block and unblock do not take part in entry-field undo ordering', async () => {
    const id = await mk(box, 'Entry with side actions and a status change');
    await report(box, id);
    await box.admin('admin.dismiss_reports', { body: { id } });
    await box.admin('admin.block', { body: { id } });
    await box.admin('admin.update', { body: { id, status: 'planned' } });
    // The later status change must not stop the side actions from being undone ...
    const rows = await log(box, id);
    const dismiss = rows.find((a) => a.kind === 'dismiss_reports');
    const block = rows.find((a) => a.kind === 'block');
    assert.equal(dismiss.undoable, true);
    assert.equal(block.undoable, true);
    assert.equal((await box.admin('admin.undo', { body: { action_id: dismiss.id } })).status, 200);
    assert.equal((await box.admin('admin.undo', { body: { action_id: block.id } })).status, 200);
    // ... and they must not stop the status change from being undone either.
    const status = (await log(box, id)).find((a) => a.kind === 'set_status');
    assert.equal(status.undoable, true);
    assert.equal((await box.admin('admin.undo', { body: { action_id: status.id } })).status, 200);
    const again = await box.admin('admin.undo', { body: { action_id: dismiss.id } });
    assert.equal(again.status, 409, 'already undone');
  });
});

describe('blocks', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', limits: { entries_per_hour: 50 } } }); });
  after(async () => { await box.stop(); });

  /** Add as one author and keep both the IP and the voter key. */
  async function author(title, extra = {}) {
    const ip = nextIp();
    const voter = newVoter();
    const r = await box.add({ title, voter, ...extra }, ip);
    assert.equal(r.status, 200, r.text);
    return { id: r.json.entry.id, ip, voter, receipt: r.json.receipt };
  }
  const blockedAdd = async (ip, voter, title = 'Trying again after being blocked') => box.add({ title, voter: voter ?? newVoter() }, ip);

  test('the author hashes are stored on add, never the raw values', async () => {
    const a = await author('Entry that stores its author hashes');
    const row = dbRows(box, 'SELECT author_hash, author_voter FROM entries WHERE id = ?', [a.id])[0];
    assert.match(row.author_hash, /^[0-9a-f]{64}$/);
    assert.match(row.author_voter, /^[0-9a-f]{64}$/);
    assert.equal(row.author_hash, crypto.createHmac('sha256', box.secret).update('ip|' + a.ip).digest('hex'));
    assert.equal(row.author_voter, crypto.createHmac('sha256', box.secret).update('voter|' + a.voter).digest('hex'));
    const owner = (await box.admin('admin.create', { body: { type: 'idea', title: 'Owner item without author' } })).json.entry.id;
    const o = dbRows(box, 'SELECT author_hash, author_voter FROM entries WHERE id = ?', [owner])[0];
    assert.deepEqual(o, { author_hash: '', author_voter: '' });
  });

  test('block, a blocked add is stored as rejected abuse but answers like a pending add, unblock restores adding', async () => {
    const a = await author('Entry from a soon blocked author');
    const b = await box.admin('admin.block', { body: { id: a.id, note: 'Posted something nasty' } });
    assert.equal(b.status, 200, b.text);
    assert.equal(b.json.entry.author_blocked, true);
    assert.equal((await box.admin('admin.stats')).json.blocks, 1);
    const row = dbRows(box, 'SELECT * FROM blocks')[0];
    assert.equal(row.entry_id, a.id);
    assert.equal(row.note, 'Posted something nasty');
    assert.equal(row.lifted_at, null);
    assert.ok(row.expires_at > row.created_at);
    const days = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86400000;
    assert.ok(Math.abs(days - 90) < 0.01, 'block_days defaults to 90, got ' + days);
    const blockAction = (await log(box, a.id)).find((x) => x.kind === 'block');
    assert.equal(blockAction.summary, 'Blocked the author.');

    // Same network address, new voter key.
    const add = await blockedAdd(a.ip);
    assert.equal(add.status, 200, add.text);
    assert.equal(add.json.ok, true);
    assert.equal(add.json.entry.state, 'published', 'looks like a normal add under moderation publish');
    assert.equal(add.json.entry.votes, 1);
    assert.ok(add.json.receipt);
    const stored = await entry(box, add.json.entry.id);
    assert.equal(stored.state, 'rejected');
    assert.equal(stored.reject_reason, 'abuse');
    const rej = (await log(box, stored.id)).find((x) => x.kind === 'reject');
    assert.equal(rej.actor, 'system');
    assert.ok(!(await box.list()).json.entries.some((e) => e.id === stored.id));
    // The author's own "mine" shows what happened (the entry is kept and the owner can still publish it).
    const mine = await box.call('mine', { body: { receipts: [add.json.receipt] } });
    assert.equal(mine.json.entries[0].state, 'rejected');
    assert.equal(mine.json.entries[0].reject_reason, 'abuse');
    assert.equal((await box.admin('admin.update', { body: { id: stored.id, state: 'published' } })).status, 200, 'the owner can still publish it');

    // Unblock.
    const un = await box.admin('admin.unblock', { body: { id: a.id } });
    assert.equal(un.status, 200, un.text);
    assert.equal(un.json.entry.author_blocked, false);
    assert.equal((await box.admin('admin.stats')).json.blocks, 0);
    assert.equal((await log(box, a.id)).find((x) => x.kind === 'unblock').summary, 'Unblocked the author.');
    const ok = await blockedAdd(a.ip);
    assert.equal(ok.json.entry.state, 'published');
    assert.equal((await entry(box, ok.json.entry.id)).state, 'published');
  });

  test('a block matches by voter key too, but not an unrelated visitor; moderation publish does not matter', async () => {
    const a = await author('Entry from an author with a stable voter key');
    await box.admin('admin.block', { body: { id: a.id } });
    const sameVoter = await blockedAdd(nextIp(), a.voter);
    assert.equal(sameVoter.json.entry.state, 'published');
    assert.equal((await entry(box, sameVoter.json.entry.id)).state, 'rejected');
    const stranger = await blockedAdd(nextIp(), newVoter());
    assert.equal(stranger.json.entry.state, 'published');
    assert.equal((await entry(box, stranger.json.entry.id)).state, 'published');
    const hit = await box.admin('admin.entry', { query: { id: String(sameVoter.json.entry.id) } });
    assert.equal(hit.json.entry.author_blocked, true, 'the new entry\'s author is blocked as well');
  });

  test('blocking twice is ok and logs once; owner items and unknown entries are refused', async () => {
    const a = await author('Entry for a double block');
    assert.equal((await box.admin('admin.block', { body: { id: a.id } })).status, 200);
    assert.equal((await box.admin('admin.block', { body: { id: a.id, note: 'again' } })).status, 200);
    assert.equal((await log(box, a.id)).filter((x) => x.kind === 'block').length, 1);
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM blocks WHERE entry_id = ?', [a.id])[0].n, 1);
    const owner = (await box.admin('admin.create', { body: { type: 'idea', title: 'Owner item cannot be blocked' } })).json.entry.id;
    const c = await box.admin('admin.block', { body: { id: owner } });
    assert.equal(c.status, 409);
    assert.equal(c.json.error, 'conflict');
    assert.equal((await box.admin('admin.block', { body: { id: 99999 } })).status, 404);
    assert.equal((await box.admin('admin.block', { body: { id: 0 } })).json.field, 'id');
    const badNote = await box.admin('admin.block', { body: { id: a.id, note: 12 } });
    assert.equal(badNote.status, 400);
    assert.equal(badNote.json.field, 'note');
    const unOwner = await box.admin('admin.unblock', { body: { id: owner } });
    assert.equal(unOwner.status, 200, 'unblocking an owner item is a no-op');
    assert.equal((await box.admin('admin.unblock', { body: { id: 99999 } })).status, 404);
    await box.admin('admin.unblock', { body: { id: a.id } });
    const before = (await log(box, a.id)).length;
    assert.equal((await box.admin('admin.unblock', { body: { id: a.id } })).status, 200);
    assert.equal((await log(box, a.id)).length, before, 'unblocking when nothing is active logs nothing');
  });

  test('a long note is cut to 500 characters', async () => {
    const a = await author('Entry with a very long block note');
    assert.equal((await box.admin('admin.block', { body: { id: a.id, note: 'n'.repeat(900) } })).status, 200);
    const row = dbRows(box, 'SELECT note FROM blocks WHERE entry_id = ?', [a.id])[0];
    assert.equal(row.note.length, 500);
    await box.admin('admin.unblock', { body: { id: a.id } });
  });

  test('reports from a blocked caller are ignored silently; votes are unaffected', async () => {
    const target = await author('Entry that a blocked person tries to report');
    const bad = await author('Entry from the person who gets blocked');
    await box.admin('admin.block', { body: { id: bad.id } });
    const r = await report(box, target.id, 'spam', { ip: bad.ip });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, id: target.id });
    const byVoter = await report(box, target.id, 'spam', { voter: bad.voter });
    assert.deepEqual(byVoter.json, { ok: true, id: target.id });
    assert.equal((await entry(box, target.id)).reports.total, 0, 'nothing stored');
    // Votes still work from the blocked address.
    const v = await box.vote(target.id, true, newVoter(), bad.ip);
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.voted, true);
    assert.equal(v.json.votes, 2);
    await box.admin('admin.unblock', { body: { id: bad.id } });
  });

  test('the rate limit is not consumed or revealed to a blocked reporter', async () => {
    const small = await startArghBox({ config: { moderation: 'publish', limits: { reports_per_hour: 1 } } });
    try {
      const ip = nextIp();
      const t1 = (await small.add({ title: 'First target for a blocked reporter' }, nextIp())).json.entry.id;
      const t2 = (await small.add({ title: 'Second target for a blocked reporter' }, nextIp())).json.entry.id;
      const bad = (await small.add({ title: 'Entry from the blocked reporter' }, ip)).json.entry.id;
      await small.admin('admin.block', { body: { id: bad } });
      for (const t of [t1, t2, t1]) assert.equal((await report(small, t, 'spam', { ip })).status, 200);
    } finally {
      await small.stop();
    }
  });

  test('an expired or lifted block no longer applies', async () => {
    const a = await author('Entry from an author whose block expires');
    await box.admin('admin.block', { body: { id: a.id } });
    assert.equal((await entry(box, a.id)).author_blocked, true);
    dbRows(box, "UPDATE blocks SET expires_at = '2000-01-01T00:00:00Z' WHERE entry_id = ?", [a.id]);
    assert.equal((await entry(box, a.id)).author_blocked, false);
    const now = new Date().toISOString().replace(/.d+Z$/, 'Z');
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM blocks WHERE lifted_at IS NULL AND expires_at > ?', [now])[0].n, (await box.admin('admin.stats')).json.blocks);
    const add = await blockedAdd(a.ip);
    assert.equal((await entry(box, add.json.entry.id)).state, 'published', 'an expired block lets the author add again');
    // And a new block can be made after the old one expired.
    assert.equal((await box.admin('admin.block', { body: { id: a.id } })).json.entry.author_blocked, true);
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM blocks WHERE entry_id = ?', [a.id])[0].n, 2);
  });

  test('unblock lifts every active block of that author (by IP or by voter key)', async () => {
    const a = await author('Entry for the author who gets two blocks');
    // A second entry by the same voter from another network, blocked separately.
    const second = await box.add({ title: 'Second entry of the same person', voter: a.voter }, nextIp());
    await box.admin('admin.block', { body: { id: a.id } });
    await box.admin('admin.block', { body: { id: second.json.entry.id } });
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM blocks WHERE entry_id IN (?, ?) AND lifted_at IS NULL', [a.id, second.json.entry.id])[0].n, 2);
    await box.admin('admin.unblock', { body: { id: a.id } });
    assert.equal((await entry(box, a.id)).author_blocked, false);
    assert.equal((await entry(box, second.json.entry.id)).author_blocked, false, 'the voter key linked the two blocks');
  });

  test('undo of a block lifts it; undo of an unblock activates it again', async () => {
    const a = await author('Entry for block undo checks');
    await box.admin('admin.block', { body: { id: a.id } });
    const block = (await log(box, a.id)).find((x) => x.kind === 'block');
    assert.equal((await box.admin('admin.undo', { body: { action_id: block.id } })).status, 200);
    assert.equal((await entry(box, a.id)).author_blocked, false);
    assert.equal((await box.admin('admin.undo', { body: { action_id: block.id } })).status, 409, 'already undone');
    await box.admin('admin.block', { body: { id: a.id } });
    await box.admin('admin.unblock', { body: { id: a.id } });
    const un = (await log(box, a.id)).find((x) => x.kind === 'unblock');
    assert.equal((await entry(box, a.id)).author_blocked, false);
    assert.equal((await box.admin('admin.undo', { body: { action_id: un.id } })).status, 200);
    assert.equal((await entry(box, a.id)).author_blocked, true, 'undoing the unblock blocks again');
    assert.equal((await box.admin('admin.stats')).json.blocks >= 1, true);
  });

  test('the triage token may block and unblock; the read token may not', async () => {
    const a = await author('Entry for the triage token to block');
    assert.equal((await box.read('admin.block', { body: { id: a.id } })).status, 403);
    assert.equal((await box.read('admin.unblock', { body: { id: a.id } })).status, 403);
    assert.equal((await entry(box, a.id)).author_blocked, false);
    const b = await box.triage('admin.block', { body: { id: a.id } });
    assert.equal(b.status, 200, b.text);
    assert.match((await log(box, a.id)).find((x) => x.kind === 'block').actor, /^triage:/);
    assert.equal((await box.triage('admin.unblock', { body: { id: a.id } })).status, 200);
    assert.equal((await box.call('admin.block', { body: { id: a.id } })).status, 401);
  });

  test('block_days sets the expiry', async () => {
    const short = await startArghBox({ config: { moderation: 'publish', limits: { block_days: 2 } } });
    try {
      const a = (await short.add({ title: 'Entry from a briefly blocked author' }, nextIp())).json.entry.id;
      await short.admin('admin.block', { body: { id: a } });
      const row = dbRows(short, 'SELECT created_at, expires_at FROM blocks')[0];
      const days = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86400000;
      assert.ok(Math.abs(days - 2) < 0.01, 'got ' + days);
    } finally {
      await short.stop();
    }
  });
});

describe('queue, stats and the entries filter', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('queue.reported lists published visitor entries, oldest open report first; stats and filters agree', async () => {
    const a = await mk(box, 'First reported entry in the list');
    const b = await mk(box, 'Second reported entry in the list');
    const quiet = await mk(box, 'An entry nobody reported at all');
    const hidden = await mk(box, 'An entry that is hidden by reports');
    await report(box, b, 'abusive');
    await new Promise((r) => setTimeout(r, 1100)); // created_at has second precision
    await report(box, a, 'spam');
    await reportMany(box, hidden, 3);
    const q = (await box.admin('admin.queue')).json;
    assert.deepEqual(q.reported.map((e) => e.id), [b, a], 'oldest open report first');
    assert.ok(q.reported.every((e) => e.state === 'published' && e.source === 'visitor'));
    assert.equal(q.reported[0].reports.open, 1);
    assert.deepEqual(q.reported[0].reports.reasons, { spam: 0, abusive: 1, off_topic: 0, other: 0 });
    assert.ok(q.pending.some((e) => e.id === hidden), 'the auto-hidden entry waits in pending');
    assert.ok(!q.reported.some((e) => e.id === quiet || e.id === hidden));
    assert.ok(q.reported[0].fingerprint, 'reported rows are full AdminEntry objects');
    const stats = (await box.admin('admin.stats')).json;
    assert.equal(stats.counts.reported, 3, 'open reports in published, pending or flagged state');
    assert.equal(stats.counts.pending, 1);
    assert.equal(stats.blocks, 0);
    const f = (await box.admin('admin.entries', { query: { reported: '1' } })).json;
    assert.deepEqual(f.entries.map((e) => e.id).sort((x, y) => x - y), [a, b, hidden].sort((x, y) => x - y), 'entries in any state with open reports');
    assert.equal(f.total, 3);
    const onlyPending = (await box.admin('admin.entries', { query: { reported: '1', state: 'pending' } })).json;
    assert.deepEqual(onlyPending.entries.map((e) => e.id), [hidden]);
    const all = (await box.admin('admin.entries')).json;
    assert.equal(all.total, 4, 'without the filter every entry is listed');
    // Dismissing empties the list.
    await box.admin('admin.dismiss_reports', { body: { id: b } });
    assert.deepEqual((await box.admin('admin.queue')).json.reported.map((e) => e.id), [a]);
    assert.equal((await box.admin('admin.stats')).json.counts.reported, 2);
    assert.equal(((await box.admin('admin.entries', { query: { reported: '1' } })).json).total, 2);
  });

  test('the read token can read the new fields', async () => {
    const q = await box.read('admin.queue');
    assert.equal(q.status, 200);
    assert.ok(Array.isArray(q.json.reported));
    const s = await box.read('admin.stats');
    assert.equal(typeof s.json.counts.reported, 'number');
    assert.equal(typeof s.json.blocks, 'number');
  });

  test('exports carry the new admin fields without leaking hashes', async () => {
    const res = await box.admin('admin.export', { query: { format: 'json' } });
    const data = JSON.parse(res.text);
    assert.ok(data.entries.every((e) => e.reports && typeof e.author_blocked === 'boolean'));
    assert.ok(!res.text.includes('author_voter'));
  });
});

describe('admin.apply: keep, reject on reported entries, block_author', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', auto_apply_min_confidence: 80, limits: { entries_per_hour: 50 } } }); });
  after(async () => { await box.stop(); });

  async function reported(title, n = 1) {
    const id = await mk(box, title);
    await reportMany(box, id, n);
    return id;
  }
  async function pendingAuthor(title) {
    const ip = nextIp();
    const voter = newVoter();
    const r = await box.add({ title, voter }, ip);
    await box.admin('admin.update', { body: { id: r.json.entry.id, state: 'pending' } });
    return { id: r.json.entry.id, ip, voter };
  }

  test('keep clears the reports, is logged as dismiss_reports with the run, and counts as keep', async () => {
    const id = await reported('Reported entry that is actually fine');
    const e = await entry(box, id);
    const r = await apply(box, [decide(box, id, e.fingerprint, 'keep')]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.applied, [{ id, action: 'keep', flagged_instead: false }]);
    assert.deepEqual(r.json.skipped, []);
    const after = await entry(box, id);
    assert.equal(after.reports.open, 0);
    assert.equal(after.state, 'published');
    assert.equal(after.title, e.title, 'keep changes nothing about the entry itself');
    assert.notEqual(after.fingerprint, e.fingerprint, 'the open reports are no longer part of the fingerprint');
    const act = (await log(box, id)).find((a) => a.kind === 'dismiss_reports');
    assert.equal(act.run_id, r.json.run_id);
    const runs = (await box.admin('admin.runs')).json.runs;
    assert.deepEqual(runs[0].counts, { publish: 0, reject: 0, merge: 0, flag: 0, tag: 0, keep: 1, block: 0, skipped: 0 });
    // Undo of the run re-opens the reports.
    const u = await box.admin('admin.undo', { body: { run_id: r.json.run_id } });
    assert.deepEqual(u.json.refused, []);
    assert.equal((await entry(box, id)).reports.open, 1);
  });

  test('keep is only valid on a published entry with open reports', async () => {
    const quiet = await mk(box, 'Published entry without any reports');
    const p = await pendingAuthor('Pending entry cannot be kept');
    const owner = (await box.admin('admin.create', { body: { type: 'idea', title: 'Owner item cannot be kept', public: true } })).json.entry.id;
    const dec = [];
    for (const id of [quiet, p.id, owner]) dec.push(decide(box, id, (await entry(box, id)).fingerprint, 'keep'));
    const r = await apply(box, dec);
    assert.deepEqual(r.json.applied, []);
    assert.deepEqual(r.json.skipped, [quiet, p.id, owner].map((id) => ({ id, reason: 'invalid_state' })));
    const rejectQuiet = await apply(box, [decide(box, quiet, dec[0].fingerprint, 'reject', { reject_reason: 'spam' })]);
    assert.deepEqual(rejectQuiet.json.skipped, [{ id: quiet, reason: 'invalid_state' }], 'reject on a published entry needs open reports');
  });

  test('below the confidence threshold keep and reject on published entries are skipped, not flagged', async () => {
    const a = await reported('Reported entry for a low confidence keep');
    const b = await reported('Reported entry for a low confidence reject');
    const fa = (await entry(box, a)).fingerprint;
    const fb = (await entry(box, b)).fingerprint;
    const r = await apply(box, [
      decide(box, a, fa, 'keep', { confidence: 50 }),
      decide(box, b, fb, 'reject', { confidence: 79, reject_reason: 'spam', block_author: true }),
    ]);
    assert.deepEqual(r.json.applied, []);
    assert.deepEqual(r.json.skipped, [{ id: a, reason: 'low_confidence' }, { id: b, reason: 'low_confidence' }]);
    for (const id of [a, b]) {
      const e = await entry(box, id);
      assert.equal(e.state, 'published', 'the entry stays public');
      assert.equal(e.reports.open, 1, 'and stays in the Reported list');
      assert.equal(e.author_blocked, false, 'no block when the reject was skipped');
    }
    const run = (await box.admin('admin.runs')).json.runs[0];
    assert.equal(run.counts.skipped, 2);
    assert.equal(run.counts.keep + run.counts.reject + run.counts.flag + run.counts.block, 0);
  });

  test('reject on a published reported entry rejects it, leaves the reports open, and can block the author', async () => {
    const a = await reported('Reported spam entry to reject');
    const b = await reported('Reported spam entry to reject and block');
    const fa = (await entry(box, a)).fingerprint;
    const fb = (await entry(box, b)).fingerprint;
    const r = await apply(box, [
      decide(box, a, fa, 'reject', { reject_reason: 'off_topic' }),
      decide(box, b, fb, 'reject', { reject_reason: 'spam', block_author: true }),
    ]);
    assert.deepEqual(r.json.applied.map((x) => [x.id, x.action, x.flagged_instead]), [[a, 'reject', false], [b, 'reject', false]]);
    const ea = await entry(box, a);
    assert.equal(ea.state, 'rejected');
    assert.equal(ea.reject_reason, 'off_topic');
    assert.equal(ea.reports.open, 1, 'rejecting does not clear reports');
    assert.equal(ea.author_blocked, false);
    const eb = await entry(box, b);
    assert.equal(eb.state, 'rejected');
    assert.equal(eb.author_blocked, true);
    assert.equal((await log(box, b)).find((x) => x.kind === 'block').run_id, r.json.run_id);
    const run = (await box.admin('admin.runs')).json.runs[0];
    assert.equal(run.counts.reject, 2);
    assert.equal(run.counts.block, 1);
    // Rejected entries leave the Reported list and the Reported count but stay findable.
    const q = (await box.admin('admin.queue')).json;
    assert.ok(!q.reported.some((e) => e.id === a || e.id === b));
    assert.ok(!(await box.admin('admin.entries', { query: { reported: '1' } })).json.entries.some((e) => e.id === a), 'rejected entries are settled, not reported');
    // Undoing the run restores both entries and lifts the block (newest first).
    const u = await box.admin('admin.undo', { body: { run_id: r.json.run_id } });
    assert.deepEqual(u.json.refused, []);
    assert.equal((await entry(box, b)).state, 'published');
    assert.equal((await entry(box, b)).author_blocked, false);
  });

  test('block_author on a pending spam reject blocks the author; their next add is stored as rejected', async () => {
    const p = await pendingAuthor('Pending spam entry from a bad author');
    const e = await entry(box, p.id);
    const r = await apply(box, [decide(box, p.id, e.fingerprint, 'reject', { reject_reason: 'abuse', block_author: true })]);
    assert.deepEqual(r.json.applied, [{ id: p.id, action: 'reject', flagged_instead: false, blocked: true }]);
    assert.equal((await entry(box, p.id)).author_blocked, true);
    const again = await box.add({ title: 'The bad author tries once more' }, p.ip);
    assert.equal(again.json.entry.state, 'published');
    assert.equal((await entry(box, again.json.entry.id)).state, 'rejected');
  });

  test('block_author is invalid_input on other actions and reasons, or when not a boolean', async () => {
    const make = async (title) => (await pendingAuthor(title)).id;
    const [a, b, c, d, f] = [await make('Pending entry a'), await make('Pending entry b'), await make('Pending entry c'), await make('Pending entry d'), await make('Pending entry f')];
    const fp = async (id) => (await entry(box, id)).fingerprint;
    const r = await apply(box, [
      decide(box, a, await fp(a), 'publish', { block_author: true }),
      decide(box, b, await fp(b), 'reject', { reject_reason: 'off_topic', block_author: true }),
      decide(box, c, await fp(c), 'reject', { reject_reason: 'spam', block_author: 'yes' }),
      decide(box, d, await fp(d), 'flag', { block_author: true }),
      decide(box, f, await fp(f), 'reject', { reject_reason: 'test', block_author: false }),
    ]);
    assert.deepEqual(r.json.skipped, [a, b, c, d].map((id) => ({ id, reason: 'invalid_input' })));
    assert.deepEqual(r.json.applied, [{ id: f, action: 'reject', flagged_instead: false }], 'block_author: false is fine anywhere');
    assert.equal((await entry(box, f)).author_blocked, false);
  });

  test('a low-confidence pending reject is flagged instead and does not block', async () => {
    const p = await pendingAuthor('Pending entry with a shaky reject');
    const e = await entry(box, p.id);
    const r = await apply(box, [decide(box, p.id, e.fingerprint, 'reject', { reject_reason: 'spam', block_author: true, confidence: 40 })]);
    assert.deepEqual(r.json.applied, [{ id: p.id, action: 'flag', flagged_instead: true, blocked: false }]);
    assert.equal((await entry(box, p.id)).author_blocked, false);
    const run = (await box.admin('admin.runs')).json.runs[0];
    assert.equal(run.counts.block, 0);
    assert.equal(run.counts.flag, 1);
  });

  test('blocking an author who is already blocked counts nothing; the reject still applies', async () => {
    const a = await pendingAuthor('Pending entry of an author blocked twice');
    const first = await apply(box, [decide(box, a.id, (await entry(box, a.id)).fingerprint, 'reject', { reject_reason: 'spam', block_author: true })]);
    assert.equal((await box.admin('admin.runs')).json.runs[0].counts.block, 1);
    assert.equal(first.json.applied.length, 1);
    // A second entry of the same person (same voter key and network) is stored as rejected; send it back to pending.
    const second = await box.add({ title: 'Second entry of that same author', voter: a.voter }, a.ip);
    await box.admin('admin.update', { body: { id: second.json.entry.id, state: 'pending' } });
    const e = await entry(box, second.json.entry.id);
    const r = await apply(box, [decide(box, e.id, e.fingerprint, 'reject', { reject_reason: 'spam', block_author: true })]);
    assert.equal(r.json.applied.length, 1);
    assert.equal(r.json.skipped.length, 0);
    assert.equal((await box.admin('admin.runs')).json.runs[0].counts.block, 0, 'no second block was made');
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM blocks WHERE entry_id IN (?, ?)', [a.id, e.id])[0].n, 1);
  });

  test('keep is ordered with publish and reject, before merges: a merge into a kept entry works in the same batch', async () => {
    const target = await reported('Reported entry that is kept and merged into');
    const dup = await pendingAuthor('Duplicate of the kept entry');
    const ft = (await entry(box, target)).fingerprint;
    const fd = (await entry(box, dup.id)).fingerprint;
    const r = await apply(box, [
      decide(box, dup.id, fd, 'merge', { merge_into: target }),
      decide(box, target, ft, 'keep'),
    ]);
    assert.deepEqual(r.json.applied.map((x) => x.action), ['keep', 'merge']);
    assert.equal((await entry(box, dup.id)).state, 'merged');
  });

  test('the triage token can send keep and block_author; the whole batch is one transaction', async () => {
    const id = await reported('Reported entry for the triage token');
    const p = await pendingAuthor('Pending spam for the triage token');
    const r = await box.triage('admin.apply', {
      body: {
        run: { reviewer: 'Bot', digest: '' },
        decisions: [
          decide(box, id, (await entry(box, id)).fingerprint, 'keep'),
          decide(box, p.id, (await entry(box, p.id)).fingerprint, 'reject', { reject_reason: 'spam', block_author: true }),
        ],
      },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.applied.length, 2);
    assert.match((await log(box, id)).find((a) => a.kind === 'dismiss_reports').actor, /^triage:/);
    const run = (await box.admin('admin.runs')).json.runs[0];
    assert.equal(run.counts.keep, 1);
    assert.equal(run.counts.block, 1);
  });
});

describe('schema 3 to 4 migration', () => {
  const V3 = `
    CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', title_original TEXT NOT NULL,
      body_original TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'visitor', state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', status_at TEXT NULL,
      merged_into INTEGER NULL REFERENCES entries(id), reject_reason TEXT NULL, tags TEXT NOT NULL DEFAULT '[]', votes INTEGER NOT NULL DEFAULT 0,
      context TEXT NOT NULL DEFAULT '{}', ai TEXT NULL, author_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      external_url TEXT NULL);
    CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id), body TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 1,
      hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE votes (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id), voter_hash TEXT NOT NULL, ip_hash TEXT NOT NULL,
      moved_from INTEGER NULL, created_at TEXT NOT NULL, UNIQUE(entry_id, voter_hash));
    CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, reviewer TEXT NOT NULL, counts TEXT NOT NULL, digest TEXT NOT NULL DEFAULT '');
    CREATE TABLE actions (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, run_id INTEGER NULL REFERENCES runs(id), kind TEXT NOT NULL,
      entry_id INTEGER NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, undone_by INTEGER NULL);
    CREATE TABLE limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX idx_entries_state ON entries(state);
    CREATE INDEX idx_votes_entry ON votes(entry_id);
    CREATE INDEX idx_limits_window ON limits(window_start);
    CREATE INDEX idx_entries_receipt ON entries(receipt_hash);
    INSERT INTO meta(key, value) VALUES('schema_version', '3');`;

  test('an existing schema 3 database upgrades in place: data kept, new tables and column present, features work', async () => {
    const box = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const hmac = (label, v) => crypto.createHmac('sha256', box.secret).update(`${label}|${v}`).digest('hex');
      const oldIp = nextIp();
      const file = path.join(box.dataDir, 'arghbox.sqlite');
      const seedSql = `${V3}
        INSERT INTO entries(type, title, title_original, state, votes, author_hash, receipt_hash, created_at, updated_at)
          VALUES('idea', 'An entry from before the upgrade', 'An entry from before the upgrade', 'published', 1, '${hmac('ip', oldIp)}', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO votes(entry_id, voter_hash, ip_hash, created_at) VALUES(1, '${hmac('voter', 'old-voter')}', '${hmac('ip', oldIp)}', '2026-01-01T00:00:00Z');
        INSERT INTO comments(entry_id, body, created_at, updated_at) VALUES(1, 'An old comment', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');`;
      const mkdb = spawnSync(phpPath(), phpArgs(['-r', '$d = new PDO("sqlite:" . $argv[1]); $d->exec($argv[2]);', file, seedSql]), { encoding: 'utf8' });
      assert.equal(mkdb.status, 0, mkdb.stderr);
      assert.equal(dbRows(box, "SELECT value FROM meta WHERE key = 'schema_version'")[0].value, '3');

      // The first request migrates.
      const list = await box.list();
      assert.equal(list.status, 200, list.text);
      assert.equal(list.json.entries.length, 1);
      assert.equal(list.json.entries[0].title, 'An entry from before the upgrade');
      assert.equal(list.json.entries[0].comments[0].body, 'An old comment');
      assert.equal(dbRows(box, "SELECT value FROM meta WHERE key = 'schema_version'")[0].value, '4');
      const cols = dbRows(box, 'PRAGMA table_info(entries)').map((c) => c.name);
      assert.ok(cols.includes('author_voter'));
      const tables = dbRows(box, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
      assert.ok(tables.includes('reports') && tables.includes('blocks'));
      const idx = dbRows(box, "SELECT name FROM sqlite_master WHERE type = 'index'").map((t) => t.name);
      for (const n of ['idx_reports_entry', 'idx_blocks_author', 'idx_blocks_voter']) assert.ok(idx.includes(n), n);
      assert.deepEqual(dbRows(box, 'SELECT author_voter FROM entries WHERE id = 1'), [{ author_voter: '' }], 'older entries keep an empty author_voter');
      assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM reports')[0].n, 0);

      // New entries fill author_voter; old ones can be reported, hidden, and their author blocked by IP.
      const fresh = await box.add({ title: 'An entry from after the upgrade', voter: newVoter() }, nextIp());
      assert.match(dbRows(box, 'SELECT author_voter FROM entries WHERE id = ?', [fresh.json.entry.id])[0].author_voter, /^[0-9a-f]{64}$/);
      for (let i = 0; i < 3; i++) assert.equal((await report(box, 1, 'spam')).status, 200);
      assert.equal((await entry(box, 1)).state, 'pending');
      const b = await box.admin('admin.block', { body: { id: 1 } });
      assert.equal(b.status, 200, b.text);
      assert.equal(b.json.entry.author_blocked, true);
      const add = await box.add({ title: 'The old author returns after the block' }, oldIp);
      assert.equal((await entry(box, add.json.entry.id)).state, 'rejected', 'an empty author_voter never matches, the IP hash does');
      const stranger = await box.add({ title: 'A stranger after the block' }, nextIp());
      assert.equal((await entry(box, stranger.json.entry.id)).state, 'published');
      // Running the migration again is a no-op.
      assert.equal((await box.list()).status, 200);
      assert.equal(dbRows(box, "SELECT value FROM meta WHERE key = 'schema_version'")[0].value, '4');
    } finally {
      await box.stop();
    }
  });

  test('a brand new database is created at schema 4 with the new tables', async () => {
    const box = await startArghBox();
    try {
      await box.list();
      assert.equal(dbRows(box, "SELECT value FROM meta WHERE key = 'schema_version'")[0].value, '4');
      const cols = dbRows(box, 'PRAGMA table_info(reports)').map((c) => c.name);
      assert.deepEqual(cols, ['id', 'entry_id', 'reason', 'voter_hash', 'ip_hash', 'created_at', 'cleared_at', 'cleared_by']);
      const bcols = dbRows(box, 'PRAGMA table_info(blocks)').map((c) => c.name);
      assert.deepEqual(bcols, ['id', 'entry_id', 'author_hash', 'voter_hash', 'note', 'created_at', 'expires_at', 'lifted_at']);
    } finally {
      await box.stop();
    }
  });
});

describe('seed format: reports and blocked', () => {
  test('tools/seed.php stores open reports (hashed, no auto-hide) and blocks the author', async () => {
    const { seed } = await import('../../tools/seed.mjs');
    const { writeConfig } = await import('../helpers/server.mjs');
    const os = await import('node:os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-seedrep-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    const configPath = path.join(tmp, 'config.php');
    const secret = crypto.randomBytes(32).toString('hex');
    writeConfig(configPath, { secret, data_dir: dataDir });
    const file = path.join(tmp, 'seed.json');
    fs.writeFileSync(file, JSON.stringify([
      { title: 'Reported four times', state: 'published', reports: [{ reason: 'spam', author: 'a' }, { reason: 'spam', author: 'b' }, { reason: 'other', author: 'c' }, { reason: 'abusive' }] },
      { title: 'From a blocked author', state: 'published', author: 'bad-author', blocked: true },
      { title: 'Nothing special about this one', state: 'published' },
    ]));
    try {
      const r = seed({ config: configPath, file });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).seeded, 3);
      const reports = dbRows(dataDir, 'SELECT * FROM reports ORDER BY id');
      assert.equal(reports.length, 4);
      assert.equal(new Set(reports.map((x) => x.voter_hash)).size, 4, 'each report gets its own random voter');
      assert.ok(reports.every((x) => /^[0-9a-f]{64}$/.test(x.ip_hash) && x.cleared_at === null));
      assert.equal(dbRows(dataDir, "SELECT state FROM entries WHERE title = 'Reported four times'")[0].state, 'published', 'seeding never auto-hides');
      const blocks = dbRows(dataDir, 'SELECT * FROM blocks');
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].lifted_at, null);
      const authorHash = crypto.createHmac('sha256', secret).update('ip|bad-author').digest('hex');
      assert.equal(blocks[0].author_hash, authorHash);
      const bad = path.join(tmp, 'bad.json');
      fs.writeFileSync(bad, JSON.stringify([{ title: 'Bad reason entry', reports: [{ reason: 'nope' }] }]));
      const bad2 = seed({ config: configPath, file: bad });
      assert.notEqual(bad2.status, 0);
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file lock */ }
    }
  });
});
