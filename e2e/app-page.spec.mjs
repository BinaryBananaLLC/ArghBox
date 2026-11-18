// The mobile app page (arghbox/app.html + app-page.js + page mode of arghbox-app.js, SPEC section 8b), against the fake
// API. Runs on the desktop and phone projects. The real PHP stack is covered by e2e/report.spec.mjs.
import { test, expect, setTurnstileMode } from './support/servers.mjs'

const panel = (page) => page.locator('#arghbox-root .panel')
const appUrl = (servers, params = {}, hash = '') => {
  const q = new URLSearchParams(params).toString()
  return `${servers.siteUrl}/arghbox/app.html${q ? '?' + q : ''}${hash}`
}
const loaderAttrs = (page) => page.evaluate(() => {
  const s = document.querySelector('script[src*="arghbox.js"]')
  return Object.fromEntries([...s.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]))
})

test.beforeEach(async ({ page }) => {
  // CSP violations (the page has a meta CSP, SPEC 8b) and the widget's events.
  await page.addInitScript(() => {
    window.__csp = []
    window.__ev = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI))
    for (const n of ['ready', 'open', 'close', 'add', 'vote']) window.addEventListener('arghbox:' + n, (e) => window.__ev.push(n))
  })
  const problems = []
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push('pageerror ' + e.message))
  page.__problems = problems
})
test.afterEach(async ({ page }) => {
  expect(page.__problems, 'no CSP console errors or page errors').toEqual([])
  expect((await page.evaluate(() => window.__csp).catch(() => null)) || [], 'no securitypolicyviolation events').toEqual([])
})

test('opens full screen at every width, with no tab, content at most 640 px wide', async ({ page, servers }) => {
  await page.goto(appUrl(servers))
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  const vp = page.viewportSize()
  await expect.poll(async () => { // after the slide-in animation
    const box = await panel(page).boundingBox()
    return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]
  }).toEqual([0, 0, vp.width, vp.height])
  await expect(page.locator('#arghbox-root')).toHaveAttribute('data-tab', 'hidden')
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  const row = await page.locator('#arghbox-root .sc .row').boundingBox()
  expect(row.width).toBeLessThanOrEqual(640)
  if (vp.width > 800) expect(Math.abs(row.x + row.width / 2 - vp.width / 2)).toBeLessThan(12) // centred
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#arghbox-root').shadowRoot.querySelector('.ov')).backgroundColor)).not.toMatch(/rgba\(.*0\.\d+\)/) // no dimmed backdrop
  expect(await page.title()).toBe('Feedback')
  expect(await page.locator('meta[name=robots]').getAttribute('content')).toBe('noindex')
  expect(await page.evaluate(() => (window.ArghBoxConfig || {}).app)).toEqual({})
  expect(await loaderAttrs(page)).toEqual({ 'data-tab': 'off', 'data-page': '/' })
})

test('URL parameters apply: theme, accent, lang, tone, view=add, type, from, platform and version', async ({ page, servers, api }) => {
  await page.goto(appUrl(servers, { theme: 'dark', accent: '#336699', lang: 'pl', tone: 'neutral', view: 'add', type: 'bug', from: '/settings/profile', platform: 'ios', version: '2.3.4-beta+7' }))
  await expect(page.locator('#f-title')).toBeVisible()
  await expect(page.locator('#arghbox-root .ty input[value=bug]')).toBeChecked()
  expect(await loaderAttrs(page)).toEqual({ 'data-tab': 'off', 'data-page': '/settings/profile', 'data-theme': 'dark', 'data-accent': '#336699', 'data-lang': 'pl', 'data-tone': 'neutral' })
  const ab = page.locator('#arghbox-root .ab')
  await expect(ab).toHaveAttribute('data-dark', '')
  expect(await ab.evaluate((n) => n.style.getPropertyValue('--arghbox-accent'))).toBe('#336699')
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(29, 28, 34)')
  await expect(page.locator('#arghbox-root .ctx')).toContainText('/settings/profile')

  await page.locator('#f-title').fill('Please add a widget for the home screen')
  await page.locator('#arghbox-root form button[type=submit]').click()
  await expect(page.locator('#arghbox-root .thx')).toBeVisible({ timeout: 10_000 })
  const add = api.last('add')
  expect(add.type).toBe('bug')
  expect(add.context.page).toBe('/settings/profile')
  expect(add.context.app).toEqual({ platform: 'ios', version: '2.3.4-beta+7' })
})

test('the list is the default view, and theme=light keeps a light page', async ({ page, servers }) => {
  await page.goto(appUrl(servers, { theme: 'light' }))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await expect(page.locator('#arghbox-root .ab')).not.toHaveAttribute('data-dark', '')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)')
})

