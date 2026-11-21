// Widget end-to-end tests against the fake API (e2e/support/fake-api.mjs). Runs on the desktop and phone projects.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, hostUrl, setTurnstileMode, repoRoot } from './support/servers.mjs'

const EN = JSON.parse(fs.readFileSync(path.join(repoRoot, 'arghbox', 'i18n', 'en.json'), 'utf8'))
const err = (code) => EN[`err.${code}.funny`] ?? EN[`err.${code}`]
const CF = 'https://challenges.cloudflare.com/**'

test.beforeEach(async ({ page }) => {
  // Collect the widget's window events (never any visitor text in detail).
  await page.addInitScript(() => {
    window.__ev = []
    for (const n of ['ready', 'open', 'close', 'add', 'vote', 'dismiss']) {
      window.addEventListener('arghbox:' + n, (e) => window.__ev.push({ name: n, detail: e.detail === null ? null : JSON.parse(JSON.stringify(e.detail)) }))
    }
    window.__cls = 0
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })
    } catch { /* not supported */ }
  })
})

// Engine-specific: WebKit's Tab key skips buttons unless the OS setting "Full Keyboard Access" is on, so a Tab press
// leaves the page instead of walking the dialog. The trap itself is checked in Chromium and Firefox.
const WEBKIT_TAB = 'WebKit does not Tab to buttons by default (Full Keyboard Access), so Tab-walking the dialog is not testable there'
const isPhone = (info) => /phone/.test(info.project.name) // phone (Pixel 7) and webkit-phone (iPhone 13)
const tab = (page) => page.locator('#arghbox-root .t')
const panel = (page) => page.locator('#arghbox-root .panel')
const card = (page, title) => page.locator('#arghbox-root .card', { hasText: title })
const voteBtn = (page, title) => page.locator(`#arghbox-root .vote[aria-label^="${title},"]`)

async function openDialog(page) {
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
}
async function load(page, servers, params = {}, hash = '') {
  await page.goto(hostUrl(servers, 'plain', params, hash))
}
const events = (page) => page.evaluate(() => window.__ev)

// ---------------------------------------------------------------- tab and loader

test('tab renders on the right edge by default, on the left with data-position, at data-offset', async ({ page, servers }) => {
  await load(page, servers)
  const vp = page.viewportSize()
  let box = await page.locator('#arghbox-root .tw').boundingBox()
  expect(Math.round(box.x + box.width)).toBe(vp.width)
  expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThan(2)
  await expect(tab(page)).toHaveText('Feedback')
  // the ArghBox mark (the pixel box, one ink path) on a white badge above the label
  const icon = await page.evaluate(() => {
    const svg = document.querySelector('#arghbox-root').shadowRoot.querySelector('.t svg')
    const r = svg.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), paths: svg.querySelectorAll('path').length, badge: getComputedStyle(svg).backgroundColor, ink: getComputedStyle(svg.querySelector('path')).fill }
  })
  expect(icon).toEqual({ w: 34, h: 34, paths: 1, badge: 'rgb(255, 255, 255)', ink: 'rgb(30, 36, 48)' })

  await load(page, servers, { 'data-position': 'left', 'data-offset': '30' })
  box = await page.locator('#arghbox-root .tw').boundingBox()
  expect(Math.round(box.x)).toBe(0)
  expect(Math.abs(box.y + box.height / 2 - vp.height * 0.3)).toBeLessThan(2)

  await load(page, servers, { 'data-offset': '500', 'data-label': 'Tell us' })
  box = await page.locator('#arghbox-root .tw').boundingBox()
  expect(Math.abs(box.y + box.height / 2 - vp.height * 0.9)).toBeLessThan(2) // clamped to 90
  await expect(tab(page)).toHaveText('Tell us')
})

test('x hides the tab, it stays hidden after reload, showTab() brings it back', async ({ page, servers }) => {
  await load(page, servers)
  const x = page.locator('#arghbox-root .x')
  await expect(x).toHaveAttribute('aria-label', 'Hide feedback button')
  await x.click()
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  expect((await events(page)).some((e) => e.name === 'dismiss')).toBe(true)
  await page.reload()
  await expect(page.locator('#arghbox-root')).toHaveCount(1)
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.evaluate(() => ArghBox.showTab())
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
  await page.reload()
  await expect(page.locator('#arghbox-root .tw')).toBeVisible() // dismissal was cleared
  await page.evaluate(() => ArghBox.hideTab())
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.reload()
  await expect(page.locator('#arghbox-root .tw')).toBeVisible() // hideTab() is not remembered
})

test('public tab state: #arghbox-root[data-tab] and the arghbox:tab event follow the tab', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.__tab = []
    window.addEventListener('arghbox:tab', (e) => window.__tab.push(e.detail.visible))
  })
  await load(page, servers)
  const root = page.locator('#arghbox-root')
  await expect(root).toHaveAttribute('data-tab', 'shown')
  await page.locator('#arghbox-root .x').click()
  await expect(root).toHaveAttribute('data-tab', 'hidden')
  await page.evaluate(() => ArghBox.showTab())
  await expect(root).toHaveAttribute('data-tab', 'shown')
  expect(await page.evaluate(() => window.__tab)).toEqual([true, false, true])
  await load(page, servers, { 'data-tab': 'off' })
  await expect(root).toHaveAttribute('data-tab', 'hidden')
})

test('data-dismiss-days=0 hides for this page view only; data-closable=off has no x', async ({ page, servers }) => {
  await load(page, servers, { 'data-dismiss-days': '0' })
  await page.locator('#arghbox-root .x').click()
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.reload()
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
  await load(page, servers, { 'data-closable': 'off' })
  await expect(tab(page)).toBeVisible()
  await expect(page.locator('#arghbox-root .x')).toHaveCount(0)
})

test('no network request before interaction; hovering the tab prefetches only the app script', async ({ page, servers }) => {
  const urls = []
  page.on('request', (r) => urls.push(r.url()))
  await load(page, servers)
  await expect(tab(page)).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(urls.filter((u) => /api\.php|arghbox-app|i18n|challenges\.cloudflare/.test(u))).toEqual([])
  await tab(page).hover()
  await expect.poll(() => urls.filter((u) => /arghbox-app\.js/.test(u)).length).toBeGreaterThan(0)
  expect(urls.filter((u) => /api\.php|i18n|challenges\.cloudflare/.test(u))).toEqual([])
  // the script URL carries the ?v= of the loader
  expect(urls.find((u) => /arghbox-app\.js/.test(u))).toContain('?v=0.1.2')
})

test('opens by click, by ArghBox.open(), by #arghbox links (hash removed), by type and view options', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)

  await page.evaluate(() => ArghBox.open())
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await page.evaluate(() => ArghBox.close())
  await expect(panel(page)).toHaveCount(0)

  await page.evaluate(() => ArghBox.open({ view: 'add', type: 'bug' }))
  await expect(panel(page).locator('h2')).toHaveText('Report a bug')
  await expect(panel(page).getByLabel('Bug')).toBeChecked()
  await page.evaluate(() => ArghBox.close())

  await page.evaluate(() => ArghBox.open({ type: 'bug' }))
  await expect(page.locator('#arghbox-root [role=tab][aria-selected=true]')).toHaveText('Bugs')
  await page.evaluate(() => ArghBox.close())

  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  expect(page.url()).not.toContain('#')
  await page.evaluate(() => ArghBox.close())

  await page.locator('#bug-link').click()
  await expect(panel(page).getByLabel('Bug')).toBeChecked()
  expect(page.url()).not.toContain('#')
  await page.evaluate(() => ArghBox.close())

  await page.locator('#add-link').click()
  await expect(panel(page).getByLabel('Idea')).toBeChecked()
  expect(page.url()).not.toContain('#')
  await page.evaluate(() => ArghBox.close())

  // landing on a page with the hash
  await page.goto(hostUrl(servers, 'plain', {}, '#arghbox'))
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(page.url()).not.toContain('#')
})

test('same-origin default API and a cross-origin data-api both work', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  expect(api.requests('list')[0].origin).toBeUndefined() // same origin: the browser sends no Origin on GET
  await page.evaluate(() => ArghBox.close())
  await load(page, servers, { api: 'cross' })
  await openDialog(page)
  expect(api.requests('list').length).toBe(2)
  expect(api.requests('list')[1].origin).toContain('127.0.0.1')
  expect(api.requests('list')[1].voter).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
})

// ---------------------------------------------------------------- list

test('list: tabs, sort, status badges, owner label, comment count, +N similar', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await expect(page.locator('#arghbox-root [role=tab][aria-selected=true]')).toHaveText('Ideas')
  const titles = () => page.locator('#arghbox-root .items:not(#ab-closed) .tt').allTextContents()
  expect(await titles()).toEqual(['Dark mode', 'Keyboard shortcuts', 'How do I change the units?', 'A print stylesheet'])
  await expect(card(page, 'Dark mode').locator('.bd')).toHaveText('Planned')
  await expect(card(page, 'Dark mode')).toContainText('+2 similar')
  await expect(card(page, 'Dark mode')).toContainText('1 comment')
  await expect(card(page, 'Dark mode')).toContainText('#design')
  await expect(card(page, 'Keyboard shortcuts').locator('.bd')).toHaveText('In progress')
  await expect(card(page, 'How do I change').locator('.bd')).toHaveText('Question') // questions live under Ideas
  await expect(card(page, 'print stylesheet').locator('.bd')).toHaveText('From the team')
  await expect(page.locator('#arghbox-root h3').first()).toHaveText('Open')

  await page.getByRole('button', { name: 'New', exact: true }).click()
  expect(await titles()).toEqual(['A print stylesheet', 'How do I change the units?', 'Keyboard shortcuts', 'Dark mode'])
  await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Top', exact: true }).click()
  expect((await titles())[0]).toBe('Dark mode')

  await page.getByRole('tab', { name: 'Bugs' }).click()
  expect(await titles()).toEqual(['KML export drops the altitude', 'Search ignores accents'])
  await page.getByRole('tab', { name: 'Ideas' }).focus()
  await page.keyboard.press('ArrowRight') // arrow keys move between tabs
  await expect(page.getByRole('tab', { name: 'Bugs' })).toHaveAttribute('aria-selected', 'true')
})

test('list: closed items are collapsed behind "Closed (N)", done before declined', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const closed = page.locator('#arghbox-root .ch')
  await expect(closed).toHaveText('Closed (2)')
  await expect(closed).toHaveAttribute('aria-expanded', 'false')
  await expect(card(page, 'Offline mode')).toBeHidden()
  await closed.click()
  await expect(closed).toHaveAttribute('aria-expanded', 'true')
  expect(await page.locator('#ab-closed .tt').allTextContents()).toEqual(['Offline mode', '3D globe view'])
  await expect(card(page, 'Offline mode').locator('.bd')).toHaveText('Done')
  await expect(card(page, '3D globe').locator('.bd')).toHaveText('Declined')
  await closed.focus()
  await page.keyboard.press('Enter')
  await expect(card(page, 'Offline mode')).toBeHidden()
})

test('list: empty box copy, neutral tone copy', async ({ page, servers, api }) => {
  api.entries = []
  await load(page, servers)
  await openDialog2(page)
  await expect(panel(page)).toContainText('No ideas yet. Be the first to suggest one.')
  await page.getByRole('tab', { name: 'Bugs' }).click()
  await expect(panel(page)).toContainText('No bugs reported yet. Suspicious, but nice.')
  await load(page, servers, { 'data-tone': 'neutral' })
  await openDialog2(page)
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await expect(panel(page)).toContainText('No ideas yet. Be the first to suggest one.')
  await expect(panel(page).getByRole('button', { name: 'Add an idea, bug or question' })).toBeVisible()
  await page.getByRole('tab', { name: 'Bugs' }).click()
  await expect(panel(page).locator('.empty')).toHaveText('No bugs reported yet.')
})
async function openDialog2(page) { // list may be empty: wait for the heading only
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(panel(page).locator('.empty')).toBeVisible()
}

test('list: search filters as you type (titles, aliases with accents, tags, closed entries)', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const search = panel(page).getByRole('searchbox')
  const visibleTitles = () => page.locator('#arghbox-root .tt:visible').allTextContents()
  await search.fill('dark')
  await expect.poll(visibleTitles).toEqual(['Dark mode'])
  await search.fill('tryb ciemný') // alias, accent folded
  await expect.poll(visibleTitles).toEqual(['Dark mode'])
  await search.fill('keyb')
  await expect.poll(visibleTitles).toEqual(['Keyboard shortcuts'])
  await search.fill('globe') // closed entry: the Closed section opens while filtering
  await expect.poll(visibleTitles).toEqual(['3D globe view'])
  await search.fill('qwertyuiop')
  await expect(panel(page)).toContainText('Nothing like that yet.')
  await search.fill('')
  await expect.poll(async () => (await visibleTitles()).length).toBe(4) // the search is debounced
})

test('list: tag chips filter by tag', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const chip = (t) => panel(page).locator('.chip', { hasText: '#' + t })
  await expect(chip('design')).toHaveText('#design 2')
  await expect(chip('map')).toHaveText('#map 2')
  await chip('design').click()
  await expect(chip('design')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.locator('#arghbox-root .tt:visible').allTextContents()).toEqual(['Dark mode', 'A print stylesheet'])
  await chip('design').click()
  await expect(chip('design')).toHaveAttribute('aria-pressed', 'false')
  expect((await page.locator('#arghbox-root .tt:visible').allTextContents()).length).toBe(4)
  await page.getByRole('tab', { name: 'Bugs' }).click()
  await chip('map').click()
  expect(await page.locator('#arghbox-root .tt:visible').allTextContents()).toEqual(['KML export drops the altitude'])
})

test('welcome text from the owner: plain text, line breaks kept, never HTML', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  await expect(panel(page).locator('.wel')).toBeHidden()
  api.set({ welcome: 'Tell us what bugs you.\n<b>We</b> read everything.' })
  await load(page, servers)
  await openDialog(page)
  const wel = panel(page).locator('.wel')
  await expect(wel).toBeVisible()
  await expect(wel).toHaveText('Tell us what bugs you.\n<b>We</b> read everything.')
  expect(await wel.locator('b').count()).toBe(0)
  expect(await wel.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap')
})

