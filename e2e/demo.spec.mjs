// The widget on the demo page against the REAL backend (php -S + the real arghbox/ folder), seeded with
// tests/fixtures/demo-seed.json. Turnstile is replaced by the stub. Runs on the desktop and phone projects.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, demoSeed } from './support/real-stack.mjs'
import { REPO } from '../tests/helpers/server.mjs'

const stub = fs.readFileSync(path.join(REPO, 'e2e', 'support', 'turnstile-stub.js'), 'utf8')

test.use({ stackOptions: { seed: demoSeed } })

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: stub }))
})

const tab = (page) => page.locator('#arghbox-root .t')
const panel = (page) => page.locator('#arghbox-root .panel')
const card = (page, title) => page.locator('#arghbox-root .card', { hasText: title })
const voteBtn = (page, title) => page.locator(`#arghbox-root .vote[aria-label^="${title},"]`)

async function openDialog(page) {
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
  // the list comes from a real PHP server (single-threaded php -S) that may be busy: allow it more than the default 5 s
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible({ timeout: 15_000 })
}

test('the demo page loads the widget and the list comes from the seeded data', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  await expect(page).toHaveTitle(/Contoso Tasks/)
  await expect(tab(page)).toHaveText('Feedback')
  await openDialog(page)
  await expect(card(page, 'Dark mode for the widget')).toBeVisible()
  const entries = (await stack.list()).entries
  const dark = entries.find((e) => e.title === 'Dark mode for the widget')
  expect(dark.votes).toBeGreaterThanOrEqual(41) // merged duplicates add their votes
  await expect(voteBtn(page, 'Dark mode for the widget').locator('.n')).toHaveText(String(dark.votes))
  const listed = entries.map((e) => e.title)
  expect(listed).toContain('Dark mode for the widget')
  // merged and rejected seed entries are never public
  expect(listed).not.toContain('Night theme please')
})

test('voting counts once, and the same visitor cannot vote twice on the same entry', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  await openDialog(page)
  const btn = voteBtn(page, 'Export all entries to CSV')
  await expect(btn.locator('.n')).toHaveText('19')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(btn.locator('.n')).toHaveText('20')
  // The button is optimistic: it flips before the vote reaches the server. Reloading now would abort the request,
  // so wait until the server has really counted it.
  await expect(btn).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => (await stack.list()).entries.find((e) => e.title === 'Export all entries to CSV').votes).toBe(20)

  // reload: the same browser (same voter key) still shows the vote, and the count did not change
  await page.reload()
  await openDialog(page)
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(btn.locator('.n')).toHaveText('20')

  // the API agrees, and voting again with the same voter key does not add another vote
  const voter = await page.evaluate(() => localStorage.getItem('arghbox:voter'))
  expect(voter).toBeTruthy()
  const entry = (await stack.list()).entries.find((e) => e.title === 'Export all entries to CSV')
  expect(entry.votes).toBe(20)
  const again = await stack.vote(entry.id, true, voter)
  expect(again.json.ok).toBe(true)
  expect(again.json.votes).toBe(20)
  expect((await stack.list()).entries.find((e) => e.id === entry.id).votes).toBe(20)
})

test('a new idea waits as pending under "Your posts", and shows in the list once the owner publishes it', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Show walking time next to the distance')
  await panel(page).getByLabel('Details (optional)').fill('A rough estimate is plenty.')
  // The server drops forms sent in under 2.5 s as robots. The widget waits that out itself, so no test sleep is needed.
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 15_000 })
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await expect(panel(page).locator('.mine')).toContainText('Show walking time next to the distance')
  await expect(panel(page).locator('.mine')).toContainText('Waiting for review.')
  await expect(card(page, 'walking time')).toHaveCount(0)

  const pending = (await stack.queue()).pending
  expect(pending).toHaveLength(1)
  const id = pending[0].id
  const r = await stack.admin('admin.update', { body: { id, state: 'published' } })
  expect(r.json.ok).toBe(true)

  await page.reload()
  await openDialog(page)
  await expect(card(page, 'Show walking time next to the distance')).toBeVisible()
})

