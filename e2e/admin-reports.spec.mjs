// Admin page: reports and author blocks, against the real PHP backend (desktop and phone projects).
// Reports are made through the public API (session, then report), the same way visitors make them.
import { test, expect, signIn, watchCsp } from './support/real-stack.mjs';
import { newVoter, nextIp } from '../tests/helpers/server.mjs';

const SEED = [
  /* 0 */ { type: 'idea', title: 'Dark mode please', body: 'Our eyes hurt at night.', state: 'published', votes: 3, author: 'friend' },
  /* 1 */ { type: 'idea', title: 'Buy cheap watches', body: 'visit my shop', state: 'published', votes: 1, author: 'spammer' },
  /* 2 */ { type: 'bug', title: 'Rude entry about staff', body: 'You are all fools.', state: 'published', votes: 1, author: 'rude' },
  /* 3 */ { type: 'idea', title: 'Export to CSV', body: 'For my accountant.', state: 'pending', votes: 1, author: 'friend' },
  /* 4 */ { type: 'idea', title: 'Write release notes', body: 'Before Friday.', state: 'private', source: 'owner', votes: 0 },
];

test.use({ stackOptions: { seed: SEED } });

const tab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) });
const card = (page, title) => page.locator('article.entry').filter({ hasText: title }).first();
async function openCard(page, title) {
  const c = card(page, title);
  await expect(c).toBeVisible();
  await c.locator('.entry-toggle').click();
  await expect(c.locator('.entry-body')).toBeVisible();
  return c;
}
async function idOf(stack, title) {
  const e = (await stack.entries()).find((x) => x.title === title);
  if (!e) throw new Error('no entry titled ' + title);
  return e.id;
}
/** `n` different visitors (different IPs and voter keys) report entry `id`. */
async function reportMany(stack, id, reasons) {
  for (const reason of reasons) {
    const ip = nextIp();
    const pass = await stack.session(ip);
    const r = await stack.call('report', { body: { pass, voter: newVoter(), id, reason }, ip });
    if (!r.json?.ok) throw new Error('report failed: ' + r.text);
  }
}
const actionRow = (page, kind) => page.locator('li.action').filter({ has: page.locator('.kind[data-kind="' + kind + '"]') }).first();

test('Reported list: right after Pending, counts, the reports line and "Hidden after reports"', async ({ page, stack }) => {
  const rude = await idOf(stack, 'Rude entry about staff');
  const spam = await idOf(stack, 'Buy cheap watches');
  await reportMany(stack, rude, ['abusive', 'abusive', 'spam']);        // 3 people: hidden until reviewed
  await reportMany(stack, spam, ['spam', 'spam']);                       // 2 people: still public
  expect((await stack.list()).entries.map((e) => e.title)).not.toContain('Rude entry about staff');
  expect((await stack.list()).entries.map((e) => e.title)).toContain('Buy cheap watches');

  const watch = watchCsp(page);
  await signIn(page, stack);
  // Tab order: Pending, then Reported.
  const names = await page.getByRole('tab').allInnerTexts();
  const labels = names.map((n) => n.split('\n')[0].trim());
  expect(labels.indexOf('Reported')).toBe(labels.indexOf('Pending') + 1);
  // Dashboard: reported = open reports on a published, pending or flagged entry (2: the hidden one and the public one), as the Reported list.
  await expect(page.locator('[data-tile="reported"] .tile-n')).toHaveText('2');
  await expect(page.locator('.reported-note')).toContainText('Reported: 2');
  await expect(page.locator('[data-tile="blocks"] .tile-n')).toHaveText('0');
  await expect(tab(page, 'Reported').locator('.badge')).toHaveText('2');

  await tab(page, 'Reported').click();
  await expect(page.locator('article.entry')).toHaveCount(2);            // reported=1 lists any state
  const hidden = await openCard(page, 'Rude entry about staff');
  await expect(hidden.locator('.reports-line')).toHaveText('Reported by 3 people: spam 1, rude 2');
  await expect(hidden.locator('.reports')).toContainText('Last report');
  await expect(hidden.locator('.reports-hidden')).toContainText('Hidden after reports');
  await expect(hidden.locator('.reports-hidden')).not.toContainText('keep it');
  await expect(hidden.getByRole('button', { name: 'Put it back (dismiss reports)' })).toBeVisible();
  await expect(hidden.getByRole('button', { name: /^Keep it/ })).toHaveCount(0);
  const still = await openCard(page, 'Buy cheap watches');
  await expect(still.locator('.reports-line')).toHaveText('Reported by 2 people: spam 2');
  await expect(still.locator('.reports-hidden')).toHaveCount(0);
  await expect(still.getByRole('button', { name: 'Keep it (dismiss reports)' })).toBeVisible();

  // Plain lists do not show the reports line for entries without reports.
  await tab(page, 'Pending').click();
  const exportCard = await openCard(page, 'Export to CSV');
  await expect(exportCard.locator('.reports')).toHaveCount(0);

  expect(await watch.collect()).toEqual([]);
  expect(watch.errors).toEqual([]);
  expect(watch.pageErrors).toEqual([]);
});

