import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { newVoter, nextIp, startArghBox } from '../helpers/server.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('session (Turnstile)', () => {
  let box;
  before(async () => { box = await startArghBox(); });
  after(async () => { await box.stop(); });

  test('good token gives a pass; secret, token and remoteip reach the verifier', async () => {
    const ip = nextIp();
    const r = await box.call('session', { body: { turnstile: 'good-token-1' }, ip });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.match(r.json.pass, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(Date.parse(r.json.expires_at) > Date.now());
    const sent = box.fake.requests.at(-1);
    assert.equal(sent.secret, 'test-secret');
    assert.equal(sent.response, 'good-token-1');
    assert.equal(sent.remoteip, ip);
  });

  test('failing and missing tokens are refused', async () => {
    const bad = await box.call('session', { body: { turnstile: 'fail-me' }, ip: nextIp() });
    assert.equal(bad.status, 403);
    assert.equal(bad.json.error, 'turnstile_failed');
    const none = await box.call('session', { body: {}, ip: nextIp() });
    assert.equal(none.status, 403);
    assert.equal(none.json.error, 'turnstile_failed');
  });

  test('works without curl (stream context fallback)', async () => {
    const b = await startArghBox({ env: { ARGHBOX_NO_CURL: '1' } });
    try {
      const r = await b.call('session', { body: { turnstile: 'ok' } });
      assert.equal(r.json.ok, true);
      assert.equal(b.fake.requests.at(-1).response, 'ok');
    } finally {
      await b.stop();
    }
  });

  test('unreachable verifier is turnstile_failed, not a crash', async () => {
    const b = await startArghBox({ turnstile: false });
    try {
      const r = await b.call('session', { body: { turnstile: 'ok' } });
      assert.equal(r.status, 502);
      assert.equal(r.json.error, 'turnstile_failed');
    } finally {
      await b.stop();
    }
  });

  test('no Turnstile secret configured', async () => {
    const b = await startArghBox({ config: { turnstile_secret_key: '' } });
    try {
      const r = await b.call('session', { body: { turnstile: 'ok' } });
      assert.equal(r.status, 503);
      assert.equal(r.json.error, 'turnstile_not_configured');
    } finally {
      await b.stop();
    }
  });

  test('sessions are rate limited with Retry-After', async () => {
    const b = await startArghBox({ config: { limits: { sessions_per_hour: 2 } } });
    try {
      const ip = nextIp();
      for (let i = 0; i < 2; i++) assert.equal((await b.call('session', { body: { turnstile: 't' }, ip })).status, 200);
      const r = await b.call('session', { body: { turnstile: 't' }, ip });
      assert.equal(r.status, 429);
      assert.equal(r.json.error, 'rate_limited');
      assert.ok(Number(r.headers.get('retry-after')) > 0);
      assert.equal(r.json.retry_after, Number(r.headers.get('retry-after')));
      // another IP is unaffected
      assert.equal((await b.call('session', { body: { turnstile: 't' }, ip: nextIp() })).status, 200);
    } finally {
      await b.stop();
    }
  });
});

describe('pass checks', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { limits: { pass_ttl_seconds: 1 } } }); });
  after(async () => { await box.stop(); });

  test('missing, garbage and tampered passes are pass_invalid', async () => {
    for (const pass of [undefined, '', 'garbage', 'a.b', 'x'.repeat(500)]) {
      const r = await box.add({ pass: pass ?? '' }, nextIp());
      assert.equal(r.status, 401, String(pass).slice(0, 10));
      assert.equal(r.json.error, 'pass_invalid');
    }
    const ip = nextIp();
    const good = await box.session(ip);
    const [payload, sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ h: 'x', e: 9999999999, n: 'n' })).toString('base64url') + '.' + sig;
    assert.equal((await box.add({ pass: forged }, ip)).json.error, 'pass_invalid');
    assert.equal((await box.add({ pass: payload + '.' + sig.slice(0, -2) + 'AA' }, ip)).json.error, 'pass_invalid');
  });

  test('expired pass is pass_expired', async () => {
    const ip = nextIp();
    const pass = await box.session(ip);
    await sleep(2300);
    const r = await box.add({ pass }, ip);
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'pass_expired');
  });

  test('a pass from another IP is pass_invalid', async () => {
    const b = await startArghBox();
    try {
      const pass = await b.session(nextIp());
      const r = await b.add({ pass }, nextIp());
      assert.equal(r.json.error, 'pass_invalid');
    } finally {
      await b.stop();
    }
  });
});