test('a public owner comment shows in the detail view, and #arghbox-<id> opens the detail', async ({ page, stack }) => {
  const entry = (await stack.list()).entries.find((e) => e.title === 'Export all entries to CSV')
  const c = await stack.admin('admin.comment', { body: { id: entry.id, body: 'Shipped in the next release, with a Jira flavour too.', public: true } })
  expect(c.json.ok).toBe(true)
  await page.goto(`${stack.siteUrl}/#arghbox-${entry.id}`)
  await expect(panel(page).locator('h2')).toHaveText('Export all entries to CSV')
  await expect(panel(page).locator('.cm')).toContainText('Shipped in the next release, with a Jira flavour too.')
  expect(await page.evaluate(() => location.hash)).toBe('') // the widget removes the hash
})

test('the Atom feed is valid XML with the published entries', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  const r = await stack.call('feed')
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toMatch(/application\/atom\+xml/)
  const result = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    return { error: !!doc.querySelector('parsererror'), root: doc.documentElement.localName, entries: doc.getElementsByTagName('entry').length }
  }, r.text)
  expect(result.error).toBe(false)
  expect(result.root).toBe('feed')
  expect(result.entries).toBeGreaterThan(5)
  expect(r.text).toContain('#arghbox-')
})

test('exports download as JSON, CSV and Jira CSV', async ({ stack }) => {
  const json = await stack.admin('admin.export', { query: { format: 'json' } })
  expect(json.status).toBe(200)
  expect(json.headers.get('content-disposition')).toMatch(/attachment; filename="arghbox-.*\.json"/)
  expect(json.json.entries.length).toBeGreaterThan(10)
  expect(json.json.version).toBe('0.2.0')

  const csv = await stack.admin('admin.export', { query: { format: 'csv' } })
  expect(csv.headers.get('content-disposition')).toMatch(/\.csv"/)
  expect(csv.text).toMatch(/^id,type,state,status,title/) // fetch strips the BOM
  expect(csv.text).toContain('Dark mode for the widget')

  const jira = await stack.admin('admin.export', { query: { format: 'jira-csv' } })
  expect(jira.text).toMatch(/Summary,Description,Issue Type,Labels/)
  expect(jira.text).toContain('From ArghBox #')

  const denied = await stack.call('admin.export', { query: { format: 'json' } })
  expect(denied.status).toBe(401)
})

// ---------------------------------------------------------------- impact on the host page (SEO and speed)

const ASSET_REQUEST = /\.(css|png|svg|ico|webmanifest|jpe?g|webp)(\?|$)/
const HOST_SCRIPT = /^\/demo\.js(\?|$)/ // the demo site's own script (demo bar, phone), not the widget's
const pathOf = (r) => { const u = new URL(r.url()); return u.pathname + u.search }

test('before any interaction the widget adds one script request and nothing else: no API, no app, no Turnstile', async ({ page, stack }) => {
  const requests = []
  const external = []
  page.on('request', (r) => {
    requests.push(pathOf(r))
    if (!r.url().startsWith(stack.origin)) external.push(r.url())
  })
  await page.goto(stack.siteUrl + '/')
  await expect(tab(page)).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(requests.filter((u) => u.startsWith('/arghbox/'))).toEqual(['/arghbox/arghbox.js?v=0.2.0'])
  expect(requests.filter((u) => !u.startsWith('/arghbox/') && !ASSET_REQUEST.test(u) && !HOST_SCRIPT.test(u) && u !== '/')).toEqual([])
  expect(external).toEqual([])
})

test('hovering the tab prefetches the app script only; the API, the strings and Turnstile wait for the click', async ({ page, stack }) => {
  const requests = []
  page.on('request', (r) => requests.push(r.url().includes('challenges.cloudflare.com') ? 'turnstile' : pathOf(r)))
  await page.goto(stack.siteUrl + '/')
  await expect(tab(page)).toBeVisible()
  await page.waitForLoadState('networkidle')
  requests.length = 0
  await tab(page).dispatchEvent('pointerenter')
  await expect.poll(() => requests.some((u) => u.startsWith('/arghbox/arghbox-app.js'))).toBe(true)
  await page.waitForLoadState('networkidle')
  expect(requests.filter((u) => !u.startsWith('/arghbox/arghbox-app.js'))).toEqual([])
  await openDialog(page)
  await expect.poll(() => requests.some((u) => u.startsWith('/arghbox/api.php?action=list'))).toBe(true)
  expect(requests.some((u) => u.startsWith('/arghbox/i18n/en.json'))).toBe(true)
})

/** Counts the top-level elements of an HTML fragment (enough to compare the raw page with the live DOM). */
function countTopLevel(html) {
  const voids = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source'])
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g
  let depth = 0
  let n = 0
  let m
  while ((m = re.exec(html))) {
    const [, close, name, , selfClose] = m
    if (close) { depth--; continue }
    if (depth === 0) n++
    if (!voids.has(name.toLowerCase()) && !selfClose) depth++
  }
  return n
}

test('the host DOM: only #arghbox-root is added, <head> is untouched, and the tab label is all a crawler sees', async ({ page, stack }) => {
  const raw = await (await page.request.get(stack.siteUrl + '/')).text()
  const rawHead = countTopLevel(raw.slice(raw.indexOf('<head>') + 6, raw.indexOf('</head>')))
  const rawBody = countTopLevel(raw.slice(raw.indexOf('<body>') + 6, raw.indexOf('</body>')))
  await page.goto(stack.siteUrl + '/')
  await expect(tab(page)).toBeVisible()
  const dom = await page.evaluate(() => {
    const root = document.getElementById('arghbox-root')
    return {
      headChildren: document.head.children.length,
      bodyIds: [...document.body.children].map((el) => el.id || el.tagName),
      bodyChildren: document.body.children.length,
      lightText: root.textContent.trim(),
      lightLinks: root.querySelectorAll('a').length,
      shadowText: root.shadowRoot.textContent.replace(/\s+/g, ' ').trim(),
      shadowLinks: root.shadowRoot.querySelectorAll('a[href]').length,
      title: document.title,
    }
  })
  expect(dom.headChildren).toBe(rawHead)
  expect(dom.bodyIds.filter((n) => n === 'arghbox-root')).toHaveLength(1)
  expect(dom.bodyChildren).toBe(rawBody + 1)
  expect(dom.lightText).toBe('') // everything is inside the shadow root
  expect(dom.lightLinks).toBe(0)
  expect(dom.shadowText).toMatch(/^Feedback\s*×?$/) // the tab label and the hide button's ×: all a rendering crawler sees until someone clicks
  expect(dom.shadowLinks).toBe(0)
  expect(dom.title).toMatch(/Contoso Tasks/)
})

test('no console errors or page errors, and no layout shift caused by the widget on the demo page', async ({ page, stack }) => {
  const problems = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(String(e)))
  await page.addInitScript(() => {
    window.__shiftNodes = []
    // Only Chromium exposes layout-shift entries; asking Firefox or WebKit would log a console warning of its own.
    if ((PerformanceObserver.supportedEntryTypes || []).includes('layout-shift')) {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shiftNodes.push((e.sources || []).map((s) => s.node && (s.node.id || s.node.nodeName)))
      }).observe({ type: 'layout-shift', buffered: true })
    }
  })
  await page.goto(stack.siteUrl + '/')
  await expect(tab(page)).toBeVisible()
  await page.waitForLoadState('networkidle')
  await openDialog(page)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  expect(problems).toEqual([])
  const nodes = await page.evaluate(() => window.__shiftNodes)
  expect(nodes.flat().filter((s) => s === 'arghbox-root')).toEqual([])
})