test('owner text gets real links (welcome, comments, closed excerpts); visitor text never does', async ({ page, servers, api }) => {
  const url = 'https://example.com/changelog'
  api.set({ welcome: `News: ${url}, and https://example.org/${'x'.repeat(70)}.` })
  api.setEntry(7, { comments: [{ body: `Why: (see ${url}).`, at: '2026-11-08T09:00:00Z' }], body: 'Visitor link https://spam.example/buy now', aliases: ['https://spam.example/alias'] })
  api.setEntry(1, { body: 'Visitor body http://spam.example/body', title: 'Dark mode https://spam.example/title' })
  await load(page, servers)
  await openDialog(page)
  const wel = panel(page).locator('.wel')
  const links = wel.locator('a')
  await expect(links).toHaveCount(2)
  await expect(links.first()).toHaveAttribute('href', url) // no trailing comma
  await expect(links.first()).toHaveAttribute('target', '_blank')
  await expect(links.first()).toHaveAttribute('rel', 'noopener nofollow ugc')
  await expect(links.first()).toHaveText(url)
  const long = `https://example.org/${'x'.repeat(70)}`
  await expect(links.nth(1)).toHaveAttribute('href', long) // no trailing full stop
  await expect(links.nth(1)).toHaveAttribute('title', long)
  expect((await links.nth(1).textContent()).length).toBeLessThan(50)
  await expect(wel).toContainText(', and ')

  // visitor text (titles, bodies, aliases) stays dead text
  await expect(card(page, 'Dark mode')).toBeVisible()
  expect(await panel(page).locator('.card a, .card .ex a').count()).toBe(0)
  await card(page, 'Dark mode').click()
  await expect(panel(page)).toContainText('Visitor body http://spam.example/body')
  await expect(panel(page).locator('.dt .body a')).toHaveCount(0)
  await expect(panel(page).locator('.al a')).toHaveCount(0)
  await expect(panel(page).locator('h2 a')).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Back' }).click()

  // owner comment in the detail view
  await panel(page).getByRole('searchbox').fill('globe')
  await card(page, '3D globe').click()
  const link = panel(page).locator('.cm a')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveAttribute('href', url)
  await expect(link).toHaveAttribute('rel', 'noopener nofollow ugc')
  await expect(panel(page).locator('.cm p')).toHaveText(`Why: (see ${url}).`)
  await expect(panel(page).locator('.dt .body a')).toHaveCount(0)

  // closed excerpt in the similar suggestions
  await page.evaluate(() => ArghBox.close())
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  await panel(page).getByLabel('Title', { exact: true }).fill('3d globe')
  const ex = panel(page).locator('.sim .it', { hasText: '3D globe view' }).locator('.ex a')
  await expect(ex).toHaveAttribute('href', url)
  await expect(panel(page).locator('.sim .tt a')).toHaveCount(0)
})

test('"Your posts" comments link too', async ({ page, servers, api }) => {
  await load(page, servers)
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  await panel(page).getByLabel('Title', { exact: true }).fill('Please add export options')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
  const receipt = JSON.parse(await page.evaluate(() => localStorage.getItem('arghbox:receipts')))[0]
  api.setEntry(receipt, { state: 'published', comments: [{ body: 'Docs: https://example.com/export.', at: '2026-11-21T09:00:00Z' }] })
  await page.reload()
  await openDialog(page)
  const a = panel(page).locator('.mine a')
  await expect(a).toHaveAttribute('href', 'https://example.com/export')
  await expect(a).toHaveAttribute('target', '_blank')
})

test('empty search offers "Add it as a new post", which opens the form with the search text as the title', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('searchbox').fill('quantum teleporter')
  await expect(panel(page)).toContainText('Nothing like that yet.')
  await panel(page).getByRole('button', { name: 'Add it as a new post' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Suggest an idea')
  await expect(panel(page).getByLabel('Title', { exact: true })).toHaveValue('quantum teleporter')
})

test('#arghbox-<id> opens that entry; the hash is removed; an unknown id falls back to the list', async ({ page, servers }) => {
  await page.goto(hostUrl(servers, 'plain', {}, '#arghbox-1'))
  await expect(panel(page).locator('h2')).toHaveText('Dark mode')
  expect(page.url()).not.toContain('#')
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await page.evaluate(() => ArghBox.close())
  await page.locator('#open-link').evaluate((a) => { a.setAttribute('href', '#arghbox-7') })
  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toHaveText('3D globe view') // a closed entry too
  await page.evaluate(() => ArghBox.close())
  await page.locator('#open-link').evaluate((a) => { a.setAttribute('href', '#arghbox-99999') })
  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await expect(card(page, 'Dark mode')).toBeVisible()
})

test('vote button has a visible "Upvote" label with the count, and a 44px target', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const btn = voteBtn(page, 'Dark mode')
  await expect(btn).toContainText('Upvote')
  await expect(btn.locator('.n')).toHaveText('14')
  const b = await btn.boundingBox()
  expect(b.width).toBeGreaterThanOrEqual(44)
  expect(b.height).toBeGreaterThanOrEqual(44)
  await btn.click()
  await expect(btn).toContainText('Upvoted')
})

// ---------------------------------------------------------------- detail

test('detail: full text, status date, tags, vote, comment thread, also asked as; Back keeps filters and scroll', async ({ page, servers, api }, info) => {
  for (let i = 0; i < 14; i++) api.entries.push({ id: 200 + i, type: 'idea', title: 'Filler idea number ' + i, body: '', votes: 1, status: 'open', status_at: null, tags: [], comments: [], similar: 0, aliases: [], source: 'visitor', state: 'published', created_at: '2026-11-0' + (1 + (i % 9)) + 'T10:00:00Z' })
  await load(page, servers)
  await openDialog(page)
  await card(page, 'Dark mode').click()
  await expect(panel(page).locator('h2')).toHaveText('Dark mode')
  await expect(panel(page)).toContainText('Planned since Nov 20, 2026')
  await expect(panel(page)).toContainText('My eyes hurt at night. A dark theme would be lovely.')
  await expect(panel(page)).toContainText('#design')
  await expect(panel(page).getByText(/comments from demo site/i)).toBeVisible()
  await expect(panel(page).locator('.cm')).toContainText('Coming in December.')
  await expect(panel(page).locator('.cm time')).toHaveText('Nov 20, 2026')
  await expect(panel(page).getByText(/also asked as/i)).toBeVisible()
  await expect(panel(page).locator('.al li')).toHaveText(['Night theme please', 'Tryb ciemny'])
  await expect(panel(page)).toContainText('14 votes')
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true') // state shared with the list

  // filters and scroll survive a detail round trip
  await panel(page).getByRole('searchbox').fill('filler')
  await expect(card(page, 'Filler idea number 13')).toBeAttached()
  await card(page, 'Filler idea number 9').scrollIntoViewIfNeeded()
  await panel(page).locator('.sc').evaluate((el) => { el.scrollTop = 200 })
  const before = await panel(page).locator('.sc').evaluate((el) => el.scrollTop)
  expect(before).toBeGreaterThan(0)
  await card(page, 'Filler idea number 9').dispatchEvent('click') // no auto-scroll by the test runner
  await expect(panel(page).locator('h2')).toHaveText('Filler idea number 9')
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await expect(panel(page).getByRole('searchbox')).toHaveValue('filler')
  expect(await panel(page).locator('.sc').evaluate((el) => el.scrollTop)).toBe(before)
  // focus returns to the card that was opened
  await expect(card(page, 'Filler idea number 9')).toBeFocused()

  // closed entry: the declined explanation is the latest comment
  await panel(page).getByRole('searchbox').fill('globe')
  await card(page, '3D globe').click()
  await expect(panel(page)).toContainText('Declined since Nov 8, 2026')
  await expect(panel(page).locator('.cm')).toContainText('We keep the map 2D only')
})

// ---------------------------------------------------------------- voting

test('voting toggles, sends the exact JSON, and survives a reload (voted ids from the API)', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  const btn = voteBtn(page, 'Dark mode')
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  await expect(btn).toHaveAttribute('aria-label', 'Dark mode, 14 Upvote')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(btn).toHaveAttribute('aria-label', 'Dark mode, 15 Upvoted')
  await expect(btn.locator('.n')).toHaveText('15')
  await expect(panel(page).locator('[role=status]')).toContainText('Counted. 15 votes')
  const v = api.last('vote')
  expect(Object.keys(v).sort()).toEqual(['id', 'on', 'pass', 'voter'])
  expect(v).toMatchObject({ id: 1, on: true, pass: 'pass-1' })
  expect(v.voter).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
  expect(api.requests('session').length).toBe(1)
  expect(api.last('session')).toEqual({ turnstile: expect.stringMatching(/^stub-token/) })
  expect((await events(page)).filter((e) => e.name === 'vote')).toEqual([{ name: 'vote', detail: { on: true } }])

  await page.reload()
  await openDialog(page)
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-label', 'Dark mode, 15 Upvoted')
  expect(api.requests('list')[1].voter).toBe(v.voter) // same voter key from localStorage

  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'false')
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-label', 'Dark mode, 14 Upvote')
  // The button flips before the request leaves the browser, so wait for the request instead of reading it at once.
  await expect.poll(() => api.last('vote')).toMatchObject({ id: 1, on: false })
  expect(api.requests('session').length).toBe(2) // a reload is a new visit: one new pass
  await voteBtn(page, 'Keyboard shortcuts').click()
  await expect.poll(() => api.requests('vote').length).toBe(3)
  expect(api.requests('session').length).toBe(2) // but one pass per visit, not per vote
})

test('voting works with the keyboard alone', async ({ page, servers }) => {
  await load(page, servers)
  await tab(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  await voteBtn(page, 'Keyboard shortcuts').focus()
  await page.keyboard.press('Space')
  await expect(voteBtn(page, 'Keyboard shortcuts')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
})

test('the interactive Turnstile container shows only while a challenge needs the visitor', async ({ page, servers }) => {
  await setTurnstileMode(page, 'interactive')
  await load(page, servers)
  await openDialog(page)
  const box = page.locator('#arghbox-turnstile')
  await expect(box).toHaveCount(0) // not created before it is needed
  await voteBtn(page, 'Dark mode').click()
  await expect(box).toBeVisible()
  await expect(box).toBeHidden()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  const calls = await page.evaluate(() => window.__turnstileCalls)
  expect(calls.render).toBe(1)
  expect(await page.evaluate(() => window.__turnstileLastRender.appearance)).toBe('interaction-only')
  expect(await page.evaluate(() => window.__turnstileLastRender.sitekey)).toBe('1x00000000000000000000AA')
  await expect(box).toHaveCount(0) // removed once the pass came: nothing stays behind in the host's DOM
  expect(await page.evaluate(() => [...document.body.children].some((e) => e.id === 'arghbox-turnstile'))).toBe(false)
})

test('a challenge that needs the visitor shows inside the dialog, right above the Send button, which says to tick it', async ({ page, servers }) => {
  await page.route(CF, (route) => route.fulfill({ contentType: 'application/javascript', body: HOLDING_STUB }))
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  const box = page.locator('#arghbox-turnstile')
  await expect(box).toBeVisible() // the form starts the check at once; this one asks the visitor
  // a light-DOM child of the widget's root (Turnstile fails in shadow roots), shown through the footer's slot
  expect(await box.evaluate((b) => b.parentElement.id + ' ' + b.slot)).toBe('arghbox-root ts')
  const send = panel(page).locator('form button[type=submit]')
  const [p, b, s] = await Promise.all([panel(page).boundingBox(), box.boundingBox(), send.boundingBox()])
  expect(b.x).toBeGreaterThanOrEqual(p.x)
  expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width + 0.5)
  expect(b.y + b.height).toBeLessThanOrEqual(s.y) // above the button, not on top of it
  await panel(page).getByLabel('Title', { exact: true }).fill('Waiting for the tick')
  await send.click()
  await expect(send).toHaveText('Tick the box above to send')
  await expect(send).toBeDisabled()
  await expect(send).toHaveAttribute('aria-busy', 'false') // no spinner: it waits for the visitor, not for us
  await page.evaluate(() => { window.__o['after-interactive-callback'](); window.__o.callback('stub-token-ticked') })
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
  await expect(box).toHaveCount(0)
})

test('while the check runs, the Send button says so and spins; then it says Sending', async ({ page, servers }) => {
  await page.route(CF, (route) => route.fulfill({ contentType: 'application/javascript', body: HOLDING_STUB }))
  await page.addInitScript(() => { window.__quiet = true }) // the stub neither asks the visitor nor answers yet
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Patience is a virtue')
  const send = panel(page).locator('form button[type=submit]')
  await send.click()
  await expect(send).toHaveText('Checking you are human...')
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('#arghbox-turnstile')).toBeHidden() // nothing for the visitor to do
  await page.evaluate(() => window.__o.callback('stub-token-late'))
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
})

// ---------------------------------------------------------------- adding

test('adding an idea sends the exact JSON; context has the pathname only', async ({ page, servers, api }, info) => {
  await page.goto(hostUrl(servers, 'plain', { secret: 'abc123' }, '#frag-9'))
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await expect(panel(page).getByLabel('Title', { exact: true })).toBeFocused()
  await panel(page).getByLabel('Title', { exact: true }).fill('  Please add a   weather layer ')
  await panel(page).getByLabel('Details (optional)').fill('Rain and wind, please.\nSecond line.')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
  await expect(panel(page).locator('[role=status]')).toBeAttached()

  const a = api.last('add')
  expect(Object.keys(a).sort()).toEqual(['body', 'context', 'elapsed_ms', 'hp', 'pass', 'title', 'type', 'voter'])
  expect(a).toMatchObject({ type: 'idea', title: 'Please add a weather layer', body: 'Rain and wind, please.\nSecond line.', hp: '', pass: 'pass-1' })
  expect(a.elapsed_ms).toBeGreaterThan(0)
  expect(Object.keys(a.context).sort()).toEqual(['browser', 'lang', 'os', 'page', 'screen'])
  // The coarse family of each emulated device: Chrome on Windows and on Android, Firefox on Windows, Safari on iOS.
  const family = { desktop: ['Chrome', 'Windows'], phone: ['Chrome', 'Android'], firefox: ['Firefox', 'Windows'], 'webkit-phone': ['Safari', 'iOS'] }[info.project.name]
  expect(a.context).toMatchObject({ page: '/plain.html', lang: 'en', browser: family[0], screen: isPhone(info) ? 'small' : 'large' })
  expect(a.context.os).toBe(family[1])
  expect(JSON.stringify(a)).not.toMatch(/abc123|frag-9/)
  expect(await events(page)).toContainEqual({ name: 'add', detail: { type: 'idea' } })
  expect(JSON.stringify(await events(page))).not.toMatch(/weather|Rain/)

  // pending entry: not in the list, shown under "Your posts"
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await expect(panel(page).locator('.mine summary')).toHaveText('Your posts (1)')
  await expect(panel(page).locator('.mine')).toContainText('Please add a weather layer')
  await expect(panel(page).locator('.mine')).toContainText('Waiting for review.')
  await expect(card(page, 'weather layer')).toHaveCount(0)
})

