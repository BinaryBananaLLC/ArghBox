/**
 * Playwright fixture that runs the REAL ArghBox backend (php -S + the real arghbox/ folder), laid out like a
 * production site: `/arghbox/api.php`, `/arghbox/admin/`, `/arghbox/arghbox.js`. It reuses
 * tests/helpers/server.mjs (throwaway config, data dir, fake Turnstile, owner/triage tokens) and tools/seed.mjs,
 * and serves the pages through tools/dev-router.php (maps /arghbox/* to the arghbox/ folder, demo/ elsewhere, or the folder in ARGHBOX_SITE_DIR).
 *
 *   import { test, expect, startRealStack, signIn, demoSeed } from './support/real-stack.mjs'
 *
 *   test('x', async ({ page, stack }) => {            // `stack` is a fresh stack per test, stopped afterwards
 *     await signIn(page, stack)                       // opens the admin page and signs in with the owner token
 *     stack.adminUrl                                  // 'http://127.0.0.1:PORT/arghbox/admin/'
 *   })
 *
 * Stack API (what startRealStack() resolves to):
 *   origin, siteUrl        'http://127.0.0.1:PORT' (the site root; demo/ by default)
 *   arghboxUrl             origin + '/arghbox/'    (use it as the data-api base: arghboxUrl + 'api.php')
 *   apiUrl, adminUrl       arghboxUrl + 'api.php', arghboxUrl + 'admin/'
 *   ownerToken, triageToken  throwaway bearer tokens
 *   configPath, dataDir, config   the generated config file, data dir and its contents
 *   seed(items | filePath) load entries into the database (tools/seed.mjs format, see SPEC section 11);
 *                          `items` may be an array or a path; pass demoSeed to load tests/fixtures/demo-seed.json
 *   call(action, opts)     { status, headers, json, text } against the real API (bearer `token`, `body`, `query`,
 *                          `headers`, `ip`, `cookie`); the same helper as tests/helpers/server.mjs
 *   admin(action, opts)    call() with the owner token;  triage(action, opts)  call() with the triage token
 *   apply(decisions, run)  triage-token admin.apply with {run:{reviewer,digest}, decisions}; returns the JSON body
 *   queue()                admin.queue JSON (convenience for looking up ids and fingerprints)
 *   entries(query)         admin.entries JSON entries array
 *   list(voter?)           the PUBLIC list action JSON (what the widget sees)
 *   add(fields, ip?), session(), vote(...)   visitor helpers from tests/helpers/server.mjs
 *   box                    the underlying startArghBox() object (its php server serves arghbox/ at its own root)
 *   stop()                 stops both php servers and the fake Turnstile server (the fixture calls it for you)
 *
 * Fixtures exported through `test`: `stack` (per test, optionally pre-seeded via `test.use({ stackOptions: {...} })`).
 * startRealStack({ config, seed }) options: `config` overrides config.php keys, `seed` is an array / path / demoSeed.
 *
 * Note for specs: Chromium logs every HTTP >= 400 response as a console error ("Failed to load resource"), and the
 * admin page legitimately gets a 401 from admin.me before sign-in. Use `watchCsp(page)` to collect only real
 * problems (CSP violations, console errors that are not network-status noise, uncaught page errors).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { startPhpServer } from '../../tests/helpers/php.mjs';
import { REPO, startArghBox } from '../../tests/helpers/server.mjs';
import { seed as seedDb } from '../../tools/seed.mjs';

export { expect };
export const demoSeed = path.join(REPO, 'tests', 'fixtures', 'demo-seed.json');

export async function startRealStack({ config = {}, seed = null } = {}) {
  const box = await startArghBox({ config });
  let php = null;
  let www = null;
  try {
    www = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-site-'));
    php = await startPhpServer({
      docroot: www,
      router: path.join(REPO, 'tools', 'dev-router.php'),
      env: { ARGHBOX_CONFIG: box.configPath, ARGHBOX_DATA_DIR: '' },
    });
  } catch (e) {
    await box.stop();
    throw e;
  }
  const origin = php.origin;
  const arghboxUrl = `${origin}/arghbox/`;
  const tmpFiles = [];

  function seedItems(items) {
    let file = items;
    if (Array.isArray(items)) {
      file = path.join(box.tmp, `seed-${tmpFiles.length}.json`);
      fs.writeFileSync(file, JSON.stringify(items));
      tmpFiles.push(file);
    }
    const r = seedDb({ config: box.configPath, file });
    if (r.status !== 0) throw new Error('seeding failed: ' + (r.stderr || r.stdout));
    return JSON.parse(r.stdout.trim().split('\n').pop());
  }
  if (seed) seedItems(seed);

  const stack = {
    origin,
    siteUrl: origin,
    arghboxUrl,
    apiUrl: arghboxUrl + 'api.php',
    adminUrl: arghboxUrl + 'admin/',
    ownerToken: box.ownerToken,
    triageToken: box.triageToken,
    configPath: box.configPath,
    dataDir: box.dataDir,
    config: box.config,
    box,
    seed: seedItems,
    call: box.call,
    admin: box.admin,
    triage: box.triage,
    add: box.add,
    session: box.session,
    vote: box.vote,
    list: async (voter) => (await box.list(voter)).json,
    async apply(decisions, run = {}) {
      const r = await box.triage('admin.apply', { body: { run: { reviewer: 'Test Reviewer', digest: 'Digest line one.\nDigest line two.', ...run }, decisions } });
      if (!r.json?.ok) throw new Error('apply failed: ' + r.text);
      return r.json;
    },
    async queue() {
      const r = await box.admin('admin.queue');
      if (!r.json?.ok) throw new Error('queue failed: ' + r.text);
      return r.json;
    },
    async entries(query = {}) {
      const r = await box.admin('admin.entries', { query: { limit: 200, ...query } });
      if (!r.json?.ok) throw new Error('entries failed: ' + r.text);
      return r.json.entries;
    },
    async stop() {
      await php.stop();
      await box.stop();
      try { fs.rmSync(www, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
  return stack;
}

/** Open the admin page and sign in with the owner token. Resolves when the dashboard tabs are visible. */
export async function signIn(page, stack, token = stack.ownerToken) {
  await page.goto(stack.adminUrl);
  await page.getByLabel('Owner token').fill(token);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('tab', { name: /Dashboard/ })).toBeVisible();
}

/**
 * Collects problems on a page: { csp: [...], errors: [...], pageErrors: [...] }.
 * `errors` leaves out Chromium's "Failed to load resource" lines (they only report HTTP statuses).
 */
export function watchCsp(page) {
  const found = { csp: [], errors: [], pageErrors: [] };
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (/Content Security Policy|Refused to/i.test(text)) found.csp.push(text);
    else if (msg.type() === 'error' && !/Failed to load resource/i.test(text)) found.errors.push(text);
  });
  page.on('pageerror', (e) => found.pageErrors.push(String(e)));
  page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  found.collect = async () => {
    try {
      const inPage = await page.evaluate(() => window.__csp || []);
      return [...found.csp, ...inPage];
    } catch {
      return found.csp;
    }
  };
  return found;
}

export const test = base.extend({
  stackOptions: [{}, { option: true }],
  stack: async ({ stackOptions }, use) => {
    const stack = await startRealStack(stackOptions);
    try {
      await use(stack);
    } finally {
      await stack.stop();
    }
  },
});