test('the loader tag does not block rendering: deferred, not in <head>, last script, versioned URL', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  const tag = await page.evaluate(() => {
    const s = document.querySelector('script[src*="arghbox.js"]')
    const all = [...document.querySelectorAll('script')]
    return { defer: s.defer, async: s.async, inHead: !!s.closest('head'), last: all[all.length - 1] === s, version: new URL(s.src).searchParams.get('v') }
  })
  expect(tag).toEqual({ defer: true, async: false, inHead: false, last: true, version: '0.2.0' })
})

test('caching: the API is never cached, the feed for 10 minutes, and .htaccess caches the scripts and strings for an hour', async ({ page, stack }) => {
  const list = await page.request.get(stack.apiUrl + '?action=list')
  expect(list.headers()['cache-control']).toMatch(/no-store/)
  const feed = await page.request.get(stack.apiUrl + '?action=feed')
  expect(feed.headers()['cache-control']).toMatch(/max-age=\d+/)
  // php -S (the dev router) serves static files with no-cache, so the Apache rules are checked in the file itself.
  const htaccess = fs.readFileSync(path.join(REPO, 'arghbox', '.htaccess'), 'utf8')
  expect(htaccess).toContain('"^(arghbox|arghbox-app|arghbox-preview|app-page)\\.js$"')
  expect(htaccess).toContain('"\\.json$"')
  expect(htaccess.match(/max-age=3600/g)).toHaveLength(2)
})