test('adding a bug; publish mode shows "Thanks, it is listed." and lists it with the visitor voted', async ({ page, servers, api }) => {
  api.set({ moderation: 'publish' })
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Bug').check()
  await expect(panel(page).locator('h2')).toHaveText('Report a bug') // the title, the placeholder and the button follow the type
  await expect(panel(page).getByLabel('Details (optional)')).toHaveAttribute('placeholder', 'What did you do, and what happened instead?')
  await panel(page).getByLabel('Title', { exact: true }).fill('Pins vanish when I rotate the phone')
  await panel(page).getByRole('button', { name: 'Send bug report' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, it is listed.')
  expect(api.last('add')).toMatchObject({ type: 'bug', title: 'Pins vanish when I rotate the phone', body: '' })
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await panel(page).getByRole('tab', { name: 'Bugs' }).click()
  await expect(voteBtn(page, 'Pins vanish when I rotate the phone')).toHaveAttribute('aria-pressed', 'true')
  await expect(card(page, 'Pins vanish')).toBeVisible()
})

test('add form: validation, honeypot is hidden from people and screen readers, draft survives Esc', async ({ page, servers, api }) => {
  await load(page, servers)
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  const title = panel(page).getByLabel('Title', { exact: true })
  await title.fill('abc')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('#e-title')).toHaveText(EN['err.title_short'])
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAttribute('aria-describedby', 'e-title')
  expect(api.requests('add').length).toBe(0)
  const hp = panel(page).locator('.hp input')
  await expect(hp.locator('xpath=..')).toHaveAttribute('aria-hidden', 'true')
  await expect(hp).toHaveAttribute('tabindex', '-1')
  expect((await hp.locator('xpath=..').boundingBox()).x).toBeLessThan(-1000)
  await title.fill('A half written idea')
  await page.keyboard.press('Escape')
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  await expect(panel(page).getByLabel('Title', { exact: true })).toHaveValue('A half written idea')
})

test('server field errors on add are tied to the field with aria-describedby', async ({ page, servers, api }) => {
  await load(page, servers)
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  api.failNext('add', 'invalid_input', { field: 'title' })
  await panel(page).getByLabel('Title', { exact: true }).fill('Something long enough')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('#e-title')).toHaveText(EN['err.invalid_input.title'])
  await expect(panel(page).getByLabel('Title', { exact: true })).toHaveAttribute('aria-describedby', 'e-title')
  await expect(panel(page).getByRole('button', { name: 'Send idea' })).toBeEnabled()
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
})

test('similar suggestions while typing: titles, aliases, closed entries; voting from the suggestion', async ({ page, servers, api }) => {
  await load(page, servers)
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  const title = panel(page).getByLabel('Title', { exact: true })
  const sim = panel(page).locator('.sim')
  await expect(sim).toBeHidden()
  await title.fill('dark mod')
  await expect(sim).toBeVisible()
  await expect(sim.locator('h3')).toHaveText('Is it one of these? Vote for it instead.')
  await expect(sim.locator('.tt')).toHaveText(['Dark mode'])
  await expect(panel(page).locator('[role=status]')).toContainText('1 similar entry is listed below.')

  await title.fill('tryb ciemny prosze') // alias match (Polish)
  await expect(sim.locator('.tt')).toHaveText(['Dark mode'])
  await title.fill('night theme')
  await expect(sim.locator('.tt')).toHaveText(['Dark mode'])

  await title.fill('a 3d globe would be cool') // closed (declined): status and the start of the latest comment, no vote button
  await expect(sim.locator('.tt')).toContainText(['3D globe view'])
  const globe = sim.locator('.it', { hasText: '3D globe view' })
  await expect(globe).toContainText('Declined: We keep the map 2D only')
  await expect(globe.locator('.vote')).toHaveCount(0)

  await title.fill('offline mode') // closed (done)
  await expect(sim.locator('.it', { hasText: 'Offline mode' })).toContainText('Done: Shipped in version 2.4.')

  await title.fill('dark mode')
  await sim.locator('.vote').click()
  await expect(sim.locator('.vote')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => api.last('vote')).toMatchObject({ id: 1, on: true })

  await title.fill('zzzz qqqq')
  await expect(sim).toBeHidden()
  const n = await sim.locator('.it').count()
  expect(n).toBe(0)
  // at most 3
  api.entries.push(...[1, 2, 3, 4].map((i) => ({ id: 300 + i, type: 'idea', title: 'Zoom feature ' + i, body: '', votes: 1, status: 'open', status_at: null, tags: [], comments: [], similar: 0, aliases: [], source: 'visitor', state: 'published', created_at: '2026-11-0' + i + 'T10:00:00Z' })))
  await page.evaluate(() => ArghBox.close())
  await page.reload()
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  await panel(page).getByLabel('Title', { exact: true }).fill('zoom feature')
  await expect(sim.locator('.it')).toHaveCount(3)
})

test('"Your posts": pending, published, merged (opens the target), rejected with a friendly reason', async ({ page, servers, api }) => {
  api.set({ moderation: 'pending' })
  await load(page, servers)
  const addOne = async (title) => {
    await page.evaluate(() => ArghBox.open({ view: 'add' }))
    await panel(page).getByLabel('Title', { exact: true }).fill(title)
    await panel(page).getByRole('button', { name: 'Send idea' }).click()
    await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
    await page.evaluate(() => ArghBox.close())
  }
  await addOne('Spammy looking thing')
  await addOne('Please add a night mode')
  await addOne('Something with no reason')
  await addOne('Totally fine idea')
  const receipts = JSON.parse(await page.evaluate(() => localStorage.getItem('arghbox:receipts')))
  expect(receipts.length).toBe(4)
  api.setEntry(receipts[0], { state: 'rejected', reject_reason: 'spam' })
  api.setEntry(receipts[1], { state: 'merged', merged_into: 1 })
  api.setEntry(receipts[2], { state: 'rejected', reject_reason: 'other' })
  api.setEntry(receipts[3], { state: 'published', status: 'planned', comments: [{ body: 'Good one, adding it.', at: '2026-11-21T09:00:00Z' }] })
  await page.reload()
  await openDialog(page)
  const mine = panel(page).locator('.mine')
  await expect(mine.locator('summary')).toHaveText('Your posts (4)')
  await expect(mine).not.toHaveAttribute('open', '') // more than 3: collapsed
  await mine.locator('summary').click()
  const row = (t) => mine.locator('li', { hasText: t })
  await expect(row('Spammy looking thing')).toContainText('Not published: it looked like spam.')
  await expect(row('Something with no reason')).toContainText('Not published.')
  await expect(row('Something with no reason')).not.toContainText('Not published:')
  await expect(row('Please add a night mode')).toContainText(/Merged into #1 .?Dark mode.?\./) // the title sits between invisible bidi isolates
  await expect(row('Totally fine idea')).toContainText('Published.')
  await expect(row('Totally fine idea')).toContainText('Comment: Good one, adding it.')
  await expect(row('Totally fine idea').locator('.bd')).toHaveText('Planned')
  expect(await mine.locator('li .lk').count()).toBeGreaterThan(0)
  await row('Please add a night mode').locator('.lk').click() // opens #1
  await expect(panel(page).locator('h2')).toHaveText('Dark mode')
  // published entries are not in the list while pending: open it via its link
})

test('"Your posts": every reject reason has friendly words', async ({ page, servers, api }) => {
  await load(page, servers)
  const reasons = { spam: 'it looked like spam', off_topic: 'it was not about this site', test: 'it looked like a test', unclear: 'we could not tell what it was about', abuse: 'it broke the house rules' }
  const keys = Object.keys(reasons)
  for (const k of keys) {
    await page.evaluate(() => ArghBox.open({ view: 'add' }))
    await panel(page).getByLabel('Title', { exact: true }).fill('Entry for ' + k)
    await panel(page).getByRole('button', { name: 'Send idea' }).click()
    await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
    await page.evaluate(() => ArghBox.close())
  }
  const receipts = JSON.parse(await page.evaluate(() => localStorage.getItem('arghbox:receipts')))
  keys.forEach((k, i) => api.setEntry(receipts[i], { state: 'rejected', reject_reason: k }))
  await page.reload()
  await openDialog(page)
  await panel(page).locator('.mine summary').click()
  for (const k of keys) await expect(panel(page).locator('.mine li', { hasText: 'Entry for ' + k })).toContainText(`Not published: ${reasons[k]}.`)
})

// ---------------------------------------------------------------- errors

test('every error code shows a friendly message, never raw JSON, and the vote is rolled back', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  const btn = voteBtn(page, 'Dark mode')
  const banner = panel(page).locator('.banner')
  const codes = ['bad_request', 'invalid_input', 'method_not_allowed', 'not_found', 'origin_not_allowed', 'unauthorized', 'conflict', 'not_configured', 'server_error']
  for (const code of codes) {
    api.failNext('vote', code)
    await btn.click()
    await expect(banner).toHaveText(err(code))
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect(btn).toHaveAttribute('aria-label', 'Dark mode, 14 Upvote')
    await expect(panel(page)).not.toContainText(/Fake API|"ok"|\{"/)
  }
  // rate limited: waiting time in minutes
  api.failNext('vote', 'rate_limited', { retry_after: 120 })
  await btn.click()
  await expect(banner).toHaveText(EN['err.rate_limited.funny.other'].replace('{n}', '2'))
  api.failNext('vote', 'rate_limited', { retry_after: 30 })
  await btn.click()
  await expect(banner).toHaveText(EN['err.rate_limited.funny.one'].replace('{n}', '1'))
  // the banner clears on the next successful action
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(banner).toBeHidden()
})

test('session errors: turnstile_failed, turnstile_not_configured, and a widget that errors', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  const banner = panel(page).locator('.banner')
  api.failNext('session', 'turnstile_failed')
  await voteBtn(page, 'Dark mode').click()
  await expect(banner).toHaveText(err('turnstile_failed'))
  api.failNext('session', 'turnstile_not_configured')
  await voteBtn(page, 'Dark mode').click()
  await expect(banner).toHaveText(err('turnstile_not_configured'))
  await setTurnstileMode(page, 'error')
  await voteBtn(page, 'Dark mode').click()
  await expect(banner).toHaveText(err('turnstile_failed'))
  await setTurnstileMode(page, 'pass')
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await expect(banner).toBeHidden()
})

test('pass_expired: a new pass is fetched and the request retried once; pass_invalid twice gives up', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  api.expirePassOnce()
  await voteBtn(page, 'Dark mode').click()
  await expect.poll(() => api.requests('vote').length).toBe(2)
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-busy', 'false')
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  expect(api.requests('session').length).toBe(2)
  expect(api.requests('vote').map((r) => r.body.pass)).toEqual(['pass-1', 'pass-2'])
  expect(await page.evaluate(() => window.__turnstileCalls.render)).toBe(2) // a fresh widget for the new token
  await expect(panel(page).locator('.banner')).toBeHidden()

  api.failNext('vote', 'pass_invalid', { times: 5 })
  await voteBtn(page, 'Keyboard shortcuts').click()
  await expect(panel(page).locator('.banner')).toHaveText(err('pass_invalid'))
  expect(api.requests('vote').length).toBe(4) // one try plus exactly one retry
})

// The test host runs on 127.0.0.1, where a box that does not answer switches the dialog to the local preview.
// These tests are about the real errors, so they turn the preview off as a site can.
const noPreview = (page) => page.addInitScript(() => { window.ArghBoxConfig = { localPreview: false } })

test('server down, HTML error page, slow server, list failure with retry', async ({ page, servers, api }) => {
  await noPreview(page)
  api.set({ down: true })
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page).locator('.empty')).toContainText(err('network'))
  api.set({ down: 'html' })
  await panel(page).getByRole('button', { name: 'Try again' }).click()
  await expect(panel(page).locator('.empty')).toContainText(err('server_error'))
  api.set({ down: false, slowMs: 700 })
  await panel(page).getByRole('button', { name: 'Try again' }).click()
  await expect(panel(page)).toContainText('Loading...')
  await expect(card(page, 'Dark mode')).toBeVisible()
  // slow vote: busy state, then done
  const btn = voteBtn(page, 'Dark mode')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-busy', 'true')
  await expect(btn).toHaveAttribute('aria-busy', 'false', { timeout: 8000 })
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  api.set({ slowMs: 0, down: true })
  await btn.click()
  await expect(panel(page).locator('.banner')).toHaveText(err('network'))
  await expect(btn).toHaveAttribute('aria-pressed', 'true') // rolled back to the previous state
})

test('local preview: on a local host with no box, sample entries, a note and working votes and adds; nothing kept', async ({ page, servers, api }) => {
  const urls = []
  page.on('request', (r) => urls.push(r.url()))
  api.set({ down: true })
  await load(page, servers)
  await tab(page).click()
  const wel = panel(page).locator('.wel')
  await expect(wel).toContainText('Local preview: no ArghBox server answered at')
  await expect(wel).toContainText('nothing is saved')
  await expect(wel.getByRole('link')).toHaveAttribute('href', 'https://github.com/BinaryBananaLLC/ArghBox/blob/main/docs/install.md#test-on-your-computer')
  await expect(card(page, 'Export my results as CSV')).toBeVisible()
  await expect(panel(page).locator('.empty')).toHaveCount(0) // no error message
  expect(urls.filter((u) => /arghbox-preview\.js\?v=0\.1\.2$/.test(u))).toHaveLength(1)

  const btn = voteBtn(page, 'Export my results as CSV')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(btn).toHaveAttribute('aria-busy', 'false')
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Preview entry from a test')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, it is listed.')
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await expect(card(page, 'Preview entry from a test')).toBeVisible()

  expect(await page.evaluate(() => localStorage.getItem('arghbox:receipts'))).toBe(null) // no receipts to confuse a real box later
  expect(urls.filter((u) => /challenges\.cloudflare\.com/.test(u))).toEqual([]) // no Turnstile in the preview
  expect(api.requests('add')).toHaveLength(0)
  expect(api.requests('vote')).toHaveLength(0)
})

