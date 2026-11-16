// Starts a throwaway ArghBox: temp config + temp data dir + fake Turnstile + `php -S`.
//
//   const box = await startArghBox({ config: { moderation: 'publish' } });
//   box.url                  'http://127.0.0.1:PORT/'   (the arghbox/ folder; api.php lives there)
//   box.ownerToken / box.triageToken   throwaway bearer tokens
//   box.call(action, opts)   -> { status, headers, json, text }
//        opts: { method, body, query, headers, ip, token, cookie, raw }
//   box.session(ip?)         -> pass string (calls action=session with a good token)
//   box.add(fields, ip?)     -> add with sensible defaults (pass, voter, elapsed_ms) -> response
//   box.vote(id, on, voter, ip?) ; box.list(voter?) ; box.admin(action, opts) (owner bearer)
//   box.stop()
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeTurnstile } from './fake-turnstile.mjs';
import { startPhpServer } from './php.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const ARGHBOX_DIR = path.join(REPO, 'arghbox');

export function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
export function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
export function newVoter() {
  return b64url(crypto.randomBytes(18));
}

/** Write a PHP config file that returns the given object. */
export function writeConfig(file, cfg) {
  fs.writeFileSync(file, `<?php\nreturn json_decode(<<<'JSON'\n${JSON.stringify(cfg)}\nJSON\n, true);\n`);
}

export async function startArghBox({ config = {}, noConfig = false, env = {}, turnstile = true, workers = 1 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-test-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(tmp, 'config.php');
  const secret = crypto.randomBytes(32).toString('hex');
  const ownerToken = b64url(crypto.randomBytes(32));
  const triageToken = b64url(crypto.randomBytes(32));
  const readToken = b64url(crypto.randomBytes(32));
  const fake = turnstile ? await startFakeTurnstile() : null;
  const cfg = {
    site_name: 'Test Box',
    site_url: 'http://localhost',
    about: 'A test site.',
    turnstile_site_key: 'site-key',
    turnstile_secret_key: 'test-secret',
    turnstile_verify_url: fake ? fake.url : 'http://127.0.0.1:9/siteverify',
    secret,
    owner_token_sha256: sha256hex(ownerToken),
    triage_token_sha256: sha256hex(triageToken),
    read_token_sha256: sha256hex(readToken),
    trusted_ip_header: 'HTTP_X_TEST_IP',
    allowed_origins: ['http://localhost:5173'],
    data_dir: dataDir,
    moderation: 'pending',
    ...config,
  };
  if (!noConfig) writeConfig(configPath, cfg);
  let php;
  try {
    php = await startPhpServer({
      docroot: ARGHBOX_DIR,
      env: { ARGHBOX_CONFIG: configPath, ARGHBOX_DATA_DIR: '', ...env },
    });
  } catch (e) {
    if (fake) await fake.stop();
    throw e;
  }
  const url = `${php.origin}/`;
  // More php -S processes on the same config and data dir simulate several PHP workers (they run in parallel).
  const extra = [];
  try {
    for (let i = 1; i < workers; i++) {
      extra.push(await startPhpServer({ docroot: ARGHBOX_DIR, env: { ARGHBOX_CONFIG: configPath, ARGHBOX_DATA_DIR: '', ...env } }));
    }
  } catch (e) {
    await Promise.all([php, ...extra].map((p) => p.stop()));
    if (fake) await fake.stop();
    throw e;
  }
  const urls = [url, ...extra.map((p) => `${p.origin}/`)];
  let rr = 0;
  const nextUrl = () => urls[rr++ % urls.length];

  async function call(action, opts = {}) {
    const { method = opts.body !== undefined ? 'POST' : 'GET', body, query = {}, headers = {}, ip, token, cookie, raw } = opts;
    const qs = new URLSearchParams({ action, ...query });
    const h = { ...headers };
    if (ip) h['X-Test-Ip'] = ip;
    if (token) h.Authorization = `Bearer ${token}`;
    if (cookie) h.Cookie = cookie;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const res = await fetch(`${nextUrl()}api.php?${qs}`, { method, headers: h, body: payload, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, json, text };
  }

  async function session(ip) {
    const r = await call('session', { body: { turnstile: 'good-token' }, ip });
    if (!r.json?.ok) throw new Error('session failed: ' + r.text);
    return r.json.pass;
  }

  /** Add an entry with valid defaults. `fields.pass` overrides the automatic pass. */
  async function add(fields = {}, ip) {
    const pass = fields.pass ?? (await session(ip));
    const body = {
      pass,
      voter: newVoter(),
      type: 'idea',
      title: 'A perfectly fine idea',
      body: '',
      context: { page: '/', lang: 'en', browser: 'Chrome', os: 'Windows', screen: 'large' },
      hp: '',
      elapsed_ms: 9000,
      ...fields,
    };
    const r = await call('add', { body, ip });
    r.voter = body.voter;
    return r;
  }

  async function vote(id, on = true, voter = newVoter(), ip, pass) {
    pass = pass ?? (await session(ip));
    return call('vote', { body: { pass, voter, id, on }, ip });
  }

  const list = (voter, ip) => call('list', { headers: voter ? { 'X-ArghBox-Voter': voter } : {}, ip });
  const admin = (action, opts = {}) => call(action, { token: ownerToken, ...opts });
  const triage = (action, opts = {}) => call(action, { token: triageToken, ...opts });
  const read = (action, opts = {}) => call(action, { token: readToken, ...opts });

  /** POST a raw JSON-RPC body to mcp.php (triage token by default; token:null sends none). */
  async function mcp(body, { token = triageToken, headers = {}, method = 'POST', raw } = {}) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const res = await fetch(`${url}mcp.php`, { method, headers: h, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* empty or not JSON */ }
    return { status: res.status, headers: res.headers, json, text };
  }

  return {
    url, urls, dataDir, configPath, secret, ownerToken, triageToken, readToken, config: cfg, fake, tmp,
    call, session, add, vote, list, admin, triage, read, mcp,
    async stop() {
      await Promise.all([php, ...extra].map((p) => p.stop()));
      if (fake) await fake.stop();
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* sqlite file may linger on Windows */ }
    },
  };
}

/** Publish pending entries by id through the owner API (convenience for tests). */
export async function publishAll(box, ids) {
  for (const id of ids) {
    const r = await box.admin('admin.update', { body: { id, state: 'published' } });
    if (!r.json?.ok) throw new Error('publish failed: ' + r.text);
  }
}

let ipCounter = 0;
/** A fresh fake client IP (send it with `ip`; the test config trusts the X-Test-Ip header). */
export function nextIp() {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${(ipCounter % 254) + 1}`;
}
