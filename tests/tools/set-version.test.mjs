// set-version writes the release version into every file that carries it, so the Release workflow can take
// the tag as the only input. These tests run it on a small fake repository, never on this one.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareVersions, normalizeVersion, replaceVersion, setVersion, stampChangelog } from '../../tools/set-version.mjs'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'set-version.mjs')
const BS = '\\' // one backslash, to spell the regex form of a version without escaping noise

function fakeRepo(version = '0.1.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-setver-'))
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  put('package.json', JSON.stringify({ name: 'arghbox', version, devDependencies: { other: version } }, null, 2) + '\n')
  put('package-lock.json', JSON.stringify({
    name: 'arghbox', version, lockfileVersion: 3,
    packages: { '': { name: 'arghbox', version }, 'node_modules/other': { version } },
  }, null, 2) + '\n')
  put('arghbox/VERSION', `${version}\n`)
  put('arghbox/lib/version.php', `<?php\nconst ARGHBOX_VERSION = '${version}';\n`)
  put('arghbox/arghbox.js', `/*! ArghBox ${version} | MIT */\nvar VERSION = '${version}';\n`)
  put('e2e/widget.spec.mjs', `expect(u).toMatch(/arghbox-preview${BS}.js${BS}?v=${version.replace(/\./g, BS + '.')}$/)\n`)
  put('docs/install.md', `<script src="/arghbox/arghbox.js?v=${version}" defer></script>\nDownload arghbox-${version}.zip. Not v${version}, 1${version} or ${version}.7.\n`)
  put('CHANGELOG.md', `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A thing.\n\n## [${version}] - 2026-01-01\n\nThe first one, ${version}.\n`)
  put('node_modules/other/index.js', `// ${version}\n`)
  put('art/logo.png', `PNG ${version}`)
  return dir
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')

test('normalizeVersion takes x.y.z with an optional v and -suffix, nothing else', () => {
  assert.equal(normalizeVersion('v0.2.0'), '0.2.0')
  assert.equal(normalizeVersion(' 1.0.0-rc.1 '), '1.0.0-rc.1')
  for (const bad of ['', '1.2', 'v1', '1.2.3.4', 'latest', 'patch', '1.2.3-']) assert.throws(() => normalizeVersion(bad), /not a version/)
})

test('compareVersions follows semver, pre-releases before their release', () => {
  assert.ok(compareVersions('0.1.1', '0.1.0') > 0)
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0)
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0)
  assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0)
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
})

test('replaceVersion changes the version as text and as a regex, and leaves look-alikes alone', () => {
  assert.equal(replaceVersion("v = '0.1.0'; ?v=0.1.0 @0.1.0 arghbox-0.1.0.zip Version 0.1.0.", '0.1.0', '0.1.1'),
    "v = '0.1.1'; ?v=0.1.1 @0.1.1 arghbox-0.1.1.zip Version 0.1.1.")
  const rx = (v) => `/x${BS}?v=${v.replace(/\./g, BS + '.')}$/`
  assert.equal(replaceVersion(rx('0.1.0'), '0.1.0', '0.1.1'), rx('0.1.1'))
  const alike = 'v0.1.0 10.1.0 0.1.0.2 0.1.0-rc.1 x0.1.0'
  assert.equal(replaceVersion(alike, '0.1.0', '0.1.1'), alike)
})

test('stampChangelog turns Unreleased into a dated section and keeps a fresh Unreleased on top', () => {
  const withNotes = '# C\n\n## [Unreleased]\n\n### Added\n\n- A.\n\n## [0.1.0] - x\n'
  assert.equal(stampChangelog(withNotes, '0.1.1', '2026-11-18'), '# C\n\n## [Unreleased]\n\n## [0.1.1] - 2026-11-18\n\n### Added\n\n- A.\n\n## [0.1.0] - x\n')
  assert.equal(stampChangelog('# C\n\n## [Unreleased]\n\n## [0.1.0] - x\n', '0.1.1', '2026-11-18'), '# C\n\n## [Unreleased]\n\n## [0.1.1] - 2026-11-18\n\nNo notable changes.\n\n## [0.1.0] - x\n')
  assert.equal(stampChangelog('# C\n\n## [0.1.0] - x\n', '0.1.1', '2026-11-18'), '# C\n\n## [Unreleased]\n\n## [0.1.1] - 2026-11-18\n\nNo notable changes.\n\n## [0.1.0] - x\n')
  const done = stampChangelog(withNotes, '0.1.1', '2026-11-18')
  assert.equal(stampChangelog(done, '0.1.1', '2026-12-01'), done, 'a second run for the same version changes nothing')
})