test('local preview: an answer that is not ArghBox (an HTML page) says so; a JSON error from a real box does not switch', async ({ page, servers, api }) => {
  api.set({ down: 'html' })
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page).locator('.wel')).toContainText('was not ArghBox (is PHP running there?)')
  await expect(card(page, 'Export my results as CSV')).toBeVisible()

  api.set({ down: false })
  api.failNext('list', 'server_error')
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page).locator('.empty')).toContainText(err('server_error'))
  await expect(card(page, 'Export my results as CSV')).toHaveCount(0)
})

test('Turnstile blocked: the list still works, voting and adding show a friendly message', async ({ page, servers }) => {
  await page.route(CF, (route) => route.abort())
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(panel(page).locator('.banner')).toHaveText(err('turnstile_unavailable'))
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'false')
  await expect(card(page, 'Keyboard shortcuts')).toBeVisible()
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Something worth saying')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('.banner')).toHaveText(err('turnstile_unavailable'))
  await expect(panel(page).getByRole('button', { name: 'Send idea' })).toBeEnabled()
})

test('no Turnstile site key: friendly "not set up" message', async ({ page, servers, api }) => {
  api.set({ turnstileKey: '' })
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(panel(page).locator('.banner')).toHaveText(err('turnstile_not_configured'))
})

// ---------------------------------------------------------------- dialog behaviour

test('dialog semantics, focus trap, Esc, backdrop and focus return', async ({ page, servers }, info) => {
  test.skip(info.project.name === 'webkit-phone', WEBKIT_TAB)
  await load(page, servers)
  await page.locator('#host-btn').focus()
  await page.evaluate(() => ArghBox.open())
  const dlg = panel(page)
  await expect(dlg).toHaveAttribute('role', 'dialog')
  await expect(dlg).toHaveAttribute('aria-modal', 'true')
  await expect(dlg).toHaveAttribute('aria-labelledby', 'ab-title')
  await expect(dlg.locator('#ab-title')).toHaveText('Ideas, bugs and questions')
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
  const insideDialog = () => page.evaluate(() => {
    const a = document.getElementById('arghbox-root').shadowRoot.activeElement
    return document.activeElement.id === 'arghbox-root' && !!a && !!a.closest('.panel')
  })
  expect(await insideDialog()).toBe(true)
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); expect(await insideDialog()).toBe(true) }
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Shift+Tab'); expect(await insideDialog()).toBe(true) }
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
  await expect(page.locator('#host-btn')).toBeFocused() // focus returns to the element that had it
  expect((await events(page)).filter((e) => e.name === 'close').length).toBe(1)

  await tab(page).click() // opened from the tab: focus goes back to the tab
  await expect(dlg.locator('h2')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
  expect(await page.evaluate(() => document.getElementById('arghbox-root').shadowRoot.activeElement.className)).toBe('t')

  await page.evaluate(() => ArghBox.open())
  await expect(dlg).toBeVisible()
  if (isPhone(info)) {
    await dlg.getByRole('button', { name: 'Close', exact: true }).click()
  } else {
    await page.mouse.click(40, 300) // the backdrop
  }
  await expect(dlg).toHaveCount(0)
  // the close button also works on desktop
  await page.evaluate(() => ArghBox.open())
  await dlg.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dlg).toHaveCount(0)
})

test('a text selection dragged out of a field onto the backdrop does not close the dialog; a click there does', async ({ page, servers }, info) => {
  test.skip(isPhone(info), 'phones show a full-screen sheet with no backdrop')
  await load(page, servers)
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  const title = panel(page).getByLabel('Title', { exact: true })
  const body = panel(page).getByLabel('Details (optional)')
  await title.fill('test')
  await body.fill('select me')
  for (const field of [title, body]) {
    const b = await field.boundingBox()
    await page.mouse.move(b.x + b.width - 6, b.y + 12) // press in the field, select leftwards and let go over the backdrop
    await page.mouse.down()
    await page.mouse.move(b.x + 4, b.y + 12, { steps: 4 })
    await page.mouse.move(40, 300, { steps: 6 })
    await page.mouse.up()
    await expect(panel(page)).toBeVisible()
  }
  await expect(title).toHaveValue('test')
  const b = await title.boundingBox() // the other way round: pressed on the backdrop, let go in the panel
  await page.mouse.move(40, 300)
  await page.mouse.down()
  await page.mouse.move(b.x + 10, b.y + 12, { steps: 6 })
  await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  await page.mouse.click(40, 300, { button: 'right' }) // not a click
  await expect(panel(page)).toBeVisible()
  await page.mouse.click(40, 300)
  await expect(panel(page)).toHaveCount(0)
})

test('an unsent draft survives an accidental close: the tab reopens the form; Enter in the title goes on to the details, Ctrl+Enter sends', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  const title = panel(page).getByLabel('Title', { exact: true })
  await title.fill('Export to CSV')
  await title.press('Enter')
  await expect(panel(page).getByLabel('Details (optional)')).toBeFocused()
  await page.keyboard.type('From the report page.')
  // Esc while an input method is composing belongs to the input method, not the dialog
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true })))
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await tab(page).click()
  await expect(panel(page).getByLabel('Title', { exact: true })).toHaveValue('Export to CSV')
  await expect(panel(page).getByLabel('Details (optional)')).toHaveValue('From the report page.')
  expect(api.requests('add').length).toBe(0)
  await page.keyboard.press('Control+Enter')
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
  expect(api.last('add')).toMatchObject({ title: 'Export to CSV', body: 'From the report page.' })
  await page.keyboard.press('Escape')
  await tab(page).click() // sent: the tab opens the list again
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
})

test('focus is trapped in the add form and the detail view too', async ({ page, servers }, info) => {
  test.skip(info.project.name === 'webkit-phone', WEBKIT_TAB)
  await load(page, servers)
  await page.evaluate(() => ArghBox.open({ view: 'add' }))
  await expect(panel(page).getByLabel('Title', { exact: true })).toBeFocused()
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.getElementById('arghbox-root').shadowRoot.activeElement?.closest('.panel'))).toBe(true)
  }
})

test('opening does not scroll or restyle the host page, adds no layout shift and no globals', async ({ page, servers }) => {
  await page.goto(hostUrl(servers, 'plain', { widget: '0' }))
  const bare = await page.evaluate(() => Object.getOwnPropertyNames(window))
  await load(page, servers)
  await expect(tab(page)).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 600))
  const snap = () => page.evaluate(() => {
    const cs = (el) => { const s = getComputedStyle(el); return ['fontSize', 'color', 'backgroundColor', 'margin', 'padding', 'display', 'position', 'overflow', 'lineHeight'].map((k) => s[k]).join('|') }
    return {
      body: cs(document.body), title: cs(document.getElementById('host-title')), btn: cs(document.getElementById('host-btn')), html: cs(document.documentElement),
      bodyStyleAttr: document.body.getAttribute('style'), htmlStyleAttr: document.documentElement.getAttribute('style'),
      scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, bodyClass: document.body.className,
    }
  })
  const before = await snap()
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  expect(await snap()).toEqual(before)
  await page.keyboard.press('Escape')
  expect(await snap()).toEqual(before)
  const kids = await page.evaluate(() => [...document.body.children].map((e) => e.id || e.tagName).filter((x) => !['host-header', 'top'].includes(x)))
  expect(kids.filter((x) => x !== 'SCRIPT').sort()).toEqual(['arghbox-root']) // the Turnstile box lives inside the root, and only during a challenge
  const after = await page.evaluate(() => Object.getOwnPropertyNames(window))
  const added = after.filter((k) => !bare.includes(k) && !k.startsWith('__ev') && k !== '__cls')
  expect(added.sort()).toEqual(['ArghBox', '__arghboxApp', '__turnstileCalls', '__turnstileLastRender', 'turnstile'].sort()) // the last three belong to the Turnstile stub
  expect(await page.evaluate(() => window.__cls)).toBe(0)
})

// ---------------------------------------------------------------- host CSS isolation

test('hostile host CSS does not change the widget, and the widget does not change the host', async ({ page, servers }, info) => {
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'lineHeight', 'letterSpacing', 'textTransform', 'display', 'borderTopWidth', 'borderRadius', 'padding', 'margin', 'width', 'height']
  await page.emulateMedia({ reducedMotion: 'reduce' }) // no slide-in to wait for
  const sample = async (url) => {
    await page.goto(url)
    await tab(page).click()
    await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
    const styles = await page.evaluate((p) => {
      const out = {}
      const root = document.getElementById('arghbox-root').shadowRoot
      for (const sel of ['.panel', 'h2', '.sub', '.card .tt', '.card .ex', '.bd', '.vote', '.pri', '.q', '.tabs button', '.chip', '.ch', '.mine, .items']) {
        const el = root.querySelector(sel)
        if (!el) continue
        const s = getComputedStyle(el)
        out[sel] = p.map((k) => s[k]).join('|')
      }
      return out
    }, props)
    const b = await panel(page).boundingBox() // inset: the rounded corners show the page behind
    const shot = await page.screenshot({ animations: 'disabled', clip: { x: b.x + 20, y: b.y + 20, width: b.width - 40, height: b.height - 40 } })
    await page.keyboard.press('Escape')
    const tabStyle = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('arghbox-root').shadowRoot.querySelector('.t')); return [s.fontSize, s.color, s.letterSpacing, s.backgroundColor, s.display].join('|') })
    return { styles, shot, tabStyle }
  }
  const plain = await sample(hostUrl(servers, 'plain'))
  const hostile = await sample(hostUrl(servers, 'hostile'))
  expect(hostile.styles).toEqual(plain.styles)
  expect(hostile.tabStyle).toEqual(plain.tabStyle)
  if (Buffer.compare(hostile.shot, plain.shot) !== 0) { fs.writeFileSync(info.outputPath('hostile-a.png'), plain.shot); fs.writeFileSync(info.outputPath('hostile-b.png'), hostile.shot) }
  expect(Buffer.compare(hostile.shot, plain.shot)).toBe(0) // pixel identical dialog

  // the hostile page really is hostile
  const hostileDiv = await page.evaluate(() => getComputedStyle(document.getElementById('host-header')).zIndex)
  expect(hostileDiv).toBe('2147482999')

  // widget is above the sticky header (z-index 2147482999) and px sizes ignore html { font-size: 10px }
  await tab(page).click()
  await expect(panel(page)).toBeVisible()
  const top = await page.evaluate(() => { const r = document.getElementById('arghbox-root').shadowRoot.querySelector('.panel').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + 8); return e && e.id })
  expect(top).toBe('arghbox-root')
  expect(await panel(page).locator('.card .tt').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px')

  // host elements keep their (hostile) look after the widget ran
  const hostBtn = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('host-btn')); return [s.fontSize, s.backgroundColor, s.color].join('|') })
  expect(hostBtn).toBe('30px|rgb(255, 0, 0)|rgb(255, 255, 0)')
})

// ---------------------------------------------------------------- themes

test('data-theme: light, dark, auto (follows the color scheme live), host (follows html.dark and data-theme)', async ({ page, servers }) => {
  const bg = () => panel(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  const LIGHT = 'rgb(255, 255, 255)'
  const DARK = 'rgb(31, 22, 19)' // the brand's night
  await page.emulateMedia({ colorScheme: 'dark' })
  await load(page, servers, { 'data-theme': 'light' })
  await openDialog(page)
  expect(await bg()).toBe(LIGHT)
  await load(page, servers, { 'data-theme': 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await openDialog(page)
  expect(await bg()).toBe(DARK)

  await load(page, servers, { 'data-theme': 'auto' })
  await openDialog(page)
  expect(await bg()).toBe(LIGHT)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(bg).toBe(DARK)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(bg).toBe(LIGHT)

  await page.goto(hostUrl(servers, 'dark', { 'data-theme': 'host' }))
  await openDialog(page)
  expect(await bg()).toBe(LIGHT)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect.poll(bg).toBe(DARK)
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await expect.poll(bg).toBe(LIGHT)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect.poll(bg).toBe(DARK)
})

test('data-accent colours the tab and primary buttons, including var(--host-var)', async ({ page, servers }) => {
  // Colours come back as color(srgb ...) or oklch(...): normalise through a canvas, and allow a rounding step.
  const rgb = (css) => page.evaluate((c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)) }, css)
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2)
  const tabBg = () => page.locator('#arghbox-root .tw').evaluate((el) => getComputedStyle(el).backgroundColor).then(rgb)
  // the tab uses the accent mixed 78% with black (contrast with white text); a dark accent keeps exactly that
  const mix = (c) => rgb('color-mix(in srgb, ' + c + ' 78%, #000)')
  await load(page, servers, { 'data-accent': '#2255cc' })
  expect(near(await tabBg(), await mix('#2255cc'))).toBe(true)
  await page.goto(hostUrl(servers, 'plain', { 'data-accent': 'var(--brand)' }))
  await page.addStyleTag({ content: ':root { --brand: #118833 }' })
  await expect.poll(async () => near(await tabBg(), await mix('#118833'))).toBe(true)
  await tab(page).click()
  await expect(panel(page).locator('.pri')).toBeVisible()
  const pri = await panel(page).locator('.pri').evaluate((el) => getComputedStyle(el).backgroundColor).then(rgb)
  expect(near(pri, await mix('#118833'))).toBe(true)
})

test('a light accent is darkened on the tab and the buttons until white text has 4.5:1', async ({ page, servers }) => {
  const rgb = (css) => page.evaluate((c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)) }, css)
  const ratioWithWhite = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, f, i) => s + f * [0.2126, 0.7152, 0.0722][i], 0)
  for (const accent of ['#ffb199', '#ffff00', '#00ff00', '#ffffff']) {
    await load(page, servers, { 'data-accent': accent })
    const tabBg = await rgb(await page.locator('#arghbox-root .tw').evaluate((el) => getComputedStyle(el).backgroundColor))
    expect(1.05 / (ratioWithWhite(tabBg) + 0.05), accent + ' tab').toBeGreaterThanOrEqual(4.5)
    await tab(page).click()
    const pri = await rgb(await panel(page).locator('.pri').evaluate((el) => getComputedStyle(el).backgroundColor))
    expect(1.05 / (ratioWithWhite(pri) + 0.05), accent + ' button').toBeGreaterThanOrEqual(4.5)
  }
})

