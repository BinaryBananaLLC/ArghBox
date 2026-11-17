// The opt-in app pass, context.app, contact_url and the list fields for apps (docs/SPEC.md sections 3, 6 and 6b).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ARGHBOX_DIR, newVoter, nextIp, startArghBox } from '../helpers/server.mjs';
import { phpArgs, phpPath } from '../helpers/php.mjs';

const entry = async (box, id) => (await box.admin('admin.entry', { query: { id: String(id) } })).json.entry;
const turnstileCalls = async (box) => (await fetch(box.fake.url.replace(/\/[^/]*$/, '/_requests'))).json();

describe('app pass off (the default)', () => {
  let box;
  before(async () => { box = await startArghBox(); });
  after(async () => { await box.stop(); });

  test('session {app: true} is refused with 403 turnstile_failed and no Cloudflare call', async () => {
    const calls = (await turnstileCalls(box)).length;
    const r = await box.call('session', { body: { app: true }, ip: nextIp() });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'turnstile_failed');
    assert.equal((await turnstileCalls(box)).length, calls);
  });

  test('list and health say app_pass is false', async () => {
    assert.equal((await box.list()).json.app_pass, false);
    const h = await box.call('health');
    assert.equal(h.json.app_pass, false);
    const priv = await box.admin('health');
    assert.equal(priv.json.app_pass, false);
    assert.ok(!priv.json.warnings.some((w) => /app_pass/.test(w)));
  });

  test('the normal Turnstile session still works', async () => {
    const r = await box.call('session', { body: { turnstile: 'good-token' }, ip: nextIp() });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });

  test('app_pass only counts when it is exactly true (a string in config does not enable it)', async () => {
    const b = await startArghBox({ config: { app_pass: 'yes' } });
    try {
      assert.equal((await b.list()).json.app_pass, false);
      assert.equal((await b.call('session', { body: { app: true }, ip: nextIp() })).status, 403);
    } finally {
      await b.stop();
    }
  });
});