test('Keep it: dismisses the reports, the entry leaves Reported, the log shows it and Undo re-opens them', async ({ page, stack }) => {
  const spam = await idOf(stack, 'Buy cheap watches');
  await reportMany(stack, spam, ['spam', 'other']);
  await signIn(page, stack);
  await tab(page, 'Reported').click();
  const c = await openCard(page, 'Buy cheap watches');
  await c.getByRole('button', { name: 'Keep it (dismiss reports)' }).click();
  await expect(c.locator('.notice.ok')).toContainText('Reports dismissed');
  await expect(c.locator('.reports')).toHaveCount(0);
  await expect(c.locator('.entry-meta .chip.bad', { hasText: /^Reported/ })).toHaveCount(0);
  expect((await stack.entries({ reported: 1 })).length).toBe(0);
  expect((await stack.list()).entries.map((e) => e.title)).toContain('Buy cheap watches');

  await tab(page, 'Reported').click();
  await expect(page.getByText('Nothing is reported.')).toBeVisible();
  await expect(tab(page, 'Reported').locator('.badge')).toHaveText('0');

  // The log, with a readable summary and Undo.
  await tab(page, 'Log').click();
  const row = actionRow(page, 'dismiss_reports');
  await expect(row).toBeVisible();
  await expect(row.locator('.action-summary')).toContainText('Dismissed 2 reports');
  await row.getByRole('button', { name: /Undo action/ }).click();
  await expect(row.locator('.chip', { hasText: 'Undone' })).toBeVisible();
  const again = await stack.entries({ reported: 1 });
  expect(again.map((e) => e.title)).toEqual(['Buy cheap watches']);
  expect(again[0].reports.open).toBe(2);
});

test('Block author: confirm with a note, badge, Unblock, log summaries and Undo', async ({ page, stack }) => {
  const spam = await idOf(stack, 'Buy cheap watches');
  const friend = await idOf(stack, 'Dark mode please');
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Buy cheap watches');
  await expect(c.locator('.entry-meta').getByText('Author blocked')).toHaveCount(0);

  // Asking shows a confirmation; Cancel leaves everything as it was.
  await c.getByRole('button', { name: 'Block author', exact: true }).click();
  await expect(c.getByRole('alertdialog')).toBeVisible();
  await c.getByRole('button', { name: 'Cancel' }).click();
  await expect(c.getByRole('alertdialog')).toBeHidden();
  expect((await stack.admin('admin.entry', { query: { id: spam } })).json.entry.author_blocked).toBe(false);

  await c.getByRole('button', { name: 'Block author', exact: true }).click();
  await expect(c.getByRole('alertdialog')).toContainText('90 days by default');
  await expect(c.getByRole('alertdialog')).not.toContainText('few weeks');
  await c.getByLabel(/Note about the block/).fill('Casino ads, three times');
  await c.getByRole('button', { name: 'Yes, block this author' }).click();
  await expect(c.locator('.notice.ok')).toContainText('Author blocked');
  await expect(c.locator('.entry-meta').getByText('Author blocked')).toBeVisible();
  await expect(c.getByRole('button', { name: 'Unblock author' })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Block author', exact: true })).toHaveCount(0);
  expect((await stack.admin('admin.entry', { query: { id: spam } })).json.entry.author_blocked).toBe(true);
  // The block sits on the author, not on the entry: another author is not blocked.
  expect((await stack.admin('admin.entry', { query: { id: friend } })).json.entry.author_blocked).toBe(false);

  // The dashboard counts the active block, and the count opens the blocked authors' entries.
  await tab(page, 'Dashboard').click();
  await expect(page.locator('[data-tile="blocks"] .tile-n')).toHaveText('1');
  await page.locator('[data-tile="blocks"]').click();
  await expect(page.locator('article.entry')).toHaveCount(1);
  await expect(card(page, 'Buy cheap watches')).toBeVisible();

  // Log: a readable summary.
  await tab(page, 'Log').click();
  const blockRow = actionRow(page, 'block');
  await expect(blockRow).toBeVisible();
  await expect(blockRow.locator('.action-summary')).not.toBeEmpty();
  await expect(blockRow.locator('.kind')).toHaveText('Author blocked');

  // Unblock from the card.
  await tab(page, 'Published').click();
  const c2 = await openCard(page, 'Buy cheap watches');
  await c2.getByRole('button', { name: 'Unblock author' }).click();
  await expect(c2.locator('.notice.ok')).toContainText('Author unblocked');
  await expect(c2.locator('.entry-meta').getByText('Author blocked')).toHaveCount(0);
  await expect(c2.getByRole('button', { name: 'Block author', exact: true })).toBeVisible();
  expect((await stack.admin('admin.entry', { query: { id: spam } })).json.entry.author_blocked).toBe(false);

  // Undo the unblock in the log: the block is active again.
  await tab(page, 'Log').click();
  const unblockRow = actionRow(page, 'unblock');
  await expect(unblockRow).toBeVisible();
  await unblockRow.getByRole('button', { name: /Undo action/ }).click();
  await expect(unblockRow.locator('.chip', { hasText: 'Undone' })).toBeVisible();
  expect((await stack.admin('admin.entry', { query: { id: spam } })).json.entry.author_blocked).toBe(true);
});

test('owner items have no Block author, and visitor text in reports stays text', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'My tasks').click();
  const c = await openCard(page, 'Write release notes');
  await expect(c.getByRole('button', { name: /Block author|Unblock author/ })).toHaveCount(0);
  await expect(c.locator('.reports')).toHaveCount(0);
});

