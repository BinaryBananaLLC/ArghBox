import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'new-secrets.mjs')
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const grab = (out, label) => out.split(/\r?\n/).find((l) => l.trim().startsWith(label)).trim().split(/\s+/).pop()
const key = (out, k) => new RegExp(`'${k}' => '([^']+)'`).exec(out)[1]

test('prints a 64-hex secret and two tokens whose sha256 hashes match the config lines', () => {
  const r = run()
  assert.equal(r.status, 0, r.stderr)
  assert.match(key(r.stdout, 'secret'), /^[0-9a-f]{64}$/)
  assert.equal(key(r.stdout, 'owner_token_sha256'), sha(grab(r.stdout, 'Owner token')))
  assert.equal(key(r.stdout, 'triage_token_sha256'), sha(grab(r.stdout, 'Triage token')))
  assert.notEqual(grab(r.stdout, 'Owner token'), grab(r.stdout, 'Triage token'))
  assert.doesNotMatch(r.stdout, /read_token_sha256/)
})

test('--read adds a read-only token and its hash', () => {
  const r = run('--read')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(key(r.stdout, 'read_token_sha256'), sha(grab(r.stdout, 'Read token')))
})

test('two runs never repeat a secret; unknown options fail with a hint', () => {
  assert.notEqual(key(run().stdout, 'secret'), key(run().stdout, 'secret'))
  const bad = run('--bogus')
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /Usage/)
})
