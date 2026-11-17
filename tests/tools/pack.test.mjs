import test from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildZip, readZip, crc32, pack } from '../../tools/pack.mjs'

test('crc32 matches the known check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  assert.equal(crc32(Buffer.alloc(0)), 0)
})

test('buildZip and readZip round-trip text, binary and empty files', () => {
  const bin = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7919) % 251))
  const files = [
    { name: 'a/hello.txt', data: Buffer.from('hello hello hello hello hello hello') },
    { name: 'a/empty.txt', data: Buffer.alloc(0) },
    { name: 'b/zażółć.bin', data: bin },
  ]
  const back = readZip(buildZip(files))
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name))
  back.forEach((f, i) => assert.ok(f.data.equals(files[i].data), f.name))
})

test('the zip is deterministic', () => {
  const f = [{ name: 'x.txt', data: Buffer.from('same') }]
  assert.ok(buildZip(f).equals(buildZip(f)))
})

test('a corrupted zip is detected', () => {
  const z = Buffer.from(buildZip([{ name: 'x.txt', data: Buffer.from('some text to store, some text to store') }]))
  z[40] ^= 0xff
  assert.throws(() => readZip(z))
})

test('pack builds both release zips with the right content', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-pack-'))
  try {
    const results = pack({ outDir: out })
    assert.equal(results.length, 2)
    const names = fs.readdirSync(out).sort()
    assert.match(names[0], /^arghbox-\d+\.\d+\.\d+\.zip$/)
    assert.match(names[1], /^arghbox-triage-skill-\d+\.\d+\.\d+\.zip$/)

    const widget = readZip(fs.readFileSync(path.join(out, names[0]))).map((f) => f.name)
    for (const must of ['arghbox/arghbox.js', 'arghbox/arghbox-app.js', 'arghbox/app.html', 'arghbox/app-page.js', 'arghbox/api.php', 'arghbox/mcp.php', 'arghbox/lib/db.php', 'arghbox/lib/config.php', 'arghbox/lib/.htaccess', 'arghbox/data/.htaccess', 'arghbox/i18n/en.json', 'arghbox/config.example.php']) {
      assert.ok(widget.includes(must), must)
    }
    assert.ok(!widget.includes('arghbox/config.php'), 'no owner config.php')
    const api = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'arghbox', 'api.php'), 'utf8')
    for (const p of /foreach \(\[([^\]]+)\] as \$part\)/.exec(api)[1].match(/'([a-z]+)'/g).map((x) => x.slice(1, -1))) {
      assert.ok(widget.includes(`arghbox/lib/${p}.php`), `the zip lacks lib/${p}.php that api.php requires`)
    }
    assert.ok(!widget.some((n) => n.includes('.sqlite')), 'no database')

    const skill = readZip(fs.readFileSync(path.join(out, names[1]))).map((f) => f.name)
    assert.ok(skill.includes('arghbox-triage/SKILL.md'))
    assert.ok(skill.includes('arghbox-triage/triage.mjs'))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

test('PowerShell Expand-Archive can read the zip (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-pack-'))
  try {
    const [widget] = pack({ outDir: out })
    const dest = path.join(out, 'unzipped')
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${widget.file}' -DestinationPath '${dest}'`], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(fs.existsSync(path.join(dest, 'arghbox', 'api.php')))
    assert.ok(fs.existsSync(path.join(dest, 'arghbox', 'lib', 'db.php')))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

// The DOS date of the first entry of a zip: [year, month, day, hour, minute, second].
function zipStamp(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const p = buf.readUInt32LE(eocd + 16)
  const time = buf.readUInt16LE(p + 12)
  const date = buf.readUInt16LE(p + 14)
  return [1980 + (date >> 9), (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2]
}

test('zip timestamps: SOURCE_DATE_EPOCH wins, otherwise the newest file time, and the zip stays deterministic', async () => {
  const { releaseDate } = await import('../../tools/pack.mjs')
  assert.deepEqual(zipStamp(buildZip([{ name: 'a', data: Buffer.from('x') }], { date: new Date(Date.UTC(2027, 4, 6, 7, 8, 10)) })), [2027, 5, 6, 7, 8, 10])
  assert.equal(releaseDate([], { SOURCE_DATE_EPOCH: '1800000000' }).getTime(), 1800000000000)
  const old = new Date(Date.UTC(2026, 1, 2)), recent = new Date(Date.UTC(2026, 8, 9, 10, 0, 0))
  assert.equal(releaseDate([{ mtime: old }, { mtime: recent }], {}).getTime(), recent.getTime())
  assert.equal(releaseDate([{}], {}).getUTCFullYear(), 2026)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-pack-src-'))
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-pack-out-'))
  try {
    fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'arghbox'), path.join(root, 'arghbox'), { recursive: true })
    fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skill'), path.join(root, 'skill'), { recursive: true })
    const stamp = new Date(Date.UTC(2026, 10, 3, 12, 30, 0))
    for (const f of ['arghbox/VERSION']) fs.utimesSync(path.join(root, f), stamp, stamp)
    const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]))
    const older = new Date(Date.UTC(2026, 5, 1))
    for (const f of [...all(path.join(root, 'arghbox')), ...all(path.join(root, 'skill'))]) if (!f.endsWith('VERSION')) fs.utimesSync(f, older, older)
    pack({ root, outDir: out, env: {} })
    const zipPath = path.join(out, fs.readdirSync(out).find((n) => /^arghbox-\d/.test(n)))
    const first = fs.readFileSync(zipPath)
    assert.deepEqual(zipStamp(first), [2026, 11, 3, 12, 30, 0])
    pack({ root, outDir: out, env: {} })
    assert.ok(fs.readFileSync(zipPath).equals(first), 'unchanged tree, same zip')
    pack({ root, outDir: out, env: { SOURCE_DATE_EPOCH: '1798761600' } }) // 2027-01-01
    assert.deepEqual(zipStamp(fs.readFileSync(zipPath)), [2027, 1, 1, 0, 0, 0])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(out, { recursive: true, force: true })
  }
})