describe('app pass on', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { app_pass: true, moderation: 'publish' } }); });
  after(async () => { await box.stop(); });

  test('session {app: true} returns a normal pass without asking Cloudflare', async () => {
    const before = (await turnstileCalls(box)).length;
    const ip = nextIp();
    const r = await box.call('session', { body: { app: true }, ip });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.match(r.json.pass, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.match(r.json.expires_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(r.json.expires_in > 1700 && r.json.expires_in <= 1800, 'same TTL as a Turnstile pass');
    assert.equal((await turnstileCalls(box)).length, before, 'Cloudflare was not called');
    // The pass works for add, vote and report like any other.
    const voter = newVoter();
    const add = await box.call('add', { body: { pass: r.json.pass, voter, type: 'idea', title: 'Added from inside an app', elapsed_ms: 9000, hp: '' }, ip });
    assert.equal(add.status, 200, add.text);
    assert.equal(add.json.entry.state, 'published');
    const vote = await box.call('vote', { body: { pass: r.json.pass, voter: newVoter(), id: add.json.entry.id, on: true }, ip });
    assert.equal(vote.status, 200, vote.text);
    const rep = await box.call('report', { body: { pass: r.json.pass, voter: newVoter(), id: add.json.entry.id, reason: 'other' }, ip });
    assert.equal(rep.status, 200, rep.text);
  });

  test('the pass is bound to the network like any other pass', async () => {
    const pass = (await box.call('session', { body: { app: true }, ip: nextIp() })).json.pass;
    const r = await box.call('vote', { body: { pass, voter: newVoter(), id: 1, on: true }, ip: nextIp() });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'pass_invalid');
  });

  test('without app: true (or with app not true) there is still no free pass', async () => {
    for (const body of [{}, { app: false }, { app: 'true' }, { app: 1 }, { turnstile: '' }, { app: null }]) {
      const r = await box.call('session', { body, ip: nextIp() });
      assert.equal(r.status, 403, JSON.stringify(body));
      assert.equal(r.json.error, 'turnstile_failed');
    }
  });

  test('with a turnstile token the Turnstile path is used, so a bad token still fails', async () => {
    const before = (await turnstileCalls(box)).length;
    const bad = await box.call('session', { body: { app: true, turnstile: 'fail-this' }, ip: nextIp() });
    assert.equal(bad.status, 403);
    assert.equal((await turnstileCalls(box)).length, before + 1, 'Cloudflare was asked');
    const good = await box.call('session', { body: { app: true, turnstile: 'good-token' }, ip: nextIp() });
    assert.equal(good.status, 200);
  });

  test('list and health say app_pass is true; only authorised callers get the warning', async () => {
    assert.equal((await box.list()).json.app_pass, true);
    const anon = await box.call('health');
    assert.equal(anon.json.app_pass, true);
    assert.equal(anon.json.warnings, undefined);
    for (const call of [box.admin, box.triage, box.read]) {
      const h = await call('health');
      assert.equal(h.json.app_pass, true);
      assert.ok(h.json.warnings.includes('app_pass is on: anyone can get a pass without the human check, so votes are limited only by the per-IP caps.'));
    }
  });

  test('it shares sessions_per_hour with the Turnstile path', async () => {
    const small = await startArghBox({ config: { app_pass: true, limits: { sessions_per_hour: 2 } } });
    try {
      const ip = nextIp();
      assert.equal((await small.call('session', { body: { app: true }, ip })).status, 200);
      assert.equal((await small.call('session', { body: { turnstile: 'good-token' }, ip })).status, 200);
      const limited = await small.call('session', { body: { app: true }, ip });
      assert.equal(limited.status, 429);
      assert.equal(limited.json.error, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal((await small.call('session', { body: { app: true }, ip: nextIp() })).status, 200, 'another network is fine');
    } finally {
      await small.stop();
    }
  });

  test('it shares the global sessions_global_per_hour cap', async () => {
    const small = await startArghBox({ config: { app_pass: true, limits: { sessions_global_per_hour: 2 } } });
    try {
      assert.equal((await small.call('session', { body: { app: true }, ip: nextIp() })).status, 200);
      assert.equal((await small.call('session', { body: { app: true }, ip: nextIp() })).status, 200);
      assert.equal((await small.call('session', { body: { app: true }, ip: nextIp() })).status, 429);
    } finally {
      await small.stop();
    }
  });

  test('votes stay limited by the per-IP caps', async () => {
    const small = await startArghBox({ config: { app_pass: true, moderation: 'publish', limits: { votes_per_ip_per_entry: 2 } } });
    try {
      const ip = nextIp();
      const id = (await small.add({ title: 'Entry that gets voted on a lot' }, nextIp())).json.entry.id;
      const pass = (await small.call('session', { body: { app: true }, ip })).json.pass;
      const v = () => small.call('vote', { body: { pass, voter: newVoter(), id, on: true }, ip });
      assert.equal((await v()).status, 200);
      assert.equal((await v()).status, 200);
      assert.equal((await v()).status, 429);
    } finally {
      await small.stop();
    }
  });

  test('it works on a site without Turnstile keys, which cannot use the normal path', async () => {
    const bare = await startArghBox({ config: { app_pass: true, turnstile_site_key: '', turnstile_secret_key: '' } });
    try {
      const r = await bare.call('session', { body: { app: true }, ip: nextIp() });
      assert.equal(r.status, 200, r.text);
      const web = await bare.call('session', { body: { turnstile: 'good-token' }, ip: nextIp() });
      assert.equal(web.status, 503);
      assert.equal(web.json.error, 'turnstile_not_configured');
    } finally {
      await bare.stop();
    }
  });
});

