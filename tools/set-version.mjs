#!/usr/bin/env node
// Writes one version into every file that carries it, so the release tag is the only thing anyone types.
// The Release workflow runs it before it builds and publishes, then commits the result back to the branch.
//
//   node tools/set-version.mjs <x.y.z | vx.y.z> [--if-newer] [--date YYYY-MM-DD] [--quiet]
//
// What changes:
//   - package.json and package-lock.json: the package's own "version" (dependencies are never touched)
//   - every other text file git would commit that names the current version (package.json's): arghbox/VERSION,
//     lib/version.php, the widget headers and VERSION constants, app.html, en.json, the demo page, the README
//     and docs script tags, the spec and the tests, including the regex form 1\.2\.3. A version glued to a
//     letter or digit (v1.2.3, 11.2.3) or followed by more version parts (1.2.3.4, 1.2.3-rc.1) is left alone;
//     one followed by a file extension (arghbox-1.2.3.zip) is replaced. This script and its test never change.
//   - CHANGELOG.md: "## [Unreleased]" becomes "## [x.y.z] - <date>" under a new, empty "## [Unreleased]".
//     Older sections are history and never change. Running it again for the same version changes nothing.
// --if-newer: do nothing when the files already carry this version or a newer one.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|zip|tgz|gz|woff2?|ttf|otf|eot|pdf|sqlite\d?|db|mp4|webm)$/i
const SKIP_DIRS = new Set(['node_modules', '.git', '.dev', 'dist', 'temp', 'test-results', 'test-results-qa-visitor', 'playwright-report'])
const SPECIAL = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md'])
const SELF = new Set(['tools/set-version.mjs', 'tests/tools/set-version.test.mjs'])

/** "v1.2.3" or "1.2.3" to "1.2.3"; throws on anything that is not x.y.z with an optional -suffix. */
export function normalizeVersion(input) {
  const v = String(input || '').trim().replace(/^v/, '')
  if (!VERSION_RE.test(v)) throw new Error(`"${input}" is not a version like 1.2.3 or 1.2.3-rc.1`)
  return v
}

/** Semver order: negative when a < b. A pre-release sorts before its release (1.0.0-rc.1 < 1.0.0). */
export function compareVersions(a, b) {
  const [ma, pa = ''] = a.split(/-(.*)/s)
  const [mb, pb = ''] = b.split(/-(.*)/s)
  const na = ma.split('.').map(Number)
  const nb = mb.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] - nb[i]
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  const xa = pa.split('.')
  const xb = pb.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const da = /^\d+$/.test(xa[i])
    const db = /^\d+$/.test(xb[i])
    if (da && db && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) - Number(xb[i])
    if (da !== db) return da ? -1 : 1
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1
  }
  return 0
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

/** Replaces the old version in text, as plain text and in its regex-escaped form. */
export function replaceVersion(text, from, to) {
  const plain = new RegExp(`(?<![\\w.])${esc(from)}(?![\\w]|\\.\\d|-[0-9A-Za-z])`, 'g')
  const fromEscaped = from.replace(/\./g, '\\.')
  const escaped = new RegExp(`(?<![\\w.\\\\])${esc(fromEscaped)}(?![\\w]|\\\\\\.[0-9])`, 'g')
  return text.replace(plain, to).replace(escaped, to.replace(/\./g, '\\.'))
}

