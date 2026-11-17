// The triage script against a real backend: reported entries (keep, reject, block_author).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startArghBox, newVoter, nextIp } from '../helpers/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'skill', 'arghbox-triage', 'triage.mjs');

async function setup() {
  const box = await startArghBox({});
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-triage-rep-'));
  const dir = path.join(work, '.arghbox');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ url: box.url }));
  fs.writeFileSync(path.join(dir, 'token'), box.triageToken + '\n');
  const env = { ...process.env, ARGHBOX_TOKEN: '', ARGHBOX_URL: '' };
  const run = (args) => new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: work, env, encoding: 'utf8', windowsHide: true }, (e, stdout, stderr) => {
      resolve({ code: e ? e.code : 0, stdout, stderr, all: stdout + stderr });
    });
  });
  const file = (...p) => path.join(dir, ...p);
  const queue = () => JSON.parse(fs.readFileSync(file('run', 'queue.json'), 'utf8'));
  const writeVerdicts = (v) => fs.writeFileSync(file('run', 'verdicts.json'), JSON.stringify(v, null, 1));
  /** A visitor entry from its own IP, published by the owner. */
  async function published(title, body, ip) {
    const r = await box.add({ type: 'idea', title, body }, ip);
    assert.ok(r.json?.ok, r.text);
    const u = await box.admin('admin.update', { body: { id: r.json.entry.id, state: 'published' } });
    assert.ok(u.json?.ok, u.text);
    return r.json.entry.id;
  }
  async function reportBy(id, n, reason = 'spam') {
    for (let i = 0; i < n; i++) {
      const ip = nextIp();
      const r = await box.call('report', { body: { pass: await box.session(ip), voter: newVoter(), id, reason }, ip });
      assert.ok(r.json?.ok, r.text);
    }
  }
  const entry = async (id) => (await box.admin('admin.entry', { query: { id } })).json.entry;
  const cleanup = async () => {
    await box.stop();
    fs.rmSync(work, { recursive: true, force: true });
  };
  return { box, run, file, queue, writeVerdicts, published, reportBy, entry, cleanup };
}

test('reported entries: fetch, check coverage, apply keep and reject with block_author', async () => {
  const s = await setup();
  try {
    const spamIp = nextIp();
    const spam = await s.published('Cheap watches online', 'buy at https://shop.example', spamIp);
    const critic = await s.published('The new map is worse than the old one', 'Everything is harder to find now.', nextIp());
    const fine = await s.published('Dark mode', 'please', nextIp());
    await s.reportBy(spam, 3, 'spam'); // three people: hidden, back in the pending queue
    await s.reportBy(critic, 2, 'other'); // two people: still public, in Reported
    assert.equal((await s.entry(spam)).state, 'pending');

    let r = await s.run(['fetch']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Fetched 1 pending entry \(1 idea\) and 1 reported entry/);
    const q = s.queue();
    assert.deepEqual(q.reported.map((e) => e.id), [critic]);
    assert.deepEqual(q.pending.map((e) => e.id), [spam]);
    const packet = fs.readFileSync(s.file('run', 'packet.md'), 'utf8');
    assert.match(packet, /## Reported entries \(1\)/);
    assert.match(packet, new RegExp(`### #${critic}\\n- fingerprint: `));
    assert.match(packet, /- reports: 2 open reports: other 2/);
    assert.match(packet, /hidden after reports\)\. Now 3 open reports: spam 3/);

    // Coverage: the reported entry needs a decision.
    const fp = (id) => [...q.pending, ...q.reported].find((e) => e.id === id).fingerprint;
    s.writeVerdicts({ reviewer: 'Test', digest: '- x', decisions: [{ id: spam, fingerprint: fp(spam), action: 'reject', reject_reason: 'spam', block_author: true, confidence: 97, reason: 'Ad.' }] });
    r = await s.run(['check']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, new RegExp(`PROBLEM\\s+#${critic} .*No decision for this reported entry`));

    s.writeVerdicts({
      reviewer: 'Test', digest: '- x',
      decisions: [
        { id: spam, fingerprint: fp(spam), action: 'reject', reject_reason: 'spam', block_author: true, confidence: 97, reason: 'Ad.' },
        { id: critic, fingerprint: fp(critic), action: 'keep', confidence: 92, reason: 'Blunt but fair criticism.' },
      ],
    });
    r = await s.run(['check']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Verdicts OK: 2 decisions for 1 pending entries and 1 reported/);

    r = await s.run(['apply']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /rejected:\s+1/);
    assert.match(r.stdout, /kept \(reports cleared\):\s+1/);
    assert.match(r.stdout, /authors blocked:\s+1/);

    assert.equal((await s.entry(spam)).state, 'rejected');
    assert.equal((await s.entry(spam)).author_blocked, true);
    const kept = await s.entry(critic);
    assert.equal(kept.state, 'published');
    assert.equal(kept.reports.open, 0);
    assert.equal(kept.reports.total, 2);
    assert.equal((await s.entry(fine)).state, 'published');

    // The blocked author's new post is stored as rejected, quietly.
    const again = await s.box.add({ type: 'idea', title: 'More cheap watches', body: 'still selling' }, spamIp);
    assert.ok(again.json.ok);
    assert.equal(again.json.entry.state, 'pending');
    assert.equal((await s.entry(again.json.entry.id)).state, 'rejected');

    // Nothing is pending or reported any more.
    r = await s.run(['fetch']);
    assert.match(r.stdout, /^Nothing to triage\./);

    // The whole run can be undone: the block is lifted and the reports are open again.
    r = await s.run(['undo', '--last']);
    assert.equal(r.code, 0, r.all);
    assert.equal((await s.entry(spam)).author_blocked, false);
    assert.equal((await s.entry(critic)).reports.open, 2);
  } finally {
    await s.cleanup();
  }
});

