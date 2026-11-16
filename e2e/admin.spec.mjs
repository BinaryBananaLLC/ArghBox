// Admin page against the real PHP backend (see e2e/support/real-stack.mjs). Runs in the desktop and phone projects.
import fs from 'node:fs';
import { test, expect, signIn, watchCsp } from './support/real-stack.mjs';

const SEED = [
  /* 0 */ { type: 'idea', title: 'Dark mode please', body: 'Our eyes hurt at night.', state: 'published', tags: ['design'], votes: 3 },
  /* 1 */ { type: 'bug', title: 'Map crashes on save', body: 'Boom.', state: 'published', status: 'planned', votes: 2 },
  /* 2 */ { type: 'idea', title: 'Export to CSV', body: 'For my accountant.', state: 'pending', votes: 1, context: { page: '/map', lang: 'en', browser: 'Firefox', os: 'Linux', screen: 'large' } },
  /* 3 */ { type: 'bug', title: 'Button is broken', state: 'pending', votes: 1 },
  /* 4 */ { type: 'idea', title: '<img src=x onerror=alert(1)>', body: '<b>not bold</b>', state: 'pending', votes: 1 },
  /* 5 */ { type: 'idea', title: 'Strange request', state: 'flagged', votes: 1 },
  /* 6 */ { type: 'idea', title: 'Buy cheap pills', state: 'rejected', reject_reason: 'spam', votes: 1 },
  /* 7 */ { type: 'idea', title: 'Night theme', state: 'merged', merged_into: 0, votes: 2 },
  /* 8 */ { type: 'idea', title: 'Write release notes', body: 'Before Friday.', state: 'private', source: 'owner', tags: ['docs'], votes: 0 },
];

test.use({ stackOptions: { seed: SEED } });

const card = (page, title) => page.locator('article.entry').filter({ hasText: title }).first();
const tab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) });
async function openCard(page, title) {
  const c = card(page, title);
  await expect(c).toBeVisible();
  await c.locator('.entry-toggle').click();
  await expect(c.locator('.entry-body')).toBeVisible();
  return c;
}
async function entryByTitle(stack, title) {
  const all = await stack.entries();
  const e = all.find((x) => x.title === title);
  if (!e) throw new Error('no entry titled ' + title);
  return e;
}
const publicEntry = async (stack, title) => (await stack.list()).entries.find((e) => e.title === title);
const actionRow = (page, kind) => page.locator('li.action').filter({ has: page.locator('.kind', { hasText: new RegExp('^' + kind + '$', 'i') }) }).first();

test('sign in: wrong token is refused, the right one opens the dashboard', async ({ page, stack }) => {
  await page.goto(stack.adminUrl);
  await expect(page.getByRole('heading', { name: 'ArghBox admin' })).toBeVisible();
  await page.getByLabel('Owner token').fill('definitely-not-the-token');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#login-msg')).toContainText('not right');
  await expect(tab(page, 'Dashboard')).toHaveCount(0);
  await page.getByLabel('Owner token').fill(stack.ownerToken);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(tab(page, 'Dashboard')).toBeVisible();
  // The session cookie survives a reload: no sign-in form.
  await page.reload();
  await expect(tab(page, 'Dashboard')).toBeVisible();
});

test('not configured: the message points at the health endpoint', async ({ page }) => {
  const { startRealStack } = await import('./support/real-stack.mjs');
  const broken = await startRealStack({ config: { secret: 'too-short' } });
  try {
    await page.goto(broken.adminUrl);
    await expect(page.locator('#login-msg')).toContainText('Open api.php?action=health');
    await expect(page.locator('#login-msg a')).toHaveAttribute('href', /api\.php\?action=health$/);
  } finally {
    await broken.stop();
  }
});

