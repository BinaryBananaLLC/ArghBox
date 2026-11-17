// Review fixes: fingerprint over open reports, block/unblock undo order, blocked add answer, keep note,
// block_author never failing a batch, the "reported" definition and the blocked filter (docs/SPEC.md sections 5, 6b, 7).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newVoter, nextIp, startArghBox } from '../helpers/server.mjs';
import { dbExec, dbRows } from '../helpers/db.mjs';

const mk = async (box, title) => {
  const r = await box.add({ title });
  assert.equal(r.status, 200, r.text);
  return r.json.entry.id;
};
const entry = async (box, id) => (await box.admin('admin.entry', { query: { id: String(id) } })).json.entry;
const log = async (box, entryId) => (await box.admin('admin.log', { query: { entry_id: String(entryId), limit: '50' } })).json.actions;
async function report(box, id, reason = 'spam') {
  const ip = nextIp();
  const pass = await box.session(ip);
  const r = await box.call('report', { body: { pass, voter: newVoter(), id, reason }, ip });
  assert.equal(r.status, 200, r.text);
  return r;
}
const decide = (id, fingerprint, action, extra = {}) => ({ id, fingerprint, action, confidence: 95, reason: 'test', ...extra });
const apply = (box, decisions) => box.admin('admin.apply', { body: { run: { reviewer: 'Tester', digest: 'digest' }, decisions } });
async function author(box, title) {
  const ip = nextIp();
  const voter = newVoter();
  const r = await box.add({ title, voter }, ip);
  assert.equal(r.status, 200, r.text);
  return { id: r.json.entry.id, ip, voter };
}