test('hosts restyle the tab and the dialog with --arghbox-* custom properties; data-accent still wins for the accent', async ({ page, servers }) => {
  const rgb = (css) => page.evaluate((c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)) }, css)
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2)
  const mix = (c) => rgb('color-mix(in srgb, ' + c + ' 78%, #000)')
  const tabStyle = () => page.locator('#arghbox-root .tw').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, font: getComputedStyle(el).fontFamily }))
  await page.goto(hostUrl(servers, 'plain'))
  await page.addStyleTag({ content: ':root { --arghbox-accent: #2255cc; --arghbox-bg: #fdfdf0; --arghbox-fg: #102030; --arghbox-card: #e0f0ff; --arghbox-font: Georgia, serif }' })
  await expect.poll(async () => near(await rgb((await tabStyle()).bg), await mix('#2255cc'))).toBe(true)
  expect((await tabStyle()).font).toMatch(/Georgia/)
  await openDialog(page)
  const look = await panel(page).evaluate((p) => {
    const h2 = p.querySelector('h2'), tabs = p.querySelector('.tabs')
    return { bg: getComputedStyle(p).backgroundColor, fg: getComputedStyle(h2).color, font: getComputedStyle(h2).fontFamily, card: getComputedStyle(tabs).backgroundColor }
  })
  expect(look).toEqual({ bg: 'rgb(253, 253, 240)', fg: 'rgb(16, 32, 48)', font: 'Georgia, serif', card: 'rgb(224, 240, 255)' })
  // data-accent on the script tag is more specific than a host-wide --arghbox-accent
  await page.goto(hostUrl(servers, 'plain', { 'data-accent': '#118833' }))
  await page.addStyleTag({ content: ':root { --arghbox-accent: #2255cc }' })
  await expect.poll(async () => near(await rgb((await tabStyle()).bg), await mix('#118833'))).toBe(true)
  // a host variable named plain --accent no longer leaks into the widget
  await page.goto(hostUrl(servers, 'plain'))
  const before = (await tabStyle()).bg
  await page.addStyleTag({ content: ':root { --accent: #2255cc }' })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  expect((await tabStyle()).bg).toBe(before)
})

test('copy: plain words that name ideas, bugs and questions, and say no account is needed, in both tones', async ({ page, servers }) => {
  const sub = () => panel(page).locator('.sub')
  for (const tone of ['funny', 'neutral']) {
    await load(page, servers, { 'data-tone': tone })
    await openDialog(page)
    await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
    await expect(sub()).toHaveText('Suggest an idea, report a bug or ask a question about Demo Site. No account needed.')
    await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
    await expect(sub()).toHaveText(EN['add.subtitle'])
    for (const [type, title, send] of [['Idea', 'Suggest an idea', 'Send idea'], ['Bug', 'Report a bug', 'Send bug report'], ['Question', 'Ask a question', 'Send question']]) {
      await panel(page).getByLabel(type, { exact: true }).check()
      await expect(panel(page).locator('h2')).toHaveText(title)
      await expect(panel(page).locator('form button[type=submit]')).toHaveText(send)
    }
    await expect(panel(page)).not.toContainText(/\bargh(?!box)/i)
  }
})

// ---------------------------------------------------------------- variants

test('data-tab=off: no tab; ArghBox.open() and #arghbox still work', async ({ page, servers }) => {
  await load(page, servers, { 'data-tab': 'off' })
  await expect(page.locator('#arghbox-root')).toHaveCount(1)
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.evaluate(() => ArghBox.open())
  await expect(panel(page).locator('h2')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => ArghBox.showTab()) // explicit showTab() overrides data-tab=off
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
})

test('data-preview=on: tab appears only after the browser has opened a #arghbox URL once', async ({ page, servers }) => {
  await load(page, servers, { 'data-preview': 'on' })
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.reload()
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.goto(hostUrl(servers, 'plain', { 'data-preview': 'on' }, '#arghbox'))
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(page.url()).not.toContain('#')
  expect(await page.evaluate(() => localStorage.getItem('arghbox:preview'))).toBe('1')
  await page.keyboard.press('Escape')
  await page.goto(hostUrl(servers, 'plain', { 'data-preview': 'on' }))
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
})

test('events: ready, open, add, vote, close, dismiss fire with no visitor text in detail', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Question').check()
  await panel(page).getByLabel('Title', { exact: true }).fill('How do I export everything?')
  await panel(page).getByLabel('Details (optional)').fill('private words here')
  await panel(page).getByRole('button', { name: 'Send question' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
  await page.keyboard.press('Escape')
  await page.locator('#arghbox-root .x').click()
  const ev = await events(page)
  expect(ev.map((e) => e.name)).toEqual(['ready', 'open', 'vote', 'add', 'close', 'dismiss'])
  expect(ev.find((e) => e.name === 'add').detail).toEqual({ type: 'question' })
  expect(ev.find((e) => e.name === 'vote').detail).toEqual({ on: true })
  expect(JSON.stringify(ev)).not.toMatch(/export everything|private words|Dark mode/)
})

test('language: data-lang falls back to English when no translation exists; html lang is used', async ({ page, servers }) => {
  await page.goto(hostUrl(servers, 'plain', { htmllang: 'pl' }))
  await expect(tab(page)).toHaveText('Feedback')
  await openDialog(page)
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await page.evaluate(() => ArghBox.close())
  await load(page, servers, { 'data-lang': 'de-AT' })
  await openDialog(page)
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
})

test('credit link: shown by default, hidden by data-credit=off and by the server', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  const link = panel(page).getByRole('link', { name: 'Powered by ArghBox' })
  await expect(link).toHaveAttribute('href', 'https://arghbox.com/')
  await expect(link.locator('svg.mk path')).toHaveCount(4) // the ArghBox mascot in its colours (lid, lid shadow, front, ink) next to the words
  await expect(link).toHaveAttribute('rel', 'noopener')
  await expect(link).toHaveAttribute('target', '_blank')
  await load(page, servers, { 'data-credit': 'off' })
  await openDialog(page)
  await expect(panel(page).getByRole('link', { name: 'Powered by ArghBox' })).toHaveCount(0)
  api.set({ credit: false })
  await load(page, servers)
  await openDialog(page)
  await expect(panel(page).getByRole('link', { name: 'Powered by ArghBox' })).toHaveCount(0)
})

// ---------------------------------------------------------------- layout

test('desktop: ~420px panel on the tab side; phone: full-screen sheet with large touch targets', async ({ page, servers }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }) // no slide-in to wait for
  await load(page, servers)
  await openDialog(page)
  const vp = page.viewportSize()
  const box = await panel(page).boundingBox()
  const close = await panel(page).getByRole('button', { name: 'Close', exact: true }).boundingBox()
  expect(close.width).toBeGreaterThanOrEqual(44)
  expect(close.height).toBeGreaterThanOrEqual(44)
  if (isPhone(info)) {
    expect(Math.round(box.x)).toBe(0)
    expect(Math.round(box.y)).toBe(0)
    expect(Math.round(box.width)).toBe(vp.width)
    expect(Math.round(box.height)).toBe(vp.height)
    for (const sel of ['.vote', '.pri', '.tabs button', '.q', '.chip', '.ch']) {
      const b = await panel(page).locator(sel).first().boundingBox()
      expect(b.height, sel).toBeGreaterThanOrEqual(44)
    }
    expect((await panel(page).locator('.vote').first().boundingBox()).width).toBeGreaterThanOrEqual(44)
    await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
    for (const sel of ['#f-title', '#f-body']) expect(await panel(page).locator(sel).evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
    expect(await panel(page).locator('.ty span').first().boundingBox().then((b) => b.height)).toBeGreaterThanOrEqual(44)
  } else {
    expect(Math.round(box.width)).toBe(420)
    expect(Math.round(box.x + box.width)).toBe(vp.width - 12)
    await page.evaluate(() => ArghBox.close())
    await load(page, servers, { 'data-position': 'left' })
    await openDialog(page)
    expect(Math.round((await panel(page).boundingBox()).x)).toBe(12)
  }
})

test('reduced motion: no animation on the dialog', async ({ page, servers }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await load(page, servers)
  await openDialog(page)
  expect(await panel(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

// ---------------------------------------------------------------- screenshots for design review

for (const scheme of ['light', 'dark']) {
  test(`screenshots (${scheme})`, async ({ page, servers }, info) => {
    const shot = async (v) => { await page.screenshot({ path: info.outputPath(`widget-${scheme}-${v}.png`), animations: 'disabled' }) }
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await load(page, servers)
    await expect(tab(page)).toBeVisible()
    await shot('tab')
    await openDialog(page)
    await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
    await shot('list')
    await panel(page).locator('.ch').click()
    await expect(panel(page).locator('.ch')).toHaveAttribute('aria-expanded', 'true')
    await shot('list-closed')
    await card(page, 'Dark mode').click()
    await expect(panel(page).locator('h2')).toHaveText('Dark mode')
    await shot('detail')
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
    await panel(page).getByLabel('Title', { exact: true }).fill('dark mod')
    await expect(panel(page).locator('.sim')).toBeVisible()
    await shot('add')
    await panel(page).getByLabel('Title', { exact: true }).fill('a 3d globe')
    await expect(panel(page).locator('.sim')).toContainText('3D globe view')
    await shot('add-closed-similar')
  })
}

// ---------------------------------------------------------------- visitor QA fixes

test('credit: a slow list answer with credit:false still removes the footer link', async ({ page, servers, api }) => {
  api.set({ credit: false, slowMs: 700 })
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page).getByRole('link', { name: 'Powered by ArghBox' })).toBeVisible() // before the answer: the default
  await expect(card(page, 'Dark mode')).toBeVisible({ timeout: 8000 })
  await expect(panel(page).getByRole('link', { name: 'Powered by ArghBox' })).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await expect(panel(page).getByRole('link', { name: 'Powered by ArghBox' })).toHaveCount(0)
})

test('a fast human is never silently dropped as a robot: the form waits out the 2.5 s the server wants', async ({ page, servers, api }) => {
  api.set({ minFillMs: 2500 })
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Quick typist here')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).getByRole('button', { name: 'Sending...' })).toBeDisabled()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
  expect(api.last('add').elapsed_ms).toBeGreaterThanOrEqual(2500)
  expect(api.entries.some((e) => e.title === 'Quick typist here')).toBe(true) // really stored, not a fake success
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await expect(panel(page).locator('.mine')).toContainText('Quick typist here')
})

test('a hung server ends in the "cannot reach" message with a working retry, not a spinner forever', async ({ page, servers, api }) => {
  await noPreview(page)
  api.set({ slowMs: 120000 })
  await page.clock.install()
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page)).toContainText('Loading...')
  await page.clock.runFor(16000)
  await expect(panel(page).locator('.empty')).toContainText(err('network'))
  api.set({ slowMs: 0 })
  await panel(page).getByRole('button', { name: 'Try again' }).click()
  await page.clock.runFor(500)
  await expect(card(page, 'Dark mode')).toBeVisible()
})

test('tab click while the app script cannot load: a message appears, the next click works', async ({ page, servers }) => {
  let block = true
  await page.route('**/arghbox-app.js*', (route) => (block ? route.abort() : route.continue()))
  await load(page, servers)
  await tab(page).click()
  const msg = page.locator('#arghbox-root .m')
  await expect(msg).toHaveAttribute('role', 'alert')
  await expect(msg).toContainText('Could not load')
  await expect(tab(page)).not.toHaveAttribute('aria-busy', 'true')
  block = false
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
})

test('tab shows a busy state while the app script downloads', async ({ page, servers }) => {
  await page.route('**/arghbox-app.js*', async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue() })
  await load(page, servers)
  await tab(page).click()
  await expect(tab(page)).toHaveAttribute('aria-busy', 'true')
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(tab(page)).not.toHaveAttribute('aria-busy', 'true')
})

test('open() then close() before the app script arrived leaves the dialog closed', async ({ page, servers }) => {
  await page.route('**/arghbox-app.js*', async (route) => { await new Promise((r) => setTimeout(r, 500)); await route.continue() })
  await load(page, servers)
  const loaded = page.waitForResponse('**/arghbox-app.js*')
  await page.evaluate(() => { ArghBox.open(); ArghBox.close() })
  await loaded
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0))) // let the script's load handler run
  await expect(panel(page)).toHaveCount(0)
  await page.evaluate(() => ArghBox.open())
  await expect(panel(page).locator('h2')).toBeVisible()
})

test('open and close 20 times: one overlay, no leaked listeners, no duplicate elements', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.__listeners = 0
    const add = EventTarget.prototype.addEventListener
    const rem = EventTarget.prototype.removeEventListener
    const counted = (t, n) => (t === window && n === 'keydown') || (t === document && n === 'focusin')
    EventTarget.prototype.addEventListener = function (n, ...x) { if (counted(this, n)) window.__listeners++; return add.call(this, n, ...x) }
    EventTarget.prototype.removeEventListener = function (n, ...x) { if (counted(this, n)) window.__listeners--; return rem.call(this, n, ...x) }
  })
  await load(page, servers)
  await openDialog(page)
  await page.keyboard.press('Escape')
  const before = await page.evaluate(() => window.__listeners)
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => ArghBox.open())
    await page.evaluate(() => ArghBox.close())
  }
  await expect.poll(() => page.evaluate(() => window.__listeners)).toBe(before)
  await expect(panel(page)).toHaveCount(0)
  await page.evaluate(() => ArghBox.open())
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(await page.locator('#arghbox-root').count()).toBe(1)
  expect(await page.locator('#arghbox-root .ov').count()).toBe(1)
  expect(await page.locator('script[src*="arghbox-app"]').count()).toBe(0)
  expect(await page.evaluate(() => window.__listeners)).toBe(before + 2)
})

test('the tab and the dialog sit above a host cookie banner', async ({ page, servers }) => {
  await page.goto(hostUrl(servers, 'hashrouter'))
  const vp = page.viewportSize()
  const hit = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [x, y])
  const box = await page.locator('#arghbox-root .tw').boundingBox()
  expect(await hit(box.x + box.width / 2, box.y + box.height / 2)).toBe('arghbox-root')
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(await hit(vp.width / 2, vp.height - 10)).toBe('arghbox-root') // the banner is covered by the overlay
})

