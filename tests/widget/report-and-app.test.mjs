// Unit tests for the helpers behind the Report button, the Contact link and page mode (arghbox-app.js), and for
// the parameter handling of app-page.js (run in a vm with a small DOM stub).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { app, en, arghboxDir } from './load.mjs'

const H = app().helpers
const plain = (o) => JSON.parse(JSON.stringify(o)) // objects made inside the vm have another prototype

test('appCtx keeps only valid platform and version members', () => {
  assert.deepEqual(plain(H.appCtx({ platform: 'ios', version: '1.2.3' })), { platform: 'ios', version: '1.2.3' })
  assert.deepEqual(plain(H.appCtx({ platform: 'other', version: '2.0.0-beta+7_x' })), { platform: 'other', version: '2.0.0-beta+7_x' })
  assert.deepEqual(plain(H.appCtx({ platform: 'windows', version: '1.0' })), { version: '1.0' })
  assert.deepEqual(plain(H.appCtx({ platform: 'android', version: 'x'.repeat(21) })), { platform: 'android' })
  assert.deepEqual(plain(H.appCtx({ platform: 'ios', version: '1 2' })), { platform: 'ios' })
  assert.deepEqual(plain(H.appCtx({ platform: 'ios', version: 12 })), { platform: 'ios' })
  assert.deepEqual(plain(H.appCtx({})), {})
  assert.deepEqual(plain(H.appCtx(null)), {})
  assert.deepEqual(plain(H.appCtx(undefined)), {})
  assert.deepEqual(plain(H.appCtx({ platform: 'ios', extra: 1 })), { platform: 'ios' })
})

test('contactUrl accepts http, https and mailto only', () => {
  for (const ok of ['https://example.com/contact', 'http://example.com', 'HTTPS://EXAMPLE.COM/a?b=1#c', 'mailto:help@example.com', 'mailto:help@example.com?subject=Hi']) assert.equal(H.contactUrl(ok), ok)
  for (const bad of ['', null, undefined, 42, 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'ftp://example.com', '//example.com', 'example.com',
    'https://exa mple.com', 'https://example.com"onclick=x', 'https://example.com/<b>', ' https://example.com', 'https://', 'mailto:']) assert.equal(H.contactUrl(bad), '', String(bad))
})

test('dropHidden removes reported entries and lowers the tag counts', () => {
  const entries = [
    { id: 1, tags: ['design'] }, { id: 2, tags: ['export', 'map'] }, { id: 3, tags: [] }, { id: 7, tags: ['map'] }, { id: 9 },
  ]
  const counts = [{ tag: 'map', count: 2 }, { tag: 'design', count: 1 }, { tag: 'export', count: 1 }]
  const r = plain(H.dropHidden(entries, counts, [2, 9, 12345]))
  assert.deepEqual(r.entries.map((e) => e.id), [1, 3, 7])
  assert.deepEqual(r.counts, [{ tag: 'map', count: 1 }, { tag: 'design', count: 1 }]) // export reached 0 and is gone
  const none = plain(H.dropHidden(entries, counts, []))
  assert.equal(none.entries.length, 5)
  assert.deepEqual(none.counts, counts)
  assert.deepEqual(plain(H.dropHidden([], [], [1])), { entries: [], counts: [] })
  assert.deepEqual(plain(H.dropHidden(entries, counts, [1, 2, 3, 7, 9])), { entries: [], counts: [] })
  // the inputs are not changed
  assert.equal(entries.length, 5)
  assert.equal(counts[0].count, 2)
})

test('hidden entries are also out of the similar suggestions', () => {
  const list = [{ id: 2, title: 'KML export drops the altitude', body: '', tags: [], aliases: [], votes: 1, created_at: 'x' }, { id: 3, title: 'Keyboard shortcuts', body: '', tags: [], aliases: [], votes: 1, created_at: 'x' }]
  const vis = H.dropHidden(list, [], [2]).entries
  assert.deepEqual(Array.from(H.similar('kml export altitude', vis, 3), (e) => e.id), [])
  assert.deepEqual(Array.from(H.similar('kml export altitude', list, 3), (e) => e.id), [2])
})