describe('add', () => {
  let box;
  before(async () => { box = await startArghBox(); });
  after(async () => { await box.stop(); });

  const stats = async () => (await box.admin('admin.stats')).json.counts;

  test('a valid entry is pending, starts with its author vote, and is not listed', async () => {
    const ip = nextIp();
    const r = await box.add({ title: 'Please add dark mode' }, ip);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.entry.state, 'pending');
    assert.equal(r.json.entry.votes, 1);
    assert.equal(r.json.entry.status, 'open');
    assert.deepEqual(r.json.entry.tags, []);
    assert.deepEqual(r.json.entry.comments, []);
    assert.ok(r.json.entry.id > 0);
    assert.ok(r.json.receipt.length >= 20);
    assert.equal((await box.list()).json.entries.length, 0);
    const adm = await box.admin('admin.entries', { query: { state: 'pending' } });
    assert.equal(adm.json.total, 1);
    assert.equal(adm.json.entries[0].votes, 1);
    assert.equal(adm.json.entries[0].source, 'visitor');
    assert.equal(adm.json.entries[0].author.length, 8);
    assert.equal(adm.json.entries[0].title_original, 'Please add dark mode');
  });

  test('title rules', async () => {
    const ip = nextIp();
    const pass = await box.session(ip);
    for (const title of ['abc', '   a  b ', '', 'x'.repeat(121), '🙂🙂🙂', '🙂🙂🙂🙂', '!!!!', '\u200B'.repeat(4) + '\u202E'.repeat(4)]) {
      const r = await box.add({ title, pass }, ip);
      assert.equal(r.status, 400, JSON.stringify(title));
      assert.equal(r.json.error, 'invalid_input');
      assert.equal(r.json.field, 'title');
    }
    const missing = await box.call('add', { body: { pass, voter: newVoter(), type: 'idea', elapsed_ms: 9000 }, ip });
    assert.equal(missing.json.field, 'title');
    assert.equal((await box.add({ title: 'a🙂🙂🙂', pass }, ip)).status, 200, 'emoji count as characters');
    const sp = await box.add({ title: '  Hello \n  wide   world  ', pass }, ip);
    assert.equal(sp.json.entry.title, 'Hello wide world');
    assert.equal((await box.add({ title: 'x'.repeat(120), pass }, ip)).status, 200);
  });

  test('body rules: trimmed, newlines kept, control chars removed, max 2000', async () => {
    const ip = nextIp();
    const pass = await box.session(ip);
    const r = await box.add({ title: 'Body check please', body: '  line one\r\nline\u0007 two\u0000\n\nthree  ', pass }, ip);
    assert.equal(r.json.entry.body, 'line one\nline two\n\nthree');
    const long = await box.add({ title: 'Too long body', body: 'y'.repeat(2001), pass }, ip);
    assert.equal(long.json.field, 'body');
    assert.equal((await box.add({ title: 'Max body ok', body: 'y'.repeat(2000), pass }, ip)).status, 200);
  });

  test('type is required and limited', async () => {
    const ip = nextIp();
    const pass = await box.session(ip);
    for (const type of ['nope', '', 5, null]) {
      const r = await box.add({ type, pass }, ip);
      assert.equal(r.json.field, 'type', String(type));
    }
    for (const type of ['idea', 'bug', 'question']) assert.equal((await box.add({ type, pass }, ip)).status, 200);
  });

  test('voter key must be well formed', async () => {
    const ip = nextIp();
    const pass = await box.session(ip);
    for (const voter of ['short', 'has space has space has space', 'x'.repeat(65), 12]) {
      const r = await box.add({ voter, pass }, ip);
      assert.equal(r.json.field, 'voter');
    }
  });

  test('links are limited to max_links (2)', async () => {
    const ip = nextIp();
    const pass = await box.session(ip);
    const ok = await box.add({ title: 'Links fine here', body: 'see http://a.example and www.b.example', pass }, ip);
    assert.equal(ok.status, 200);
    const bad = await box.add({ title: 'https://a.example', body: 'http://b.example and www.c.example', pass }, ip);
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'invalid_input');
  });

  test('honeypot and too-fast submissions get a silent fake success and store nothing', async () => {
    const before = await stats();
    const ip = nextIp();
    const pass = await box.session(ip);
    for (const extra of [{ hp: 'http://spam' }, { elapsed_ms: 100 }, { elapsed_ms: undefined }]) {
      const r = await box.add({ title: 'Totally real feedback', pass, ...extra }, ip);
      assert.equal(r.status, 200);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.entry.id, 0);
      assert.equal(r.json.entry.state, 'pending');
      assert.ok(r.json.receipt);
    }
    assert.deepEqual(await stats(), before);
    assert.equal((await box.call('mine', { body: { receipts: ['whatever'] } })).json.entries.length, 0);
  });

  test('context is sanitized', async () => {
    const ip = nextIp();
    const r = await box.add({
      title: 'Context check here',
      context: { page: '/pricing?x=1#top', lang: 'pl-PL', browser: 'B'.repeat(60), os: 'Linux', screen: 'huge', evil: '<script>' },
    }, ip);
    const e = (await box.admin('admin.entries', { query: { q: 'Context check here' } })).json.entries.find((x) => x.id === r.json.entry.id);
    assert.equal(e.context.page, '/pricing');
    assert.equal(e.context.lang, 'pl-PL');
    assert.equal(e.context.browser.length, 40);
    assert.equal(e.context.os, 'Linux');
    assert.equal('screen' in e.context, false);
    assert.equal('evil' in e.context, false);
    const r2 = await box.add({ title: 'Context check two', context: { page: 'relative', lang: 'not a lang!!!' } }, ip);
    const e2 = (await box.admin('admin.entries', { query: { q: 'Context check two' } })).json.entries.find((x) => x.id === r2.json.entry.id);
    assert.equal('page' in e2.context, false);
    assert.equal('lang' in e2.context, false);
  });

  test('entries_per_hour is enforced with Retry-After', async () => {
    const b = await startArghBox({ config: { limits: { entries_per_hour: 2 } } });
    try {
      const ip = nextIp();
      const pass = await b.session(ip);
      assert.equal((await b.add({ title: 'First entry here', pass }, ip)).status, 200);
      assert.equal((await b.add({ title: 'Second entry here', pass }, ip)).status, 200);
      const r = await b.add({ title: 'Third entry here', pass }, ip);
      assert.equal(r.status, 429);
      assert.equal(r.json.error, 'rate_limited');
      assert.ok(Number(r.headers.get('retry-after')) > 0);
      assert.equal((await b.add({ title: 'Other visitor fine' }, nextIp())).status, 200);
    } finally {
      await b.stop();
    }
  });

  test('moderation "publish" shows entries at once', async () => {
    const b = await startArghBox({ config: { moderation: 'publish' } });
    try {
      const r = await b.add({ title: 'Visible right away' }, nextIp());
      assert.equal(r.json.entry.state, 'published');
      const l = await b.list(r.voter);
      assert.equal(l.json.entries.length, 1);
      assert.deepEqual(l.json.voted, [r.json.entry.id]);
      assert.equal(l.json.entries[0].source, 'visitor');
    } finally {
      await b.stop();
    }
  });
});