test('"Your posts": a very long word wraps, owner comments show in full, RTL text aligns right', async ({ page, servers, api }) => {
  api.set({ moderation: 'pending' })
  await load(page, servers)
  const long = 'W'.repeat(110)
  const addOne = async (title) => {
    await page.evaluate(() => ArghBox.open({ view: 'add' }))
    await panel(page).getByLabel('Title', { exact: true }).fill(title)
    await panel(page).getByRole('button', { name: 'Send idea' }).click()
    await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
    await page.evaluate(() => ArghBox.close())
  }
  await addOne(long)
  await addOne('مرحبا، أريد وضعاً ليلياً')
  const receipts = JSON.parse(await page.evaluate(() => localStorage.getItem('arghbox:receipts')))
  const comment = 'First line of a long owner comment. ' + 'More words to make it long. '.repeat(8) + 'THE END'
  api.setEntry(receipts[0], { state: 'published', comments: [{ body: comment, at: '2026-11-21T09:00:00Z' }] })
  await page.reload()
  await openDialog(page)
  const mine = panel(page).locator('.mine')
  await expect(mine).toHaveAttribute('open', '')
  const li = mine.locator('li', { hasText: long })
  const a = await li.boundingBox()
  const p = await panel(page).boundingBox()
  expect(a.x + a.width).toBeLessThanOrEqual(p.x + p.width + 1)
  expect(await mine.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await expect(li.locator('.ex')).toContainText('THE END') // not cut to two lines
  const rtl = mine.locator('li', { hasText: 'مرحبا' }).locator('span').first()
  expect(await rtl.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
})

test('RTL titles and bodies get direction auto in the list, the detail and the form', async ({ page, servers, api }) => {
  api.setEntry(4, { title: 'שלום, אני רוצה מצב כהה', body: 'עברית מימין לשמאל' })
  await load(page, servers)
  await openDialog(page)
  const dirOf = (loc) => loc.evaluate((el) => getComputedStyle(el).direction)
  expect(await dirOf(card(page, 'שלום').locator('.tt'))).toBe('rtl')
  expect(await dirOf(card(page, 'Dark mode').locator('.tt'))).toBe('ltr')
  await card(page, 'שלום').click()
  expect(await dirOf(panel(page).locator('.body'))).toBe('rtl')
  expect(await dirOf(panel(page).locator('h2'))).toBe('rtl')
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('مرحبا بكم')
  expect(await dirOf(panel(page).locator('#f-title'))).toBe('rtl')
})

test('HTML and script in titles, bodies and owner comments show as text everywhere', async ({ page, servers, api }) => {
  const evil = '<img src=x onerror="window.__pwned=1"> <b>bold</b>'
  api.setEntry(1, { title: evil, body: '<script>window.__pwned=1</script> & "q"', aliases: [evil], comments: [{ body: `Hi ${evil} https://example.com/a_(b).`, at: '2026-11-21T09:00:00Z' }] })
  await load(page, servers)
  await openDialog(page)
  await card(page, 'bold').click()
  await expect(panel(page).locator('h2')).toHaveText(evil)
  await expect(panel(page).locator('.body')).toContainText('<script>window.__pwned=1</script> & "q"')
  await expect(panel(page).locator('.cm a')).toHaveAttribute('href', 'https://example.com/a_(b)')
  expect(await panel(page).locator('img, script, .dt b:not(.n)').count()).toBe(0)
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined()
})

test('add form: more than 2 links is explained before sending, and nothing is sent', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Links http://a.example http://b.example')
  await panel(page).getByLabel('Details (optional)').fill('and www.c.example too')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('#e-title')).toHaveText(EN['err.links'].replace('{n}', '2'))
  await expect(panel(page).getByLabel('Title', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(panel(page).getByLabel('Title', { exact: true })).toBeFocused()
  expect(api.requests('add').length).toBe(0)
})

test('Turnstile blocked: the add form says so on arrival, before the visitor types a report', async ({ page, servers }) => {
  await page.route(CF, (route) => route.abort())
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await expect(panel(page).locator('.banner')).toHaveText(err('turnstile_unavailable'))
})

test('i18n file fails to load: the fallback dialog offers a retry that works', async ({ page, servers }) => {
  let block = true
  await page.route('**/i18n/en.json*', (route) => (block ? route.abort() : route.continue()))
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page)).toContainText('Could not load')
  block = false
  await panel(page).getByRole('button', { name: 'Try again' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions')
  await expect(card(page, 'Dark mode')).toBeVisible()
})

test('wheel over the backdrop, header or footer does not scroll the host page behind the dialog', async ({ page, servers }, info) => {
  test.skip(isPhone(info), 'wheel is a desktop input')
  await load(page, servers)
  await openDialog(page)
  const vp = page.viewportSize()
  await page.mouse.move(100, vp.height / 2)
  await page.mouse.wheel(0, 500)
  const foot = await panel(page).locator('.ft').boundingBox()
  await page.mouse.move(foot.x + foot.width / 2, foot.y + foot.height - 4)
  await page.mouse.wheel(0, 500)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const sc = await panel(page).locator('.sc').boundingBox()
  await page.mouse.move(sc.x + sc.width / 2, sc.y + sc.height / 2)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => panel(page).locator('.sc').evaluate((el) => el.scrollTop)).toBeGreaterThan(0) // the list itself still scrolls
})

test('a host accent that is too light is darkened until white button text passes AA, in light and dark', async ({ page, servers }) => {
  const contrast = (loc) => loc.evaluate((el) => {
    const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] }
    const ctx = document.createElement('canvas').getContext('2d')
    const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)) }
    const cs = getComputedStyle(el)
    const a = lum(rgb(cs.color))
    const b = lum(rgb(cs.backgroundColor))
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await load(page, servers, { 'data-accent': '#ffb199' })
    await openDialog(page)
    expect(await contrast(panel(page).getByRole('button', { name: 'Add an idea, bug or question' }))).toBeGreaterThanOrEqual(4.5)
    await panel(page).locator('.chip').first().click()
    expect(await contrast(panel(page).locator('.chip[aria-pressed=true]'))).toBeGreaterThanOrEqual(4.5)
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await load(page, servers) // the brand colour is left as designed
  await openDialog(page)
  const bg = await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe(await page.locator('#arghbox-root .tw').evaluate((el) => getComputedStyle(el).backgroundColor))
})

test('phone: tag chips scroll sideways in one row so the list starts above the fold', async ({ page, servers }, info) => {
  test.skip(!isPhone(info), 'phone layout')
  await load(page, servers)
  await openDialog(page)
  const chips = panel(page).locator('.chips')
  if (await chips.isVisible()) {
    expect((await chips.boundingBox()).height).toBeLessThan(80)
  }
  const first = await card(page, 'Dark mode').boundingBox()
  expect(first.y + 60).toBeLessThan(page.viewportSize().height)
})

test('thanks view: a check mark, centred text, and the same two buttons', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('A thankful idea')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.')
  await expect(panel(page).locator('.thx .ok')).toBeVisible()
  await expect(panel(page).locator('.thx .ok')).toHaveAttribute('aria-hidden', 'true')
  await expect(panel(page).getByRole('button', { name: 'Back to the list' })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Add another' })).toBeVisible()
})

test('Esc in a filled search box clears it first; a second Esc closes the dialog', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const q = panel(page).getByRole('searchbox')
  await q.fill('dark')
  await expect(card(page, 'Keyboard shortcuts')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(1)
  await expect(q).toHaveValue('')
  await expect(card(page, 'Keyboard shortcuts')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
})

test('slow network: the empty sheet shows a spinner (no words yet) until the language file arrives', async ({ page, servers }) => {
  await page.route('**/i18n/en.json*', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue() })
  await load(page, servers)
  await tab(page).click()
  await expect(panel(page)).toHaveAttribute('aria-busy', 'true')
  expect(await panel(page).evaluate((el) => getComputedStyle(el, '::after').content)).not.toBe('none')
  await expect(panel(page).locator('h2')).toHaveText('Ideas, bugs and questions', { timeout: 8000 })
  expect(await panel(page).evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none')
})

// ---------------------------------------------------------------- host-page safety (strict hosts, odd startup, body swaps)

const watchViolations = (page) => page.addInitScript(() => {
  window.__csp = []
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
})
const noErrors = (page) => {
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  return errs
}

test('a hash router host: a #arghbox link opens the dialog without touching the URL or the history, no "not found" flash', async ({ page, servers }) => {
  await page.goto(hostUrl(servers, 'hashrouter', {}, '#/settings'))
  await expect(page.locator('#route')).toHaveText('settings')
  const len = await page.evaluate(() => history.length)
  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/settings')
  expect(await page.evaluate(() => history.length)).toBe(len) // no dead Back entry
  await expect(page.locator('#route')).toHaveText('settings')
  expect(await page.locator('#routes-seen').textContent()).not.toContain('#arghbox') // the host router never saw it
  await page.keyboard.press('Escape')
  // a script that sets the hash: the host's route is put back
  await page.evaluate(() => { location.hash = '#arghbox' })
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect.poll(() => new URL(page.url()).hash).toBe('#/settings')
  await page.keyboard.press('Escape')
  // landing on #arghbox: opened, and the hash is gone
  await page.goto('about:blank')
  await page.goto(hostUrl(servers, 'hashrouter', {}, '#arghbox'))
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(page.url()).not.toContain('#')
})

test('a link to another page that happens to end in #arghbox is left alone', async ({ page, servers }) => {
  await page.goto(hostUrl(servers, 'hashrouter', {}, '#/home'))
  await page.evaluate(() => {
    const a = document.createElement('a')
    a.id = 'elsewhere'
    a.href = '/other.html#arghbox'
    a.textContent = 'elsewhere'
    document.body.prepend(a)
    a.addEventListener('click', (e) => e.preventDefault())
  })
  await page.locator('#elsewhere').click()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await expect(panel(page)).toHaveCount(0)
})

test('strict CSP host (no inline script or style, same-origin and Turnstile only): everything works, no violation', async ({ page, servers, api }) => {
  await watchViolations(page)
  const errs = noErrors(page)
  await page.goto(hostUrl(servers, 'csp-strict'))
  await expect(tab(page)).toBeVisible()
  await page.locator('#open-link').click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Strict hosts deserve feedback too')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
  expect(api.requests('add').length).toBe(1)
  expect(await page.evaluate(() => window.__csp)).toEqual([])
  expect(errs).toEqual([])
})

test('nonce-only CSP host: the loader hands its nonce to the app script and to Turnstile', async ({ page, servers }) => {
  await watchViolations(page)
  const errs = noErrors(page)
  await page.goto(hostUrl(servers, 'csp-nonce'))
  await tab(page).click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__csp)).toEqual([])
  expect(errs).toEqual([])
})

test('Trusted Types host: no innerHTML, script URLs go through the "arghbox" policy', async ({ page, servers }, info) => {
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'Trusted Types enforcement is a Chromium feature')
  await watchViolations(page)
  const errs = noErrors(page)
  await page.goto(hostUrl(servers, 'trusted-types'))
  await expect(tab(page)).toBeVisible()
  // the tab icon is built with createElementNS (no innerHTML), so it renders under Trusted Types too
  expect(await page.evaluate(() => document.querySelector('#arghbox-root').shadowRoot.querySelectorAll('.t svg path').length)).toBe(1)
  await tab(page).click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await expect(panel(page).locator('.vote .ic svg').first()).toBeVisible()
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__csp)).toEqual([])
  expect(errs).toEqual([])
})

test('loader in <head> without defer: waits for the body, and the API is safe to call before that', async ({ page, servers }) => {
  const errs = noErrors(page)
  await page.addInitScript(() => { window.__early = null })
  await page.goto(`${servers.siteUrl}/head-sync.html`)
  await expect(tab(page)).toBeVisible()
  expect(await page.evaluate(() => window.__early)).toEqual({ type: 'function', promise: true })
  const box = await page.locator('#arghbox-root .tw').boundingBox()
  expect(box.x).toBe(0) // data-position=left was read although the script tag was gone from the stack
  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(errs).toEqual([])
})

test('loader with async in <head>: starts whether or not the body exists yet', async ({ page, servers }) => {
  const errs = noErrors(page)
  await page.goto(`${servers.siteUrl}/head-async.html`)
  await expect(tab(page)).toBeVisible()
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
  expect(await page.locator('#arghbox-root').count()).toBe(1)
  expect(errs).toEqual([])
})

test('a host page in windows-1250 without a charset on the scripts: the files are pure ASCII, nothing breaks', async ({ page, servers }) => {
  const errs = noErrors(page)
  await page.route((url) => url.pathname === '/windows-1250.html' || url.pathname.startsWith('/arghbox/'), async (route) => {
    const r = await route.fetch()
    const headers = { ...r.headers() }
    if (headers['content-type']) headers['content-type'] = headers['content-type'].split(';')[0] // no charset anywhere
    await route.fulfill({ response: r, headers })
  })
  await page.goto(`${servers.siteUrl}/windows-1250.html`)
  expect(await page.evaluate(() => document.characterSet.toLowerCase())).toBe('windows-1250')
  await expect(tab(page)).toHaveText('Feedback')
  await tab(page).click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await panel(page).getByRole('searchbox').fill('tryb ciemný') // alias "Tryb ciemny": the accent folding works
  await expect(card(page, 'Dark mode')).toBeVisible()
  await expect(card(page, 'Keyboard shortcuts')).toBeHidden()
  expect(errs).toEqual([])
})

test('storage blocked: the x still hides the tab for this page view, and the dialog works', async ({ page, servers }) => {
  const errs = noErrors(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })
  })
  await load(page, servers)
  await expect(tab(page)).toBeVisible()
  await page.locator('#arghbox-root .x').click()
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.evaluate(() => ArghBox.open())
  await expect(card(page, 'Dark mode')).toBeVisible()
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  expect(errs).toEqual([])
})