test('dashboard: counts, last run digest, 7-day number and the pending hint', async ({ page, stack }) => {
  const q = await stack.queue();
  const csv = q.pending.find((e) => e.title === 'Export to CSV');
  await stack.apply([{ id: csv.id, fingerprint: csv.fingerprint, action: 'publish', confidence: 95, reason: 'Clear idea', tags: ['export'] }],
    { reviewer: 'Claude Test', digest: 'Published one idea.\nTwo more need a look.' });
  await signIn(page, stack);
  const tile = (name) => page.locator(`[data-tile="${name}"] .tile-n`);
  await expect(tile('pending')).toHaveText('2');
  await expect(tile('flagged')).toHaveText('1');
  await expect(tile('published')).toHaveText('3');
  await expect(tile('rejected')).toHaveText('1');
  await expect(tile('merged')).toHaveText('1');
  await expect(tile('tasks')).toHaveText('1');
  await expect(tile('week')).toHaveText('8');
  await expect(page.getByText('Pending: 2 waiting for triage.')).toBeVisible();
  await expect(page.getByText('empty the ArghBox').first()).toBeVisible();
  const digest = page.locator('.digest');
  await expect(digest).toContainText('Published one idea.');
  await expect(digest).toContainText('Two more need a look.');
  expect(await digest.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  await expect(page.getByText('Run #1 by Claude Test')).toBeVisible();
  // Tab badges.
  await expect(tab(page, 'Pending').locator('.badge')).toHaveText('2');
  await expect(tab(page, 'Published').locator('.badge')).toHaveText('3');
});

test('lists: pending, flagged, published (status filter), rejected, merged, my tasks, search, filters', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  for (const t of ['Export to CSV', 'Button is broken', '<img src=x onerror=alert(1)>']) await expect(card(page, t)).toBeVisible();
  await expect(page.locator('article.entry')).toHaveCount(3);
  // Search and type filter.
  await page.getByLabel('Search', { exact: true }).fill('csv');
  await expect(page.locator('article.entry')).toHaveCount(1);
  await page.getByLabel('Search', { exact: true }).fill('');
  await page.getByLabel('Filter by type').selectOption('bug');
  await expect(page.locator('article.entry')).toHaveCount(1);
  await expect(card(page, 'Button is broken')).toBeVisible();

  await tab(page, 'Needs you').click();
  await expect(card(page, 'Strange request')).toBeVisible();

  await tab(page, 'Published').click();
  await expect(page.locator('article.entry')).toHaveCount(2);
  await page.getByLabel('Filter by status').selectOption('planned');
  await expect(page.locator('article.entry')).toHaveCount(1);
  await expect(card(page, 'Map crashes on save')).toBeVisible();
  await page.getByLabel('Filter by status').selectOption('');
  await page.getByLabel('Filter by tag').selectOption('design');
  await expect(page.locator('article.entry')).toHaveCount(1);
  await expect(card(page, 'Dark mode please')).toBeVisible();

  await tab(page, 'Rejected').click();
  const rej = card(page, 'Buy cheap pills');
  await expect(rej).toBeVisible();
  await expect(rej.locator('.chip.bad', { hasText: 'Spam' })).toBeVisible();

  await tab(page, 'Merged').click();
  const merged = await openCard(page, 'Night theme');
  await expect(merged).toContainText('merged into #' + (await entryByTitle(stack, 'Dark mode please')).id);

  await tab(page, 'My tasks').click();
  const task = await openCard(page, 'Write release notes');
  await expect(task).toContainText('Before Friday.');
});

test('entry panel shows originals, context, AI note and the full facts', async ({ page, stack }) => {
  const q = await stack.queue();
  const csv = q.pending.find((e) => e.title === 'Export to CSV');
  const btn = q.pending.find((e) => e.title === 'Button is broken');
  await stack.apply([
    { id: csv.id, fingerprint: csv.fingerprint, action: 'publish', confidence: 95, title: 'Export entries to CSV', reason: 'Clear request.', title_en: 'Export to CSV (English)' },
    { id: btn.id, fingerprint: btn.fingerprint, action: 'publish', confidence: 40, reason: 'Probably fine but unsure.' },
  ], { reviewer: 'Claude Test' });
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Export entries to CSV');
  await expect(c).toContainText('page /map');
  await expect(c).toContainText('Firefox');
  await expect(c.locator('.ai')).toContainText('Suggested: publish');
  await expect(c.locator('.ai')).toContainText('confidence 95%');
  await expect(c.locator('.ai')).toContainText('Export to CSV (English)');
  await expect(c.locator('.ai')).toContainText('Claude Test');
  await c.locator('details.originals summary').click();
  await expect(c.locator('details.originals')).toContainText('Export to CSV');

  await tab(page, 'Needs you').click();
  const f = await openCard(page, 'Button is broken');
  await expect(f.locator('.ai')).toContainText('confidence 40%');
  await expect(f.locator('.ai')).toContainText('not applied');
  await expect(f.locator('.ai')).toContainText('Probably fine but unsure.');
});

test('publish, reject with a reason, flag and back to pending', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  let c = await openCard(page, 'Export to CSV');
  await c.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Published.');
  expect((await entryByTitle(stack, 'Export to CSV')).state).toBe('published');
  expect(await publicEntry(stack, 'Export to CSV')).toBeTruthy();
  await expect(tab(page, 'Published').locator('.badge')).toHaveText('3');

  c = await openCard(page, 'Button is broken');
  await c.getByLabel('Reject reason').selectOption('test');
  await c.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(c.locator('.notice.ok')).toContainText('Rejected (Test)');
  const rejected = await entryByTitle(stack, 'Button is broken');
  expect(rejected.state).toBe('rejected');
  expect(rejected.reject_reason).toBe('test');

  await c.getByRole('button', { name: 'Back to pending' }).click();
  await expect(c.locator('.notice.ok')).toContainText('Back in the triage queue');
  expect((await entryByTitle(stack, 'Button is broken')).state).toBe('pending');

  await c.getByRole('button', { name: 'Flag', exact: true }).click();
  await expect(c.locator('.notice.ok')).toContainText('Flagged');
  expect((await entryByTitle(stack, 'Button is broken')).state).toBe('flagged');
  await expect(tab(page, 'Needs you').locator('.badge')).toHaveText('2');
});

