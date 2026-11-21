// Unit tests for the pure helpers of arghbox-app.js (window.__arghboxApp.helpers) and arghbox.js (ArghBox._h).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { app, loader, en, arghboxDir } from './load.mjs'

const H = app().helpers
const ids = (l) => Array.from(l, (e) => e.id)
const plain = (o) => JSON.parse(JSON.stringify(o)) // objects made inside the vm have another prototype

const entries = [
  { id: 1, title: 'Dark mode', body: 'My eyes hurt at night', tags: ['design'], aliases: ['Night theme please', 'Tryb ciemny'], votes: 14, created_at: '2026-10-01T10:00:00Z', status: 'planned' },
  { id: 2, title: 'KML export drops the altitude', body: '', tags: ['export', 'map'], aliases: [], votes: 9, created_at: '2026-11-03T10:00:00Z', status: 'open', type: 'bug' },
  { id: 3, title: 'Zażółć gęślą jaźń', body: '', tags: [], aliases: [], votes: 1, created_at: '2026-11-04T10:00:00Z', status: 'open' },
  { id: 7, title: '3D globe view', body: 'A spinning earth would be fun to look at', tags: ['map'], aliases: [], votes: 4, created_at: '2026-10-05T10:00:00Z', status: 'declined',
    comments: [{ body: 'We keep the map 2D only.', at: '2026-11-08T09:00:00Z' }] },
]

test('fold: lowercase, accents, punctuation, special letters', () => {
  assert.equal(H.fold('  Héllo,   WÓRLD!! '), 'hello world')
  assert.equal(H.fold('Zażółć gęślą jaźń'), 'zazolc gesla jazn')
  assert.equal(H.fold('Straße Œuvre Ørsted'), 'strasse oeuvre orsted')
  assert.equal(H.fold(null), '')
  assert.equal(H.fold('a-b_c/d'), 'a b c d')
})

test('tokens: drops stop words and single letters', () => {
  assert.deepEqual(plain(H.tokens('Can you add a dark mode, please?')), ['add', 'dark', 'mode'])
})

test('similar: matches titles, prefixes, aliases (with accents), tags, body and closed entries', () => {
  assert.deepEqual(ids(H.similar('dark mode', entries)), [1])
  assert.deepEqual(ids(H.similar('dar', entries)), [1]) // typing prefix
  assert.deepEqual(ids(H.similar('tryb ciemný', entries)), [1]) // alias, accent folded
  assert.deepEqual(ids(H.similar('night theme', entries)), [1]) // alias
  assert.deepEqual(ids(H.similar('zazolc gesla', entries)), [3]) // diacritics in the title
  assert.deepEqual(ids(H.similar('export', entries)), [2])
  assert.ok(ids(H.similar('design', entries)).includes(1), 'tag match')
  assert.deepEqual(ids(H.similar('spinning earth', entries)), [7]) // start of the body, closed entry
  assert.deepEqual(ids(H.similar('3d globe', entries)), [7])
  assert.deepEqual(plain(H.similar('', entries)), [])
  assert.deepEqual(plain(H.similar('the and please', entries)), []) // only stop words
  assert.deepEqual(ids(H.similar('quantum teleportation', entries)), [])
})

test('similar: at most max results, best first', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: 'Map zoom ' + i, votes: i, aliases: [], tags: [], body: '' }))
  const out = H.similar('map zoom', many, 3)
  assert.equal(out.length, 3)
  assert.deepEqual(ids(out), [8, 7, 6]) // equal scores: more votes first
})

test('rank: null without usable words, scored otherwise', () => {
  assert.equal(H.rank('the', entries, 0.4), null)
  const r = H.rank('dark', entries, 0.4)
  assert.equal(r[0].e.id, 1)
  assert.ok(r[0].s > 0.5)
})