test('only reported entries: fetch does not say "Nothing to triage."; status shows reported and blocks', async () => {
  const s = await setup();
  try {
    const id = await s.published('Rude post', 'you fools', nextIp());
    await s.reportBy(id, 1, 'abusive');
    let r = await s.run(['fetch']);
    assert.equal(r.code, 0, r.all);
    assert.doesNotMatch(r.stdout, /Nothing to triage/);
    assert.match(r.stdout, /Fetched 0 pending entries and 1 reported entry/);
    r = await s.run(['status']);
    assert.match(r.stdout, /reported 1/);
    assert.match(r.stdout, /0 active author blocks/);
  } finally {
    await s.cleanup();
  }
});

test('a keep below the confidence threshold is skipped and the entry stays in Reported', async () => {
  const s = await setup();
  try {
    const id = await s.published('Borderline post', 'hmm', nextIp());
    await s.reportBy(id, 1, 'other');
    await s.run(['fetch']);
    const e = s.queue().reported[0];
    s.writeVerdicts({ reviewer: 'Test', digest: '- x', decisions: [{ id, fingerprint: e.fingerprint, action: 'keep', confidence: 50, reason: 'Unsure.' }] });
    const c = await s.run(['check']);
    assert.equal(c.code, 0, c.all);
    assert.match(c.stdout, /warning\s+#\d+ .*below the threshold/);
    const r = await s.run(['apply']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /skipped:\s+1/);
    assert.match(r.stdout, /low_confidence/);
    assert.equal((await s.entry(id)).reports.open, 1);
  } finally {
    await s.cleanup();
  }
});

test('apply: "authors blocked" counts what the server did, not what was asked for', async () => {
  const s = await setup();
  try {
    const ip = nextIp();
    const voter = newVoter();
    const post = async (title, from, v) => {
      const r = await s.box.add({ type: 'idea', title, body: 'buy now https://shop.example', voter: v }, from);
      assert.ok(r.json?.ok, r.text);
      assert.ok((await s.box.admin('admin.update', { body: { id: r.json.entry.id, state: 'published' } })).json?.ok);
      return r.json.entry.id;
    };
    const a = await post('Cheap watches one', ip, voter);
    const b = await post('Cheap watches two', ip, voter); // the same author
    const c = await post('Cheap watches three', nextIp(), newVoter()); // another author
    assert.ok((await s.box.admin('admin.block', { body: { id: a } })).json?.ok); // the owner already blocked the first author
    await s.reportBy(b, 3);
    await s.reportBy(c, 3);

    let r = await s.run(['fetch']);
    assert.equal(r.code, 0, r.all);
    const q = s.queue();
    const fp = (id) => q.pending.find((e) => e.id === id).fingerprint;
    s.writeVerdicts({
      reviewer: 'Test', digest: '- x',
      decisions: [b, c].map((id) => ({ id, fingerprint: fp(id), action: 'reject', reject_reason: 'spam', block_author: true, confidence: 97, reason: 'Ad.' })),
    });
    r = await s.run(['apply']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /rejected:\s+2/);
    assert.match(r.stdout, /authors blocked:\s+1\b/); // b's author was already blocked
  } finally {
    await s.cleanup();
  }
});