test('invalid parameters are ignored and never echoed into the page', async ({ page, servers, api }) => {
  const evil = '"><img src=x onerror=alert(1)>'
  await page.goto(appUrl(servers, { platform: 'windows', version: evil, from: 'settings', view: 'zzz', type: 'x', theme: 'pink', accent: 'red', lang: '1', tone: 'loud' }))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  expect(await page.evaluate(() => (window.ArghBoxConfig || {}).app)).toEqual({})
  expect(await loaderAttrs(page)).toEqual({ 'data-tab': 'off', 'data-page': '/' })
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toMatch(/windows|onerror|pink/)
  await expect(page.locator('#arghbox-root .sc .row')).toBeVisible() // the list, not the add form

  await page.locator('#arghbox-root .pri').first().click()
  await page.locator('#f-title').fill('Something that is long enough')
  await page.locator('#arghbox-root form button[type=submit]').click()
  await expect(page.locator('#arghbox-root .thx')).toBeVisible({ timeout: 10_000 })
  const add = api.last('add')
  expect(add.type).toBe('idea')
  expect(add.context.page).toBe('/')
  expect('app' in add.context).toBe(false)
  // a from path with a query or hash is invalid too
  for (const from of ['/a?b=1', '/a#x', '/' + 'x'.repeat(200)]) {
    await page.goto(appUrl(servers, { from }))
    await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
    expect((await loaderAttrs(page))['data-page']).toBe('/')
  }
})

test('only valid members of platform and version are used', async ({ page, servers, api }) => {
  await page.goto(appUrl(servers, { platform: 'android', version: 'x'.repeat(21) }))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  expect(await page.evaluate(() => window.ArghBoxConfig.app)).toEqual({ platform: 'android' })
  await page.locator('#arghbox-root .pri').first().click()
  await page.locator('#f-title').fill('Only the platform is valid')
  await page.locator('#arghbox-root form button[type=submit]').click()
  await expect(page.locator('#arghbox-root .thx')).toBeVisible({ timeout: 10_000 })
  expect(api.last('add').context.app).toEqual({ platform: 'android' })
})

const BRIDGES = {
  'React Native': { script: () => { window.ReactNativeWebView = { postMessage: (m) => (window.__bridge ||= []).push(m) } }, json: true },
  'iOS WKWebView': { script: () => { window.webkit = { messageHandlers: { arghbox: { postMessage: (m) => (window.__bridge ||= []).push(m) } } } }, json: false },
  Android: { script: () => { window.ArghBoxAndroid = { postMessage: (m) => (window.__bridge ||= []).push(m) } }, json: true },
  Flutter: { script: () => { window.ArghBoxFlutter = { postMessage: (m) => (window.__bridge ||= []).push(m) } }, json: true },
}
for (const [name, b] of Object.entries(BRIDGES)) {
  test(`bridge ${name}: open, vote, add and close are posted, with no visitor text`, async ({ page, servers }) => {
    await page.addInitScript(b.script)
    await page.goto(appUrl(servers, { platform: 'android', version: '1.0.0' }))
    await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
    const msgs = () => page.evaluate((json) => (window.__bridge || []).map((m) => (json ? JSON.parse(m) : m)), b.json)
    expect((await msgs()).map((m) => m.type)).toEqual(['open'])
    expect(await page.evaluate(() => typeof window.__bridge[0])).toBe(b.json ? 'string' : 'object')

    await page.locator('#arghbox-root .vote').first().click()
    await expect(page.locator('#arghbox-root .vote').first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await expect.poll(async () => (await msgs()).map((m) => m.type)).toEqual(['open', 'vote'])

    await page.locator('#arghbox-root .pri').first().click()
    await page.locator('#f-title').fill('A secret title that must not leak')
    await page.locator('#f-body').fill('A secret body that must not leak either')
    await page.locator('#arghbox-root form button[type=submit]').click()
    await expect(page.locator('#arghbox-root .thx')).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => (await msgs()).map((m) => m.type)).toEqual(['open', 'vote', 'add'])

    await page.locator('#arghbox-root .ib[aria-label="Close"]').click()
    await expect.poll(async () => (await msgs()).map((m) => m.type)).toEqual(['open', 'vote', 'add', 'close'])
    const all = await msgs()
    for (const m of all) expect(Object.keys(m).sort()).toEqual(['detail', 'source', 'type'])
    expect(all.every((m) => m.source === 'arghbox')).toBe(true)
    expect(all[1].detail).toEqual({ on: true })
    expect(all[2].detail).toEqual({ type: 'idea' })
    expect(JSON.stringify(all)).not.toMatch(/secret/)
    await expect(page.locator('#c')).toBeHidden() // a bridge exists: the app closes the page, no closed screen
  })
}

test('with several bridges present, every one gets the message', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: (m) => (window.__a ||= []).push(m) }
    window.ArghBoxFlutter = { postMessage: (m) => (window.__b ||= []).push(m) }
  })
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  expect(await page.evaluate(() => [window.__a.length, window.__b.length])).toEqual([1, 1])
})