test('sortEntries top and new, splitEntries open and closed', () => {
  assert.deepEqual(ids(H.sortEntries(entries, 'top')), [1, 2, 7, 3])
  assert.deepEqual(ids(H.sortEntries(entries, 'new')), [3, 2, 7, 1])
  const list = [{ id: 1, status: 'declined' }, { id: 2, status: 'open' }, { id: 3, status: 'done' }, { id: 4, status: 'planned' }, { id: 5, status: 'done' }]
  const sp = H.splitEntries(list)
  assert.deepEqual(ids(sp.open), [2, 4])
  assert.deepEqual(ids(sp.closed), [3, 5, 1], 'done first, then declined')
})

test('tabEntries: questions live under ideas', () => {
  const l = [{ id: 1, type: 'idea' }, { id: 2, type: 'bug' }, { id: 3, type: 'question' }]
  assert.deepEqual(ids(H.tabEntries(l, 'ideas')), [1, 3])
  assert.deepEqual(ids(H.tabEntries(l, 'bugs')), [2])
})

test('plural category and string lookup with tone and plurals', () => {
  assert.equal(H.pluralCat('en', 1), 'one')
  assert.equal(H.pluralCat('en', 2), 'other')
  assert.equal(H.pluralCat('pl', 5), 'many')
  assert.equal(H.pluralCat('xx-invalid-lang-tag-!!', 1), 'one')
  const dict = { 'votes.one': '{n} vote', 'votes.other': '{n} votes', 'votes.funny.one': '{n} person said argh', 'votes.funny.other': '{n} people said argh', plain: 'x', 'plain.funny': 'fx' }
  assert.equal(H.translate(dict, {}, 'en', 'funny', 'votes', { n: 1 }), '1 person said argh')
  assert.equal(H.translate(dict, {}, 'en', 'funny', 'votes', { n: 3 }), '3 people said argh')
  assert.equal(H.translate(dict, {}, 'en', 'neutral', 'votes', { n: 1 }), '1 vote')
  assert.equal(H.translate(dict, {}, 'en', 'neutral', 'votes', { n: 3 }), '3 votes')
  assert.equal(H.translate(dict, {}, 'en', 'funny', 'plain'), 'fx')
  assert.equal(H.translate(dict, {}, 'en', 'neutral', 'plain'), 'x')
  // falls back to English, then to the key
  assert.equal(H.translate({}, dict, 'pl', 'neutral', 'votes', { n: 7 }), '7 votes')
  assert.equal(H.translate({}, {}, 'en', 'funny', 'no.such.key'), 'no.such.key')
  // a translation that only has "other" is used for every number
  assert.equal(H.translate({ 'votes.other': '{n} g.' }, dict, 'pl', 'neutral', 'votes', { n: 1 }), '1 g.')
})