test('setVersion updates every file that carries the version and nothing else', () => {
  const dir = fakeRepo('0.1.0')
  const r = setVersion({ root: dir, version: 'v0.1.1', date: '2026-11-18' })
  assert.equal(r.from, '0.1.0')
  assert.equal(r.to, '0.1.1')
  assert.deepEqual([...r.changed].sort(), ['CHANGELOG.md', 'arghbox/VERSION', 'arghbox/arghbox.js', 'arghbox/lib/version.php',
    'docs/install.md', 'e2e/widget.spec.mjs', 'package-lock.json', 'package.json'])

  const pkg = JSON.parse(read(dir, 'package.json'))
  assert.equal(pkg.version, '0.1.1')
  assert.equal(pkg.devDependencies.other, '0.1.0', 'dependencies keep their own versions')
  assert.equal(read(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', "npm's formatting is kept")
  const lock = JSON.parse(read(dir, 'package-lock.json'))
  assert.equal(lock.version, '0.1.1')
  assert.equal(lock.packages[''].version, '0.1.1')
  assert.equal(lock.packages['node_modules/other'].version, '0.1.0')

  assert.equal(read(dir, 'arghbox/VERSION'), '0.1.1\n')
  assert.match(read(dir, 'arghbox/lib/version.php'), /ARGHBOX_VERSION = '0\.1\.1'/)
  assert.equal(read(dir, 'arghbox/arghbox.js'), "/*! ArghBox 0.1.1 | MIT */\nvar VERSION = '0.1.1';\n")
  assert.ok(read(dir, 'e2e/widget.spec.mjs').includes(`v=0${BS}.1${BS}.1$`), 'the regex form is updated')
  assert.equal(read(dir, 'docs/install.md'), '<script src="/arghbox/arghbox.js?v=0.1.1" defer></script>\nDownload arghbox-0.1.1.zip. Not v0.1.0, 10.1.0 or 0.1.0.7.\n')
  const log = read(dir, 'CHANGELOG.md')
  assert.match(log, /^## \[Unreleased\]\n\n## \[0\.1\.1\] - 2026-11-18\n\n### Added\n\n- A thing\.\n/m)
  assert.match(log, /^## \[0\.1\.0\] - 2026-01-01\n\nThe first one, 0\.1\.0\.$/m, 'history never changes')
  assert.equal(read(dir, 'node_modules/other/index.js'), '// 0.1.0\n')
  assert.equal(read(dir, 'art/logo.png'), 'PNG 0.1.0')

  const again = setVersion({ root: dir, version: '0.1.1', date: '2026-12-01' })
  assert.deepEqual(again.changed, [], 'running it again for the same version changes nothing')
})

test('--if-newer skips a version that is not newer than the files', () => {
  const dir = fakeRepo('0.2.0')
  for (const v of ['0.1.9', '0.2.0', '0.2.0-rc.1']) {
    const r = setVersion({ root: dir, version: v, ifNewer: true })
    assert.match(r.skipped, /already say 0\.2\.0/)
    assert.deepEqual(r.changed, [])
  }
  assert.equal(read(dir, 'arghbox/VERSION'), '0.2.0\n')
  assert.ok(setVersion({ root: dir, version: '0.2.1', ifNewer: true, date: '2026-11-18' }).changed.includes('arghbox/VERSION'))
})

test('the command refuses a missing or malformed version without touching anything', () => {
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.equal(none.status, 2)
  assert.match(none.stdout, /Usage/)
  const bad = spawnSync(process.execPath, [SCRIPT, 'patch'], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /not a version/)
  const date = spawnSync(process.execPath, [SCRIPT, '9.9.9', '--date', 'tomorrow'], { encoding: 'utf8' })
  assert.equal(date.status, 2)
  assert.match(date.stderr, /YYYY-MM-DD/)
})
