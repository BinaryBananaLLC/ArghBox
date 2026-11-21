// The GitHub Pages demo (tools/build-pages.mjs): Contoso Tasks with the real widget, admin page and mobile app page,
// and demo/backend.js answering api.php in the browser. Served statically under /ArghBox/ like GitHub Pages, with
// no PHP: every API answer must come from the page itself. Each test starts in a fresh browser context, so a fresh
// box. Runs on every project (desktop, phone, Firefox, iPhone WebKit): the demo is what GitHub visitors open first.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'
import { buildPages, servePages } from '../tools/build-pages.mjs'
import { REPO } from '../tests/helpers/server.mjs'

const test = base.extend({
  // One build and one static server per worker.
  site: [async ({}, use) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-pages-'))
    buildPages({ out })
    const srv = await servePages({ dir: out })
    await use(srv)
    await srv.close()
    fs.rmSync(out, { recursive: true, force: true })
  }, { scope: 'worker' }],
})

const tab = (page) => page.locator('#arghbox-root .t')
const panel = (page) => page.locator('#arghbox-root .panel')
const card = (page, title) => page.locator('#arghbox-root .card', { hasText: title })
const voteBtn = (root, title) => root.locator(`#arghbox-root .vote[aria-label^="${title},"]`)

async function openDialog(page) {
  await tab(page).click()
  await expect(panel(page).locator('h2')).toBeVisible()
  await expect(page.locator('#arghbox-root .card').first()).toBeVisible()
}

/** Collects console errors and warnings, page errors, requests to api.php and requests that leave the site. */
function watch(page, site) {
  const w = { problems: [], api: [], external: [] }
  page.on('console', (m) => {
    // Firefox reports Playwright's own injected script as "debugger eval code" (a forced-layout warning): not the page's
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('debugger eval code')) w.problems.push(m.text())
  })
  page.on('pageerror', (e) => w.problems.push(String(e)))
  page.on('request', (r) => {
    const u = r.url()
    if (/\/api\.php/.test(u)) w.api.push(u)
    if (!u.startsWith(new URL(site.url).origin) && !u.startsWith('data:') && !u.startsWith('blob:')) w.external.push(u)
  })
  return w
}

async function signIn(page, password = 'demo') {
  await expect(page.locator('#token')).toBeVisible()
  await page.locator('#token').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
const adminTab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) })
async function openAdminCard(page, title) {
  const c = page.locator('article.entry').filter({ hasText: title }).first()
  await expect(c).toBeVisible()
  await c.locator('.entry-toggle').click()
  await expect(c.locator('.entry-body')).toBeVisible()
  return c
}

test('the build has no PHP and puts the in-browser box before the widget, admin and app page scripts', async ({ site }) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-pages-check-'))
  try {
    const { files } = buildPages({ out })
    expect(files.filter((f) => f.endsWith('.php'))).toEqual([])
    expect(files).toEqual(expect.arrayContaining(['index.html', 'backend.js', 'arghbox/arghbox.js', 'arghbox/arghbox-app.js', 'arghbox/app.html', 'arghbox/admin/index.html', 'arghbox/admin/admin.js', 'arghbox/i18n/en.json']))
    const order = (rel, names) => {
      const html = fs.readFileSync(path.join(out, rel), 'utf8')
      return names.map((n) => html.indexOf(n))
    }
    const idx = order('index.html', ['backend.js', 'demo.js', 'arghbox/arghbox.js'])
    expect(idx.every((n) => n > 0) && idx[0] < idx[1] && idx[1] < idx[2]).toBe(true)
    const app = order('arghbox/app.html', ['../backend.js', '../phone-bridge.js', 'app-page.js'])
    expect(app.every((n) => n > 0) && app[0] < app[1] && app[1] < app[2]).toBe(true)
    const admin = order('arghbox/admin/index.html', ['../../backend.js', '../../admin-note.js', 'admin.js'])
    expect(admin.every((n) => n > 0) && admin[0] < admin[1] && admin[1] < admin[2]).toBe(true)
    // the source page has the marker, the built one does not
    expect(fs.readFileSync(path.join(REPO, 'demo', 'index.html'), 'utf8')).toContain('<!-- arghbox-demo-backend -->')
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).not.toContain('arghbox-demo-backend')
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
  // like GitHub Pages: no api.php, folders get their index.html
  expect((await fetch(site.url + 'arghbox/api.php?action=list')).status).toBe(404)
  expect((await fetch(site.url + 'arghbox/admin/')).status).toBe(200)
})