test('the report strings exist, and none of them collides with the plural lookup', () => {
  const dict = en()
  for (const k of ['report.button', 'report.legend', 'report.spam', 'report.abusive', 'report.off_topic', 'report.other', 'report.send', 'report.cancel', 'report.pick', 'report.done', 'contact']) {
    assert.equal(typeof dict[k], 'string', k)
    assert.equal(H.translate(dict, dict, 'en', 'funny', k), dict[k], k)
    assert.equal(H.translate(dict, dict, 'en', 'neutral', k), dict[k], k)
  }
  assert.equal(dict['report.button'], 'Report')
  assert.match(dict['report.done'], /You will not see this one again/)
})

test('report errors map to friendly strings (no raw codes)', () => {
  const dict = en()
  for (const code of ['not_found', 'rate_limited', 'pass_invalid', 'turnstile_failed', 'server_error', 'network', 'forbidden']) {
    const i = H.errorInfo(code, 120)
    assert.ok(dict[i.key] || dict[i.key + '.funny'] || dict[i.key + '.funny.other'], code)
  }
})

// ---- app-page.js

function runAppPage({ search = '', hash = '', src = 'https://x.test/arghbox/app-page.js?v=0.1.2', bridges = {} } = {}) {
  const attrs = {}
  const listeners = {}
  const heading = { textContent: 'Feedback closed' }
  const closed = { hidden: true, querySelector: () => heading }
  const open = { onclick: null, textContent: 'Open again', focus() { this.focused = true } }
  const docListeners = {}
  let script = null
  const win = {
    location: { search, hash, href: 'https://x.test/arghbox/app.html' + search + hash },
    addEventListener: (n, f) => { (listeners[n] ||= []).push(f) },
    ...bridges,
  }
  const rootAttrs = {}
  const doc = {
    currentScript: { src },
    documentElement: { setAttribute: (k, v) => { rootAttrs[k] = v }, style: { setProperty: (k, v) => { rootAttrs['style' + k] = v } } },
    addEventListener: (n, f) => { (docListeners[n] ||= []).push(f) },
    createElement: () => (script = { setAttribute: (k, v) => { attrs[k] = v }, set src(v) { attrs.src = v }, get src() { return attrs.src } }),
    getElementById: (id) => (id === 'c' ? closed : open),
    body: { appendChild: () => { attrs.appended = true } },
  }
  win.window = win
  win.document = doc
  const ctx = vm.createContext({ window: win, document: doc, URLSearchParams, JSON, console })
  vm.runInContext(fs.readFileSync(path.join(arghboxDir, 'app-page.js'), 'utf8'), ctx, { filename: 'app-page.js' })
  const fire = (name, detail) => (listeners[name] || []).forEach((f) => f({ detail }))
  const click = (path) => { const e = { composedPath: () => path, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; (docListeners.click || []).forEach((f) => f(e)); return e }
  return { win, attrs, rootAttrs, fire, closed, open, listeners, heading, click, script: () => script }
}

test('app-page.js: valid parameters become loader attributes and the app config', () => {
  const r = runAppPage({ search: '?platform=ios&version=1.2.3&from=/settings&view=add&type=bug&theme=dark&accent=%23336699&lang=pl-PL&tone=neutral' })
  assert.deepEqual(plain(r.win.ArghBoxConfig), { app: { platform: 'ios', version: '1.2.3' } })
  assert.equal(r.attrs.src, 'arghbox.js?v=0.1.2')
  assert.equal(r.attrs['data-tab'], 'off')
  assert.equal(r.attrs['data-page'], '/settings')
  assert.equal(r.attrs['data-theme'], 'dark')
  assert.equal(r.attrs['data-accent'], '#336699')
  assert.equal(r.attrs['data-lang'], 'pl-PL')
  assert.equal(r.attrs['data-tone'], 'neutral')
  assert.equal(r.attrs.appended, true)
  assert.equal(r.rootAttrs['data-theme'], 'dark')
  assert.equal(r.rootAttrs['style--ac'], '#336699')
})

test('app-page.js: invalid parameters are dropped (page defaults to /)', () => {
  const r = runAppPage({ search: '?platform=windows&version=a%2Fb&from=settings&theme=pink&accent=red&lang=1&tone=loud&view=x&type=y' })
  assert.deepEqual(plain(r.win.ArghBoxConfig), { app: {} })
  assert.deepEqual(Object.keys(r.attrs).filter((k) => k.startsWith('data-')).sort(), ['data-page', 'data-tab'])
  assert.equal(r.attrs['data-page'], '/')
  for (const from of ['/a?b', '/a#b', '/' + 'x'.repeat(200), '']) {
    assert.equal(runAppPage({ search: '?from=' + encodeURIComponent(from) }).attrs['data-page'], '/', from)
  }
  assert.equal(runAppPage({ search: '?from=%2Fsettings%2Fprofile' }).attrs['data-page'], '/settings/profile')
  assert.equal(runAppPage({ search: '?accent=%23abc' }).attrs['data-accent'], '#abc')
  assert.equal(runAppPage({ search: '?accent=%23abcd' }).attrs['data-accent'], undefined)
  assert.equal(runAppPage({ search: '?version=' + 'v'.repeat(20) }).win.ArghBoxConfig.app.version, 'v'.repeat(20))
  assert.equal(runAppPage({ search: '?version=' + 'v'.repeat(21) }).win.ArghBoxConfig.app.version, undefined)
})

test('app-page.js: the loader URL carries the version of this script, or none', () => {
  assert.equal(runAppPage({ src: 'https://x.test/arghbox/app-page.js?v=9.9.9' }).attrs.src, 'arghbox.js?v=9.9.9')
  assert.equal(runAppPage({ src: 'https://x.test/arghbox/app-page.js' }).attrs.src, 'arghbox.js')
})

test('app-page.js: bridges get {source, type, detail}; iOS gets an object, the others a JSON string', () => {
  const got = { rn: [], ios: [], and: [], fl: [] }
  const r = runAppPage({ bridges: {
    ReactNativeWebView: { postMessage: (m) => got.rn.push(m) },
    webkit: { messageHandlers: { arghbox: { postMessage: (m) => got.ios.push(m) } } },
    ArghBoxAndroid: { postMessage: (m) => got.and.push(m) },
    ArghBoxFlutter: { postMessage: (m) => got.fl.push(m) },
  } })
  r.fire('arghbox:vote', { on: true })
  for (const k of ['rn', 'and', 'fl']) assert.deepEqual(JSON.parse(got[k][0]), { source: 'arghbox', type: 'vote', detail: { on: true } })
  assert.equal(typeof got.ios[0], 'object')
  assert.deepEqual(plain(got.ios[0]), { source: 'arghbox', type: 'vote', detail: { on: true } })
  r.fire('arghbox:close')
  assert.equal(r.closed.hidden, true, 'a bridge is there, so no closed screen')
  assert.equal(r.win.location.href, 'https://x.test/arghbox/app.html', 'and no navigation')
  r.fire('arghbox:open', {})
  r.fire('arghbox:add', { type: 'idea' })
  assert.deepEqual(got.rn.map((m) => JSON.parse(m).type), ['vote', 'close', 'open', 'add'])
})

test('app-page.js: with no bridge, close goes to the fixed arghbox://close and shows the closed screen; open hides it', () => {
  const r = runAppPage({ search: '?from=/x&platform=ios' })
  r.fire('arghbox:close')
  assert.equal(r.win.location.href, 'arghbox://close')
  assert.equal(r.closed.hidden, false)
  assert.equal(r.open.focused, true)
  r.fire('arghbox:open', {})
  assert.equal(r.closed.hidden, true)
  // nothing from the URL ever reaches the close URL
  const evil = runAppPage({ search: '?next=https://evil.example&from=/https://evil.example&redirect=javascript:alert(1)' })
  evil.fire('arghbox:close')
  assert.equal(evil.win.location.href, 'arghbox://close')
})

test('app-page.js: a bridge that throws is skipped, not fatal, and does not count as reached', () => {
  const r = runAppPage({ bridges: { ReactNativeWebView: { postMessage: () => { throw new Error('gone') } } } })
  assert.doesNotThrow(() => r.fire('arghbox:close'))
  assert.equal(r.closed.hidden, false, 'no bridge was reached: the closed screen shows')
  assert.equal(r.win.location.href, 'arghbox://close')
  const got = []
  const both = runAppPage({ bridges: { ReactNativeWebView: { postMessage: () => { throw new Error('gone') } }, ArghBoxAndroid: { postMessage: (m) => got.push(m) } } })
  both.fire('arghbox:close')
  assert.equal(both.closed.hidden, true)
  assert.equal(got.length, 1)
})

test('app-page.js: version reads a space as +, platform ignores letter case, from refuses // and whitespace', () => {
  assert.equal(runAppPage({ search: '?version=1.2.3+7' }).win.ArghBoxConfig.app.version, '1.2.3+7')
  assert.equal(runAppPage({ search: '?version=1.2.3%2B7' }).win.ArghBoxConfig.app.version, '1.2.3+7')
  assert.equal(runAppPage({ search: '?version=a%20b%20c' }).win.ArghBoxConfig.app.version, 'a+b+c')
  assert.equal(runAppPage({ search: '?platform=iOS' }).win.ArghBoxConfig.app.platform, 'ios')
  assert.equal(runAppPage({ search: '?platform=ANDROID' }).win.ArghBoxConfig.app.platform, 'android')
  assert.equal(runAppPage({ search: '?platform=Windows' }).win.ArghBoxConfig.app.platform, undefined)
  for (const from of ['//evil.example', '//', '/a b', '/a%09b', '/a%0Ab']) {
    assert.equal(runAppPage({ search: '?from=' + from }).attrs['data-page'], '/', from)
  }
  assert.equal(runAppPage({ search: '?from=/a//b' }).attrs['data-page'], '/a//b')
})

test('app-page.js: a loader that fails to load shows "could not load" with Try again, which reloads', () => {
  const r = runAppPage()
  let reloaded = 0
  r.win.location.reload = () => { reloaded++ }
  r.script().onerror()
  assert.equal(r.closed.hidden, false)
  assert.equal(r.heading.textContent, 'Feedback could not load')
  assert.equal(r.open.textContent, 'Try again')
  r.open.onclick()
  assert.equal(reloaded, 1)
})

test('app-page.js: links go to every bridge as a link message and are not followed; without a bridge nothing changes', () => {
  const got = { rn: [], ios: [], and: [], fl: [] }
  const r = runAppPage({ bridges: {
    ReactNativeWebView: { postMessage: (m) => got.rn.push(m) },
    webkit: { messageHandlers: { arghbox: { postMessage: (m) => got.ios.push(m) } } },
    ArghBoxAndroid: { postMessage: (m) => got.and.push(m) },
    ArghBoxFlutter: { postMessage: (m) => got.fl.push(m) },
  } })
  const a = (href) => ({ tagName: 'A', href })
  for (const href of ['https://example.com/contact', 'http://example.com/', 'mailto:hi@example.com', 'HTTPS://EXAMPLE.COM/']) {
    const e = r.click([{ tagName: 'SPAN' }, a(href), { tagName: 'DIV' }])
    assert.equal(e.defaultPrevented, true, href)
  }
  for (const k of ['rn', 'and', 'fl']) {
    assert.equal(got[k].length, 4)
    assert.deepEqual(JSON.parse(got[k][0]), { source: 'arghbox', type: 'link', detail: { url: 'https://example.com/contact' } })
  }
  assert.deepEqual(plain(got.ios[2]), { source: 'arghbox', type: 'link', detail: { url: 'mailto:hi@example.com' } })
  for (const href of ['javascript:alert(1)', 'tel:123', 'intent://x', 'arghbox://close', 'data:text/html,x']) {
    assert.equal(r.click([a(href)]).defaultPrevented, false, href)
  }
  assert.equal(r.click([{ tagName: 'BUTTON' }]).defaultPrevented, false)
  assert.equal(got.rn.length, 4, 'nothing else was posted')
  const none = runAppPage()
  assert.equal(none.click([a('https://example.com/')]).defaultPrevented, false)
})
