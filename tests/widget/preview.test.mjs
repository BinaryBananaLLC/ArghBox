// Unit tests for arghbox-preview.js, the local preview's in-memory API (SPEC section 8).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScript } from './load.mjs'

const API = 'http://localhost:8787/arghbox/api.php'
const make = (code = 'network') => loadScript('arghbox-preview.js').__arghboxPreview(API, code)
// vm objects have another realm's prototypes: compare plain copies
const plain = (x) => JSON.parse(JSON.stringify(x))

test('list: sample entries in the shape of the real list, with a note that names the API and links the docs', async () => {
  const call = make('network')
  const r = await call('list', {})
  assert.equal(r.ok, true)
  assert.equal(r.app_pass, true) // no Turnstile in the preview
  assert.equal(r.turnstile_site_key, '')
  assert.equal(r.credit, true)
  assert.match(r.welcome, /^Local preview: no ArghBox server answered at localhost:8787\/arghbox\/api\.php\./)
  assert.match(r.welcome, /nothing is saved/)
  assert.match(r.welcome, /https:\/\/github\.com\/BinaryBananaLLC\/ArghBox\/blob\/main\/docs\/install\.md#test-on-your-computer/)
  assert.ok(r.entries.length >= 6)
  const types = new Set(r.entries.map((e) => e.type))
  assert.deepEqual([...types].sort(), ['bug', 'idea', 'question'])
  const statuses = new Set(r.entries.map((e) => e.status))
  for (const s of ['open', 'planned', 'in_progress', 'done', 'declined']) assert.ok(statuses.has(s), s)
  for (const e of r.entries) {
    assert.ok(e.id > 900000, 'ids stay clear of a real box')
    for (const k of ['type', 'title', 'body', 'status', 'votes', 'similar', 'aliases', 'tags', 'comments', 'source', 'created_at']) assert.ok(k in e, k)
  }
  assert.ok(r.entries.some((e) => e.source === 'owner'))
  assert.deepEqual(plain(r.tag_counts).find((t) => t.tag === 'design'), { tag: 'design', count: 2 })
  assert.deepEqual(plain(r.voted), [])
})

test('the note says why no box answered', async () => {
  assert.match((await make('not_configured')('list', {})).welcome, /the ArghBox at localhost:8787\/arghbox\/api\.php has no config\.php yet/)
  assert.match((await make('server_error')('list', {})).welcome, /was not ArghBox \(is PHP running there\?\)/)
})

test('session, vote and add work in memory; a new list shows the changes; nothing leaks between previews', async () => {
  const call = make()
  const s = await call('session', { app: true })
  assert.equal(s.ok, true)
  assert.ok(s.pass && s.expires_in > 0)
  const first = (await call('list', {})).entries[0]
  let v = await call('vote', { pass: s.pass, id: first.id, on: true })
  assert.deepEqual(plain(v), { ok: true, id: first.id, votes: first.votes + 1, voted: true })
  v = await call('vote', { pass: s.pass, id: first.id, on: true }) // the same vote again changes nothing
  assert.equal(v.votes, first.votes + 1)
  assert.deepEqual(plain((await call('list', {})).voted), [first.id])
  v = await call('vote', { pass: s.pass, id: first.id, on: false })
  assert.deepEqual(plain(v), { ok: true, id: first.id, votes: first.votes, voted: false })
  await assert.rejects(call('vote', { id: 1, on: true }), (e) => e.code === 'not_found')

  const a = await call('add', { pass: s.pass, type: 'bug', title: '  The   map  is blank ', body: 'On Firefox.' })
  assert.equal(a.ok, true)
  assert.equal(a.receipt, undefined) // no receipt: the preview never writes receipts to localStorage
  assert.equal(a.entry.state, 'published')
  assert.equal(a.entry.title, 'The map is blank')
  assert.equal(a.entry.type, 'bug')
  assert.equal(a.entry.votes, 1)
  const list = await call('list', {})
  assert.ok(list.entries.some((e) => e.id === a.entry.id))
  assert.ok(list.voted.includes(a.entry.id))
  await assert.rejects(call('add', { type: 'idea', title: 'abc' }), (e) => e.code === 'invalid_input' && e.field === 'title')
  await assert.rejects(call('add', { type: 'idea', title: 'Long body', body: 'x'.repeat(2001) }), (e) => e.code === 'invalid_input' && e.field === 'body')

  assert.deepEqual(plain(await call('report', { id: first.id, reason: 'spam' })), { ok: true })
  assert.deepEqual(plain(await call('mine', { receipts: ['r'] })), { ok: true, entries: [] })
  await assert.rejects(call('feed', {}), (e) => e.code === 'not_found')

  const fresh = await make()('list', {})
  assert.ok(!fresh.entries.some((e) => e.title === 'The map is blank'), 'a new preview starts over')
})
