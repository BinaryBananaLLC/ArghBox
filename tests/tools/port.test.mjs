// A dev or test server must refuse a port that is already taken instead of silently sharing it
// (php -S on Windows can bind a busy port, and requests then reach the other server).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { assertPortFree, freePort } from '../helpers/php.mjs'

test('assertPortFree rejects a busy port and accepts a free one', async () => {
  const busy = net.createServer()
  await new Promise((resolve) => busy.listen(0, '127.0.0.1', resolve))
  const { port } = busy.address()
  await assert.rejects(assertPortFree(port), /already in use/)
  await new Promise((resolve) => busy.close(resolve))
  await assertPortFree(await freePort())
})