test('API errors are shown next to the action', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const c = await openCard(page, 'Export to CSV');
  await c.locator('details.edit summary').click();
  await c.getByLabel('Title', { exact: true }).fill('ab');
  await c.getByRole('button', { name: 'Save changes' }).click();
  await expect(c.locator('.notice.bad')).toContainText('Edit failed');
  await c.getByLabel('Title', { exact: true }).fill('Export everything to CSV');
  await c.getByRole('button', { name: 'Save changes' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Saved.');
  expect(await entryByTitle(stack, 'Export everything to CSV')).toBeTruthy();
});

test('merge through the picker, then undo restores the votes', async ({ page, stack }) => {
  const target = await entryByTitle(stack, 'Dark mode please');
  const csv = await entryByTitle(stack, 'Export to CSV');
  const before = (await entryByTitle(stack, 'Dark mode please')).votes;
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const c = await openCard(page, 'Export to CSV');
  await c.locator('details.merge summary').click();
  await c.getByLabel('Search published entries to merge into').fill('Dark');
  await c.locator('.pick', { hasText: 'Dark mode please' }).click();
  await c.getByRole('button', { name: 'Merge into #' + target.id }).click();
  await expect(c.locator('.notice.ok')).toContainText('Merged into #' + target.id);
  const merged = await entryByTitle(stack, 'Export to CSV');
  expect(merged.state).toBe('merged');
  expect(merged.merged_into).toBe(target.id);
  expect((await entryByTitle(stack, 'Dark mode please')).votes).toBe(before + 1);

  await tab(page, 'Log').click();
  const row = actionRow(page, 'merge');
  await expect(row).toContainText('Export to CSV');
  await row.getByRole('button', { name: /^Undo/ }).click();
  await expect(row.locator('.chip', { hasText: 'Undone' })).toBeVisible();
  const restored = await entryByTitle(stack, 'Export to CSV');
  expect(restored.state).toBe('pending');
  expect(restored.merged_into).toBeNull();
  expect((await entryByTitle(stack, 'Dark mode please')).votes).toBe(before);
  expect(restored.id).toBe(csv.id);
});

test('status change shows in the public list', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Dark mode please');
  await c.getByLabel('Status', { exact: true }).selectOption('in_progress');
  await c.getByRole('button', { name: 'Set status' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Status is now In progress.');
  expect((await publicEntry(stack, 'Dark mode please')).status).toBe('in_progress');
});

test('tags: edit with chips and suggestions', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Map crashes on save');
  const input = c.getByLabel(/^Add a tag to entry/);
  await input.fill('Crash');
  await input.press('Enter');
  await expect(c.locator('.tag-chips .chip', { hasText: '#crash' })).toBeVisible();
  // A suggestion from the vocabulary (the "design" tag is in use on another entry).
  await c.getByRole('button', { name: 'Use tag design' }).click();
  await expect(c.locator('.tag-chips .chip', { hasText: '#design' })).toBeVisible();
  // Invalid tag and the 3-tag limit.
  await input.fill('Not valid!');
  await input.press('Enter');
  await expect(c.locator('.tag-editor .field-error')).toContainText('lowercase');
  await c.getByRole('button', { name: 'Save tags' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Tags saved.');
  expect((await publicEntry(stack, 'Map crashes on save')).tags).toEqual(['crash', 'design']);
  // Remove one.
  await c.getByRole('button', { name: 'Remove tag crash' }).click();
  await c.getByRole('button', { name: 'Save tags' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Tags saved.');
  expect((await publicEntry(stack, 'Map crashes on save')).tags).toEqual(['design']);
});

test('comments: public shows in the public list, private note does not, hide removes it', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Dark mode please');
  const form = c.locator('.comment-form');
  await form.getByLabel('New comment or note').fill('Coming in December.');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Public comment added.');
  await form.getByLabel('New comment or note').fill('Remember to ask Anna.');
  await form.getByLabel('Comment visibility').selectOption('0');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Private note added.');

  await expect(c.locator('.comment.public')).toContainText('Coming in December.');
  await expect(c.locator('.comment.public .chip').first()).toHaveText('Public comment');
  await expect(c.locator('.comment.private')).toContainText('Remember to ask Anna.');
  await expect(c.locator('.comment.private .chip').first()).toHaveText('Private note');

  let pub = await publicEntry(stack, 'Dark mode please');
  expect(pub.comments.map((x) => x.body)).toEqual(['Coming in December.']);
  expect(JSON.stringify(pub)).not.toContain('Anna');

  // Edit the public comment.
  await c.locator('.comment.public').getByRole('button', { name: 'Edit' }).click();
  await c.getByLabel('Edit comment').fill('Coming in January.');
  await c.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(c.locator('.comment.public')).toContainText('Coming in January.');
  pub = await publicEntry(stack, 'Dark mode please');
  expect(pub.comments.map((x) => x.body)).toEqual(['Coming in January.']);

  // Hide it, then unhide.
  await c.locator('.comment.public').getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Comment hidden.');
  await expect(c.locator('.comment.hidden-c')).toContainText('Hidden');
  pub = await publicEntry(stack, 'Dark mode please');
  expect(pub.comments).toEqual([]);
  await c.locator('.comment.hidden-c').getByRole('button', { name: 'Unhide' }).click();
  // Wait for the server to confirm before asking the public API (the click is asynchronous).
  await expect(c.locator('.notice.ok')).toHaveText('Comment is visible again.');
  pub = await publicEntry(stack, 'Dark mode please');
  expect(pub.comments).toHaveLength(1);
});

test('my tasks: create a private task, it stays out of the public list, make it public, make it private again', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'My tasks').click();
  await page.locator('details.new-task summary').click();
  const form = page.locator('.task-form');
  await form.getByLabel('Type').selectOption('bug');
  await form.getByLabel('Title', { exact: true }).fill('Fix the footer');
  await form.getByLabel('Details').fill('It is crooked.');
  await form.getByLabel('Status', { exact: true }).selectOption('planned');
  const tags = form.getByLabel('Add a tag to the new task');
  await tags.fill('layout');
  await tags.press('Enter');
  await form.getByRole('button', { name: 'Create task' }).click();
  await expect(form.locator('.notice.ok')).toContainText('(private)');
  const created = await entryByTitle(stack, 'Fix the footer');
  expect(created.state).toBe('private');
  expect(created.source).toBe('owner');
  expect(created.tags).toEqual(['layout']);
  expect(await publicEntry(stack, 'Fix the footer')).toBeUndefined();

  const c = await openCard(page, 'Fix the footer');
  await c.getByRole('button', { name: 'Make public' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Published.');
  const pub = await publicEntry(stack, 'Fix the footer');
  expect(pub).toBeTruthy();
  expect(pub.source).toBe('owner');
  expect(pub.status).toBe('planned');
  await c.getByRole('button', { name: 'Make private' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Now private.');
  expect(await publicEntry(stack, 'Fix the footer')).toBeUndefined();

  // A task created as public from the start.
  await page.locator('details.new-task').evaluate((d) => { d.open = true; });
  await form.getByLabel('Title', { exact: true }).fill('Announce the launch');
  await form.getByLabel('Public').check();
  await form.getByRole('button', { name: 'Create task' }).click();
  await expect(form.locator('.notice.ok')).toContainText('(public)');
  expect(await publicEntry(stack, 'Announce the launch')).toBeTruthy();
});

test('log: undo a single action, and a refusal shows its reason', async ({ page, stack }) => {
  const q = await stack.queue();
  const csv = q.pending.find((e) => e.title === 'Export to CSV');
  const btn = q.pending.find((e) => e.title === 'Button is broken');
  expect((await stack.admin('admin.update', { body: { id: csv.id, state: 'published' } })).json.ok).toBe(true);
  expect((await stack.admin('admin.update', { body: { id: btn.id, state: 'published' } })).json.ok).toBe(true);
  await signIn(page, stack);
  await tab(page, 'Log').click();

  // Undo the newest publish (Button is broken).
  const rowBtn = page.locator('li.action').filter({ hasText: 'Button is broken' }).first();
  await rowBtn.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.locator('li.action .kind', { hasText: /^undo$/i }).first()).toBeVisible();
  expect((await entryByTitle(stack, 'Button is broken')).state).toBe('pending');
  expect(await publicEntry(stack, 'Button is broken')).toBeUndefined();

  // Make the other publish stale behind the page's back, then press Undo: the refusal reason is shown.
  const rowCsv = page.locator('li.action').filter({ hasText: 'Export to CSV' }).first();
  await expect(rowCsv.getByRole('button', { name: /^Undo/ })).toBeVisible();
  expect((await stack.admin('admin.update', { body: { id: csv.id, status: 'planned' } })).json.ok).toBe(true);
  await rowCsv.getByRole('button', { name: /^Undo/ }).click();
  await expect(rowCsv.locator('.notice.bad')).toContainText('Not undone:');
  expect((await entryByTitle(stack, 'Export to CSV')).state).toBe('published');
});

test('log: runs with digest, show actions, undo a run (in-page confirm, no native dialog) and its refusals', async ({ page, stack }) => {
  const q = await stack.queue();
  const csv = q.pending.find((e) => e.title === 'Export to CSV');
  const btn = q.pending.find((e) => e.title === 'Button is broken');
  const res = await stack.apply([
    { id: csv.id, fingerprint: csv.fingerprint, action: 'publish', confidence: 95, reason: 'ok' },
    { id: btn.id, fingerprint: btn.fingerprint, action: 'publish', confidence: 95, reason: 'ok' },
  ], { reviewer: 'Claude Test', digest: 'Published two.\nAll fine.' });
  // Change one of them afterwards so the run undo has to refuse it.
  expect((await stack.admin('admin.update', { body: { id: csv.id, status: 'done' } })).json.ok).toBe(true);

  await signIn(page, stack);
  await tab(page, 'Log').click();
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  const run = page.locator(`li.run[data-run="${res.run_id}"]`);
  await expect(run).toContainText('Claude Test');
  await expect(run).toContainText('Published two.');
  await expect(run).toContainText('All fine.');

  await run.getByRole('button', { name: 'Show actions' }).click();
  await expect(page.locator('li.action')).toHaveCount(2);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();

  const runCard = () => page.locator(`li.run[data-run="${res.run_id}"]`);
  const msg = page.locator(`li.run[data-run="${res.run_id}"] > .notice`);
  // No native dialog any more: the confirmation is in the page.
  let native = 0;
  page.on('dialog', (d) => { native++; d.dismiss(); });

  // Cancel (button, then Esc) does nothing and returns focus to "Undo this run".
  await runCard().getByRole('button', { name: 'Undo this run' }).click();
  const confirmBox = runCard().getByRole('alertdialog');
  await expect(confirmBox).toContainText('run #' + res.run_id);
  await expect(confirmBox.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirmBox.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmBox).toBeHidden();
  await expect(runCard().getByRole('button', { name: 'Undo this run' })).toBeFocused();
  await runCard().getByRole('button', { name: 'Undo this run' }).click();
  await page.keyboard.press('Escape');
  await expect(confirmBox).toBeHidden();
  await expect(runCard().getByRole('button', { name: 'Undo this run' })).toBeFocused();
  expect((await entryByTitle(stack, 'Button is broken')).state).toBe('published');

  // Confirm: the run is undone, the entry that changed afterwards is refused.
  await runCard().getByRole('button', { name: 'Undo this run' }).click();
  await confirmBox.getByRole('button', { name: 'Yes, undo run #' + res.run_id }).click();
  await expect(msg).toContainText('Undone: 1');
  await expect(msg).toContainText('Refused: 1');
  await expect(msg.locator('li')).toContainText('Action');
  expect((await entryByTitle(stack, 'Button is broken')).state).toBe('pending');
  expect((await entryByTitle(stack, 'Export to CSV')).state).toBe('published');
  expect(native).toBe(0);
});

test('sign out returns to the sign-in form and ends the session', async ({ page, stack }) => {
  await signIn(page, stack);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Owner token')).toBeVisible();
  await expect(page.locator('#login-msg')).toContainText('signed out');
  await page.reload();
  await expect(page.getByLabel('Owner token')).toBeVisible();
  const me = await page.evaluate(async () => (await fetch('../api.php?action=admin.me')).status);
  expect(me).toBe(401);
});

test('a session that ends mid-use sends you back to sign-in', async ({ page, stack }) => {
  await signIn(page, stack);
  await page.context().clearCookies();
  await tab(page, 'Pending').click();
  await expect(page.locator('#login-msg')).toContainText('session ended');
});

test('CSP: no violations, no console errors, and visitor text is never rendered as HTML', async ({ page, stack }) => {
  const seen = watchCsp(page);
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(stack.adminUrl);
  const res = await page.request.get(stack.adminUrl);
  const csp = res.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['cache-control']).toContain('no-store');
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex');
  expect(await page.locator('[style]').count()).toBe(0);

  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const evil = await openCard(page, '<img src=x onerror=alert(1)>');
  await expect(evil.locator('.entry-title')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(evil.locator('.entry-text')).toContainText('<b>not bold</b>');
  expect(await page.locator('main img, main b').count()).toBe(0);
  for (const t of ['Needs you', 'Published', 'Rejected', 'Merged', 'My tasks', 'Log', 'Dashboard']) {
    await tab(page, t).click();
    await expect(page.locator('h1')).toHaveText('ArghBox admin: ' + t);
    await page.waitForLoadState('networkidle'); // the section has loaded its data
  }
  await page.locator('.export-menu summary').click();
  await expect(page.locator('.export-link')).toHaveCount(3);
  await page.locator('.export-menu summary').click();
  await page.locator('details.connect summary').click();
  await expect(page.locator('#mcp-command')).toBeVisible();
  expect(await page.locator('[style]').count()).toBe(0);
  expect(dialogs).toEqual([]);
  expect(await seen.collect()).toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(seen.pageErrors).toEqual([]);
});

test('export: JSON, CSV and Jira CSV download with the right names and content', async ({ page, stack }) => {
  await signIn(page, stack);
  const download = async (format) => {
    await page.locator('.export-menu summary').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(`.export-link[data-format="${format}"]`).click()]);
    const file = await dl.path();
    return { name: dl.suggestedFilename(), text: fs.readFileSync(file, 'utf8') };
  };
  await expect(page.getByText('Jira → System → External system import → CSV')).toBeHidden();
  await page.locator('.export-menu summary').click();
  await expect(page.getByText('Jira → System → External system import → CSV')).toBeVisible();
  await page.locator('.export-menu summary').click();

  const json = await download('json');
  expect(json.name).toMatch(/^arghbox-.+-\d{8}\.json$/);
  const data = JSON.parse(json.text);
  expect(data.entries.map((e) => e.title)).toContain('Dark mode please');
  expect(data.entries.map((e) => e.title)).not.toContain('Buy cheap pills'); // rejected is left out by default
  expect(Array.isArray(data.runs)).toBe(true);

  const csv = await download('csv');
  expect(csv.name).toMatch(/^arghbox-.+-\d{8}\.csv$/);
  expect(csv.text.charCodeAt(0)).toBe(0xfeff);
  expect(csv.text.slice(1).split(/\r?\n/)[0]).toMatch(/^id,type,state,status,title,body,votes,tags/);
  expect(csv.text).toContain('Dark mode please');

  // The state filter applies to CSV.
  await page.locator('.export-menu summary').click();
  await page.locator('#export-state').selectOption('rejected');
  await page.locator('.export-menu summary').click();
  const rejectedCsv = await download('csv');
  expect(rejectedCsv.text).toContain('Buy cheap pills');
  expect(rejectedCsv.text).not.toContain('Dark mode please');

  const jira = await download('jira-csv');
  expect(jira.name).toMatch(/^arghbox-.+-\d{8}-jira\.csv$/);
  expect(jira.text.replace(/^﻿/, '').split(/\r?\n/)[0]).toBe('Summary,Description,Issue Type,Labels');
  expect(jira.text).toContain('Dark mode please');
  expect(jira.text).toContain('From ArghBox #');
});

test('linked issue: set, shown as a safe link, cleared, invalid rejected', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Dark mode please');
  await c.locator('details.edit summary').click();
  const input = c.getByLabel(/^Linked issue/);
  const save = c.getByRole('button', { name: 'Save changes' });

  // Invalid values are refused on the client with a message.
  for (const bad of ['javascript:alert(1)', 'not a url', 'ftp://example.com/x']) {
    await input.fill(bad);
    await save.click();
    await expect(c.locator('.notice.bad')).toContainText('http or https');
  }
  expect((await entryByTitle(stack, 'Dark mode please')).external_url ?? null).toBeNull();
  // The server refuses too, with its own message.
  const target = await entryByTitle(stack, 'Dark mode please');
  const refused = await stack.admin('admin.update', { body: { id: target.id, external_url: 'javascript:alert(1)' } });
  expect(refused.json.ok).toBe(false);
  expect(refused.json.message).toContain('http or https');

  await input.fill('https://example.atlassian.net/browse/AB-1');
  await save.click();
  await expect(c.locator('.notice.ok')).toHaveText('Saved.');
  const link = c.locator('a.external-link');
  await expect(link).toHaveAttribute('href', 'https://example.atlassian.net/browse/AB-1');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveAttribute('rel', /noreferrer/);
  expect((await entryByTitle(stack, 'Dark mode please')).external_url).toBe('https://example.atlassian.net/browse/AB-1');
  // Not part of the public list.
  expect(JSON.stringify(await publicEntry(stack, 'Dark mode please'))).not.toContain('atlassian');

  await c.locator('details.edit summary').click();
  await c.getByLabel(/^Linked issue/).fill('');
  await c.getByRole('button', { name: 'Save changes' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Saved.');
  await expect(c.locator('a.external-link')).toHaveCount(0);
  expect((await entryByTitle(stack, 'Dark mode please')).external_url ?? null).toBeNull();
});

test('pending is oldest first; published sort and status filter go through the API', async ({ page, stack }) => {
  const requests = [];
  page.on('request', (r) => { if (r.url().includes('action=admin.entries')) requests.push(new URL(r.url()).searchParams); });
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  await expect(page.locator('article.entry')).toHaveCount(3);
  const titles = await page.locator('article.entry .entry-title').allTextContents();
  expect(titles).toEqual(['Export to CSV', 'Button is broken', '<img src=x onerror=alert(1)>']);
  expect(requests.some((q) => q.get('state') === 'pending' && q.get('sort') === 'oldest')).toBe(true);

  await tab(page, 'Published').click();
  await expect(page.locator('article.entry')).toHaveCount(2);
  await page.getByLabel('Sort').selectOption('votes');
  await expect.poll(() => requests.some((q) => q.get('state') === 'published' && q.get('sort') === 'votes')).toBe(true);
  await expect(page.locator('article.entry .entry-title').first()).toHaveText('Dark mode please');
  await page.getByLabel('Filter by status').selectOption('planned');
  await expect.poll(() => requests.some((q) => q.get('status') === 'planned' && q.get('limit') === '25')).toBe(true);
  await expect(page.locator('article.entry')).toHaveCount(1);
  await expect(card(page, 'Map crashes on save')).toBeVisible();
  // No "fetch everything" requests any more.
  expect(requests.every((q) => q.get('limit') === '25' || q.get('limit') === '8')).toBe(true);
});

test('entry history list shows the entry actions with undo', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Map crashes on save');
  await c.getByLabel('Status', { exact: true }).selectOption('done');
  await c.getByRole('button', { name: 'Set status' }).click();
  await expect(c.locator('.notice.ok')).toContainText('Done');
  await c.locator('details.history summary').click();
  const row = c.locator('details.history li.action').first();
  await expect(row.locator('.kind')).toHaveText('set_status');
  await row.getByRole('button', { name: /^Undo/ }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Undone.');
  expect((await entryByTitle(stack, 'Map crashes on save')).status).toBe('planned');
});

test('connect your AI: MCP command with this install URL and no token, feed URL, copy buttons', async ({ page, stack }) => {
  await signIn(page, stack);
  await expect(page.locator('#mcp-command')).toBeHidden();
  await page.locator('details.connect summary').click();
  const cmd = await page.locator('#mcp-command').textContent();
  expect(cmd).toBe(`claude mcp add --transport http arghbox ${stack.arghboxUrl}mcp.php --header "Authorization: Bearer <YOUR_TRIAGE_TOKEN>"`);
  expect(cmd).not.toContain(stack.triageToken);
  expect(cmd).not.toContain(stack.ownerToken);
  expect(await page.locator('details.connect').textContent()).not.toContain(stack.ownerToken);
  await expect(page.locator('details.connect')).toContainText('triage.mjs fetch');
  await expect(page.locator('details.connect')).toContainText('empty the ArghBox');
  await expect(page.locator('details.connect')).toContainText('mcp-config');
  await expect(page.locator('details.connect')).toContainText('read-only token');
  await expect(page.locator('#feed-url')).toHaveText(`${stack.arghboxUrl}api.php?action=feed`);
  await page.getByRole('button', { name: 'Copy the MCP command' }).click();
  await expect(page.locator('.copy-status').first()).toHaveText(/Copied|Copy failed/);
});

test('read-only actor: write controls are hidden', async ({ page, stack }) => {
  await page.route('**/api.php?action=admin.me', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, actor: 'read' } });
  });
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const c = await openCard(page, 'Export to CSV');
  await expect(c.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await expect(c.locator('details.merge, details.edit')).toHaveCount(0);
  await expect(c.locator('.comment-form')).toHaveCount(0);
  await expect(c.locator('details.history')).toHaveCount(1);
  await tab(page, 'My tasks').click();
  await expect(page.locator('details.new-task')).toHaveCount(0);
});

test('layout: no horizontal page scroll, focus is visible, screenshots', async ({ page, stack }, info) => {
  await signIn(page, stack);
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await noOverflow();
  await page.screenshot({ path: info.outputPath(`dashboard-${info.project.name}.png`) });
  await tab(page, 'Pending').click();
  await noOverflow();
  const c = await openCard(page, 'Export to CSV');
  await c.getByLabel('New comment or note').fill('A note to self.');
  await c.getByLabel('Comment visibility').selectOption('0');
  await c.locator('.comment-form').getByRole('button', { name: 'Add' }).click();
  await expect(c.locator('.comment.private')).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: info.outputPath(`entry-${info.project.name}.png`), fullPage: true });
  await tab(page, 'Log').click();
  await noOverflow();
  await page.screenshot({ path: info.outputPath(`log-${info.project.name}.png`) });
  // Dark mode: dashboard with the Connect panel and the export menu, and the entry panel.
  await page.emulateMedia({ colorScheme: 'dark' });
  await tab(page, 'Dashboard').click();
  await page.locator('details.connect summary').click();
  await page.locator('.export-menu summary').click();
  await page.screenshot({ path: info.outputPath(`dashboard-dark-${info.project.name}.png`), fullPage: true });
  await page.locator('.export-menu summary').click();
  await tab(page, 'Pending').click();
  await openCard(page, 'Button is broken');
  await page.screenshot({ path: info.outputPath(`entry-dark-${info.project.name}.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  // Keyboard: the first tab stop shows a focus ring.
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe('none');
});

// ---------------------------------------------------------------- robustness, structure and a11y

test('a double click on Add posts one comment; a double submit of Create task makes one task', async ({ page, stack }) => {
  await signIn(page, stack);
  const slow = async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.continue(); };
  const posts = { comment: 0, create: 0 };
  await page.route('**/api.php?action=admin.comment', async (route) => { posts.comment++; await slow(route); });
  await page.route('**/api.php?action=admin.create', async (route) => { posts.create++; await slow(route); });

  await tab(page, 'Published').click();
  const c = await openCard(page, 'Dark mode please');
  const form = c.locator('.comment-form');
  await form.getByLabel('New comment or note').fill('Only once, please.');
  await form.getByRole('button', { name: 'Add' }).dblclick();
  await expect(c.locator('.notice.ok')).toHaveText('Public comment added.');
  expect(posts.comment).toBe(1);
  expect((await publicEntry(stack, 'Dark mode please')).comments.filter((x) => x.body === 'Only once, please.')).toHaveLength(1);

  await tab(page, 'My tasks').click();
  await page.locator('details.new-task > summary').click();
  await page.locator('.task-form').getByLabel('Title').fill('Pay the hosting bill');
  await page.locator('.task-form').getByRole('button', { name: 'Create task' }).dblclick();
  await expect(page.locator('.task-form .notice.ok')).toContainText('Created #');
  expect(posts.create).toBe(1);
  expect((await stack.entries({ source: 'owner' })).filter((e) => e.title === 'Pay the hosting bill')).toHaveLength(1);
  // the button works again afterwards
  await expect(page.locator('.task-form').getByRole('button', { name: 'Create task' })).toBeEnabled();
});

test('write buttons of a card are disabled while its request runs, and come back after a failure', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const c = await openCard(page, 'Button is broken');
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api.php?action=admin.update', async (route) => {
    await gate;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'server_error', message: 'Boom.' }) });
  });
  await c.getByRole('button', { name: 'Flag', exact: true }).click();
  await expect(c.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await expect(c).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(c.locator('.notice.bad')).toContainText('Boom.');
  await expect(c.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await expect(c).not.toHaveAttribute('aria-busy', 'true');
});

test('merge picker: a late answer to an older search never replaces the newer results', async ({ page, stack }) => {
  await signIn(page, stack);
  await tab(page, 'Pending').click();
  const c = await openCard(page, 'Export to CSV');
  await c.locator('details.merge summary').click();
  await expect(c.locator('.pick').first()).toBeVisible(); // the first (empty) search finished
  let slowSeen = 0;
  await page.route('**/api.php?action=admin.entries*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'Map') { slowSeen++; await new Promise((r) => setTimeout(r, 1500)); } // the older search answers last
    await route.continue();
  });
  const slowAnswered = page.waitForResponse((r) => r.url().includes('action=admin.entries') && r.url().includes('q=Map'));
  const input = c.getByLabel('Search published entries to merge into');
  await input.fill('Map');
  await expect.poll(() => slowSeen).toBe(1);
  await input.fill('Dark');
  await expect(c.locator('.pick', { hasText: 'Dark mode please' })).toBeVisible();
  await expect(c.locator('.pick', { hasText: 'Map crashes' })).toHaveCount(0);
  // wait until the slow answer has been delivered and the page has had a frame to handle it, then check it did not win
  await slowAnswered;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(c.locator('.pick', { hasText: 'Dark mode please' })).toBeVisible();
  await expect(c.locator('.pick', { hasText: 'Map crashes' })).toHaveCount(0);
});

test('a failing admin.queue does not bounce a signed-in owner to the sign-in form: banner with Retry', async ({ page, stack }) => {
  let fail = true;
  await page.route('**/api.php?action=admin.queue', (route) => (fail
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'server_error', message: 'Too slow.' }) })
    : route.continue()));
  await page.goto(stack.adminUrl);
  await page.getByLabel('Owner token').fill(stack.ownerToken);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(tab(page, 'Dashboard')).toBeVisible();
  await expect(page.getByLabel('Owner token')).toHaveCount(0);
  const banner = page.getByRole('alert').filter({ hasText: 'Could not load the site name and the tag list' });
  await expect(banner).toBeVisible();
  // the rest of the page works without the vocabulary
  await tab(page, 'Published').click();
  await expect(card(page, 'Dark mode please')).toBeVisible();
  // a reload with the owner still signed in also keeps the app
  await page.reload();
  await expect(tab(page, 'Published')).toBeVisible();
  await expect(banner).toBeVisible();

  fail = false;
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(banner).toBeHidden();
  await tab(page, 'Published').click();
  await expect(page.getByLabel('Filter by tag').locator('option', { hasText: '#design' })).toHaveCount(1);
});

test('saving tags does not reload the whole queue, and the new tag is suggested afterwards', async ({ page, stack }) => {
  await signIn(page, stack);
  let queue = 0;
  await page.route('**/api.php?action=admin.queue', (route) => { queue++; return route.continue(); });
  await tab(page, 'Published').click();
  const c = await openCard(page, 'Map crashes on save');
  const input = c.locator('.panel-row').getByLabel('Add a tag to entry');
  await input.fill('crash');
  await input.press('Enter');
  await c.getByRole('button', { name: 'Save tags' }).click();
  await expect(c.locator('.notice.ok')).toHaveText('Tags saved.');
  expect(queue).toBe(0);
  await expect(c.getByRole('button', { name: 'Remove tag crash' })).toBeVisible();
});

test('structure: one h1 naming the section, a main landmark around the tab panel', async ({ page, stack }) => {
  await page.goto(stack.adminUrl);
  await expect(page.locator('main.login h1')).toHaveText('ArghBox admin'); // sign-in view
  await signIn(page, stack);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('ArghBox admin: Dashboard');
  await tab(page, 'Log').click();
  await expect(page.locator('h1')).toHaveText('ArghBox admin: Log');
  await expect(page.locator('main > #main[role=tabpanel]')).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Sections"] [role=tablist]')).toHaveCount(1);
  await expect(page.locator('header.top')).toHaveCount(1);
  // every visible control sits inside a landmark (banner, nav or main)
  const stray = await page.evaluate(() => [...document.querySelectorAll('button, a, input, select')].filter((el) => !el.closest('header, nav, main') && el.offsetParent !== null).length);
  expect(stray).toBe(0);
});

test('search engines: the admin page says noindex in the header and the markup', async ({ page, stack }) => {
  const res = await page.request.get(stack.adminUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()['x-robots-tag']).toMatch(/noindex/);
  expect(await res.text()).toMatch(/<meta name="robots" content="noindex">/);
  expect(res.headers()['cache-control']).toMatch(/no-store/);
});

test('plain http on a real host name is refused with a page the CSP lets render', async ({ page, stack }) => {
  // The dev stack is on loopback (allowed). Ask for the same page under a public host name to get the refusal.
  const http = await import('node:http');
  const url = new URL(stack.adminUrl);
  const got = await new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, headers: { Host: 'example.test' } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
  expect(got.status).toBe(403);
  expect(got.body).toContain('Use https://');
  expect(got.body).not.toMatch(/\sstyle=/); // inline styles are blocked by the page's own CSP
  expect(got.headers['content-security-policy']).toContain("style-src 'self'");

  const seen = watchCsp(page);
  await page.route('**/arghbox/admin/', (route) => route.fulfill({ status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': got.headers['content-security-policy'] }, body: got.body }));
  await page.goto(stack.adminUrl);
  await expect(page.locator('h1')).toHaveText('Use https://');
  await expect(page.locator('.login-card')).toHaveCSS('border-top-width', '1px'); // admin.css was applied
  expect(await seen.collect()).toEqual([]);
});