describe('context.app on add', () => {
  let box;
  before(async () => { box = await startArghBox({ config: { moderation: 'publish', limits: { entries_per_hour: 200 } } }); });
  after(async () => { await box.stop(); });

  const ctxOf = async (context) => {
    const r = await box.add({ title: 'Entry with an app context', context }, nextIp());
    assert.equal(r.status, 200, r.text);
    return (await entry(box, r.json.entry.id)).context;
  };

  test('a valid app object is kept', async () => {
    assert.deepEqual((await ctxOf({ page: '/', app: { platform: 'ios', version: '1.2.3' } })).app, { platform: 'ios', version: '1.2.3' });
    assert.deepEqual((await ctxOf({ app: { platform: 'android', version: '2024.10-beta+7_rc.1' } })).app, { platform: 'android', version: '2024.10-beta+7_rc.1' });
    assert.deepEqual((await ctxOf({ app: { platform: 'other', version: '1' } })).app, { platform: 'other', version: '1' });
  });

  test('the rest of the context is unchanged next to app', async () => {
    const c = await ctxOf({ page: '/p?x=1#y', lang: 'pl', browser: 'WebView', os: 'Android', screen: 'small', app: { platform: 'android', version: '3.1' } });
    assert.deepEqual(c, { page: '/p', lang: 'pl', browser: 'WebView', os: 'Android', screen: 'small', app: { platform: 'android', version: '3.1' } });
  });

  test('invalid members are dropped, the valid one stays, and it is never an error', async () => {
    assert.deepEqual((await ctxOf({ app: { platform: 'windows', version: '1.0' } })).app, { version: '1.0' });
    assert.deepEqual((await ctxOf({ app: { platform: 'iOS', version: '1.0' } })).app, { version: '1.0' }, 'platform is case sensitive');
    assert.deepEqual((await ctxOf({ app: { platform: 'ios', version: 'x'.repeat(21) } })).app, { platform: 'ios' });
    assert.deepEqual((await ctxOf({ app: { platform: 'ios', version: 'x'.repeat(20) } })).app, { platform: 'ios', version: 'x'.repeat(20) });
    for (const version of ['', '1 2', '<b>1</b>', '1.0\n', '../1', 'v\u00e9', 12, null, ['1'], { a: 1 }]) {
      assert.deepEqual((await ctxOf({ app: { platform: 'ios', version } })).app, { platform: 'ios' }, JSON.stringify(version));
    }
    for (const platform of ['', 'ios ', 'IOS', 5, null, ['ios'], { a: 1 }]) {
      assert.deepEqual((await ctxOf({ app: { platform, version: '1.0' } })).app, { version: '1.0' }, JSON.stringify(platform));
    }
  });

  test('when nothing valid survives, app is dropped; non-objects are dropped; extra keys never pass', async () => {
    for (const app of [{}, { platform: 'x', version: '' }, { other: 'ios' }, 'ios', 5, true, null, ['ios', '1.0'], []]) {
      const c = await ctxOf({ page: '/', app });
      assert.ok(!('app' in c), JSON.stringify(app));
    }
    const c = await ctxOf({ app: { platform: 'ios', version: '1.0', device: 'iPhone', user: 'me@example.com' } });
    assert.deepEqual(c.app, { platform: 'ios', version: '1.0' });
  });

  test('a web add has no app key', async () => {
    const c = await ctxOf({ page: '/', lang: 'en', browser: 'Chrome', os: 'Windows', screen: 'large' });
    assert.ok(!('app' in c));
  });

  test('the context stays out of the public API', async () => {
    const r = await box.add({ title: 'Entry that must not expose its app context', context: { app: { platform: 'ios', version: '9.9.9' } } }, nextIp());
    const pub = (await box.list()).json.entries.find((e) => e.id === r.json.entry.id);
    assert.ok(pub);
    assert.ok(!JSON.stringify(pub).includes('9.9.9'));
    assert.ok(!('context' in pub));
  });
});