describe('votes', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('vote on, again (no double count), off, off again', async () => {
    const a = await box.add({ title: 'Voting target one' }, nextIp());
    const id = a.json.entry.id;
    const voter = newVoter();
    const ip = nextIp();
    const v1 = await box.vote(id, true, voter, ip);
    assert.equal(v1.status, 200);
    assert.deepEqual([v1.json.id, v1.json.votes, v1.json.voted], [id, 2, true]);
    const v2 = await box.vote(id, true, voter, ip);
    assert.deepEqual([v2.json.votes, v2.json.voted], [2, true]);
    const off = await box.vote(id, false, voter, ip);
    assert.deepEqual([off.json.votes, off.json.voted], [1, false]);
    const off2 = await box.vote(id, false, voter, ip);
    assert.deepEqual([off2.json.votes, off2.json.voted], [1, false]);
    const l = await box.list(voter);
    assert.deepEqual(l.json.voted, []);
    assert.equal(l.json.entries.find((e) => e.id === id).votes, 1);
  });

  test('"on" defaults to true; bad input is refused; unknown and unpublished entries are 404', async () => {
    const a = await box.add({ title: 'Voting target two' }, nextIp());
    const ip = nextIp();
    const pass = await box.session(ip);
    const r = await box.call('vote', { body: { pass, voter: newVoter(), id: a.json.entry.id }, ip });
    assert.equal(r.json.votes, 2);
    assert.equal((await box.call('vote', { body: { pass, voter: newVoter(), id: 'x' }, ip })).json.field, 'id');
    assert.equal((await box.call('vote', { body: { pass, voter: newVoter(), id: a.json.entry.id, on: 'yes' }, ip })).json.field, 'on');
    assert.equal((await box.call('vote', { body: { pass, voter: 'bad', id: 1 }, ip })).json.field, 'voter');
    assert.equal((await box.call('vote', { body: { pass, voter: newVoter(), id: 99999 }, ip })).status, 404);
    const pend = await startArghBox();
    try {
      const p = await pend.add({ title: 'Pending entry only' }, nextIp());
      assert.equal((await pend.vote(p.json.entry.id, true, newVoter(), nextIp())).status, 404);
    } finally {
      await pend.stop();
    }
  });

  test('several voter keys from one IP up to votes_per_ip_per_entry (3, author included), then refused', async () => {
    const ip = nextIp();
    const a = await box.add({ title: 'One network many keys' }, ip);
    const id = a.json.entry.id;
    const pass = await box.session(ip);
    const r2 = await box.vote(id, true, newVoter(), ip, pass);
    const r3 = await box.vote(id, true, newVoter(), ip, pass);
    assert.equal(r2.status, 200);
    assert.equal(r3.json.votes, 3);
    const r4 = await box.vote(id, true, newVoter(), ip, pass);
    assert.equal(r4.status, 429);
    assert.equal(r4.json.error, 'rate_limited');
    assert.ok(r4.headers.get('retry-after'));
    assert.equal((await box.vote(id, true, newVoter(), nextIp())).json.votes, 4);
    // the author's own key is not blocked from re-confirming
    assert.equal((await box.vote(id, true, a.voter, ip, pass)).status, 200);
  });

  test('votes_per_hour is enforced', async () => {
    const b = await startArghBox({ config: { moderation: 'publish', limits: { votes_per_hour: 2 } } });
    try {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push((await b.add({ title: `Entry number ${i} here` }, nextIp())).json.entry.id);
      const ip = nextIp();
      const pass = await b.session(ip);
      const voter = newVoter();
      assert.equal((await b.vote(ids[0], true, voter, ip, pass)).status, 200);
      assert.equal((await b.vote(ids[1], true, voter, ip, pass)).status, 200);
      const r = await b.vote(ids[2], true, voter, ip, pass);
      assert.equal(r.status, 429);
      assert.ok(Number(r.headers.get('retry-after')) > 0);
    } finally {
      await b.stop();
    }
  });

  test('voting on a merged entry counts for the final target', async () => {
    const a = await box.add({ title: 'Merge source entry' }, nextIp());
    const b = await box.add({ title: 'Merge target entry' }, nextIp());
    const m = await box.admin('admin.update', { body: { id: a.json.entry.id, merge_into: b.json.entry.id } });
    assert.equal(m.json.ok, true, m.text);
    assert.equal(m.json.entry.state, 'merged');
    const v = await box.vote(a.json.entry.id, true, newVoter(), nextIp());
    assert.equal(v.json.id, b.json.entry.id);
    assert.equal(v.json.votes, 3, 'target had 1 own + 1 moved + 1 new');
    const l = await box.list(a.voter);
    assert.ok(!l.json.entries.some((e) => e.id === a.json.entry.id));
    assert.ok(l.json.voted.includes(b.json.entry.id), 'the moved vote shows as voted on the target');
    const tgt = l.json.entries.find((e) => e.id === b.json.entry.id);
    assert.equal(tgt.similar, 1);
    assert.deepEqual(tgt.aliases, ['Merge source entry']);
  });
});

