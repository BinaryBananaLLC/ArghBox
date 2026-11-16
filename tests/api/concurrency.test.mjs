// Several PHP workers at once. `php -S` runs one request at a time per process, so four processes sharing ONE
// config and ONE data directory behave like four PHP-FPM workers on a shared host: they contend for the same
// SQLite file. Each journal mode is run and its numbers are printed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nextIp, startArghBox } from '../helpers/server.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';

const SCALE = Number(process.env.STRESS_SCALE || 1); // STRESS_SCALE=3 for a heavier measurement run
const voter = () => crypto.randomBytes(18).toString('base64url');
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

/** Run a read-only SQL query against the box's database with the PHP CLI. */
function sql(box, query) {
  const file = fs.readdirSync(box.dataDir).find((f) => f.endsWith('.sqlite'));
  const script = '$d = new PDO("sqlite:" . $argv[1]); echo json_encode($d->query($argv[2])->fetchAll(PDO::FETCH_ASSOC));';
  const r = spawnSync(phpPath(), phpArgs(['-r', script, path.join(box.dataDir, file), query]), { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const mode of ['delete', 'wal']) {
  describe(`4 workers, one data directory, journal mode ${mode}`, () => {
    test('about 200 mixed parallel requests: no 500s, invariants hold, rate limits respected', async () => {
      const box = await startArghBox({
        workers: 4,
        env: { ARGHBOX_JOURNAL_MODE: mode },
        config: {
          moderation: 'publish',
          limits: { entries_per_hour: 5, votes_per_hour: 100000, sessions_per_hour: 100000, sessions_global_per_hour: 1000000, votes_per_ip_per_entry: 3, mine_per_hour: 100000, admin_logins_per_hour: 1000, auth_failures_global_per_hour: 100000 },
        },
      });
      const log = [];
      const req = async (action, opts) => {
        const t0 = performance.now();
        const r = await box.call(action, opts);
        log.push({ action, status: r.status, ms: performance.now() - t0, error: r.json?.error });
        return r;
      };
      const pass = async (ip) => (await req('session', { body: { turnstile: 'good' }, ip })).json?.pass;
      const add = async (title, ip, p) => req('add', { ip, body: { pass: p ?? (await pass(ip)), voter: voter(), type: 'idea', title, elapsed_ms: 9000, hp: '' } });
      const started = performance.now();
      try {
        // A cold database hit by eight requests at once (first-request migration race).
        const cold = await Promise.all(Array.from({ length: 8 }, () => req('list', {})));
        assert.ok(cold.every((r) => r.status === 200), 'cold start: ' + cold.map((r) => r.status));

        // Seed published entries in parallel.
        const seeded = await Promise.all(Array.from({ length: 20 }, (_, i) => add(`Stress entry number ${i} here`, nextIp())));
        assert.ok(seeded.every((r) => r.status === 200), 'seeding: ' + seeded.map((r) => r.status));
        const ids = seeded.map((r) => r.json.entry.id);
        const fps = Object.fromEntries((await box.admin('admin.entries', { query: { limit: '200' } })).json.entries.map((e) => [e.id, e.fingerprint]));
        const tagDecision = (id) => ({ id, fingerprint: fps[id], action: 'tag', tags: ['stress'], confidence: 90, reason: 'stress' });
        const runs = [];
        for (let i = 0; i < 10; i++) {
          const r = await box.triage('admin.apply', { body: { run: { reviewer: 'Seed' }, decisions: [tagDecision(ids[i])] } });
          runs.push(r.json.run_id);
        }

        // The storm.
        const hot = nextIp(); // one address hammering add: only entries_per_hour may succeed
        const hotPass = await pass(hot);
        const capIp = nextIp(); // one address, many voter keys on one entry: only votes_per_ip_per_entry may succeed
        const capPass = await pass(capIp);
        const capEntry = ids[19];
        const ops = [];
        for (let i = 0; i < 40 * SCALE; i++) ops.push(() => pass(nextIp()));
        for (let i = 0; i < 30 * SCALE; i++) ops.push(() => add(`Parallel new entry ${i} here`, nextIp()));
        for (let i = 0; i < 60 * SCALE; i++) {
          ops.push(async () => {
            const ip = nextIp();
            const p = await pass(ip);
            return req('vote', { ip, body: { pass: p, voter: voter(), id: ids[i % 18], on: i % 4 !== 0 } });
          });
        }
        for (let i = 0; i < 30 * SCALE; i++) ops.push(() => req('list', { headers: { 'X-ArghBox-Voter': voter() }, ip: nextIp() }));
        for (let i = 0; i < 15 * SCALE; i++) ops.push(() => req('mine', { body: { receipts: ['nothing-here-' + i] }, ip: nextIp() }));
        for (let i = 0; i < 15 * SCALE; i++) ops.push(() => req('admin.apply', { token: box.triageToken, body: { run: { reviewer: 'Storm' }, decisions: [tagDecision(ids[10 + (i % 8)])] } }));
        for (const runId of runs) ops.push(() => req('admin.undo', { token: box.ownerToken, body: { run_id: runId } }));
        for (let i = 0; i < 30; i++) ops.push(() => add(`Hot address entry ${i} here`, hot, hotPass).then((r) => ({ hotAdd: true, r })));
        for (let i = 0; i < 10; i++) ops.push(() => req('vote', { ip: capIp, body: { pass: capPass, voter: voter(), id: capEntry, on: true } }).then((r) => ({ capVote: true, r })));
        // shuffle so the kinds interleave
        for (let i = ops.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ops[i], ops[j]] = [ops[j], ops[i]]; }
        const results = await Promise.all(ops.map((f) => f()));

        const total = log.length;
        const errors = log.filter((e) => e.status >= 500);
        const busy = log.filter((e) => e.status === 503 && e.error === 'busy');
        const lat = log.map((e) => e.ms);
        const out = {
          mode, requests: total, http500: errors.filter((e) => e.status === 500).length, busy503: busy.length,
          p50_ms: Math.round(percentile(lat, 0.5)), p95_ms: Math.round(percentile(lat, 0.95)), max_ms: Math.round(Math.max(...lat)),
          total_s: Math.round((performance.now() - started) / 100) / 10,
        };
        console.log('STRESS ' + JSON.stringify(out));
        assert.ok(total >= 300, 'about 200 operations produce 300+ HTTP requests: ' + total);
        assert.equal(out.http500, 0, 'no HTTP 500: ' + JSON.stringify(errors.slice(0, 3)));
        assert.equal(errors.length, busy.length, 'only a clean 503 busy is allowed');

        // Rate limits survived the race.
        const hotAdds = results.filter((r) => r?.hotAdd).map((r) => r.r.status);
        assert.equal(hotAdds.filter((s) => s === 200).length, 5, 'entries_per_hour 5: ' + hotAdds.join(','));
        assert.ok(hotAdds.every((s) => s === 200 || s === 429 || s === 503));
        const capVotes = results.filter((r) => r?.capVote).map((r) => r.r.status);
        assert.equal(capVotes.filter((s) => s === 200).length, 3, 'votes_per_ip_per_entry 3: ' + capVotes.join(','));

        // Invariants of the data.
        assert.deepEqual(sql(box, 'SELECT COUNT(*) AS n FROM entries e WHERE e.votes != (SELECT COUNT(*) FROM votes v WHERE v.entry_id = e.id)'), [{ n: 0 }], 'entries.votes equals the vote rows');
        assert.deepEqual(sql(box, 'SELECT COUNT(*) AS n FROM (SELECT entry_id, voter_hash FROM votes GROUP BY entry_id, voter_hash HAVING COUNT(*) > 1)'), [{ n: 0 }], 'no duplicate vote per voter key');
        assert.deepEqual(sql(box, 'PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
        assert.equal(sql(box, "SELECT COUNT(*) AS n FROM actions WHERE kind NOT IN ('tag', 'undo')")[0].n, 0, 'only tag and undo actions were logged');
        const hotRows = sql(box, 'SELECT key, count FROM limits').filter((r) => r.key.startsWith('entries|'));
        assert.ok(hotRows.every((r) => r.count <= 5), 'no entries counter above its limit');
        const journal = sql(box, 'PRAGMA journal_mode')[0].journal_mode;
        assert.ok(['delete', 'wal'].includes(journal));
        console.log(`STRESS journal_mode in file: ${journal}`);
      } finally {
        await box.stop();
      }
    });
  });
}

describe('busy database handling', () => {
  test('a locked database answers 503 busy with Retry-After 2, never 500', async () => {
    const box = await startArghBox({ env: { ARGHBOX_BUSY_TIMEOUT_MS: '300' }, config: { moderation: 'publish' } });
    try {
      await box.list(); // create and migrate
      const file = fs.readdirSync(box.dataDir).find((f) => f.endsWith('.sqlite'));
      // Hold the write lock from another process for longer than busy_timeout (300 ms here) plus the retry.
      const hold = '$d = new PDO("sqlite:" . $argv[1]); $d->exec("BEGIN EXCLUSIVE"); echo "locked\\n"; sleep(30); $d->exec("ROLLBACK");';
      const { spawn } = await import('node:child_process');
      const locker = spawn(phpPath(), phpArgs(['-r', hold, path.join(box.dataDir, file)]), { stdio: ['ignore', 'pipe', 'ignore'] });
      await new Promise((resolve) => locker.stdout.once('data', resolve));
      try {
        const t0 = Date.now();
        // the session call needs the database for its rate limit
        const s = await box.call('session', { body: { turnstile: 't' }, ip: nextIp() });
        const dt = Date.now() - t0;
        assert.equal(s.status, 503, s.text);
        assert.equal(s.json.error, 'busy');
        assert.equal(s.headers.get('retry-after'), '2');
        assert.equal(s.json.retry_after, 2);
        assert.ok(dt >= 300, 'waited for busy_timeout first: ' + dt);
        const l = await box.list();
        assert.equal(l.status, 503);
        assert.equal(l.json.error, 'busy');
      } finally {
        locker.kill();
      }
      // and it recovers once the lock is gone
      await new Promise((r) => setTimeout(r, 500));
      assert.equal((await box.list()).status, 200);
    } finally {
      await box.stop();
    }
  });
});