describe('contact_url', () => {
  /** Run ab_clean_contact_url on a list of values in one PHP call. */
  function clean(values) {
    const script = 'define("ARGHBOX_BOOT", true); require $argv[1] . "/lib/config.php"; $in = json_decode($argv[2], true); echo json_encode(array_map("ab_clean_contact_url", $in));';
    const r = spawnSync(phpPath(), phpArgs(['-r', script, ARGHBOX_DIR, JSON.stringify(values)]), { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return JSON.parse(r.stdout);
  }

  test('accepts https, http and mailto links up to 300 characters', () => {
    const good = [
      'https://example.com/contact', 'http://example.com', 'HTTPS://Example.com/x?y=1#z', 'mailto:feedback@example.com',
      'mailto:team@example.com?subject=Hi', 'https://example.com/' + 'a'.repeat(300 - 'https://example.com/'.length),
    ];
    assert.deepEqual(clean(good), good);
  });

  test('anything else becomes the empty string', () => {
    const bad = [
      '', ' ', 'example.com', 'www.example.com', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'tel:+4812345', '//example.com',
      'https://', 'http:///path', 'mailto:', 'https://example.com/a b', ' https://example.com', 'https://example.com ', 'https://example.com/\n',
      'https://example.com/\t', 'https://exa\u00a0mple.com', 'https://example.com/\u200b', 'https://example.com/\u0000', 'https://example.com/\u202e',
      'https://example.com/' + 'a'.repeat(300), 5, null, true, ['https://example.com'], { a: 1 },
    ];
    assert.deepEqual(clean(bad), bad.map(() => ''));
  });

  test('list returns it, or an empty string', async () => {
    const withIt = await startArghBox({ config: { contact_url: 'mailto:hello@example.com' } });
    const without = await startArghBox();
    const junk = await startArghBox({ config: { contact_url: 'javascript:alert(1)' } });
    try {
      assert.equal((await withIt.list()).json.contact, 'mailto:hello@example.com');
      assert.equal((await without.list()).json.contact, '');
      assert.equal((await junk.list()).json.contact, '');
    } finally {
      await withIt.stop();
      await without.stop();
      await junk.stop();
    }
  });
});

describe('list fields', () => {
  test('list has contact and app_pass next to the existing keys', async () => {
    const box = await startArghBox({ config: { contact_url: 'https://example.com/help', app_pass: true } });
    try {
      const r = await box.list();
      assert.deepEqual(Object.keys(r.json).sort(), ['app_pass', 'contact', 'credit', 'entries', 'max_links', 'moderation', 'ok', 'site', 'tag_counts', 'turnstile_site_key', 'version', 'voted', 'welcome'].sort());
      assert.equal(r.json.contact, 'https://example.com/help');
      assert.equal(r.json.app_pass, true);
    } finally {
      await box.stop();
    }
  });
});

describe('config limits and keys', () => {
  test('report_hide_at is clamped to 0..100 and falls back to 3', async () => {
    const script = 'define("ARGHBOX_BOOT", true); foreach (["version","http","entries","config"] as $p) require $argv[1] . "/lib/" . $p . ".php"; $c = ab_config_load(); echo json_encode([$c["report_hide_at"], $c["limits"]["reports_per_hour"], $c["limits"]["block_days"], $c["app_pass"], $c["contact_url"]]);';
    const run = async (cfg) => {
      const box = await startArghBox({ config: cfg, turnstile: false });
      try {
        const r = spawnSync(phpPath(), phpArgs(['-r', script, ARGHBOX_DIR]), { encoding: 'utf8', env: { ...process.env, ARGHBOX_CONFIG: box.configPath }, windowsHide: true });
        assert.equal(r.status, 0, r.stderr + r.stdout);
        return JSON.parse(r.stdout);
      } finally {
        await box.stop();
      }
    };
    assert.deepEqual(await run({}), [3, 10, 90, false, '']);
    assert.deepEqual(await run({ report_hide_at: 0 }), [0, 10, 90, false, '']);
    assert.deepEqual(await run({ report_hide_at: 500, limits: { block_days: 0, reports_per_hour: 4 } }), [100, 4, 1, false, '']);
    assert.deepEqual(await run({ report_hide_at: -5 }), [0, 10, 90, false, '']);
    assert.deepEqual(await run({ report_hide_at: 'many' }), [3, 10, 90, false, '']);
  });
});
