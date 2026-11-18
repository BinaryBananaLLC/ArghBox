// The npm package: versions agree, the packed file list ships what a site needs and never a secret, and the
// `arghbox` command and the JavaScript API work from a real `npm install` of the packed tarball.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `arghbox-${name}-`))
const q = (s) => `"${s}"`
// npm is a .cmd on Windows, which Node only starts through a shell.
const npm = (args, cwd) => spawnSync(`npm ${args}`, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' } })

/** The files `npm pack` would ship from dir, as forward-slash paths. */
function packList(dir) {
  const r = npm('pack --dry-run --json --ignore-scripts', dir)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0].files.map((f) => f.path.replace(/\\/g, '/'))
}

/** A copy of everything the package's `files` can pick up, so tests can add junk without touching the repo. */
function stageCopy() {
  const dir = tmp('stage')
  for (const f of ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'index.mjs', 'index.d.ts', 'arghbox', 'skill', 'bin', 'tools/install.mjs', 'tools/new-secrets.mjs', 'tools/pack.mjs']) {
    fs.cpSync(path.join(REPO, f), path.join(dir, f), { recursive: true })
  }
  return dir
}

test('the version is the same in package.json, arghbox/VERSION, lib/version.php and the changelog', () => {
  const v = PKG.version
  assert.match(v, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  assert.equal(fs.readFileSync(path.join(REPO, 'arghbox', 'VERSION'), 'utf8').trim(), v)
  assert.match(fs.readFileSync(path.join(REPO, 'arghbox', 'lib', 'version.php'), 'utf8'), new RegExp(`ARGHBOX_VERSION = '${v.replace(/\./g, '\\.')}'`))
  assert.match(fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8'), new RegExp(`^## \\[${v.replace(/\./g, '\\.')}\\]`, 'm'))
})

test('the version in the widget files and in app.html is the package version', () => {
  const v = PKG.version
  const read = (f) => fs.readFileSync(path.join(REPO, 'arghbox', f), 'utf8')
  for (const f of ['arghbox.js', 'arghbox-app.js', 'arghbox-preview.js', 'app-page.js']) assert.ok(read(f).startsWith(`/*! ArghBox ${v} `), `${f} header`)
  assert.ok(read('app.html').includes(`<script src="app-page.js?v=${v}"></script>`), 'app.html loads app-page.js?v=<version>')
})

test('package.json is publishable: public (no provenance, so a local npm publish works), a bin and typed exports', () => {
  assert.equal(PKG.name, 'arghbox')
  assert.equal(PKG.private, undefined, 'a private package cannot be published')
  assert.deepEqual(PKG.publishConfig, { access: 'public' })
  assert.equal(PKG.bin.arghbox, 'bin/arghbox.mjs')
  assert.match(fs.readFileSync(path.join(REPO, PKG.bin.arghbox), 'utf8'), /^#!\/usr\/bin\/env node/)
  assert.equal(PKG.exports['.'].default, './index.mjs')
  assert.equal(PKG.exports['.'].types, './index.d.ts')
  assert.equal(Object.keys(PKG.dependencies || {}).length, 0, 'the package has no runtime dependencies')
})

test('the packed file list has the server folder, the skill and the CLI, and nothing private', () => {
  const dir = stageCopy()
  try {
    // Junk a working copy can have: the owner's config, databases, data, logs, backups, translate state.
    const junk = ['arghbox/config.php', 'arghbox/data/arghbox.sqlite', 'arghbox/data/arghbox.sqlite-wal', 'arghbox/data/notes.txt',
      'arghbox/error.log', 'arghbox/i18n/.translate-state.json', 'skill/arghbox-triage/RULES.md.bak']
    for (const f of junk) fs.writeFileSync(path.join(dir, f), 'secret')
    const files = packList(dir)
    for (const f of junk) assert.ok(!files.includes(f), `${f} must never be packed`)
    for (const f of ['bin/arghbox.mjs', 'index.mjs', 'index.d.ts', 'tools/install.mjs', 'tools/new-secrets.mjs', 'README.md', 'LICENSE', 'CHANGELOG.md',
      'arghbox/.htaccess', 'arghbox/lib/.htaccess', 'arghbox/data/.htaccess', 'arghbox/data/index.html', 'arghbox/VERSION', 'arghbox/arghbox.js',
      'arghbox/arghbox-app.js', 'arghbox/app.html', 'arghbox/app-page.js', 'arghbox/api.php', 'arghbox/mcp.php', 'arghbox/lib/config.php', 'arghbox/config.example.php', 'arghbox/i18n/en.json',
      'skill/arghbox-triage/SKILL.md', 'skill/arghbox-triage/triage.mjs']) {
      assert.ok(files.includes(f), `${f} must be packed`)
    }
    for (const f of files) assert.doesNotMatch(f, /^(tests|e2e|docs|art|demo|temp|dist|node_modules)\/|^tools\/(dev|seed|pack|capture|translate)/, `${f} is not for the package`)
    // Every file the installer copies from arghbox/ is in the package, so an npm install equals a checkout.
    const walk = (d, b = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), `${b}${e.name}/`) : [`${b}${e.name}`])
    for (const f of walk(path.join(REPO, 'arghbox'))) {
      if (f === 'config.php' || /\.sqlite/.test(f) || (f.startsWith('data/') && !['data/.htaccess', 'data/index.html'].includes(f))) continue
      assert.ok(files.includes(`arghbox/${f}`), `arghbox/${f} is missing from the package`)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('npm install of the packed tarball gives a working `arghbox` command and API', { timeout: 180_000 }, () => {
  const out = tmp('pack')
  const site = tmp('site')
  try {
    const p = npm(`pack --ignore-scripts --pack-destination ${q(out)}`, REPO)
    assert.equal(p.status, 0, p.stderr)
    const tgz = fs.readdirSync(out).find((f) => f.endsWith('.tgz'))
    assert.equal(tgz, `arghbox-${PKG.version}.tgz`)

    fs.writeFileSync(path.join(site, 'package.json'), JSON.stringify({ name: 'some-site', private: true, type: 'module' }))
    fs.mkdirSync(path.join(site, 'public'))
    const i = npm(`install --save-dev --offline --no-audit --no-fund ${q(path.join(out, tgz))}`, site)
    assert.equal(i.status, 0, i.stderr)

    const v = npm('exec --offline -- arghbox --version', site)
    assert.equal(v.status, 0, v.stderr)
    assert.equal(v.stdout.trim(), PKG.version)

    // First install into the site, then a second run that only checks (the way a prebuild script runs it).
    const first = npm('exec --offline -- arghbox install --public public --skill --quiet', site)
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, new RegExp(`ArghBox ${PKG.version.replace(/\./g, '\\.')}: \\d+ new, 0 updated`))
    for (const f of ['public/arghbox/arghbox.js', 'public/arghbox/.htaccess', 'public/arghbox/lib/.htaccess', 'public/arghbox/data/.htaccess', '.claude/skills/arghbox-triage/SKILL.md']) {
      assert.ok(fs.existsSync(path.join(site, f)), f)
    }
    fs.writeFileSync(path.join(site, 'public', 'arghbox', 'config.php'), '<?php return [];')
    const again = npm('exec --offline -- arghbox install --public public --skill --quiet', site)
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /: 0 new, 0 updated, \d+ unchanged/)
    assert.equal(again.stdout.trim().split(/\r?\n/).length, 1, 'quiet mode prints one line when there is nothing to note')
    assert.equal(fs.readFileSync(path.join(site, 'public', 'arghbox', 'config.php'), 'utf8'), '<?php return [];')

    const s = npm('exec --offline -- arghbox secrets --read', site)
    assert.equal(s.status, 0, s.stderr)
    assert.match(s.stdout, /'read_token_sha256' => '[0-9a-f]{64}'/)

    const bad = npm('exec --offline -- arghbox frobnicate', site)
    assert.equal(bad.status, 2)
    assert.match(bad.stderr, /Unknown command: frobnicate/)

    // The JavaScript API, imported by name from the installed package.
    fs.writeFileSync(path.join(site, 'api.mjs'), "import { version, serverDir, skillDir, install } from 'arghbox'\nimport fs from 'node:fs'\nconst r = install({ publicDir: 'public', dryRun: true })\nconsole.log(JSON.stringify({ version, server: fs.existsSync(serverDir + '/arghbox.js'), skill: fs.existsSync(skillDir + '/SKILL.md'), kinds: [...new Set(r.actions.map((a) => a.kind))].sort() }))\n")
    const api = spawnSync(process.execPath, ['api.mjs'], { cwd: site, encoding: 'utf8' })
    assert.equal(api.status, 0, api.stderr)
    assert.deepEqual(JSON.parse(api.stdout), { version: PKG.version, server: true, skill: true, kinds: ['same'] })
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(site, { recursive: true, force: true })
  }
})

test('arghbox help, version and unknown commands', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'arghbox.mjs'), ...a], { encoding: 'utf8' })
  const help = run()
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage: arghbox <command>/)
  assert.match(help.stdout, /install/)
  assert.match(help.stdout, /secrets/)
  assert.equal(run('version').stdout.trim(), PKG.version)
  const badInstall = run('install', '--bogus')
  assert.equal(badInstall.status, 2)
  assert.match(badInstall.stderr, /Usage: arghbox install \[--target <site repo>\] --public/)
  const missing = run('install', '--public')
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /--public needs a value/)
})

test('.htaccess: app-page.js and arghbox-preview.js are cached like the other scripts; app.html and the admin assets revalidate with no-transform', () => {
  const ht = fs.readFileSync(path.join(REPO, 'arghbox', '.htaccess'), 'utf8')
  assert.match(ht, /\^\(arghbox\|arghbox-app\|arghbox-preview\|app-page\)\\.js\$/)
  assert.match(ht, /<FilesMatch "\^\(app\\.html\|admin\\.\(css\|js\)\)\$">\s*Header set Cache-Control "no-cache, no-transform"/)
  assert.match(ht, /<FilesMatch "\^app\\\.html\$">\s*Header set X-Frame-Options "DENY"\s*Header set Content-Security-Policy "frame-ancestors 'none'"/)
})