test('a bridge that throws does not break the page, and does not count as reached', async ({ page, servers }) => {
  await page.addInitScript(() => { window.ReactNativeWebView = { postMessage: () => { throw new Error('native side is gone') } } })
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await page.locator('#arghbox-root .ib[aria-label="Close"]').click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('#c')).toBeVisible() // no bridge was reached: the visitor gets the closed screen, not a blank page
})

test('a throwing bridge does not hide the closed screen from a working one', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: () => { throw new Error('gone') } }
    window.ArghBoxAndroid = { postMessage: (m) => (window.__bridge ||= []).push(m) }
  })
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await page.locator('#arghbox-root .ib[aria-label="Close"]').click()
  await expect.poll(() => page.evaluate(() => (window.__bridge || []).map((m) => JSON.parse(m).type))).toEqual(['open', 'close'])
  await expect(page.locator('#c')).toBeHidden()
})

test('when the widget cannot load, the page says so and Try again reloads it', async ({ page, servers }) => {
  let block = true
  await page.route('**/arghbox/arghbox.js*', (r) => (block ? r.abort() : r.continue()))
  await page.goto(appUrl(servers))
  await expect(page.locator('#c')).toBeVisible()
  await expect(page.locator('#c h1')).toHaveText('Feedback could not load')
  await expect(page.locator('#o')).toHaveText('Try again')
  block = false
  await page.locator('#o').click()
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await expect(page.locator('#c')).toBeHidden()
})

test('parameters: a space in version is read as +, platform is case-insensitive, from rejects // and whitespace', async ({ page, servers }) => {
  await page.goto(servers.siteUrl + '/arghbox/app.html?platform=iOS&version=2.3.4+7&from=/a')
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  expect(await page.evaluate(() => window.ArghBoxConfig.app)).toEqual({ platform: 'ios', version: '2.3.4+7' })
  expect((await loaderAttrs(page))['data-page']).toBe('/a')
  await page.goto(servers.siteUrl + '/arghbox/app.html?platform=ANDROID&version=1.0%2B2')
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  expect(await page.evaluate(() => window.ArghBoxConfig.app)).toEqual({ platform: 'android', version: '1.0+2' })
  for (const from of ['//evil.example/x', '/a b', '/a\tb']) {
    await page.goto(appUrl(servers, { from }))
    await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
    expect((await loaderAttrs(page))['data-page'], from).toBe('/')
  }
})

test('external links: with a bridge every bridge gets a link message and the page stays; without one nothing changes', async ({ page, servers, api }) => {
  api.set({ contact: 'https://example.com/contact' })
  await page.addInitScript(() => {
    for (const k of ['ReactNativeWebView', 'ArghBoxAndroid', 'ArghBoxFlutter']) window[k] = { postMessage: (m) => (window.__l ||= []).push(JSON.parse(m)) }
    window.webkit = { messageHandlers: { arghbox: { postMessage: (m) => (window.__l ||= []).push(m) } } }
  })
  await page.goto(appUrl(servers))
  const contact = page.locator('#arghbox-root a', { hasText: 'Contact' })
  await expect(contact).toBeVisible()
  await contact.click()
  await expect.poll(() => page.evaluate(() => window.__l.filter((m) => m.type === 'link').length)).toBe(4)
  const links = await page.evaluate(() => window.__l.filter((m) => m.type === 'link'))
  for (const m of links) expect(m).toEqual({ source: 'arghbox', type: 'link', detail: { url: 'https://example.com/contact' } })
  await expect(contact).toBeVisible() // the dialog stays
  expect(page.url()).toContain('/arghbox/app.html')
})

test('external links: without a bridge the click is left alone', async ({ page, servers, api, context }) => {
  api.set({ contact: 'mailto:hi@example.com' })
  await page.goto(appUrl(servers))
  const contact = page.locator('#arghbox-root a', { hasText: 'Contact' })
  await expect(contact).toBeVisible()
  await page.evaluate(() => document.addEventListener('click', (e) => { window.__dp = e.defaultPrevented; e.preventDefault() })) // runs after the page's own listener; stops the real mailto navigation
  await contact.click()
  expect(await page.evaluate(() => window.__dp)).toBe(false)
})

