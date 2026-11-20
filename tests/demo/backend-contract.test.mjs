// The demo backend must not drift from the real API: run one scenario against the real PHP and against
// demo/backend.js, and compare the status of every answer and the KEY SETS of its JSON (values may differ).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { newVoter, nextIp, startArghBox } from '../helpers/server.mjs';
import { phpPath } from '../helpers/php.mjs';
import { loadBackend } from './browser.mjs';

let phpMissing = false;
try { phpPath(); } catch { phpMissing = 'PHP is not installed'; }

/** The same calls on the real server. */
function realClient(box) {
  const ip = nextIp();
  return {
    async session() { return (await box.session(ip)); },
    async call(action, { body, query, voter, admin } = {}) {
      const r = await box.call(action, { body, query, ip, token: admin ? box.ownerToken : undefined, headers: voter ? { 'X-ArghBox-Voter': voter } : {} });
      return { status: r.status, json: r.json };
    },
  };
}

/** The same calls on the demo. */
function demoClient(demo) {
  return {
    async session() { return (await demo.call('session', { body: { turnstile: 'token' } })).json.pass; },
    async call(action, { body, query, voter, admin } = {}) {
      const r = await demo.call(action, { body, query, voter, token: admin ? 'demo' : undefined });
      return { status: r.status, json: r.json };
    },
  };
}

/** Everything both servers must answer alike. Returns {step name: {status, json}}. */
async function scenario(api) {
  const out = {};
  const step = async (name, action, opts) => { out[name] = await api.call(action, opts); return out[name]; };
  const pass = await api.session();
  const voter = newVoter();
  const other = newVoter();
  const draft = (title, extra = {}) => ({ pass, voter, type: 'idea', title, body: 'Details here.', hp: '', elapsed_ms: 9000, context: { page: '/pricing', lang: 'en', browser: 'Chrome', os: 'Windows', screen: 'large', app: { platform: 'ios', version: '1.0.0' } }, ...extra });

  await step('health', 'health');
  const a = (await step('add', 'add', { body: draft('Contract idea A') })).json;
  const b = (await step('add b', 'add', { body: draft('Contract idea B') })).json;
  const c = (await step('add c', 'add', { body: draft('Contract idea C') })).json;
  await step('add invalid', 'add', { body: draft('abc') });
  await step('mine pending', 'mine', { body: { receipts: [a.receipt] } });
  await step('admin.me signed out', 'admin.me');
  await step('admin.me', 'admin.me', { admin: true });
  const queue0 = (await step('admin.queue pending', 'admin.queue', { admin: true })).json;
  await step('publish a', 'admin.update', { admin: true, body: { id: a.entry.id, state: 'published' } });
  await step('publish c', 'admin.update', { admin: true, body: { id: c.entry.id, state: 'published' } });
  await step('vote', 'vote', { body: { pass, voter: other, id: a.entry.id, on: true } });
  await step('vote unknown', 'vote', { body: { pass, voter, id: 987654, on: true } });
  await step('comment', 'admin.comment', { admin: true, body: { id: a.entry.id, body: 'Thanks, noted.' } });
  await step('private note', 'admin.comment', { admin: true, body: { id: a.entry.id, body: 'Note to self.', public: false } });
  await step('report', 'report', { body: { pass, voter: other, id: c.entry.id, reason: 'spam' } });
  await step('merge c', 'admin.update', { admin: true, body: { id: c.entry.id, merge_into: a.entry.id } });
  await step('list', 'list', { voter: other });
  await step('mine published', 'mine', { body: { receipts: [a.receipt, c.receipt, 'unknown'] } });
  await step('queue', 'admin.queue', { admin: true });
  const pendingB = queue0.pending.find((e) => e.id === b.entry.id);
  await step('apply', 'admin.apply', { admin: true, body: { run: { reviewer: 'Contract', digest: '- one entry' }, decisions: [{ id: b.entry.id, fingerprint: pendingB.fingerprint, action: 'publish', confidence: 95, reason: 'Fine.', tags: ['design'] }] } });
  await step('entries', 'admin.entries', { admin: true, query: { sort: 'votes', limit: '10' } });
  await step('entries filtered', 'admin.entries', { admin: true, query: { state: 'published', q: 'Contract', tag: 'design' } });
  await step('entry', 'admin.entry', { admin: true, query: { id: String(a.entry.id) } });
  await step('entry unknown', 'admin.entry', { admin: true, query: { id: '987654' } });
  await step('create', 'admin.create', { admin: true, body: { type: 'bug', title: 'Contract owner item', public: true } });
  await step('comment update', 'admin.comment_update', { admin: true, body: { comment_id: (await api.call('admin.entry', { admin: true, query: { id: String(a.entry.id) } })).json.entry.comments[0].id, hidden: true } });
  await step('block', 'admin.block', { admin: true, body: { id: c.entry.id } });
  await step('dismiss', 'admin.dismiss_reports', { admin: true, body: { id: a.entry.id } });
  await step('unblock', 'admin.unblock', { admin: true, body: { id: c.entry.id } });
  await step('stats', 'admin.stats', { admin: true });
  await step('runs', 'admin.runs', { admin: true });
  const log = (await step('log', 'admin.log', { admin: true, query: { limit: '50' } })).json;
  const edit = await api.call('admin.update', { admin: true, body: { id: b.entry.id, status: 'planned' } });
  assert.equal(edit.status, 200);
  const publishB = log.actions.find((x) => x.entry_id === b.entry.id && x.kind === 'publish');
  await step('undo refused', 'admin.undo', { admin: true, body: { action_id: publishB.id } });
  const statusRow = (await api.call('admin.log', { admin: true, query: { entry_id: String(b.entry.id) } })).json.actions[0];
  await step('undo', 'admin.undo', { admin: true, body: { action_id: statusRow.id } });
  await step('undo run', 'admin.undo', { admin: true, body: { run_id: (await api.call('admin.runs', { admin: true })).json.runs[0].id } });
  return out;
}