test('the host swaps its <body>: the tab and the dialog come back, the API keeps working', async ({ page, servers }) => {
  await load(page, servers)
  await expect(tab(page)).toBeVisible()
  await page.evaluate(() => { document.body.replaceWith(Object.assign(document.createElement('body'), { innerHTML: '<h1>New page</h1>' })) })
  await expect(page.locator('#arghbox-root')).toHaveCount(1)
  await expect(tab(page)).toBeVisible()
  await page.evaluate(() => { document.body.innerHTML = '<p>htmx swapped everything</p>' }) // children replaced, body kept
  await expect(page.locator('#arghbox-root')).toHaveCount(1)
  await expect(tab(page)).toBeVisible()
  await tab(page).click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => { document.body.innerHTML = '' })
  await page.evaluate(() => ArghBox.showTab())
  await expect(tab(page)).toBeVisible()
  await expect(page.locator('#arghbox-root')).toHaveCount(1)
})

test('the host swaps its <body> while the dialog is open: the dialog survives and the next challenge gets a fresh widget', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#arghbox-turnstile')).toHaveCount(0) // removed once the pass came
  await page.evaluate(() => { document.body.innerHTML = '<p>swapped</p>' })
  await expect(panel(page)).toBeVisible() // the dialog lives in the re-attached root
  api.expirePassOnce() // the next vote needs a new challenge
  await voteBtn(page, 'Keyboard shortcuts').click()
  await expect(voteBtn(page, 'Keyboard shortcuts')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__turnstileCalls.render)).toBe(2)
  await expect(page.locator('#arghbox-turnstile')).toHaveCount(0)
})

test('Turnstile gets action "arghbox" on render', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__turnstileLastRender.action)).toBe('arghbox')
})

const HOLDING_STUB = `
  window.__ts = { renders: 0, resets: 0, executes: 0, removes: 0 };
  window.turnstile = {
    render: function (el, o) { window.__o = o; window.__ts.renders++; return 'w1'; },
    execute: function () { window.__ts.executes++; if (window.__auto) { var o = window.__o; Promise.resolve().then(function () { o.callback('stub-token-' + window.__ts.executes); }); } else if (!window.__quiet) { window.__o['before-interactive-callback'](); } },
    reset: function () { window.__ts.resets++; }, remove: function () { window.__ts.removes++; }, getResponse: function () {}
  };`

test('closing the dialog during a Turnstile challenge hides it for good: a late callback never shows it again', async ({ page, servers }) => {
  await page.route(CF, (route) => route.fulfill({ contentType: 'application/javascript', body: HOLDING_STUB }))
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  const box = page.locator('#arghbox-turnstile')
  await expect(box).toBeVisible() // the visitor is asked to solve a challenge
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(box).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__ts.removes)).toBe(1) // the widget was removed, not left running
  await page.evaluate(() => window.__o['before-interactive-callback']()) // Cloudflare calls late
  await expect(box).toBeHidden()
  await page.evaluate(() => window.__o.callback('stub-token-late'))
  await expect(box).toBeHidden()
  // and the next visit starts clean
  await page.evaluate(() => { window.__auto = true })
  await page.evaluate(() => ArghBox.open())
  await expect(card(page, 'Dark mode')).toBeVisible()
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
})

test('a stale challenge timer never fails a later challenge', async ({ page, servers, api }) => {
  await page.route(CF, (route) => route.fulfill({ contentType: 'application/javascript', body: HOLDING_STUB }))
  await page.clock.install()
  await load(page, servers)
  await openDialog(page)
  await page.evaluate(() => { window.__auto = true })
  await voteBtn(page, 'Dark mode').click() // challenge 1
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-busy', 'false') // really done (the button is optimistic)
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  api.expirePassOnce()
  await voteBtn(page, 'Keyboard shortcuts').click() // challenge 2
  await expect(voteBtn(page, 'Keyboard shortcuts')).toHaveAttribute('aria-busy', 'false')
  await expect(voteBtn(page, 'Keyboard shortcuts')).toHaveAttribute('aria-pressed', 'true')
  await page.clock.fastForward(100000) // challenge 2's 120 s timer has 20 s left, if it was not cleared
  api.expirePassOnce()
  await page.evaluate(() => { window.__auto = false })
  await voteBtn(page, 'A print stylesheet').click() // challenge 3, waits for the visitor
  await expect(page.locator('#arghbox-turnstile')).toBeVisible()
  await page.clock.fastForward(30000) // the stale timer would fire now and fail challenge 3
  await expect(panel(page).locator('.banner')).toBeHidden()
  await expect(page.locator('#arghbox-turnstile')).toBeVisible()
  await page.evaluate(() => window.__o.callback('stub-token-late-but-fine'))
  await expect(voteBtn(page, 'A print stylesheet')).toHaveAttribute('aria-busy', 'false')
  await expect(panel(page).locator('.vote[aria-pressed=true]')).toHaveCount(3)
})

test('startup that bailed leaves a harmless API, and a second correct copy still starts', async ({ page, servers }) => {
  const errs = noErrors(page)
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow
    let calls = 0
    Element.prototype.attachShadow = function (...a) { if (calls++ === 0) throw new Error('no shadow dom here'); return original.apply(this, a) }
  })
  await load(page, servers)
  await expect(page.locator('#arghbox-root')).toHaveCount(0)
  const out = await page.evaluate(async () => {
    const r = { version: typeof ArghBox.version, errors: [] }
    for (const m of ['open', 'close', 'showTab', 'hideTab']) {
      try { const v = ArghBox[m](); r[m] = v instanceof Promise ? 'promise' : typeof v } catch (e) { r.errors.push(m + ': ' + e.message) }
    }
    return r
  })
  expect(out.errors).toEqual([])
  expect(out.version).toBe('string')
  expect(out.open).toBe('promise')
  // a corrected copy (for example a tag manager retrying) is not blocked by the failed one
  await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = '/arghbox/arghbox.js?v=0.1.2'
    s.onload = resolve
    document.head.appendChild(s)
  }))
  await expect(tab(page)).toBeVisible()
  await tab(page).click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  expect(await page.locator('#arghbox-root').count()).toBe(1)
  expect(errs).toEqual([])
})

test('the loader finds its own tag by the LAST arghbox.js script when currentScript is not available', async ({ page, servers }) => {
  await load(page, servers, { widget: '0' })
  const src = await (await page.request.get(`${servers.siteUrl}/arghbox/arghbox.js?v=0.1.2`)).text()
  await page.evaluate((code) => {
    for (const label of ['First', 'Last']) {
      const s = document.createElement('script')
      s.type = 'text/plain' // never executes, only to be found
      s.src = '/arghbox/arghbox.js?v=0.1.2'
      s.setAttribute('data-label', label)
      document.body.appendChild(s)
    }
    ;(0, eval)(code) // an indirect eval has no currentScript, like a tag manager that evals the file
  }, src)
  await expect(tab(page)).toHaveText('Last')
})

test('a language with no loader label falls back to the English label', async ({ page, servers }) => {
  await page.route('**/arghbox/arghbox.js*', async (route) => {
    const r = await route.fetch()
    const body = (await r.text()).replace('var LANGS = ["en"];', 'var LANGS = ["en","pl"];')
    await route.fulfill({ response: r, body })
  })
  await load(page, servers, { 'data-lang': 'pl' })
  await expect(tab(page)).toHaveText('Feedback')
})

// ---------------------------------------------------------------- the page recorded with an entry

async function openAddForm(page) {
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await expect(panel(page).getByLabel('Title', { exact: true })).toBeVisible()
}

// The form shows no page line; these tests read what the add request carries.
async function sendIdea(page, title) {
  await openAddForm(page)
  await panel(page).getByLabel('Title', { exact: true }).fill(title)
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
}

test('data-page records a fixed path instead of the real one, and wins over the hook', async ({ page, servers, api }) => {
  await page.addInitScript(() => { window.ArghBoxConfig = { redactPage: () => '/hooked' } })
  await load(page, servers, { 'data-page': '/account/reset' })
  await sendIdea(page, 'Fixed path please')
  expect(api.last('add').context.page).toBe('/account/reset')
})

test('redactPage can cut a token out of the path', async ({ page, servers, api }) => {
  await page.addInitScript(() => { window.ArghBoxConfig = { redactPage: (p) => p.split('.')[0] + '/:token' } })
  await load(page, servers)
  await sendIdea(page, 'Redacted path please')
  expect(api.last('add').context.page).toBe('/plain/:token')
})

test('redactPage returning an empty string records no page at all', async ({ page, servers, api }) => {
  await page.addInitScript(() => { window.ArghBoxConfig = { redactPage: () => '' } })
  await load(page, servers)
  await sendIdea(page, 'No page recorded')
  expect('page' in api.last('add').context).toBe(false)
})

test('a redactPage that throws or returns a non-path fails closed: no page, never the real one', async ({ page, servers, api }) => {
  await page.addInitScript(() => { window.ArghBoxConfig = { redactPage: () => { throw new Error('boom') } } })
  await load(page, servers)
  await sendIdea(page, 'Hook that throws')
  expect('page' in api.last('add').context).toBe(false)
  expect(JSON.stringify(api.last('add').context)).not.toContain('plain')
  await page.addInitScript(() => { window.ArghBoxConfig = { redactPage: () => 42 } })
  await load(page, servers)
  await sendIdea(page, 'Hook that returns a number')
  expect('page' in api.last('add').context).toBe(false)
})

// ---------------------------------------------------------------- server hiccups and friendly errors

test('busy (503 + Retry-After): one automatic retry, then a friendly message', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  api.failNext('vote', 'busy', { retry_after: 1, status: 503, times: 1 })
  await voteBtn(page, 'Dark mode').click()
  await expect.poll(() => api.requests('vote').length, { timeout: 8000 }).toBe(2) // one retry, as told by Retry-After
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-busy', 'false')
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true') // the retry worked
  await expect(panel(page).locator('.banner')).toBeHidden()
  api.failNext('vote', 'busy', { retry_after: 1, status: 503, times: 5 })
  await voteBtn(page, 'Keyboard shortcuts').click()
  await expect(panel(page).locator('.banner')).toHaveText(err('busy'), { timeout: 8000 })
  await expect(voteBtn(page, 'Keyboard shortcuts')).toHaveAttribute('aria-pressed', 'false') // rolled back
  expect(api.requests('vote').length).toBe(4) // exactly one retry per click
})

test('forbidden has friendly words and the vote is rolled back', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  api.failNext('vote', 'forbidden', { status: 403 })
  await voteBtn(page, 'Dark mode').click()
  await expect(panel(page).locator('.banner')).toHaveText(err('forbidden'))
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'false')
})

test('a pass is valid for expires_in seconds from the moment it arrived, whatever the visitor clock says', async ({ page, servers, api }) => {
  let sessions = 0
  await page.route('**/api.php?action=session', async (route) => {
    sessions++
    const r = await route.fetch()
    const j = await r.json()
    j.expires_at = '2001-01-01T00:00:00Z' // a visitor clock that is years ahead of the server
    j.expires_in = 1800
    await route.fulfill({ json: j })
  })
  await load(page, servers)
  await openDialog(page)
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await voteBtn(page, 'Keyboard shortcuts').click()
  await expect(voteBtn(page, 'Keyboard shortcuts')).toHaveAttribute('aria-pressed', 'true')
  expect(sessions).toBe(1)
  expect(api.requests('vote').length).toBe(2)
})

test('the honeypot field has a meaningless name that password managers leave alone, and is hidden from everyone', async ({ page, servers }) => {
  await load(page, servers)
  await openAddForm(page)
  const hp = panel(page).locator('.hp input')
  await expect(hp).toHaveAttribute('autocomplete', 'off')
  await expect(hp).toHaveAttribute('tabindex', '-1')
  await expect(hp).toHaveAttribute('aria-hidden', 'true')
  expect(await hp.getAttribute('name')).not.toMatch(/web|site|url|mail|name|phone|address|pass/i)
})

test('the vote button name carries its visible label (WCAG 2.5.3)', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const btn = voteBtn(page, 'Dark mode')
  await expect(btn).toHaveAttribute('aria-label', 'Dark mode, 14 Upvote')
  expect(await btn.locator('.vl').textContent()).toBe('Upvote')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-label', 'Dark mode, 15 Upvoted')
  expect(await btn.locator('.vl').textContent()).toBe('Upvoted')
})

test('copy: "Posted on" for every kind, a kind thanks line, punctuated suggestion header', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('tab', { name: 'Bugs' }).click()
  await card(page, 'KML export').click()
  await expect(panel(page).locator('.meta').first()).toContainText('Posted on')
  await expect(panel(page)).not.toContainText('Asked on')
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('dark mod')
  await expect(panel(page).locator('.sim h3')).toHaveText('Is it one of these? Vote for it instead.')
  await panel(page).getByLabel('Title', { exact: true }).fill('A kindly thanked idea')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('.thx p')).toHaveText('It shows up in the list once someone has had a look. Thanks for helping us improve Demo Site!')
  await expect(panel(page)).not.toContainText('Spam')
})

test('long words in aliases and the sub-line wrap instead of overflowing', async ({ page, servers, api }) => {
  api.setEntry(1, { aliases: ['A'.repeat(120)] })
  await load(page, servers)
  await openDialog(page)
  await card(page, 'Dark mode').click()
  const al = panel(page).locator('.al')
  await expect(al).toBeVisible()
  const sc = panel(page).locator('.sc')
  expect(await sc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})

// ---------------------------------------------------------------- performance with a big box

function bigBox(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 1000 + i, type: i % 5 === 0 ? 'bug' : 'idea', title: i % 50 === 1 ? `Zebra crossing ${i}` : `Entry number ${i} about topic ${i % 17}`, body: `A body for entry ${i}. `.repeat(6),
    votes: (i * 7) % 50, status: 'open', status_at: null, tags: [`t${i % 9}`], comments: [], similar: 0, aliases: [], source: 'visitor',
    state: 'published', created_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
  }))
}