test('external links: a non-http(s)/mailto link is never posted', async ({ page, servers }) => {
  await page.addInitScript(() => { window.ArghBoxAndroid = { postMessage: (m) => (window.__l ||= []).push(JSON.parse(m)) } })
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await page.evaluate(() => {
    const a = document.createElement('a'); a.href = 'tel:+48123456789'; a.textContent = 'x'; document.body.appendChild(a); document.addEventListener('click', (e) => e.preventDefault())
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  expect((await page.evaluate(() => window.__l)).map((m) => m.type)).toEqual(['open'])
})

test('with no bridge, closing shows the closed screen, and Open again brings the box back', async ({ page, servers }) => {
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await expect(page.locator('#c')).toBeHidden()
  await page.locator('#arghbox-root .ib[aria-label="Close"]').click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('#c')).toBeVisible()
  await expect(page.locator('#c h1')).toHaveText('Feedback closed')
  expect(page.url()).toContain('/arghbox/app.html') // the arghbox://close navigation goes nowhere in a normal browser
  await expect(page.locator('#o')).toBeFocused()
  await page.locator('#o').click()
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(page.locator('#c')).toBeHidden()
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  // Esc closes too, and shows the screen again
  await page.keyboard.press('Escape')
  await expect(page.locator('#c')).toBeVisible()
  expect(await page.evaluate(() => window.__ev.filter((e) => e === 'close').length)).toBe(2)
})

test('#arghbox-<id> opens that entry, #arghbox-add the add form, and the default open is skipped', async ({ page, servers }) => {
  await page.goto(appUrl(servers, { view: 'add' }, '#arghbox-1'))
  await expect(panel(page).locator('h2')).toHaveText('Dark mode')
  expect(await page.evaluate(() => window.__ev.filter((e) => e === 'open').length)).toBe(1)
  expect(page.url()).not.toContain('#arghbox') // the loader removes the hash

  await page.goto(appUrl(servers, {}, '#arghbox-bug'))
  await expect(page.locator('#arghbox-root .ty input[value=bug]')).toBeChecked()
})

test('app_pass: the pass comes from session {app:true} and Turnstile is never loaded', async ({ page, servers, api }) => {
  api.set({ appPass: true })
  const cf = []
  page.on('request', (r) => { if (/challenges\.cloudflare\.com/.test(r.url())) cf.push(r.url()) })
  await page.goto(appUrl(servers, { platform: 'ios', version: '1.0.0' }))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await page.locator('#arghbox-root .vote').first().click()
  await expect(page.locator('#arghbox-root .vote').first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  await page.locator('#arghbox-root .pri').first().click()
  await page.locator('#f-title').fill('Works without the robot check')
  await page.locator('#arghbox-root form button[type=submit]').click()
  await expect(page.locator('#arghbox-root .thx')).toBeVisible({ timeout: 10_000 })
  expect(api.requests('session').length).toBeGreaterThan(0)
  for (const s of api.requests('session')) expect(s.body).toEqual({ app: true })
  expect(cf).toEqual([])
  expect(await page.evaluate(() => typeof window.turnstile)).toBe('undefined')
  expect(await page.evaluate(() => !!document.getElementById('arghbox-turnstile'))).toBe(false)
})

test('without app_pass the web flow stays: Turnstile, then session {turnstile}', async ({ page, servers, api }) => {
  await setTurnstileMode(page, 'interactive')
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await page.locator('#arghbox-root .vote').first().click()
  await expect.poll(() => api.requests('vote').length, { timeout: 10_000 }).toBe(1)
  expect(api.requests('session')[0].body.turnstile).toMatch(/^stub-token/)
  expect(await page.evaluate(() => window.__turnstileCalls.render)).toBeGreaterThan(0)
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('arghbox-turnstile')).display)).toBe('none') // hidden again after the challenge
})

test('app_pass errors are friendly (a server that refuses the app pass)', async ({ page, servers, api }) => {
  api.set({ appPass: true })
  api.failNext('session', 'turnstile_failed', { status: 403 })
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await page.locator('#arghbox-root .vote').first().click()
  await expect(page.locator('#arghbox-root .banner')).toContainText('robot check')
})

test('the page makes no request outside its own origin except Turnstile, and nothing is blocked by the CSP', async ({ page, servers }) => {
  const origins = new Set()
  page.on('request', (r) => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin) })
  await setTurnstileMode(page, 'interactive')
  await page.goto(appUrl(servers, { view: 'add' }))
  await page.locator('#f-title').fill('A title that needs a pass')
  await page.locator('#arghbox-root form button[type=submit]').click()
  await expect(page.locator('#arghbox-root .thx')).toBeVisible({ timeout: 10_000 })
  expect([...origins].sort()).toEqual([servers.siteUrl, 'https://challenges.cloudflare.com'].sort())
  // the meta CSP is the one from the spec
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("connect-src 'self'")
})

test('keyboard: Esc closes, and the dialog traps focus', async ({ page, servers }, info) => {
  test.skip(/phone/.test(info.project.name), 'no keyboard on the phone project')
  await page.goto(appUrl(servers))
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement.id)).toBe('arghbox-root') // focus stays inside the dialog (shadow host)
  await page.keyboard.press('Escape')
  await expect(page.locator('#c')).toBeVisible()
})