test('Contoso Tasks loads the real widget, and the seeded list comes from the browser, not a server', async ({ page, site }) => {
  const w = watch(page, site)
  await page.goto(site.url)
  await expect(page).toHaveTitle(/Contoso Tasks/)
  await expect(page.locator('#demo-password')).toContainText('demo')
  await expect(page.locator('#demo-local-note')).toBeVisible()
  await expect(tab(page)).toHaveText(/Feedback/)
  await openDialog(page)
  await expect(voteBtn(page, 'Recurring tasks').locator('.n')).toHaveText('31')
  await expect(card(page, 'Dark mode')).toBeVisible()
  // pending, merged, rejected and private entries are never public
  for (const hidden of ['Sync with my Outlook calendar', 'Repeat a task every week', 'Best crypto signals', 'Write the help page']) {
    await expect(card(page, hidden)).toHaveCount(0)
  }
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  expect(w.api).toEqual([])
  expect(w.external).toEqual([])
  expect(w.problems).toEqual([])
})

test('a vote counts once and survives a reload', async ({ page, site }) => {
  await page.goto(site.url)
  await openDialog(page)
  const btn = voteBtn(page, 'Calendar view')
  await expect(btn.locator('.n')).toHaveText('17')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(btn.locator('.n')).toHaveText('18')
  await expect(btn).toHaveAttribute('aria-busy', 'false')
  await page.reload()
  await openDialog(page)
  await expect(voteBtn(page, 'Calendar view')).toHaveAttribute('aria-pressed', 'true')
  await expect(voteBtn(page, 'Calendar view').locator('.n')).toHaveText('18')
})

test('the whole loop: add an idea, publish it on the admin page with the demo password, see it on the board', async ({ page, site }) => {
  const w = watch(page, site)
  await page.goto(site.url)
  await openDialog(page)
  await panel(page).getByRole('button', { name: 'Add an idea, bug or question' }).click()
  await panel(page).getByLabel('Title', { exact: true }).fill('Snooze a reminder for one hour')
  await panel(page).getByLabel('Details (optional)').fill('Sometimes I just need a bit more time.')
  await panel(page).getByRole('button', { name: 'Send idea' }).click()
  await expect(panel(page).locator('h2')).toHaveText('Thanks, we got it.', { timeout: 15_000 })
  await expect(page.locator('#demo-step-2')).toHaveClass('now') // the demo bar points at the admin page next
  await panel(page).getByRole('button', { name: 'Back to the list' }).click()
  await expect(panel(page).locator('.wel')).toContainText('password: demo')
  await expect(panel(page).locator('.mine')).toContainText('Snooze a reminder for one hour')
  await expect(panel(page).locator('.mine')).toContainText('Waiting for review.')
  await expect(card(page, 'Snooze a reminder')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // the admin page: the real admin.js, with the demo note and the password hint
  await page.locator('#demo-admin-link').click()
  await expect(page).toHaveURL(/\/arghbox\/admin\/$/)
  await expect(page.locator('.demo-note')).toContainText('demo')
  await signIn(page, 'not-the-password')
  await expect(page.locator('#login-msg')).toHaveText('That token is not right. Check it and try again.')
  await page.getByRole('button', { name: 'Fill it in' }).click()
  await expect(page.locator('#token')).toHaveValue('demo')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-tile="pending"] .tile-n')).toHaveText('3')
  await adminTab(page, 'Pending').click()
  const c = await openAdminCard(page, 'Snooze a reminder for one hour')
  await c.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(c.locator('.notice.ok')).toHaveText('Published.')

  // back on the site, the visitor sees it on the board
  await page.getByRole('link', { name: 'Back to Contoso Tasks' }).click()
  await openDialog(page)
  await expect(card(page, 'Snooze a reminder for one hour')).toBeVisible()
  expect(w.api).toEqual([])
  expect(w.problems).toEqual([])
})

test('the admin page shows the seeded AI run, the flagged entry and the reported one, and the run can be undone', async ({ page, site }) => {
  const w = watch(page, site)
  await page.goto(site.url + 'arghbox/admin/')
  await signIn(page)
  for (const [tile, n] of [['pending', '2'], ['reported', '1'], ['flagged', '1']]) {
    await expect(page.locator(`[data-tile="${tile}"] .tile-n`)).toHaveText(n)
  }
  await adminTab(page, 'Needs you').click()
  const f = await openAdminCard(page, 'make it better')
  await expect(f.locator('.ai')).toContainText('confidence 55%')

  // the admin API answers from the same in-browser box
  const api = (action, body) => page.evaluate(async ([a, b]) => {
    const me = await (await fetch('../api.php?action=admin.me')).json()
    const init = b ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ArghBox-CSRF': me.csrf }, body: JSON.stringify(b) } : {}
    return (await fetch('../api.php?action=' + a, init)).json()
  }, [action, body])
  const runs = await api('admin.runs')
  expect(runs.runs).toHaveLength(1)
  expect(runs.runs[0].reviewer).toBe('claude')
  const undone = await api('admin.undo', { run_id: runs.runs[0].id })
  expect(undone.ok).toBe(true)
  const stats = await api('admin.stats')
  expect(stats.counts.merged).toBe(1) // only the older, hand-merged duplicate is left
  expect(w.problems).toEqual([])
})