// api.php and mcp.php send X-Robots-Tag: noindex, nofollow on every response (lib/http.php).
test('api.php and mcp.php answer with X-Robots-Tag: noindex', async ({ page, stack }) => {
  for (const action of ['list', 'feed', 'health']) {
    const r = await page.request.get(stack.apiUrl + '?action=' + action)
    expect(r.headers()['x-robots-tag'], action).toMatch(/noindex/)
  }
  const mcp = await page.request.post(stack.arghboxUrl + 'mcp.php', { data: {} })
  expect(mcp.headers()['x-robots-tag']).toMatch(/noindex/)
})

test('the demo hash links open the right view: #arghbox-add the form, the bug link a bug report', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/#arghbox-add')
  await expect(panel(page).getByLabel('Title', { exact: true })).toBeVisible()
  await page.goto(stack.siteUrl + '/')
  await page.getByRole('link', { name: 'Report a bug', exact: true }).click()
  await expect(panel(page).getByLabel('Title', { exact: true })).toBeVisible()
  await expect(panel(page).getByRole('radio', { name: /Bug/ })).toBeChecked()
  expect(await page.evaluate(() => location.hash)).toBe('')
  // the ArghBox icon in the header is an #arghbox link too
  await page.keyboard.press('Escape')
  await page.locator('#header-feedback').click()
  await expect(card(page, 'Dark mode for the widget')).toBeVisible()
  expect(await page.evaluate(() => location.hash)).toBe('')
})

test('the demo page links to the admin page with a relative URL, and the admin page and the Atom feed answer', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  // relative, so the same page works at / (npm run dev) and under /ArghBox/ (GitHub Pages)
  const hrefs = await page.locator('a[href*="arghbox/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  expect(hrefs).toContain('arghbox/admin/')
  expect(hrefs.filter((h) => h.startsWith('/'))).toEqual([])
  for (const href of ['/arghbox/admin/', '/arghbox/api.php?action=feed']) {
    expect((await page.request.get(stack.siteUrl + href)).status()).toBe(200)
  }
  // with the real box, the demo bar names the dev owner token, not the GitHub Pages password
  await expect(page.locator('#demo-password')).toHaveText(/owner token that npm run dev printed/)
  await expect(page.locator('#demo-local-note')).toBeHidden()
})

test('the demo page links to the mobile app page, which opens the box full screen with the real API', async ({ page, stack }) => {
  await page.goto(stack.siteUrl + '/')
  const link = page.locator('#app-page-link')
  await expect(link).toHaveAttribute('href', 'arghbox/app.html?platform=ios&version=5.12.1&from=/settings')
  await link.click()
  await expect(page).toHaveURL(/\/arghbox\/app\.html\?platform=ios&version=5\.12\.1&from=\/settings/)
  await expect(page.locator('#arghbox-root .panel h2')).toBeVisible()
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
})
