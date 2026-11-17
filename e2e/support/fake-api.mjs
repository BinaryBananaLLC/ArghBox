/**
 * In-memory fake of the ArghBox public API (docs/SPEC.md section 6), for widget tests.
 *
 *   import { createFakeApi, startFakeApi } from './fake-api.mjs'
 *   const api = createFakeApi({ moderation: 'pending' })   // api.handler(req, res) is a node:http handler
 *   const { url, close } = await startFakeApi(api)          // or listen on a random port (CORS enabled)
 *
 * Implements list, session, add, vote, report, mine, health. Voter keys are real: `voted` in `list` follows
 * the X-ArghBox-Voter header. A pass is any string returned by `session`.
 *
 * Inspecting what the widget sent:
 *   api.log            [{action, method, voter, body, origin}] in order
 *   api.requests('add') only those of one action;   api.last('add') the last one's body
 *
 * Switches (all reset by api.reset()):
 *   api.set({ down: true })            close the connection (network error); 'html' answers 503 text/html
 *   api.set({ slowMs: 800 })           delay every answer
 *   api.set({ moderation: 'publish' }) new entries are published at once
 *   api.set({ turnstileKey: '' })      list returns no site key
 *   api.set({ welcome: 'Hello' })      the owner's welcome text in list
 *   api.set({ contact: 'https://example.com/contact' })  list.contact (the owner's contact link)
 *   api.set({ appPass: true })         list.app_pass: session {app: true} gives a pass without Turnstile
 *   api.reports                        [{id, reason, voter}] what `report` stored (one per voter and entry)
 *   api.set({ minFillMs: 2500 })       like the real server: faster adds get a silent fake success
 *   api.failNext('vote', 'rate_limited', { retry_after: 120, times: 1, status: 429, field })
 *                                      next N calls of an action fail with that error (action '*' = any)
 *   api.expirePassOnce()               the next call that needs a pass answers pass_expired once
 *   api.setEntry(idOrReceipt, patch)   change an entry directly (state, status, reject_reason, merged_into ...)
 *   api.reset()                        back to the seed data and default switches
 */
import http from 'node:http'

const STATUS = {
  bad_request: 400, invalid_input: 400, method_not_allowed: 405, not_found: 404, origin_not_allowed: 403,
  turnstile_failed: 403, turnstile_not_configured: 503, pass_invalid: 401, pass_expired: 401, rate_limited: 429,
  unauthorized: 401, conflict: 409, not_configured: 503, server_error: 500,
}

export function seedEntries() {
  const e = (o) => ({
    type: 'idea', body: '', votes: 1, status: 'open', status_at: null, tags: [], comments: [], similar: 0, aliases: [],
    source: 'visitor', state: 'published', created_at: '2026-11-01T10:00:00Z', ...o,
  })
  return [
    e({ id: 1, title: 'Dark mode', body: 'My eyes hurt at night. A dark theme would be lovely.', votes: 14, status: 'planned', status_at: '2026-11-20T09:00:00Z',
      tags: ['design'], comments: [{ body: 'Coming in December.', at: '2026-11-20T09:00:00Z' }], similar: 2,
      aliases: ['Night theme please', 'Tryb ciemny'], created_at: '2026-10-01T10:00:00Z' }),
    e({ id: 2, type: 'bug', title: 'KML export drops the altitude', body: 'Exported files have no height values.', votes: 9, tags: ['export', 'map'], created_at: '2026-11-03T10:00:00Z' }),
    e({ id: 3, title: 'Keyboard shortcuts', body: 'Let me zoom and pan without the mouse.', votes: 6, status: 'in_progress', status_at: '2026-11-10T09:00:00Z', created_at: '2026-11-02T10:00:00Z' }),
    e({ id: 4, type: 'question', title: 'How do I change the units?', votes: 3, created_at: '2026-11-05T10:00:00Z' }),
    e({ id: 5, title: 'A print stylesheet', body: 'Printing the page should look good.', votes: 2, source: 'owner', tags: ['design'], created_at: '2026-11-06T10:00:00Z' }),
    e({ id: 6, title: 'Offline mode', votes: 5, status: 'done', status_at: '2026-11-12T09:00:00Z', comments: [{ body: 'Shipped in version 2.4.', at: '2026-11-12T09:00:00Z' }], created_at: '2026-09-01T10:00:00Z' }),
    e({ id: 7, title: '3D globe view', votes: 4, status: 'declined', status_at: '2026-11-08T09:00:00Z', tags: ['map'],
      comments: [{ body: 'We keep the map 2D only, it keeps things fast and simple.', at: '2026-11-08T09:00:00Z' }], created_at: '2026-10-05T10:00:00Z' }),
    e({ id: 8, type: 'bug', title: 'Search ignores accents', votes: 1, created_at: '2026-11-07T10:00:00Z' }),
    e({ id: 9, type: 'bug', title: 'Map flickers on zoom', votes: 2, status: 'done', status_at: '2026-11-09T09:00:00Z', created_at: '2026-10-20T10:00:00Z' }),
  ]
}

