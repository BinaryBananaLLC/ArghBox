// Report button, locally hidden entries and the Contact link (SPEC sections 6b and 8), against the fake API.
// Runs on the desktop and phone projects.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, hostUrl, repoRoot } from './support/servers.mjs'

const EN = JSON.parse(fs.readFileSync(path.join(repoRoot, 'arghbox', 'i18n', 'en.json'), 'utf8'))
const root = (page) => page.locator('#arghbox-root')
const card = (page, title) => root(page).locator('.card', { hasText: title })

async function openBox(page, servers, params = {}, hash = '') {
  await page.goto(hostUrl(servers, 'plain', params, hash))
  await root(page).locator('.t').click()
  await expect(root(page).locator('.card').first()).toBeVisible()
}
async function openDetail(page, title) {
  await card(page, title).click()
  await expect(root(page).locator('h2')).toHaveText(title)
}
// "Dark mode" (id 1) is a visitor entry tagged design, and so is the team's "A print stylesheet" (id 5).
const VISITOR = 'Dark mode'

test('the Report button is on visitor entries and not on the owner\'s items', async ({ page, servers }) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await expect(root(page).locator('.rp')).toHaveText('Report')
  await root(page).locator('.ib', { hasText: 'Back' }).click()
  await openDetail(page, 'A print stylesheet')
  await expect(root(page).locator('.rp')).toHaveCount(0)
  await expect(root(page)).toContainText('From the team')
})

test('the Report button is on closed visitor entries too, never on a list card', async ({ page, servers }) => {
  await openBox(page, servers)
  await expect(root(page).locator('.card .rp')).toHaveCount(0)
  await root(page).locator('.ch').click()
  await openDetail(page, 'Offline mode')
  await expect(root(page).locator('.rp')).toBeVisible()
})

test('four reasons in an accessible group: legend, radios, keyboard, Cancel returns focus', async ({ page, servers, api }, info) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  const group = root(page).locator('fieldset')
  await expect(group.locator('legend')).toHaveText(EN['report.legend'])
  const labels = await group.locator('label').allTextContents()
  expect(labels).toEqual(['Spam', 'Rude or abusive', 'Not about this site or app', 'Something else'])
  await expect(group.getByRole('radio')).toHaveCount(4)
  await expect(group.getByRole('radio').first()).toBeFocused()
  await expect(root(page).locator('.rp')).toHaveCount(0) // the button is replaced by the picker
  await expect(root(page).getByRole('button', { name: 'Send report' })).toBeVisible()
  if (!/phone/.test(info.project.name)) {
    await page.keyboard.press('ArrowDown')
    await expect(group.getByRole('radio').nth(1)).toBeChecked()
    await expect(group.getByRole('radio').nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(group.getByRole('radio').nth(2)).toBeChecked()
    // Tab walks on to Send report and Cancel, and the trap keeps focus in the dialog
    await page.keyboard.press('Tab')
    await expect(root(page).getByRole('button', { name: 'Send report' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(root(page).getByRole('button', { name: 'Cancel' })).toBeFocused()
  }
  await root(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(group).toHaveCount(0)
  await expect(root(page).locator('.rp')).toBeFocused()
  expect(api.requests('report')).toEqual([])
})

test('sending without a reason asks for one', async ({ page, servers, api }) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  await root(page).getByRole('button', { name: 'Send report' }).click()
  await expect(root(page).locator('.banner')).toHaveText(EN['report.pick'])
  await expect(root(page).locator('fieldset input').first()).toBeFocused()
  expect(api.requests('report')).toEqual([])
})

test('reporting sends the reason, confirms, and hides the entry in the list, search, similar and tag chips, also after reload', async ({ page, servers, api }) => {
  await openBox(page, servers)
  const chip = root(page).locator('.chip', { hasText: '#design' })
  await expect(chip).toContainText('2') // Dark mode (1) and the print stylesheet (5)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  await root(page).locator('fieldset label', { hasText: 'Spam' }).click()
  await root(page).getByRole('button', { name: 'Send report' }).click()

  await expect(root(page).locator('.sim')).toHaveText(EN['report.done'], { timeout: 10_000 }) // back on the list with the confirmation
  await expect(card(page, VISITOR)).toHaveCount(0)
  expect(api.requests('report')).toHaveLength(1)
  const sent = api.last('report')
  expect(sent.id).toBe(1)
  expect(sent.reason).toBe('spam')
  expect(sent.pass).toMatch(/^pass-/)
  expect(sent.voter).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
  expect(api.reports).toEqual([{ id: 1, reason: 'spam', voter: sent.voter }])

  // the chip count lost the hidden entry
  await expect(chip).toContainText('1')
  // search and the similar suggestions of the add form
  await root(page).locator('input[type=search]').fill('dark')
  await expect(root(page).locator('.empty')).toBeVisible()
  await root(page).locator('input[type=search]').fill('')
  await root(page).locator('.pri').first().click()
  await root(page).locator('#f-title').fill('Dark mode')
  await page.waitForTimeout(400)
  await expect(root(page).locator('.sim')).toContainText('Offline mode') // a near match is still offered...
  await expect(root(page).locator('.sim')).not.toContainText('Dark mode') // ...but never the reported one

  // after a reload it stays hidden, and the same browser sends the voter key it had
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('arghbox:reported')))).toEqual([1])
  await page.reload()
  await root(page).locator('.t').click()
  await expect(root(page).locator('.card').first()).toBeVisible()
  await expect(card(page, VISITOR)).toHaveCount(0)
  await expect(root(page).locator('.chip', { hasText: '#design' })).toContainText('1')
  // the confirmation was shown once
  await expect(root(page).locator('.sim')).toHaveCount(0)
})