test('format: placeholders, unknown ones stay', () => {
  assert.equal(H.format('{a} and {b} and {c}', { a: 1, b: 'x' }), '1 and x and {c}')
  assert.equal(H.format('no placeholders'), 'no placeholders')
  assert.equal(H.format('{n} items', { n: 0 }), '0 items')
})

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
test('parseUA: browser and OS families', () => {
  const cases = [
    [CHROME_WIN, 'Chrome', 'Windows'],
    [CHROME_WIN + ' Edg/130.0.0.0', 'Edge', 'Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox', 'macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15', 'Safari', 'macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1', 'Safari', 'iOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome', 'iOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'Chrome', 'Android'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36', 'Samsung Internet', 'Android'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox', 'Linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome', 'ChromeOS'],
    ['', '', ''],
  ]
  for (const [ua, browser, os] of cases) assert.deepEqual(plain(H.parseUA(ua)), { browser, os }, ua)
})

test('buildContext: pathname only, coarse browser/os/screen, sanitized lang', () => {
  const base = { pathname: '/tools/kml', lang: 'pl_PL', ua: CHROME_WIN, width: 1400 }
  assert.deepEqual(plain(H.buildContext(base)), { page: '/tools/kml', lang: 'pl-PL', browser: 'Chrome', os: 'Windows', screen: 'large' })
  assert.equal(H.buildContext({ ...base, lang: 'en<script>' }).lang, 'enscript')
  assert.equal(H.buildContext({ ...base, pathname: '/' + 'a'.repeat(300) }).page.length, 200)
  // userAgentData wins over the UA string
  const uad = { brands: [{ brand: 'Not.A/Brand', version: '8' }, { brand: 'Chromium', version: '130' }, { brand: 'Microsoft Edge', version: '130' }], platform: 'Windows' }
  assert.equal(H.buildContext({ ...base, uaData: uad, ua: '' }).browser, 'Edge')
  assert.equal(H.buildContext({ ...base, uaData: { brands: [{ brand: 'Chromium', version: '1' }], platform: 'macOS' }, ua: '' }).browser, 'Chrome')
  // iPad desktop-class Safari reports as a Mac with touch
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15'
  assert.equal(H.buildContext({ ...base, ua: ipad, maxTouchPoints: 5 }).os, 'iOS')
})

test('screenClass boundaries', () => {
  assert.equal(H.screenClass(639), 'small')
  assert.equal(H.screenClass(640), 'medium')
  assert.equal(H.screenClass(1199), 'medium')
  assert.equal(H.screenClass(1200), 'large')
})

test('errorInfo: every SPEC error code maps to an existing friendly string', () => {
  const dict = en()
  const codes = ['bad_request', 'invalid_input', 'method_not_allowed', 'not_found', 'origin_not_allowed', 'turnstile_failed', 'turnstile_not_configured',
    'pass_invalid', 'pass_expired', 'rate_limited', 'unauthorized', 'conflict', 'not_configured', 'server_error', 'network', 'turnstile_unavailable', 'title_short', 'weird_new_code']
  for (const tone of ['funny', 'neutral']) {
    for (const c of codes) {
      const info = H.errorInfo(c, 120)
      const msg = H.translate(dict, dict, 'en', tone, info.key, info.vars)
      assert.notEqual(msg, info.key, `${c} (${tone}) has a string`)
      assert.ok(!/[{}]/.test(msg), `${c} has no unfilled placeholder: ${msg}`)
      assert.ok(!/json|undefined|null/i.test(msg))
    }
  }
})

test('errorInfo: rate_limited shows minutes (rounded up, at least 1); invalid_input by field', () => {
  const dict = en()
  const msg = (s) => { const i = H.errorInfo('rate_limited', s); return H.translate(dict, dict, 'en', 'neutral', i.key, i.vars) }
  assert.match(msg(1), /1 minute\b/)
  assert.match(msg(61), /2 minutes/)
  assert.match(msg(0), /1 minute\b/)
  assert.match(msg(3600), /60 minutes/)
  assert.equal(H.errorInfo('invalid_input', 0, 'title').key, 'err.invalid_input.title')
  assert.equal(H.errorInfo('invalid_input', 0, 'hp').key, 'err.invalid_input')
  assert.equal(H.errorInfo('zzz').key, 'err.unknown')
})

test('every string key the app asks for exists in en.json', () => {
  const src = fs.readFileSync(path.join(arghboxDir, 'arghbox-app.js'), 'utf8')
  const dict = en()
  const has = (k) => Object.keys(dict).some((d) => d === k || d.startsWith(k + '.'))
  for (const m of src.matchAll(/\bt\('([a-z_.]+)'/g)) if (!m[1].endsWith('.')) assert.ok(has(m[1]), 'missing string: ' + m[1])
  for (const k of ['status.planned', 'status.in_progress', 'status.done', 'status.declined', 'type.idea', 'type.bug', 'type.question', 'tab.ideas', 'tab.bugs',
    'sort.top', 'sort.new', 'add.ph.idea', 'add.ph.bug', 'add.ph.question', 'reason.spam', 'reason.abuse',
    'add.title.idea', 'add.title.bug', 'add.title.question', 'add.submit.idea', 'add.submit.bug', 'add.submit.question',
    'add.ph.body.idea', 'add.ph.body.bug', 'add.ph.body.question',
    'reason.off_topic', 'reason.test', 'reason.unclear', 'err.invalid_input.title', 'err.invalid_input.body']) assert.ok(has(k), k)
  assert.equal(dict._meta.lang, 'en')
  for (const [k, v] of Object.entries(dict)) if (k !== '_meta') assert.equal(typeof v, 'string', k)
})

test('visitors read plain words: no string calls a post an "argh" (the product name ArghBox is fine)', () => {
  for (const [k, v] of Object.entries(en())) if (k !== '_meta') assert.doesNotMatch(v, /\bargh(?!box)/i, k)
})

test('fmtDate, clip, newVoterKey, toMs', () => {
  assert.equal(H.fmtDate('2026-11-20T09:00:00Z', 'en'), 'Nov 20, 2026')
  assert.equal(H.fmtDate('nonsense', 'en'), '')
  assert.equal(H.clip('  a   b  ', 20), 'a b')
  assert.equal(H.clip('one two three four five', 12), 'one two…')
  const k = H.newVoterKey({ getRandomValues: (a) => { a.fill(251); return a } }, (s) => Buffer.from(s, 'latin1').toString('base64'))
  assert.match(k, /^[A-Za-z0-9_-]{22,64}$/)
  assert.equal(k.length, 24)
  assert.equal(H.toMs(1800), 1800 * 1000)
  assert.equal(H.toMs(1.8e12), 1.8e12)
  assert.equal(H.toMs('2026-11-20T09:00:00Z'), Date.parse('2026-11-20T09:00:00Z'))
  assert.ok(H.toMs(undefined) > Date.now())
})

test('loader helpers: language matching and hash routes', () => {
  const L = loader()._h
  assert.equal(L.matchLang('pl-PL', ['en', 'pl']), 'pl')
  assert.equal(L.matchLang('pt-br', ['en', 'pt-BR', 'pt']), 'pt-BR')
  assert.equal(L.matchLang('pt-PT', ['en', 'pt-BR', 'pt']), 'pt')
  assert.equal(L.matchLang('de', ['en', 'pl']), 'en')
  assert.equal(L.matchLang('', ['en', 'pl']), 'en')
  assert.equal(L.matchLang('PL_pl', ['en', 'pl']), 'pl')
  assert.deepEqual(plain(L.parseHash('#arghbox')), { view: 'list', id: 0 })
  assert.deepEqual(plain(L.parseHash('#arghbox-add')), { view: 'add', type: 'idea' })
  assert.deepEqual(plain(L.parseHash('#arghbox-bug')), { view: 'add', type: 'bug' })
  assert.deepEqual(plain(L.parseHash('#ARGHBOX-BUG')), { view: 'add', type: 'bug' })
  assert.deepEqual(plain(L.parseHash('#arghbox-42')), { view: 'list', id: 42 })
  assert.equal(L.parseHash('#arghbox-4x'), null)
  assert.equal(L.parseHash('#arghbox-other'), null)
  assert.equal(L.parseHash('#section-1'), null)
  assert.equal(L.parseHash(''), null)
})

// Verified against the server's own rule in lib/entries.php ab_check_links (PHP preg_match_all, same pattern).
test('countLinks matches the server count: one per URL, tricky cases', () => {
  const cases = [
    ['no links', '', 0],
    ['https://www.example.com', '', 1], // one URL, not two
    ['https://www.', '', 1],
    ['http://', '', 0],
    ['www.', '', 0],
    ['bare www.example.com here', '', 1],
    ['HTTPS://A.EXAMPLE and WWW.B.EXAMPLE', '', 2],
    ['a', 'see https://a.example, https://b.example and www.c.example', 3],
    ['xwww.example.com', '', 0],
    ['sub.www.example.com', '', 0],
    ['-www.example.com', '', 0],
    ['(www.example.com)', '', 1],
    ['https://a.example/www.b.example', '', 1],
    ['http://a.example,http://b.example', '', 1],
    ['title with www.one.example', 'body with www.two.example', 2],
    ['www.one.example', 'www.two.example\nwww.three.example', 3],
    ['ftp://x.example mailto:a@b.c', '', 0],
    ['tab\twww.x.example', '', 1],
    ['http:/x.example https//y.example', '', 0],
  ]
  for (const [title, body, n] of cases) assert.equal(H.countLinks(title, body), n, JSON.stringify([title, body]))
  assert.equal(H.countLinks(undefined, null), 0)
})

test('ratio: WCAG contrast of two sRGB colours', () => {
  assert.ok(Math.abs(H.ratio([0, 0, 0], [255, 255, 255]) - 21) < 0.01)
  assert.ok(Math.abs(H.ratio([255, 255, 255], [255, 255, 255]) - 1) < 0.01)
  assert.ok(H.ratio([181, 66, 48], [255, 255, 255]) > 4.5) // the brand button
})

test('pagePath: data-page wins; the host hook can redact or drop the page; failures fail closed', () => {
  assert.equal(H.pagePath('', '/reset/abc123', undefined), '/reset/abc123')
  assert.equal(H.pagePath('/account', '/reset/abc123', undefined), '/account')
  const conf = { redactPage: (p) => p.replace(/^\/reset\/.*/, '/reset/:token') }
  assert.equal(H.pagePath('', '/reset/abc123', conf), '/reset/:token')
  assert.equal(H.pagePath('', '/docs', conf), '/docs')
  assert.equal(H.pagePath('/fixed', '/reset/abc123', conf), '/fixed') // data-page wins over the hook
  assert.equal(H.pagePath('', '/reset/abc123', { redactPage: () => '' }), '') // '' = record no page
  assert.equal(H.pagePath('', '/reset/abc123', { redactPage: () => { throw new Error('x') } }), '')
  assert.equal(H.pagePath('', '/reset/abc123', { redactPage: () => 42 }), '')
  assert.equal(H.pagePath('', '/reset/abc123', { redactPage: () => 'no-slash' }), '')
  assert.equal(H.pagePath('', '/reset/abc123', { redactPage: 'not a function' }), '/reset/abc123')
})

test('fetchBody gives up on a body that never finishes, not only on missing headers', async () => {
  const stalled = app({ fetch: () => Promise.resolve({ ok: true, text: () => new Promise(() => {}) }) }).helpers
  const t0 = Date.now()
  await assert.rejects(stalled.fetchBody('/x', {}, 60))
  assert.ok(Date.now() - t0 < 1500)
  const fine = app({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve('{"a":1}') }) }).helpers
  const x = await fine.fetchBody('/x', {}, 500)
  assert.equal(x.txt, '{"a":1}')
  const broken = app({ fetch: () => Promise.reject(new TypeError('offline')) }).helpers
  await assert.rejects(broken.fetchBody('/x', {}, 500))
})

test('both scripts are pure ASCII, so a host page in another charset cannot corrupt them', () => {
  for (const f of ['arghbox.js', 'arghbox-app.js']) {
    const buf = fs.readFileSync(path.join(arghboxDir, f))
    const bad = []
    buf.forEach((b, i) => { if (b > 0x7f && bad.length < 5) bad.push(i) })
    assert.deepEqual(bad, [], `${f} has non-ASCII bytes at ${bad.join(', ')}`)
  }
})

test('the _h test hook is only exposed when a test asks for it', () => {
  assert.ok(loader()._h)
  const prod = (() => { const w = {}; return w })()
  assert.equal(prod._h, undefined)
})

test('the loader API never throws before startup: methods are safe no-ops and open() resolves', async () => {
  const L = loader() // the vm document has no body, so startup is still waiting
  assert.equal(typeof L.version, 'string')
  assert.equal(await L.open(), undefined)
  assert.doesNotThrow(() => { L.close(); L.showTab(); L.hideTab() })
})