describe('mine', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'pending' } }); });
  after(async () => { await box.stop(); });

  test('reports the fate of my entries, including reasons, merges and comments', async () => {
    const mk = async (title) => {
      const r = await box.add({ title }, nextIp());
      return { id: r.json.entry.id, receipt: r.json.receipt };
    };
    const pend = await mk('Mine still pending');
    const rej = await mk('Mine got rejected');
    const flg = await mk('Mine got flagged');
    const tgt = await mk('Mine target entry');
    const src = await mk('Mine merged source');
    const pub = await mk('Mine published');
    assert.equal((await box.admin('admin.update', { body: { id: rej.id, state: 'rejected', reject_reason: 'spam' } })).json.ok, true);
    assert.equal((await box.admin('admin.update', { body: { id: flg.id, state: 'flagged' } })).json.ok, true);
    assert.equal((await box.admin('admin.update', { body: { id: tgt.id, state: 'published' } })).json.ok, true);
    assert.equal((await box.admin('admin.update', { body: { id: pub.id, state: 'published', tags: ['alpha'], status: 'planned' } })).json.ok, true);
    assert.equal((await box.admin('admin.comment', { body: { id: pub.id, body: 'We are on it.' } })).json.ok, true);
    assert.equal((await box.admin('admin.comment', { body: { id: pub.id, body: 'secret note', public: false } })).json.ok, true);
    assert.equal((await box.admin('admin.update', { body: { id: src.id, merge_into: tgt.id } })).json.ok, true);

    const r = await box.call('mine', { body: { receipts: [pend, rej, flg, tgt, src, pub, { x: 1 }, 'unknown-receipt'].map((x) => x.receipt ?? x) } });
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.json.entries.map((e) => [e.id, e]));
    assert.equal(r.json.entries.length, 6);
    assert.equal(by[pend.id].state, 'pending');
    assert.equal(by[flg.id].state, 'pending', 'flagged is reported as pending');
    assert.equal(by[rej.id].state, 'rejected');
    assert.equal(by[rej.id].reject_reason, 'spam');
    assert.equal(by[src.id].state, 'merged');
    assert.equal(by[src.id].merged_into, tgt.id);
    assert.equal(by[src.id].merged_into_title, 'Mine target entry');
    assert.equal(by[pub.id].state, 'published');
    assert.equal(by[pub.id].status, 'planned');
    assert.deepEqual(by[pub.id].tags, ['alpha']);
    assert.equal(by[pub.id].comments.length, 1);
    assert.equal(by[pub.id].comments[0].body, 'We are on it.');
    assert.equal(by[pend.id].reject_reason, null);
    for (const k of ['receipt', 'id', 'type', 'title', 'state', 'status', 'tags', 'comments', 'merged_into', 'merged_into_title', 'reject_reason']) {
      assert.ok(k in by[pub.id], k);
    }
    assert.ok(!r.text.includes('secret note'));
  });

  test('more than 50 receipts is invalid_input', async () => {
    const r = await box.call('mine', { body: { receipts: Array.from({ length: 51 }, (_, i) => 'r' + i) } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_input');
    assert.equal((await box.call('mine', { body: {} })).json.error, 'invalid_input');
  });
});

