// The size checker guards the promise that the loader stays tiny on every host page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('check-size passes and reports the widget files with their budgets', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'tools', 'check-size.mjs')], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /ok\s+arghbox\/arghbox\.js: \d+ bytes, \d+ gzipped \(budget 4096\)/)
  assert.match(run.stdout, /ok\s+arghbox\/arghbox-app\.js: \d+ bytes, \d+ gzipped \(budget 22528\)/)
  assert.match(run.stdout, /ok\s+arghbox\/app-page\.js: \d+ bytes, \d+ gzipped \(budget 2048\)/)
})