const DEFAULTS = () => ({ down: false, slowMs: 0, moderation: 'pending', turnstileKey: '1x00000000000000000000AA', minFillMs: 0, credit: true, welcome: '', contact: '', appPass: false })

export function createFakeApi(options = {}) {
  const api = {
    sw: { ...DEFAULTS(), ...options },
    entries: [],
    voters: new Map(), // entry id -> Set of voter keys (on top of the seed vote count)
    passes: new Set(),
    reports: [],
    log: [],
    failures: [],
    expireOnce: false,
    nextId: 100,
    nextPass: 1,
  }

  api.reset = () => {
    api.sw = { ...DEFAULTS(), ...options }
    api.entries = seedEntries()
    api.voters = new Map()
    api.passes = new Set()
    api.reports = []
    api.log = []
    api.failures = []
    api.expireOnce = false
    api.nextId = 100
    api.nextPass = 1
  }
  api.set = (patch) => { Object.assign(api.sw, patch) }
  api.failNext = (action, code, o = {}) => { api.failures.push({ action, code, times: o.times || 1, o }) }
  api.expirePassOnce = () => { api.expireOnce = true }
  api.requests = (action) => api.log.filter((r) => r.action === action)
  api.last = (action) => { const r = api.requests(action); return r.length ? r[r.length - 1].body : undefined }
  api.entry = (id) => api.entries.find((x) => x.id === id)
  api.setEntry = (key, patch) => {
    const en = api.entries.find((x) => x.id === key || x._receipt === key)
    if (!en) throw new Error('no such entry ' + key)
    Object.assign(en, patch)
    return en
  }

  const votesOf = (en) => (en._base ?? (en._base = en.votes)) + (api.voters.get(en.id) || new Set()).size
  const view = (en) => {
    // eslint-disable-next-line no-unused-vars
    const { state, _receipt, _base, reject_reason, merged_into, ...rest } = en
    return { ...rest, votes: votesOf(en) }
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
    })
    res.end(JSON.stringify(body))
  }
  const error = (res, code, extra = {}) => {
    const headers = code === 'rate_limited' ? { 'Retry-After': String(extra.retry_after || 60) } : {}
    const body = { ok: false, error: code, message: 'Fake API: ' + code }
    if (extra.field) body.field = extra.field
    if (extra.retry_after) body.retry_after = extra.retry_after
    send(res, extra.status || STATUS[code] || 400, body, headers)
  }

  async function readBody(req) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const txt = Buffer.concat(chunks).toString('utf8')
    return txt ? JSON.parse(txt) : {}
  }

  api.handler = async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const origin = req.headers.origin
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
    const origWrite = res.writeHead.bind(res)
    res.writeHead = (status, headers) => origWrite(status, { ...cors, ...headers })
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-ArghBox-Voter', 'Access-Control-Max-Age': '600' })
      return res.end()
    }
    const action = url.searchParams.get('action') || ''
    let body = {}
    try { body = req.method === 'POST' ? await readBody(req) : {} } catch { return error(res, 'bad_request') }
    const voter = req.headers['x-arghbox-voter'] || body.voter || ''
    api.log.push({ action, method: req.method, voter, body, origin })

    if (api.sw.down === true) return req.socket.destroy()
    if (api.sw.down === 'html') { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end('<html><body>Service Unavailable</body></html>') }
    if (api.sw.slowMs) await new Promise((r) => setTimeout(r, api.sw.slowMs))

    const f = api.failures.find((x) => (x.action === action || x.action === '*') && x.times > 0)
    if (f) { f.times--; return error(res, f.code, f.o) }

    if (action === 'add' || action === 'vote' || action === 'report') {
      if (api.expireOnce) { api.expireOnce = false; api.passes.clear(); return error(res, 'pass_expired') }
      if (!api.passes.has(body.pass)) return error(res, 'pass_invalid')
    }

    switch (action) {
      case 'list': {
        const listed = api.entries.filter((x) => x.state === 'published').map(view)
          .sort((a, b) => b.votes - a.votes || (a.created_at < b.created_at ? 1 : -1))
        const counts = {}
        listed.forEach((x) => x.tags.forEach((g) => { counts[g] = (counts[g] || 0) + 1 }))
        const tag_counts = Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
        const voted = api.entries.filter((x) => api.voters.get(x.id)?.has(voter)).map((x) => x.id)
        return send(res, 200, {
          ok: true, site: { name: 'Demo Site' }, welcome: api.sw.welcome, version: '0.1.0', turnstile_site_key: api.sw.turnstileKey, moderation: api.sw.moderation,
          credit: api.sw.credit, contact: api.sw.contact, app_pass: api.sw.appPass, entries: listed, tag_counts, voted,
        })
      }
      case 'session': {
        if (body.app === true && typeof body.turnstile !== 'string') {
          if (!api.sw.appPass) return error(res, 'turnstile_failed')
        } else if (typeof body.turnstile !== 'string' || !body.turnstile.startsWith('stub-token')) return error(res, 'turnstile_failed')
        const pass = 'pass-' + api.nextPass++
        api.passes.add(pass)
        return send(res, 200, { ok: true, pass, expires_at: Math.floor(Date.now() / 1000) + 1800 })
      }
      case 'add': {
        const title = String(body.title || '').replace(/\s+/g, ' ').trim()
        const text = String(body.body || '').trim()
        if (!['idea', 'bug', 'question'].includes(body.type)) return error(res, 'invalid_input', { field: 'type' })
        if (title.length < 4 || title.length > 120) return error(res, 'invalid_input', { field: 'title' })
        if (text.length > 2000) return error(res, 'invalid_input', { field: 'body' })
        const receipt = 'rcpt-' + api.nextId
        if (body.hp || (body.elapsed_ms || 0) < api.sw.minFillMs) {
          return send(res, 200, { ok: true, entry: { id: 0, type: body.type, title, state: 'pending', votes: 1 }, receipt })
        }
        const en = {
          id: api.nextId++, type: body.type, title, body: text, votes: 0, status: 'open', status_at: null, tags: [], comments: [], similar: 0, aliases: [],
          source: 'visitor', state: api.sw.moderation === 'publish' ? 'published' : 'pending', created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          _receipt: receipt, _base: 0,
        }
        api.entries.push(en)
        api.voters.set(en.id, new Set([voter]))
        return send(res, 200, { ok: true, entry: { ...view(en), state: en.state }, receipt })
      }
      case 'vote': {
        let en = api.entry(body.id)
        if (!en) return error(res, 'not_found')
        while (en.state === 'merged' && en.merged_into) en = api.entry(en.merged_into)
        const set = api.voters.get(en.id) || new Set()
        if (body.on) set.add(voter); else set.delete(voter)
        api.voters.set(en.id, set)
        return send(res, 200, { ok: true, id: en.id, votes: votesOf(en), voted: set.has(voter) })
      }
      case 'report': {
        if (!['spam', 'abusive', 'off_topic', 'other'].includes(body.reason)) return error(res, 'invalid_input', { field: 'reason' })
        const en = api.entry(body.id)
        if (!en || en.state !== 'published' || en.source !== 'visitor') return error(res, 'not_found')
        if (!api.reports.some((r) => r.id === en.id && r.voter === voter)) api.reports.push({ id: en.id, reason: body.reason, voter })
        return send(res, 200, { ok: true, id: en.id })
      }
      case 'mine': {
        const rs = Array.isArray(body.receipts) ? body.receipts.slice(0, 50) : []
        const out = []
        for (const r of rs) {
          const en = api.entries.find((x) => x._receipt === r)
          if (!en) continue
          const target = en.merged_into && api.entry(en.merged_into)
          out.push({
            receipt: r, id: en.id, type: en.type, title: en.title, state: en.state === 'flagged' ? 'pending' : en.state, status: en.status,
            tags: en.tags, comments: en.comments, merged_into: en.merged_into || null, merged_into_title: target ? target.title : null,
            reject_reason: en.reject_reason || null,
          })
        }
        return send(res, 200, { ok: true, entries: out })
      }
      case 'health':
        return send(res, 200, { ok: true, version: '0.1.0', php: 'fake', sqlite: 'fake', config: 'found' })
      default:
        return error(res, 'not_found')
    }
  }

  api.reset()
  return api
}

export async function startFakeApi(api = createFakeApi(), port = 0) {
  const server = http.createServer((req, res) => { api.handler(req, res).catch(() => { try { res.writeHead(500); res.end() } catch {} }) })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/api.php`
  return { api, url, server, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) }
}