test('the phone runs the mobile app page, and the page shows the messages the app receives', async ({ page, site }) => {
  const w = watch(page, site)
  await page.goto(site.url)
  await page.locator('#phone-feedback').click()
  const phone = page.frameLocator('#webview iframe')
  await expect(phone.locator('#arghbox-root .card').first()).toBeVisible()
  await expect(page.locator('#bridge-log')).toContainText('open')
  // the board opened by itself (no click inside the frame): the title takes focus, without a focus ring
  const ring = await phone.locator('#arghbox-root .panel h2').evaluate((h) => [h.matches(':focus'), getComputedStyle(h).outlineStyle])
  expect(ring).toEqual([true, 'none'])
  await voteBtn(phone, 'Dark mode').click()
  await expect(voteBtn(phone, 'Dark mode').locator('.n')).toHaveText('28')
  await expect(page.locator('#bridge-log')).toContainText('vote {"on":true}')
  await phone.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('#bridge-log li').first()).toContainText('close')
  await expect(page.locator('#app-screen')).toBeVisible()
  await expect(page.locator('#webview')).toBeHidden()

  // the same box and the same browser: the website shows the vote made in the app
  await openDialog(page)
  await expect(voteBtn(page, 'Dark mode')).toHaveAttribute('aria-pressed', 'true')
  await expect(voteBtn(page, 'Dark mode').locator('.n')).toHaveText('28')
  await page.keyboard.press('Escape')

  // opening it again from the app shows the board again
  await page.locator('#phone-feedback').click()
  await expect(phone.locator('#arghbox-root .panel h2')).toBeVisible()
  expect(w.api).toEqual([])
  expect(w.problems).toEqual([])
})

test('"Reset the demo" brings back the seeded box', async ({ page, site }) => {
  await page.goto(site.url)
  await openDialog(page)
  await voteBtn(page, 'Calendar view').click()
  await expect(voteBtn(page, 'Calendar view').locator('.n')).toHaveText('18')
  await expect(voteBtn(page, 'Calendar view')).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  await Promise.all([page.waitForEvent('load'), page.locator('#demo-reset').click()])
  await openDialog(page)
  await expect(voteBtn(page, 'Calendar view').locator('.n')).toHaveText('17')
  await expect(voteBtn(page, 'Calendar view')).toHaveAttribute('aria-pressed', 'false')
})

test('a reset in one tab starts the other open tabs over too', async ({ page, site }) => {
  const admin = await page.context().newPage()
  await admin.goto(site.url + 'arghbox/admin/')
  await signIn(admin)
  await expect(admin.locator('[data-tile="pending"] .tile-n')).toHaveText('2')
  await page.goto(site.url)
  await Promise.all([admin.waitForEvent('load'), page.waitForEvent('load'), page.locator('#demo-reset').click()])
  // the admin tab reloaded on its own, and the reset signed it out
  await expect(admin.locator('#token')).toBeVisible()
  await admin.close()
})

test('the admin export downloads a CSV built in the browser', async ({ page, site }) => {
  await page.goto(site.url + 'arghbox/admin/')
  await signIn(page)
  await page.locator('details.export-menu summary').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('a.export-link[data-format="csv"]').click()])
  expect(download.suggestedFilename()).toMatch(/^arghbox-contoso-tasks-\d{8}\.csv$/)
  const text = fs.readFileSync(await download.path(), 'utf8')
  expect(text.replace(/^﻿/, '')).toMatch(/^id,type,state,status,title/)
  expect(text).toContain('Recurring tasks')
})

const AXE = fs.readFileSync(path.join(REPO, 'e2e', 'support', 'vendor', 'axe.min.js'), 'utf8')
async function axeViolations(page) {
  await page.addScriptTag({ content: AXE })
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] })
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' > ')).join(' | ').slice(0, 300)}`)
  })
}

test('accessibility: the Contoso page and the admin sign-in with the demo note have no axe violations', async ({ page, site }) => {
  await page.goto(site.url)
  await expect(tab(page)).toBeVisible()
  expect(await axeViolations(page)).toEqual([])
  await page.goto(site.url + 'arghbox/admin/')
  await expect(page.getByRole('button', { name: 'Fill it in' })).toBeVisible()
  expect(await axeViolations(page)).toEqual([])
})