/** CHANGELOG.md with this version's dated section; unchanged when the section already exists. */
export function stampChangelog(text, version, date) {
  if (new RegExp(`^## \\[${esc(version)}\\]`, 'm').test(text)) return text
  const heading = `## [${version}] - ${date}`
  const unreleased = /^## \[Unreleased\][^\n]*\n/m.exec(text)
  if (unreleased) {
    const after = text.slice(unreleased.index + unreleased[0].length)
    const next = after.search(/^## \[/m)
    const body = next === -1 ? after : after.slice(0, next)
    const filler = body.trim() ? '' : '\nNo notable changes.\n\n'
    return text.slice(0, unreleased.index) + `## [Unreleased]\n\n${heading}\n` + filler + after.replace(/^\n*/, filler ? '' : '\n')
  }
  const first = text.search(/^## \[/m)
  const block = `## [Unreleased]\n\n${heading}\n\nNo notable changes.\n\n`
  if (first === -1) return text.replace(/\n*$/, '\n\n') + block.trimEnd() + '\n'
  return text.slice(0, first) + block + text.slice(first)
}

/** The repository's text files: what git would commit, or every file outside build and dependency folders. */
function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
    const files = out.split('\0').filter(Boolean)
    if (files.length) return files
  } catch { /* not a git checkout: walk the folder */ }
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel) } else if (e.isFile()) files.push(rel)
    }
  }
  walk('')
  return files
}

/** Sets the package's own version in package.json or package-lock.json text, keeping npm's formatting. */
function stampPackageJson(text, version, lock) {
  const json = JSON.parse(text)
  json.version = version
  if (lock && json.packages && json.packages['']) json.packages[''].version = version
  return JSON.stringify(json, null, 2) + '\n'
}

/**
 * Writes `version` everywhere. Returns { from, to, changed: [relative paths], skipped: reason | null }.
 * `date` is the CHANGELOG date (default: today in UTC).
 */
export function setVersion({ root = REPO, version, date = new Date().toISOString().slice(0, 10), ifNewer = false } = {}) {
  const to = normalizeVersion(version)
  const pkgPath = path.join(root, 'package.json')
  const from = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
  if (ifNewer && compareVersions(to, from) <= 0) {
    return { from, to, changed: [], skipped: `the files already say ${from}` }
  }
  const changed = []
  const write = (rel, before, after) => {
    if (after === before) return
    fs.writeFileSync(path.join(root, rel), after)
    changed.push(rel)
  }
  for (const rel of listFiles(root)) {
    const full = path.join(root, rel)
    if (BINARY.test(rel) || !fs.existsSync(full) || fs.statSync(full).size > 4 * 1024 * 1024) continue
    const base = rel.split('/').pop()
    if ((SPECIAL.has(base) && rel === base) || SELF.has(rel)) continue // handled below, or this script itself
    if (from === to) continue
    const text = fs.readFileSync(full, 'utf8')
    if (text.includes('\0')) continue
    write(rel, text, replaceVersion(text, from, to))
  }
  for (const [rel, lock] of [['package.json', false], ['package-lock.json', true]]) {
    if (!fs.existsSync(path.join(root, rel))) continue
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    write(rel, text, stampPackageJson(text, to, lock))
  }
  if (fs.existsSync(path.join(root, 'CHANGELOG.md'))) {
    const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    write('CHANGELOG.md', text, stampChangelog(text, to, date))
  }
  return { from, to, changed, skipped: null }
}

function main(argv) {
  const args = argv.slice(2)
  const opt = { ifNewer: args.includes('--if-newer'), quiet: args.includes('--quiet') }
  const di = args.indexOf('--date')
  if (di !== -1) opt.date = args[di + 1]
  const version = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--date')
  if (!version || args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node tools/set-version.mjs <x.y.z | vx.y.z> [--if-newer] [--date YYYY-MM-DD] [--quiet]')
    return version ? 0 : 2
  }
  if (opt.date && !/^\d{4}-\d{2}-\d{2}$/.test(opt.date)) { console.error(`--date must be YYYY-MM-DD, got ${opt.date}`); return 2 }
  let r
  try {
    r = setVersion({ version, date: opt.date, ifNewer: opt.ifNewer })
  } catch (e) {
    console.error(e.message)
    return 2
  }
  if (r.skipped) console.log(`Version ${r.to}: nothing to do, ${r.skipped}.`)
  else if (!r.changed.length) console.log(`Version ${r.to}: every file already says it.`)
  else {
    console.log(`Version ${r.from} -> ${r.to}: ${r.changed.length} files.`)
    if (!opt.quiet) for (const f of r.changed) console.log(`  ${f}`)
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv)
