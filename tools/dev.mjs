#!/usr/bin/env node
// Local development server: demo/ + arghbox/ on php -S, a fake Turnstile verify endpoint,
// and a dev config in .dev/ (git-ignored). --site <dir> serves another folder instead of demo/.
//
//   node tools/dev.mjs [--port 8787] [--seed] [--fresh] [--origin URL]... [--data DIR]
//                      [--site DIR] [--dev-dir DIR]
//                      [--real-turnstile] [--moderation pending|publish]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeTurnstile } from '../tests/helpers/fake-turnstile.mjs';
import { startPhpServer } from '../tests/helpers/php.mjs';
import { writeConfig } from '../tests/helpers/server.mjs';
import { seed } from './seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

function parseArgs(argv) {
  const o = { port: 8787, seed: false, fresh: false, origins: [], data: null, site: null, devDir: null, help: false, real: false, moderation: 'pending' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') o.seed = true;
    else if (a === '--fresh') o.fresh = true;
    else if (a === '--real-turnstile') o.real = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--origin') o.origins.push(argv[++i]);
    else if (a === '--dev-dir') o.devDir = path.resolve(argv[++i] || '');
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--site') o.site = path.resolve(argv[++i] || '');
    else if (a === '--data') o.data = path.resolve(argv[++i]);
    else if (a === '--moderation') o.moderation = argv[++i] === 'publish' ? 'publish' : 'pending';
    else {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

function readOrCreate(file, make) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (v) return v;
  } catch { /* create below */ }
  const v = make();
  fs.writeFileSync(file, v + '\n');
  return v;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(`Usage: node tools/dev.mjs [options]

  --port N              Port (default 8787)
  --seed                Load tests/fixtures/demo-seed.json when the box is empty
  --fresh               Wipe the data of this dev folder first
  --origin URL          Allow one more origin to call the API (repeatable; http://localhost and
                        http://127.0.0.1 on any port are always allowed)
  --data DIR            Data folder (default <dev-dir>/data)
  --site DIR            Serve this folder instead of demo/ (a site that installs ArghBox)
  --dev-dir DIR         Where everything generated goes: config.php, tokens, site.json, data
                        (default .dev in the repository; a relative path starts at the current folder).
                        Give every parallel dev server its own.
  --moderation MODE     pending (default) or publish
  --real-turnstile      Use Cloudflare's siteverify with the test secret instead of the fake verify server
  -h, --help            This text`);
  process.exit(0);
}
const DEV = opts.devDir || path.join(REPO, '.dev');

fs.mkdirSync(DEV, { recursive: true });
fs.mkdirSync(path.join(DEV, 'www'), { recursive: true });
fs.mkdirSync(path.join(DEV, 'arghbox'), { recursive: true });
if (opts.site && !fs.existsSync(opts.site)) {
  console.error(`--site folder not found: ${opts.site}`);
  process.exit(2);
}
const dataDir = opts.data || path.join(DEV, 'data');
if (opts.fresh) fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const secret = readOrCreate(path.join(DEV, 'secret'), () => crypto.randomBytes(32).toString('hex'));
const ownerToken = readOrCreate(path.join(DEV, 'owner-token'), () => crypto.randomBytes(32).toString('base64url'));
const triageToken = readOrCreate(path.join(DEV, 'triage-token'), () => crypto.randomBytes(32).toString('base64url'));

const fake = opts.real ? null : await startFakeTurnstile();
const configPath = path.join(DEV, 'config.php');
writeConfig(configPath, {
  site_name: 'ArghBox dev',
  site_url: `http://localhost:${opts.port}`,
  about: 'Local development install of ArghBox, the feedback box for small websites.',
  turnstile_site_key: '1x00000000000000000000AA',
  turnstile_secret_key: '1x0000000000000000000000000000000AA',
  turnstile_verify_url: fake ? fake.url : 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  secret,
  owner_token_sha256: sha(ownerToken),
  triage_token_sha256: sha(triageToken),
  trusted_ip_header: '',
  // any port on this machine: a site's own dev server (Vite, VitePress, Next, ...) can use the box whatever port it got
  allowed_origins: ['http://localhost:*', 'http://127.0.0.1:*', ...opts.origins],
  data_dir: dataDir,
  moderation: opts.moderation,
  credit: true,
  tags: ['design', 'mobile', 'export', 'integrations'],
});

if (opts.seed) {
  const r = seed({ config: configPath, file: path.join(REPO, 'tests', 'fixtures', 'demo-seed.json'), ifEmpty: true });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    if (fake) await fake.stop();
    process.exit(1);
  }
  console.log(`Seed: ${r.stdout.trim()}`);
}

// Written before php starts: the moment the server answers, everything a tool may look for is already on disk.
const site = `http://localhost:${opts.port}`;
fs.writeFileSync(path.join(DEV, 'arghbox', 'site.json'), JSON.stringify({ url: `${site}/arghbox/` }) + '\n');
fs.writeFileSync(path.join(DEV, 'arghbox', 'token'), triageToken + '\n');

let php;
try {
  php = await startPhpServer({
    docroot: path.join(DEV, 'www'),
    router: path.join(HERE, 'dev-router.php'),
    env: { ARGHBOX_CONFIG: configPath, ARGHBOX_DATA_DIR: '', ARGHBOX_SITE_DIR: opts.site || '' },
    port: opts.port,
  });
} catch (e) {
  console.error(`Could not start php -S on port ${opts.port}: ${e.message}`);
  if (fake) await fake.stop();
  process.exit(1);
}

console.log(`
ArghBox dev server
  Site:        ${site}/   (${opts.site ? opts.site : 'demo/'})
  Admin page:  ${site}/arghbox/admin/
  API health:  ${site}/arghbox/api.php?action=health
  Owner token: ${ownerToken}   (also in ${path.join(DEV, 'owner-token')})
  Triage:      node skill/arghbox-triage/triage.mjs fetch --dir ${path.join(DEV, 'arghbox')}
  Turnstile:   ${fake ? 'fake verify server (any token passes, "fail..." fails)' : 'Cloudflare siteverify with the always-pass test secret'}
  Dev folder:  ${DEV}
  Data:        ${dataDir}
Press Ctrl+C to stop.`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await php.stop();
  if (fake) await fake.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
php.child.on('exit', () => { if (!stopping) { console.error('php -S exited.'); shutdown(); } });
