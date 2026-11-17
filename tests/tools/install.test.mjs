import test from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { install, isExcluded } from '../../tools/install.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-install-'))

test('isExcluded: never copies config, databases or data contents', () => {
  assert.equal(isExcluded('config.php'), true)
  assert.equal(isExcluded('data/arghbox.sqlite'), true)
  assert.equal(isExcluded('data/notes.txt'), true)
  assert.equal(isExcluded('data/.htaccess'), false)
  assert.equal(isExcluded('data/index.html'), false)
  assert.equal(isExcluded('lib/db.php'), false)
  assert.equal(isExcluded('i18n/.translate-state.json'), true)
})

test('dry run changes nothing', () => {
  const target = tmp()
  try {
    const r = install({ target, publicDir: 'public_html', skill: true, dryRun: true })
    assert.ok(r.actions.length > 20)
    assert.deepEqual(fs.readdirSync(target), [])
    assert.ok(r.gitignore.includes('public_html/arghbox/config.php'))
    assert.ok(r.gitignore.includes('.arghbox/'))
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('installs, keeps config.php and data, and updates changed code on a second run', () => {
  const target = tmp()
  try {
    fs.mkdirSync(path.join(target, 'public'))
    const r1 = install({ target, publicDir: 'public', skill: true })
    const dest = path.join(target, 'public', 'arghbox')
    for (const f of ['arghbox.js', 'arghbox-app.js', 'app.html', 'app-page.js', 'api.php', 'mcp.php', 'lib/db.php', 'i18n/en.json', 'data/.htaccess', 'VERSION']) {
      assert.ok(fs.existsSync(path.join(dest, f)), f)
    }
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'arghbox-triage', 'SKILL.md')))
    assert.ok(!fs.existsSync(path.join(dest, 'config.php')))
    assert.ok(r1.warnings.length === 1)

    fs.writeFileSync(path.join(dest, 'config.php'), '<?php return ["mine" => true];')
    fs.writeFileSync(path.join(dest, 'data', 'arghbox.sqlite'), 'precious')
    fs.writeFileSync(path.join(dest, 'data', 'index.html'), 'custom')
    fs.writeFileSync(path.join(dest, 'data', 'notes.txt'), 'mine')
    fs.writeFileSync(path.join(dest, 'arghbox.js'), 'old code')

    const r2 = install({ target, publicDir: 'public', skill: false })
    assert.equal(fs.readFileSync(path.join(dest, 'config.php'), 'utf8'), '<?php return ["mine" => true];')
    assert.equal(fs.readFileSync(path.join(dest, 'data', 'arghbox.sqlite'), 'utf8'), 'precious')
    assert.notEqual(fs.readFileSync(path.join(dest, 'data', 'index.html'), 'utf8'), 'custom', 'data/index.html is updated')
    assert.equal(fs.readFileSync(path.join(dest, 'data', 'notes.txt'), 'utf8'), 'mine')
    assert.notEqual(fs.readFileSync(path.join(dest, 'arghbox.js'), 'utf8'), 'old code')
    assert.ok(r2.actions.some((a) => a.kind === 'update' && a.file === 'public/arghbox/arghbox.js'))
    assert.equal(r2.warnings.length, 0)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('refuses a missing target and a public folder outside the target', () => {
  assert.throws(() => install({ target: path.join(os.tmpdir(), 'arghbox-nope-xyz'), publicDir: 'public' }), /not found/)
  const target = tmp()
  try {
    assert.throws(() => install({ target, publicDir: '..' }), /inside/)
    assert.throws(() => install({ target }), /--public/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('CLI: --dry-run prints the .gitignore lines and exits 0', () => {
  const target = tmp()
  try {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'install.mjs'), '--target', target, '--public', 'www', '--dry-run'], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /www\/arghbox\/data\/\*/)
    assert.match(r.stdout, /Dry run/)
    const bad = spawnSync(process.execPath, [path.join(REPO, 'tools', 'install.mjs'), '--bogus'], { encoding: 'utf8' })
    assert.equal(bad.status, 2)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('isExcluded and isProtected only treat the top-level config.php as the owner config (lib/config.php is code)', async () => {
  const { isProtected } = await import('../../tools/install.mjs')
  assert.equal(isExcluded('lib/config.php'), false)
  assert.equal(isProtected('lib/config.php'), false)
  assert.equal(isProtected('config.php'), true)
  assert.equal(isProtected('data/arghbox.sqlite'), true)
})

test('every file api.php requires is installed, and lib/config.php really ships', () => {
  const target = tmp()
  try {
    install({ target, publicDir: 'public' })
    const dest = path.join(target, 'public', 'arghbox')
    assert.ok(fs.existsSync(path.join(dest, 'lib', 'config.php')), 'lib/config.php missing after install')
    const api = fs.readFileSync(path.join(dest, 'api.php'), 'utf8')
    const parts = /foreach \(\[([^\]]+)\] as \$part\)/.exec(api)[1].match(/'([a-z]+)'/g).map((x) => x.slice(1, -1))
    for (const p of parts) assert.ok(fs.existsSync(path.join(dest, 'lib', `${p}.php`)), `lib/${p}.php missing`)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('--skill-only installs just the skill and needs no --public', () => {
  const target = tmp()
  try {
    const r = install({ target, skillOnly: true })
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'arghbox-triage', 'triage.mjs')))
    assert.ok(!fs.existsSync(path.join(target, 'arghbox')))
    assert.deepEqual(r.gitignore, ['.arghbox/'])
    const cli = spawnSync(process.execPath, [path.join(REPO, 'tools', 'install.mjs'), '--target', target, '--skill-only', '--dry-run'], { encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
    assert.match(cli.stdout, /\.arghbox\/token/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('upgrade: reports the version change, keeps config and data, and stays quiet about config when it lives in arghbox-private', () => {
  const root = tmp()
  try {
    const src = path.join(root, 'src')
    fs.cpSync(path.join(REPO, 'arghbox'), path.join(src, 'arghbox'), { recursive: true })
    fs.writeFileSync(path.join(src, 'arghbox', 'VERSION'), '9.9.9\n')
    const site = path.join(root, 'domains', 'x')
    fs.mkdirSync(path.join(site, 'public_html', 'arghbox'), { recursive: true })
    fs.mkdirSync(path.join(site, 'arghbox-private'), { recursive: true })
    fs.writeFileSync(path.join(site, 'public_html', 'arghbox', 'VERSION'), '0.0.1\n')
    fs.writeFileSync(path.join(site, 'arghbox-private', 'config.php'), '<?php return [];')
    const r = install({ target: site, publicDir: 'public_html', sourceRoot: src })
    assert.ok(r.warnings.some((w) => /0\.0\.1 to 9\.9\.9/.test(w) && /\?v=9\.9\.9/.test(w)))
    assert.ok(!r.warnings.some((w) => /config\.php/.test(w)))
    assert.equal(fs.readFileSync(path.join(site, 'arghbox-private', 'config.php'), 'utf8'), '<?php return [];')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

const canLink = (() => {
  const d = tmp()
  try { fs.symlinkSync(d, path.join(d, 'l'), 'dir'); return true } catch { return false } finally { fs.rmSync(d, { recursive: true, force: true }) }
})()

test('a changed skill file is saved as .bak before it is overwritten, and the CLI says so', () => {
  const target = tmp()
  try {
    install({ target, skillOnly: true })
    const rules = path.join(target, '.claude', 'skills', 'arghbox-triage', 'RULES.md')
    const original = fs.readFileSync(rules, 'utf8')
    fs.writeFileSync(rules, 'my own rules')
    const r = install({ target, skillOnly: true })
    assert.equal(fs.readFileSync(rules, 'utf8'), original)
    assert.equal(fs.readFileSync(rules + '.bak', 'utf8'), 'my own rules')
    assert.ok(r.actions.some((a) => a.kind === 'update' && /RULES\.md\.bak$/.test(a.backup)))
    fs.writeFileSync(rules, 'again')
    const cli = spawnSync(process.execPath, [path.join(REPO, 'tools', 'install.mjs'), '--target', target, '--skill-only'], { encoding: 'utf8' })
    assert.match(cli.stdout, /saved as RULES\.md\.bak/)
    // an unchanged file makes no backup, and a dry run writes none
    const before = fs.readdirSync(path.dirname(rules)).sort()
    install({ target, skillOnly: true })
    assert.deepEqual(fs.readdirSync(path.dirname(rules)).sort(), before)
    fs.writeFileSync(rules, 'dry')
    install({ target, skillOnly: true, dryRun: true })
    assert.equal(fs.readFileSync(rules, 'utf8'), 'dry')
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('data/.htaccess and data/index.html are updated on upgrade, other files in data/ never', () => {
  const target = tmp()
  try {
    install({ target, publicDir: 'public' })
    const data = path.join(target, 'public', 'arghbox', 'data')
    fs.writeFileSync(path.join(data, '.htaccess'), '# old')
    fs.writeFileSync(path.join(data, 'arghbox.sqlite'), 'precious')
    fs.writeFileSync(path.join(data, 'error.log'), 'log')
    install({ target, publicDir: 'public' })
    assert.notEqual(fs.readFileSync(path.join(data, '.htaccess'), 'utf8'), '# old')
    assert.equal(fs.readFileSync(path.join(data, 'arghbox.sqlite'), 'utf8'), 'precious')
    assert.equal(fs.readFileSync(path.join(data, 'error.log'), 'utf8'), 'log')
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('files that the new version no longer has are listed as a warning and never deleted', () => {
  const target = tmp()
  try {
    install({ target, publicDir: 'public' })
    const dest = path.join(target, 'public', 'arghbox')
    fs.writeFileSync(path.join(dest, 'lib', 'old-thing.php'), '<?php')
    fs.writeFileSync(path.join(dest, 'config.php'), '<?php return [];')
    fs.writeFileSync(path.join(dest, 'data', 'arghbox.sqlite'), 'x')
    const r = install({ target, publicDir: 'public' })
    const w = r.warnings.find((x) => /not part of this version/.test(x))
    assert.ok(w && w.includes('public/arghbox/lib/old-thing.php'), String(w))
    assert.ok(!/config\.php|sqlite/.test(w))
    assert.ok(fs.existsSync(path.join(dest, 'lib', 'old-thing.php')))
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('symbolic links in the source are followed, broken ones are reported', { skip: !canLink }, () => {
  const root = tmp()
  try {
    const src = path.join(root, 'src')
    fs.cpSync(path.join(REPO, 'arghbox'), path.join(src, 'arghbox'), { recursive: true })
    fs.cpSync(path.join(REPO, 'skill'), path.join(src, 'skill'), { recursive: true })
    const real = path.join(root, 'real-i18n')
    fs.renameSync(path.join(src, 'arghbox', 'i18n'), real)
    fs.symlinkSync(real, path.join(src, 'arghbox', 'i18n'), 'dir')
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(src, 'arghbox', 'broken.js'), 'file')
    const target = path.join(root, 'site')
    fs.mkdirSync(target)
    const r = install({ target, publicDir: 'public', sourceRoot: src })
    assert.ok(fs.existsSync(path.join(target, 'public', 'arghbox', 'i18n', 'en.json')), 'linked folder was copied')
    assert.ok(r.warnings.some((w) => /points nowhere/.test(w) && /broken\.js/.test(w)))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('symbolic links in the destination are never written through', { skip: !canLink }, () => {
  const root = tmp()
  try {
    const target = path.join(root, 'site')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(path.join(target, 'public', 'arghbox'), { recursive: true })
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(target, 'public', 'arghbox', 'lib'), 'dir')
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'untouched')
    fs.writeFileSync(path.join(outside, 'real.txt'), 'victim')
    fs.symlinkSync(path.join(outside, 'real.txt'), path.join(target, 'public', 'arghbox', 'VERSION'), 'file')
    const r = install({ target, publicDir: 'public' })
    assert.deepEqual(fs.readdirSync(outside).sort(), ['keep.txt', 'real.txt'], 'nothing written through the folder link')
    assert.equal(fs.readFileSync(path.join(outside, 'real.txt'), 'utf8'), 'victim', 'nothing written through the file link')
    assert.ok(r.actions.some((a) => a.kind === 'skip' && a.file === 'public/arghbox/lib/db.php'))
    assert.ok(r.warnings.some((w) => /symbolic link/.test(w)))
    assert.ok(fs.existsSync(path.join(target, 'public', 'arghbox', 'api.php')), 'the rest is still installed')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a --public folder that does not exist yet is created, with a note in case it was a typo', () => {
  const target = tmp()
  try {
    const dry = install({ target, publicDir: 'pubic', dryRun: true })
    assert.ok(dry.warnings.some((w) => /pubic\/ did not exist \(it would be created\)/.test(w)), dry.warnings.join('\n'))
    const r = install({ target, publicDir: 'pubic' })
    assert.ok(r.warnings.some((w) => /pubic\/ did not exist and was created/.test(w)))
    fs.mkdirSync(path.join(target, 'public'))
    const ok = install({ target, publicDir: 'public' })
    assert.ok(!ok.warnings.some((w) => /did not exist/.test(w)), 'no note when the folder is there')
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})