/** The shape of a JSON value: object keys, recursively; an array is the union of its elements. null when there is nothing to compare. */
function shape(v) {
  if (Array.isArray(v)) {
    const items = v.map(shape).filter((s) => s !== null);
    if (!items.length) return null;
    return items.reduce((acc, s) => merge(acc, s));
  }
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v === null ? null : typeof v;
}
function merge(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (typeof a === 'object' && typeof b === 'object') {
    const out = { ...a };
    for (const [k, x] of Object.entries(b)) out[k] = k in out ? merge(out[k], x) : x;
    return out;
  }
  return a;
}
// Free-form members whose keys depend on the data, and `null` placeholders that the other side may fill.
const FREE = new Set(['context', 'ai']);
function differences(real, demo, where = '') {
  if (real === null || demo === null) return [];
  if (typeof real !== typeof demo) return [`${where}: ${typeof real} vs ${typeof demo}`];
  if (typeof real !== 'object') return [];
  const out = [];
  for (const k of new Set([...Object.keys(real), ...Object.keys(demo)])) {
    if (FREE.has(k)) continue;
    if (!(k in real)) out.push(`${where}.${k}: only in the demo`);
    else if (!(k in demo)) out.push(`${where}.${k}: missing in the demo`);
    else out.push(...differences(real[k], demo[k], `${where}.${k}`));
  }
  return out;
}

describe('the demo backend answers like the real api.php', { skip: phpMissing }, () => {
  let box;
  let real;
  let demo;
  before(async () => {
    box = await startArghBox({ config: { moderation: 'pending', tags: ['design'] } });
    [real, demo] = [await scenario(realClient(box)), await scenario(demoClient(loadBackend()))];
  });
  after(async () => { await box?.stop(); });

  test('the scenario ran the same steps', () => {
    assert.deepEqual(Object.keys(demo), Object.keys(real));
    assert.ok(Object.keys(real).length > 30);
  });

  test('every step has the same HTTP status', () => {
    const mismatch = Object.keys(real).filter((k) => real[k].status !== demo[k].status).map((k) => `${k}: ${real[k].status} vs ${demo[k].status}`);
    assert.deepEqual(mismatch, []);
  });

  test('every step has the same keys, recursively', () => {
    const problems = [];
    for (const name of Object.keys(real)) {
      for (const d of differences(shape(real[name].json), shape(demo[name].json), name)) problems.push(d);
    }
    assert.deepEqual(problems, []);
  });

  test('the steps that matter most carry real data on both sides', () => {
    for (const name of ['list', 'queue', 'entries', 'entry', 'stats', 'runs', 'log']) {
      assert.equal(real[name].status, 200, name);
      assert.equal(demo[name].status, 200, name);
    }
    assert.ok(real.list.json.entries[0].aliases.length > 0, 'the list has an alias on the real server');
    assert.ok(demo.list.json.entries.some((e) => e.aliases.length > 0));
    assert.equal(real['undo refused'].status, 409);
    assert.deepEqual(Object.keys(demo['undo refused'].json).sort(), Object.keys(real['undo refused'].json).sort());
  });
});