test('the tab dismissal (×) and showTab() do not touch the hidden entries', async ({ page, servers }) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  await root(page).locator('fieldset label', { hasText: 'Something else' }).click()
  await root(page).getByRole('button', { name: 'Send report' }).click()
  await expect(root(page).locator('.sim')).toBeVisible({ timeout: 10_000 })
  await page.evaluate(() => ArghBox.close())
  await page.locator('#arghbox-root .x').click()
  await page.evaluate(() => ArghBox.showTab())
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('arghbox:reported')))).toEqual([1])
})

test('a deep link to a reported entry does not open it', async ({ page, servers }) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  await root(page).locator('fieldset label', { hasText: 'Spam' }).click()
  await root(page).getByRole('button', { name: 'Send report' }).click()
  await expect(root(page).locator('.sim')).toBeVisible({ timeout: 10_000 })
  await page.evaluate(() => ArghBox.close())
  await page.evaluate(() => ArghBox.open({ id: 1 }))
  await expect(root(page).locator('.card').first()).toBeVisible()
  await expect(root(page).locator('h2')).not.toHaveText(VISITOR)
})

test('errors from the report are shown in friendly words, and the picker stays so it can be retried', async ({ page, servers, api }) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  await root(page).locator('fieldset label', { hasText: 'Rude or abusive' }).click()
  api.failNext('report', 'rate_limited', { retry_after: 120 })
  const send = root(page).getByRole('button', { name: 'Send report' })
  await send.click()
  await expect(root(page).locator('.banner')).toContainText('2 minutes')
  await expect(send).toBeEnabled()
  await expect(root(page).locator('h2')).toHaveText(VISITOR)
  expect(await page.evaluate(() => localStorage.getItem('arghbox:reported'))).toBeNull()
  await send.click() // retry works
  await expect(root(page).locator('.sim')).toHaveText(EN['report.done'], { timeout: 10_000 })
  expect(api.requests('report')).toHaveLength(2)

  // an entry that is gone says so, never raw JSON
  await root(page).locator('.card', { hasText: 'Keyboard shortcuts' }).click()
  await root(page).locator('.rp').click()
  api.setEntry(3, { state: 'rejected' })
  await root(page).locator('fieldset label', { hasText: 'Spam' }).click()
  await root(page).getByRole('button', { name: 'Send report' }).click()
  await expect(root(page).locator('.banner')).toHaveText(EN['err.not_found'])
  await expect(root(page).locator('.banner')).not.toContainText('{')
})

test('a network failure while reporting is a friendly message', async ({ page, servers, api }) => {
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  await root(page).locator('fieldset label', { hasText: 'Spam' }).click()
  api.failNext('report', 'server_error', { status: 500 })
  await root(page).getByRole('button', { name: 'Send report' }).click()
  await expect(root(page).locator('.banner')).toContainText(/hiccuped|went wrong/)
})

test('the Contact link shows when the server has a contact URL, next to the credit', async ({ page, servers, api }) => {
  api.set({ contact: 'https://example.com/contact' })
  await openBox(page, servers)
  const link = root(page).locator('.cr a', { hasText: 'Contact' })
  await expect(link).toHaveAttribute('href', 'https://example.com/contact')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener')
  await expect(root(page).locator('.cr a')).toHaveCount(2) // Contact and the credit
  await openDetail(page, VISITOR)
  await expect(root(page).locator('.cr a', { hasText: 'Contact' })).toBeVisible()
  const box = await root(page).locator('.cr a', { hasText: 'Contact' }).boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(28)
})

test('a mailto: contact works; an empty or unsafe contact shows no link', async ({ page, servers, api }) => {
  api.set({ contact: 'mailto:help@example.com' })
  await openBox(page, servers)
  await expect(root(page).locator('.cr a', { hasText: 'Contact' })).toHaveAttribute('href', 'mailto:help@example.com')
  for (const bad of ['', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', '//example.com', 'https://exa mple.com']) {
    api.set({ contact: bad })
    await page.goto(hostUrl(servers))
    await root(page).locator('.t').click()
    await expect(root(page).locator('.card').first()).toBeVisible()
    await expect(root(page).locator('.cr a', { hasText: 'Contact' })).toHaveCount(0)
    await expect(root(page).locator('a[href^="javascript:"]')).toHaveCount(0)
  }
})

test('with the credit off and a contact URL, only Contact is in the footer; with neither there is no footer line', async ({ page, servers, api }) => {
  api.set({ contact: 'https://example.com/contact', credit: false })
  await openBox(page, servers)
  await expect(root(page).locator('.cr a')).toHaveCount(1)
  await expect(root(page).locator('.cr a')).toHaveText('Contact')
  api.set({ contact: '' })
  await page.goto(hostUrl(servers))
  await root(page).locator('.t').click()
  await expect(root(page).locator('.card').first()).toBeVisible()
  await expect(root(page).locator('.cr')).toHaveCount(0)
})

test('opening the report form scrolls it so the Send button is not under the footer', async ({ page, servers }) => {
  await page.setViewportSize({ width: 375, height: 500 })
  await openBox(page, servers)
  await openDetail(page, VISITOR)
  await root(page).locator('.rp').click()
  const send = root(page).getByRole('button', { name: 'Send report' })
  await expect(send).toBeVisible()
  await expect.poll(async () => { // after the scroll
    const b = await send.boundingBox()
    const ft = root(page).locator('.ft')
    const limit = (await ft.count()) ? (await ft.boundingBox()).y : page.viewportSize().height
    return b.y >= 0 && b.y + b.height <= limit + 1
  }).toBe(true)
})