test('the context line shows the app: "App: iOS 2.3.1"', async ({ page, stack }) => {
  const r = await stack.add({ type: 'idea', title: 'Make the app faster', body: 'It takes a while to start.', context: { page: '/settings', lang: 'en', screen: 'small', app: { platform: 'ios', version: '2.3.1' } } }, nextIp());
  expect(r.json?.ok, r.text).toBe(true);
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const c = await openCard(page, 'Make the app faster');
  await expect(c.locator('.facts')).toContainText('App: iOS 2.3.1');
});

test('phone width: the Reported list, the reports box and the block confirmation fit the screen', async ({ page, stack }) => {
  const spam = await idOf(stack, 'Buy cheap watches');
  await reportMany(stack, spam, ['spam', 'abusive']);
  await signIn(page, stack);
  await tab(page, 'Reported').click();
  const c = await openCard(page, 'Buy cheap watches');
  await c.getByRole('button', { name: 'Block author', exact: true }).click();
  await expect(c.getByRole('alertdialog')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await c.getByRole('button', { name: 'Yes, block this author' }).boundingBox();
  const width = page.viewportSize().width;
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await expect(c.getByRole('button', { name: 'Keep it (dismiss reports)' })).toBeVisible();
});

test('Put it back: a hidden entry with reports is published again, its reports are dismissed, and the log says so in words', async ({ page, stack }) => {
  const rude = await idOf(stack, 'Rude entry about staff');
  await reportMany(stack, rude, ['abusive', 'abusive', 'spam']); // auto-hidden
  expect((await stack.list()).entries.map((e) => e.title)).not.toContain('Rude entry about staff');
  await signIn(page, stack);
  await tab(page, 'Reported').click();
  const c = await openCard(page, 'Rude entry about staff');
  await c.getByRole('button', { name: 'Put it back (dismiss reports)' }).click();
  await expect(c.locator('.notice.ok')).toContainText('Put back');
  expect((await stack.list()).entries.map((e) => e.title)).toContain('Rude entry about staff');
  expect((await stack.entries({ reported: 1 })).length).toBe(0);
  await tab(page, 'Reported').click();
  await expect(page.getByText('Nothing is reported.')).toBeVisible();
  await expect(tab(page, 'Reported').locator('.badge')).toHaveText('0');

  await tab(page, 'Log').click();
  const kinds = await page.locator('li.action .kind').evaluateAll((els) => els.map((e) => e.textContent)); // the chip is upper-cased by CSS
  expect(kinds).toContain('Hidden after reports');
  expect(kinds).toContain('Published');
  for (const k of kinds) expect(k).not.toMatch(/_|^[a-z]+$/); // never a raw kind name
});