test('500 entries: a keystroke, a tab switch and a vote stay fast', async ({ page, servers, api }) => {
  api.entries.push(...bigBox(500))
  await load(page, servers)
  await tab(page).click()
  await expect(page.locator('#arghbox-root .it').first()).toBeVisible({ timeout: 10000 })
  const timings = await page.evaluate(async () => {
    const root = document.querySelector('#arghbox-root').shadowRoot
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
    const waitFor = async (fn) => { const t0 = performance.now(); while (!fn()) await frame(); return performance.now() - t0 }
    const count = () => root.querySelectorAll('.it').length
    const out = { cards: count() }
    const q = root.querySelector('.q')
    q.value = 'zebra'
    const t0 = performance.now()
    q.dispatchEvent(new Event('input'))
    await waitFor(() => count() < out.cards)
    out.keystroke = performance.now() - t0
    q.value = ''
    q.dispatchEvent(new Event('input'))
    await waitFor(() => count() === out.cards)
    const bugs = [...root.querySelectorAll('[role=tab]')].find((b) => b.id === 'tab-bugs')
    const ideas = [...root.querySelectorAll('[role=tab]')].find((b) => b.id === 'tab-ideas')
    const t1 = performance.now()
    bugs.click()
    await waitFor(() => count() < out.cards)
    ideas.click()
    await waitFor(() => count() === out.cards)
    out.tabs = performance.now() - t1
    return out
  })
  expect(timings.cards).toBeGreaterThan(350)
  expect(timings.keystroke).toBeLessThan(700) // includes the 120 ms debounce
  expect(timings.tabs).toBeLessThan(900) // two full re-renders of ~500 cards
  const t0 = Date.now()
  await voteBtn(page, 'Entry number 3 about topic 3').click()
  await expect(voteBtn(page, 'Entry number 3 about topic 3')).toHaveAttribute('aria-pressed', 'true')
  expect(Date.now() - t0).toBeLessThan(3000)
})

test('the search is debounced: typing fast re-renders the list once', async ({ page, servers, api }) => {
  api.entries.push(...bigBox(200))
  await load(page, servers)
  await openDialog(page)
  const renders = await page.evaluate(async () => {
    const root = document.querySelector('#arghbox-root').shadowRoot
    const box = root.querySelector('#ab-panel')
    let n = 0
    new MutationObserver((recs) => { for (const r of recs) if (r.removedNodes.length) n++ }).observe(box, { childList: true }) // one clear = one paint
    const q = root.querySelector('.q')
    for (const v of ['e', 'en', 'ent', 'entr', 'entry']) { q.value = v; q.dispatchEvent(new Event('input')) }
    await new Promise((r) => setTimeout(r, 500))
    return n
  })
  expect(renders).toBe(1) // five keystrokes, one paint
})

// ---------------------------------------------------------------- re-initialising the loader, and data-tab-min-width

test('re-initialising the loader 5 times leaves one set of listeners: one hashchange opens one dialog once', async ({ page, servers }) => {
  await load(page, servers)
  await page.evaluate(() => {
    window.__opens = 0
    window.__readies = 0
    window.addEventListener('arghbox:open', () => window.__opens++)
    window.addEventListener('arghbox:ready', () => window.__readies++)
  })
  const reload = (i, reset) => page.evaluate(([n, del]) => new Promise((resolve) => {
    if (del) delete window.ArghBox // the host "resets" the widget
    const s = document.createElement('script')
    s.src = `/arghbox/arghbox.js?v=0.1.2&again=${n}`
    s.onload = () => resolve()
    document.head.appendChild(s)
  }), [i, reset])
  for (let i = 0; i < 3; i++) await reload(i, false) // a second copy while the first runs: ignored
  for (let i = 3; i < 8; i++) await reload(i, true) // a reset: the old instance is torn down first
  expect(await page.locator('#arghbox-root').count()).toBe(1)
  expect(await page.evaluate(() => window.__readies)).toBe(5)
  await page.evaluate(() => { location.hash = '#arghbox' })
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect(await page.evaluate(() => window.__opens)).toBe(1) // exactly one route
  expect(await page.locator('#arghbox-root .panel').count()).toBe(1)
  expect(await page.locator('#arghbox-turnstile').count()).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  // the live instance is the last one and still fully works
  await voteBtn(page, 'Dark mode').count()
  await tab(page).click()
  await expect(card(page, 'Dark mode')).toBeVisible()
  await voteBtn(page, 'Dark mode').click()
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
})

test('data-tab-min-width: no edge tab below that width, the other ways in keep working', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.__tab = []
    window.addEventListener('arghbox:tab', (e) => window.__tab.push(e.detail.visible))
  })
  await page.setViewportSize({ width: 360, height: 700 })
  await load(page, servers, { 'data-tab-min-width': '600' })
  const root = page.locator('#arghbox-root')
  await expect(root).toHaveCount(1)
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await expect(root).toHaveAttribute('data-tab', 'hidden')
  // still reachable: the API, a #arghbox link, showTab()
  await page.evaluate(() => ArghBox.open())
  await expect(panel(page).locator('h2')).toBeVisible()
  await page.evaluate(() => ArghBox.close())
  await expect(panel(page)).toHaveCount(0)
  await page.locator('#open-link').click()
  await expect(panel(page).locator('h2')).toBeVisible()
  await page.evaluate(() => ArghBox.close())
  await page.evaluate(() => ArghBox.showTab())
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
  await expect(root).toHaveAttribute('data-tab', 'shown')
  await page.evaluate(() => ArghBox.hideTab())
  await expect(root).toHaveAttribute('data-tab', 'hidden')
  await load(page, servers, { 'data-tab-min-width': '600' }) // hideTab() is a decision of the host; start clean for the resizing
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  // a wider viewport shows it, a narrower one hides it again (rotating a phone)
  await page.setViewportSize({ width: 1024, height: 700 })
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
  await expect(root).toHaveAttribute('data-tab', 'shown')
  await page.setViewportSize({ width: 599, height: 700 })
  await expect(page.locator('#arghbox-root .tw')).toBeHidden()
  await page.setViewportSize({ width: 600, height: 700 })
  await expect(page.locator('#arghbox-root .tw')).toBeVisible() // "below 600" hides, 600 itself shows
  expect((await page.evaluate(() => window.__tab)).length).toBeGreaterThan(3)
})

test('data-tab-min-width: a wide viewport shows the tab from the start, and 0 means always', async ({ page, servers }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await load(page, servers, { 'data-tab-min-width': '600' })
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
  await page.setViewportSize({ width: 360, height: 700 })
  await load(page, servers, { 'data-tab-min-width': '0' })
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
  await load(page, servers)
  await expect(page.locator('#arghbox-root .tw')).toBeVisible()
})

// ---------------------------------------------------------------- accessibility audit (axe-core, vendored, dev-only)

const AXE = fs.readFileSync(path.join(repoRoot, 'e2e', 'support', 'vendor', 'axe.min.js'), 'utf8')

// Runs axe on the whole page (it enters the open shadow root) and returns readable violations.
async function axeViolations(page, label) {
  if ((await page.evaluate(() => typeof window.axe)) === 'undefined') await page.addScriptTag({ content: AXE })
  const found = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      resultTypes: ['violations'],
    })
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(' > ')} ${(n.any[0] || n.all[0] || n.none[0] || {}).message || ''}`).join(' | ').slice(0, 400)}`)
  })
  return found.map((f) => `${label}: ${f}`)
}

async function auditEveryView(page, servers, params) {
  const found = []
  await page.goto(hostUrl(servers, 'plain', params))
  await expect(tab(page)).toBeVisible()
  found.push(...(await axeViolations(page, 'closed')))
  await openDialog(page)
  found.push(...(await axeViolations(page, 'list')))
  await panel(page).locator('.chip').first().click()
  found.push(...(await axeViolations(page, 'list filtered by a tag')))
  await panel(page).locator('.chip[aria-pressed=true]').click()
  await panel(page).locator('.ch').click()
  found.push(...(await axeViolations(page, 'list with closed entries')))
  await card(page, 'Dark mode').click()
  await expect(panel(page).locator('h2')).toHaveText('Dark mode')
  found.push(...(await axeViolations(page, 'detail')))
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  found.push(...(await axeViolations(page, 'add, empty')))
  await panel(page).getByLabel('Title', { exact: true }).fill('abc')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('#e-title')).toBeVisible()
  found.push(...(await axeViolations(page, 'add, with a field error')))
  await panel(page).getByLabel('Title', { exact: true }).fill('dark mod')
  await expect(panel(page).locator('.sim')).toBeVisible()
  found.push(...(await axeViolations(page, 'add, with suggestions')))
  await panel(page).getByLabel('Title', { exact: true }).fill('An idea that passes the audit')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
  found.push(...(await axeViolations(page, 'thanks')))
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await expect(panel(page).locator('.mine')).toBeVisible()
  await panel(page).locator('.mine summary').click()
  found.push(...(await axeViolations(page, 'your arghs')))
  return found
}

for (const scheme of ['light', 'dark']) {
  test(`axe-core: no violations on any view (${scheme})`, async ({ page, servers }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    expect(await auditEveryView(page, servers, {})).toEqual([])
  })
}

test('axe-core: a very light, a very dark and a neon accent still pass (tab, buttons, badges)', async ({ page, servers, api }) => {
  api.setEntry(5, { source: 'owner' }) // keep the "From the team" badge in the audit
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    for (const accent of ['#ffb199', '#003366', '#00ff00', '#ffff00']) {
      await page.goto(hostUrl(servers, 'plain', { 'data-accent': accent }))
      await expect(tab(page)).toBeVisible()
      const found = await axeViolations(page, `${scheme} ${accent} closed`)
      await openDialog(page)
      found.push(...(await axeViolations(page, `${scheme} ${accent} list`)))
      await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
      found.push(...(await axeViolations(page, `${scheme} ${accent} add`)))
      expect(found).toEqual([])
    }
  }
})

// ---------------------------------------------------------------- stacking (data-z) and the ready event

test('data-z sets the stacking value: above a host element with a lower z-index, below a higher one', async ({ page, servers }) => {
  const hitAtTab = async () => page.evaluate(() => {
    const t = document.querySelector('#arghbox-root').shadowRoot.querySelector('.tw').getBoundingClientRect()
    const el = document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2)
    return el && (el.id || el.className)
  })
  const cover = (z) => page.evaluate((zi) => {
    document.querySelectorAll('.cover').forEach((n) => n.remove())
    const d = document.createElement('div')
    d.className = 'cover'
    d.style.cssText = `position:fixed;inset:0;z-index:${zi};background:rgba(0,0,0,.01)`
    document.body.appendChild(d)
  }, z)
  await load(page, servers, { 'data-z': '5000' })
  await expect(tab(page)).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('arghbox-root')).zIndex)).toBe('5000')
  await cover(4999)
  expect(await hitAtTab()).toBe('arghbox-root') // above the lower element
  await cover(5001)
  expect(await hitAtTab()).toBe('cover') // below the higher one: the host's element is hit
  // the dialog and its backdrop follow the same value
  await page.evaluate(() => document.querySelectorAll('.cover').forEach((n) => n.remove()))
  await openDialog(page)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#arghbox-root').shadowRoot.querySelector('.ov')).zIndex)).toBe('5001')
  // the default sits at the top of the usual range, above a typical cookie banner
  await load(page, servers)
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('arghbox-root')).zIndex)).toBe('2147483000')
  await cover(99999)
  expect(await hitAtTab()).toBe('arghbox-root')
})

test('arghbox:ready fires once per successful start, never on a bailed start', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.__ready = 0
    window.addEventListener('arghbox:ready', () => window.__ready++)
  })
  await load(page, servers)
  await expect(tab(page)).toBeVisible()
  expect(await page.evaluate(() => window.__ready)).toBe(1)
  // a second copy of the loader while the first one runs: no second start, no second event
  await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = '/arghbox/arghbox.js?v=0.1.2&again=1'
    s.onload = resolve
    document.head.appendChild(s)
  }))
  expect(await page.evaluate(() => window.__ready)).toBe(1)
  expect(await page.locator('#arghbox-root').count()).toBe(1)
})

test('arghbox:ready is not fired when startup bails, and fires once for the copy that works', async ({ page, servers }) => {
  await page.addInitScript(() => {
    window.__ready = 0
    window.addEventListener('arghbox:ready', () => window.__ready++)
    const original = Element.prototype.attachShadow
    let calls = 0
    Element.prototype.attachShadow = function (...a) { if (calls++ === 0) throw new Error('no shadow dom here'); return original.apply(this, a) }
  })
  await load(page, servers)
  await expect(page.locator('#arghbox-root')).toHaveCount(0)
  expect(await page.evaluate(() => window.__ready)).toBe(0)
  await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = '/arghbox/arghbox.js?v=0.1.2&again=1'
    s.onload = resolve
    document.head.appendChild(s)
  }))
  await expect(tab(page)).toBeVisible()
  expect(await page.evaluate(() => window.__ready)).toBe(1)
})

// ---------------------------------------------------------------- screen reader announcements, language line

test('errors go to the assertive alert region, successes to the polite status region', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  const alert = panel(page).locator('[role=alert]')
  const status = panel(page).locator('[role=status]')
  await expect(alert).toHaveCount(1)
  await expect(alert).toHaveAttribute('aria-live', 'assertive')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  await expect(alert).toHaveText('')
  api.failNext('vote', 'rate_limited', { retry_after: 120, status: 429 })
  await voteBtn(page, 'Dark mode').click()
  await expect(alert).toHaveText(EN['err.rate_limited.funny.other'].replace('{n}', '2'))
  api.failNext('vote', 'server_error')
  await voteBtn(page, 'Dark mode').click()
  await expect(alert).toHaveText(err('server_error'))
  await expect(status).toHaveText('')
  await voteBtn(page, 'Dark mode').click() // a successful vote clears the error and speaks politely
  await expect(status).toHaveText('Counted. 15 votes')
  await expect(alert).toHaveText('')
  await expect(panel(page).locator('.banner')).toBeHidden()
})

test('add form: a field error and the success are announced', async ({ page, servers }) => {
  await load(page, servers)
  await openDialog(page)
  const alert = panel(page).locator('[role=alert]')
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('abc')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(alert).toHaveText(EN['err.title_short'])
  await panel(page).getByLabel('Title', { exact: true }).fill('A well announced idea')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
  await expect(panel(page).locator('[role=status]')).toHaveText('Thanks, we got it.')
})

test('the form shows no technical context line, but a bug report still carries page, language and screen size', async ({ page, servers, api }) => {
  await load(page, servers)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Bug').check()
  await expect(panel(page).locator('form')).not.toContainText(/language en|page \/|small screen|We send along|attaches/)
  await panel(page).getByLabel('Title', { exact: true }).fill('Carries the context quietly')
  await panel(page).getByRole('button', { name: 'Send bug report' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 8000 })
  expect(api.last('add').context).toMatchObject({ page: '/plain.html', lang: 'en', screen: expect.stringMatching(/^(small|medium|large)$/) })
})