describe('review fixes', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', auto_apply_min_confidence: 80, limits: { entries_per_hour: 80 } } }); });
  after(async () => { await box.stop(); });

  test('the fingerprint covers open reports: old formula without them, r:<ids> with them, same everywhere', async () => {
    const id = await mk(box, 'Entry whose fingerprint covers reports');
    const clean = (await entry(box, id)).fingerprint;
    const row = dbRows(box, 'SELECT * FROM entries WHERE id = ?', [id])[0];
    const base = [row.id, row.state, row.status, row.type, row.title, row.body, ''].join('|');
    const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
    assert.equal(clean, h(base));
    await report(box, id);
    await report(box, id, 'abusive');
    const ids = dbRows(box, 'SELECT id FROM reports WHERE entry_id = ? ORDER BY id', [id]).map((r) => r.id);
    const one = await entry(box, id);
    assert.equal(one.fingerprint, h(base + '|r:' + ids.join(',')));
    const q = (await box.admin('admin.queue')).json;
    assert.equal(q.published.find((e) => e.id === id).fingerprint, one.fingerprint);
    assert.equal(q.reported.find((e) => e.id === id).fingerprint, one.fingerprint);
    assert.equal((await box.admin('admin.entries', { query: { reported: '1' } })).json.entries.find((e) => e.id === id).fingerprint, one.fingerprint);
    await box.admin('admin.dismiss_reports', { body: { id } });
    assert.equal((await entry(box, id)).fingerprint, clean, 'cleared reports are not part of it');
  });

  test('a report arriving after the queue was fetched makes keep and a published reject skip as changed', async () => {
    const a = await mk(box, 'Reported once then reported again A');
    const b = await mk(box, 'Reported once then reported again B');
    await report(box, a);
    await report(box, b);
    const q = (await box.admin('admin.queue')).json;
    const fa = q.reported.find((e) => e.id === a).fingerprint;
    const fb = q.reported.find((e) => e.id === b).fingerprint;
    await report(box, a, 'abusive');
    await report(box, b, 'abusive');
    const r = await apply(box, [decide(a, fa, 'keep'), decide(b, fb, 'reject', { reject_reason: 'abuse' })]);
    assert.deepEqual(r.json.applied, []);
    assert.deepEqual(r.json.skipped, [{ id: a, reason: 'changed' }, { id: b, reason: 'changed' }]);
    assert.equal((await entry(box, a)).reports.open, 2);
    assert.equal((await entry(box, b)).state, 'published');
    const ok = await apply(box, [decide(a, (await entry(box, a)).fingerprint, 'keep')]);
    assert.equal(ok.json.applied.length, 1);
  });

  test('block -> unblock -> undo block is refused; undoing in reverse order works', async () => {
    const a = await author(box, 'Author for block undo ordering');
    await box.admin('admin.block', { body: { id: a.id } });
    await box.admin('admin.unblock', { body: { id: a.id } });
    const acts = await log(box, a.id);
    const block = acts.find((x) => x.kind === 'block');
    const unblock = acts.find((x) => x.kind === 'unblock');
    assert.equal(block.undoable, false);
    assert.equal(unblock.undoable, true);
    const bad = await box.admin('admin.undo', { body: { action_id: block.id } });
    assert.equal(bad.status, 409);
    assert.equal(bad.json.error, 'conflict');
    assert.equal((await entry(box, a.id)).author_blocked, false);
    assert.equal((await box.admin('admin.undo', { body: { action_id: unblock.id } })).status, 200);
    assert.equal((await entry(box, a.id)).author_blocked, true);
    assert.equal((await box.admin('admin.undo', { body: { action_id: block.id } })).status, 200);
    assert.equal((await entry(box, a.id)).author_blocked, false);
    assert.equal(dbRows(box, 'SELECT COUNT(*) AS n FROM blocks WHERE lifted_at IS NULL AND entry_id = ?', [a.id])[0].n, 0);
  });

  for (const moderation of ['publish', 'pending']) {
    test(`a blocked add answers like a normal add (moderation ${moderation})`, async () => {
      const b = await startArghBox({ config: { moderation } });
      try {
        const ip = nextIp();
        const first = await b.add({ title: 'First entry of the author', voter: newVoter() }, ip);
        await b.admin('admin.block', { body: { id: first.json.entry.id } });
        const blocked = await b.add({ title: 'Second entry of the blocked author' }, ip);
        const normal = await b.add({ title: 'Entry of an unrelated author' });
        const want = moderation === 'publish' ? 'published' : 'pending';
        assert.equal(blocked.json.entry.state, want);
        assert.equal(normal.json.entry.state, want);
        assert.deepEqual(Object.keys(blocked.json.entry).sort(), Object.keys(normal.json.entry).sort());
        const stored = (await b.admin('admin.entry', { query: { id: String(blocked.json.entry.id) } })).json;
        assert.equal(stored.entry.state, 'rejected');
        assert.equal(stored.entry.reject_reason, 'abuse');
        const rej = stored.actions.find((x) => x.kind === 'reject');
        assert.equal(rej.actor, 'system');
        assert.equal(rej.summary, `Rejected #${stored.entry.id} (abuse): the author is blocked.`);
      } finally {
        await b.stop();
      }
    });
  }

  test('keep stores the reviewer note: log summary and after.ai', async () => {
    const id = await mk(box, 'Reported entry that is fine for a reason');
    await report(box, id);
    await report(box, id, 'other');
    const e = await entry(box, id);
    await apply(box, [decide(id, e.fingerprint, 'keep', { reason: 'Looks legitimate' })]);
    const row = (await log(box, id)).find((x) => x.kind === 'dismiss_reports');
    assert.equal(row.summary, 'Dismissed 2 reports: Looks legitimate');
    const after = JSON.parse(dbRows(box, "SELECT after FROM actions WHERE kind = 'dismiss_reports' AND entry_id = ?", [id])[0].after);
    assert.equal(after.ai.action, 'keep');
    assert.equal(after.ai.reason, 'Looks legitimate');
    assert.equal(after.ai.reviewer, 'Tester');
    assert.equal(after.ai.confidence, 95);
    assert.ok(after.ai.run_id && after.ai.at);
    const id2 = await mk(box, 'Reported entry dismissed by the owner');
    await report(box, id2);
    await box.admin('admin.dismiss_reports', { body: { id: id2 } });
    assert.equal((await log(box, id2)).find((x) => x.kind === 'dismiss_reports').summary, 'Dismissed 1 report.');
  });

  test('block_author never fails the batch: no author hashes still rejects, with blocked false', async () => {
    const noAuthor = await author(box, 'Pending spam from an author with no hashes');
    const pa = await author(box, 'Pending spam from a normal author');
    const other = await author(box, 'Pending good entry in the same batch');
    for (const x of [noAuthor, pa, other]) await box.admin('admin.update', { body: { id: x.id, state: 'pending' } });
    dbExec(box, "UPDATE entries SET author_hash = '', author_voter = '' WHERE id = ?", [noAuthor.id]);
    const fp = async (id) => (await entry(box, id)).fingerprint;
    const r = await apply(box, [
      decide(noAuthor.id, await fp(noAuthor.id), 'reject', { reject_reason: 'spam', block_author: true }),
      decide(pa.id, await fp(pa.id), 'reject', { reject_reason: 'spam', block_author: true }),
      decide(other.id, await fp(other.id), 'publish'),
    ]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.applied, [
      { id: noAuthor.id, action: 'reject', flagged_instead: false, blocked: false },
      { id: pa.id, action: 'reject', flagged_instead: false, blocked: true },
      { id: other.id, action: 'publish', flagged_instead: false },
    ]);
    assert.equal((await entry(box, noAuthor.id)).state, 'rejected');
    assert.equal((await entry(box, other.id)).state, 'published');
    assert.equal((await box.admin('admin.runs')).json.runs[0].counts.block, 1);
  });

  test('reported = open report and published, pending or flagged; rejected and merged do not count; blocked filter', async () => {
    const b = await startArghBox({ config: { moderation: 'publish', report_hide_at: 0, limits: { entries_per_hour: 50 } } });
    try {
      const bm = async (title) => (await b.add({ title }, nextIp())).json.entry.id;
      const ids = {
        pub: await bm('Reported and still published'), pend: await bm('Reported and then pending'), flag: await bm('Reported and then flagged'),
        rej: await bm('Reported and then rejected'), mer: await bm('Reported and then merged'), target: await bm('Merge target without reports'),
      };
      for (const k of ['pub', 'pend', 'flag', 'rej', 'mer']) await report(b, ids[k]);
      await b.admin('admin.update', { body: { id: ids.pend, state: 'pending' } });
      await b.admin('admin.update', { body: { id: ids.flag, state: 'flagged' } });
      await b.admin('admin.update', { body: { id: ids.rej, state: 'rejected', reject_reason: 'spam' } });
      await b.admin('admin.update', { body: { id: ids.mer, merge_into: ids.target } });
      assert.equal(dbRows(b, 'SELECT COUNT(*) AS n FROM reports WHERE cleared_at IS NULL')[0].n, 5, 'all reports still open');
      const stats = (await b.admin('admin.stats')).json;
      const list = (await b.admin('admin.entries', { query: { reported: '1' } })).json;
      assert.deepEqual(list.entries.map((e) => e.id).sort((x, y) => x - y), [ids.pub, ids.pend, ids.flag].sort((x, y) => x - y));
      assert.equal(list.total, 3);
      assert.equal(stats.counts.reported, 3, 'tab count equals list');
      assert.deepEqual((await b.admin('admin.queue')).json.reported.map((e) => e.id), [ids.pub], 'queue.reported stays published only');
      assert.equal((await b.admin('admin.entries', { query: { blocked: '1' } })).json.total, 0);
      await b.admin('admin.block', { body: { id: ids.pub } });
      const blk = (await b.admin('admin.entries', { query: { blocked: '1' } })).json;
      assert.deepEqual(blk.entries.map((e) => e.id), [ids.pub]);
      assert.equal(blk.entries[0].author_blocked, true);
      assert.equal((await b.admin('admin.entries', { query: { blocked: '1', reported: '1' } })).json.total, 1);
    } finally {
      await b.stop();
    }
  });
});
