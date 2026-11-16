import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { freePort, killTree } from '../helpers/php.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEV = path.join(REPO, 'tools', 'dev.mjs')

function startDev(args) {
  const child = spawn(process.execPath, [DEV, ...args], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  return { child, output: () => out }
}

async function waitReady(proc, port) {
  // Two PHP servers plus Node start-ups on a busy machine (parallel test files, other agents) can take a while.
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (proc.child.exitCode !== null) throw new Error('dev.mjs exited: ' + proc.output())
    try {
      const r = await fetch(`http://127.0.0.1:${port}/arghbox/api.php?action=health`)
      if (r.ok) return r.json()
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('dev.mjs did not start: ' + proc.output())
}

/**
 * Start dev.mjs on a free port that no other server of this test uses. A port found free a moment ago can be taken
 * by someone else before php binds it (and two freePort() calls in a row may even return the same number), so a
 * start that fails early is retried on a new port. Resolves {proc, port, ready}.
 */
async function startDevOnFreePort(args, taken = []) {
  let lastError
  for (let attempt = 0; attempt < 4; attempt++) {
    let port = await freePort()
    while (taken.includes(port)) port = await freePort()
    const proc = startDev(['--port', String(port), ...args])
    try {
      const ready = await waitReady(proc, port)
      return { proc, port, ready }
    } catch (e) {
      lastError = e
      await killTree(proc.child)
    }
  }
  throw lastError
}

test('--help prints the options, including --dev-dir', () => {
  const r = spawnSync(process.execPath, [DEV, '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /--dev-dir DIR/)
  assert.match(r.stdout, /--site DIR/)
})

test('two dev servers with different --dev-dir values run side by side without sharing state', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-devdirs-'))
  const dirA = path.join(tmp, 'a')
  const dirB = path.join(tmp, 'b')
  let a = null
  let b = null
  try {
    // One after the other: the second must never get the first one's port, and starting them in turn keeps the load low.
    const sa = await startDevOnFreePort(['--dev-dir', dirA, '--moderation', 'pending', '--origin', 'http://localhost:4001', '--seed'])
    a = sa.proc
    const sb = await startDevOnFreePort(['--dev-dir', dirB, '--moderation', 'publish', '--origin', 'http://localhost:4002'], [sa.port])
    b = sb.proc
    const [pa, pb, ha, hb] = [sa.port, sb.port, sa.ready, sb.ready]
    assert.equal(ha.moderation, 'pending')
    assert.equal(hb.moderation, 'publish')

    const cfgA = fs.readFileSync(path.join(dirA, 'config.php'), 'utf8')
    const cfgB = fs.readFileSync(path.join(dirB, 'config.php'), 'utf8')
    assert.match(cfgA, /localhost:4001/)
    assert.doesNotMatch(cfgA, /localhost:4002/)
    assert.match(cfgB, /localhost:4002/)
    assert.doesNotMatch(cfgB, /localhost:4001/)
    assert.match(cfgA, new RegExp(`localhost:${pa}`))
    assert.match(cfgB, new RegExp(`localhost:${pb}`))

    for (const [dir, port] of [[dirA, pa], [dirB, pb]]) {
      for (const f of ['owner-token', 'triage-token', 'secret', path.join('arghbox', 'site.json'), path.join('arghbox', 'token')]) {
        assert.ok(fs.existsSync(path.join(dir, f)), `${dir} ${f}`)
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'arghbox', 'site.json'), 'utf8')).url, `http://localhost:${port}/arghbox/`)
      assert.ok(fs.existsSync(path.join(dir, 'data')))
    }
    assert.notEqual(fs.readFileSync(path.join(dirA, 'owner-token'), 'utf8'), fs.readFileSync(path.join(dirB, 'owner-token'), 'utf8'))

    // only A was seeded, and each box has its own data
    const la = await (await fetch(`http://127.0.0.1:${pa}/arghbox/api.php?action=list`)).json()
    const lb = await (await fetch(`http://127.0.0.1:${pb}/arghbox/api.php?action=list`)).json()
    assert.ok(la.entries.length > 5)
    assert.equal(lb.entries.length, 0)
    assert.match(a.output(), new RegExp(dirA.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')))
  } finally {
    if (a) await killTree(a.child)
    if (b) await killTree(b.child)
    // Windows can hold the folder for a moment after the processes end: retry instead of sleeping.
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