describe('public list shows the backlog', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', tags: ['preset-tag'] } }); });
  after(async () => { await box.stop(); });

  test('all statuses, never private/rejected/merged, tag_counts and ordering', async () => {
    const mk = async (title, extra = {}) => (await box.add({ title }, nextIp())).json.entry.id;
    const open = await mk('Open one here');
    const done = await mk('Done one here');
    const declined = await mk('Declined one here');
    const rejected = await mk('Rejected one here');
    const owner = (await box.admin('admin.create', { body: { type: 'idea', title: 'Private owner task' } })).json.entry;
    const upd = (body) => box.admin('admin.update', { body });
    await upd({ id: done, status: 'done', tags: ['alpha', 'beta'] });
    await upd({ id: declined, status: 'declined', tags: ['alpha'] });
    await upd({ id: rejected, state: 'rejected' });
    await box.admin('admin.comment', { body: { id: declined, body: 'Because of reasons.' } });
    const l = (await box.list()).json;
    const ids = l.entries.map((e) => e.id);
    assert.ok(ids.includes(open) && ids.includes(done) && ids.includes(declined));
    assert.ok(!ids.includes(rejected) && !ids.includes(owner.id));
    const d = l.entries.find((e) => e.id === declined);
    assert.equal(d.status, 'declined');
    assert.ok(d.status_at);
    assert.equal(d.comments[0].body, 'Because of reasons.');
    assert.ok(d.comments[0].at);
    assert.deepEqual(l.tag_counts, [{ tag: 'alpha', count: 2 }, { tag: 'beta', count: 1 }]);
    assert.equal(l.entries.find((e) => e.id === open).status_at, null);
  });
});

describe('Turnstile failures are diagnosable in error.log', () => {
  for (const [name, env] of [['curl', {}], ['stream fallback', { ARGHBOX_NO_CURL: '1' }]]) {
    test(`${name}: the log says why, never logs tokens or secrets, and no deprecation noise`, async () => {
      const b = await startArghBox({ turnstile: false, env });
      try {
        const r = await b.call('session', { body: { turnstile: 'super-secret-token-123' } });
        assert.equal(r.status, 502);
        assert.equal(r.json.error, 'turnstile_failed');
        const log = fs.readFileSync(path.join(b.dataDir, 'error.log'), 'utf8');
        assert.match(log, /turnstile: verification request failed \((curl|stream): /);
        assert.match(log, name === 'curl' ? /curl: error \d+ /i : /stream: .*(no response|HTTP)/);
        assert.doesNotMatch(log, /super-secret-token-123|test-secret/);
        assert.doesNotMatch(log, /deprecated|curl_close/i);
      } finally {
        await b.stop();
      }
    });
  }
});
