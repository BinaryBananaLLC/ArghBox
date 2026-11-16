#!/usr/bin/env node
// Takes the README screenshots of the real widget and the real admin page with Playwright.
// It starts the real backend on throwaway data seeded with tests/fixtures/demo-seed.json, stubs Turnstile,
// and writes PNGs to docs/images/.
//
//   node tools/capture.mjs            (needs `npx playwright install chromium`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { startRealStack, demoSeed } from '../e2e/support/real-stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'docs', 'images');
const stub = fs.readFileSync(path.join(REPO, 'e2e', 'support', 'turnstile-stub.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

const stack = await startRealStack({
  seed: demoSeed,
  config: {
    site_name: 'Pocket Maps',
    about: 'Pocket Maps makes tiny map tools: drop pins, draw routes, share a link.',
    welcome: 'Tell us what bugs you. We read everything and reply here.',
    tags: ['design', 'mobile', 'export', 'integrations'],
  },
});

const browser = await chromium.launch();
const shot = (name) => path.join(OUT, name);
const DESKTOP = { width: 1280, height: 800 };

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2, ...opts });
  await context.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: stub }));
  const page = await context.newPage();
  return { page, context };
}
const panel = (page) => page.locator('#arghbox-root .panel');

async function openList(page) {
  await page.goto(stack.siteUrl + '/');
  await page.locator('#arghbox-root .t').click();
  await panel(page).locator('.card').first().waitFor();
  await page.waitForTimeout(500);
}

try {
  // one visitor entry that the "AI" triaged, so the admin page has an AI note to show
  const added = await stack.add({
    type: 'question',
    title: 'Czy mogę zapisać trasę offline?',
    body: 'Jadę w góry, tam nie ma zasięgu. Czy trasa zostanie na telefonie?',
  });
  if (!added.json?.ok) throw new Error('could not add the demo entry: ' + added.text);
  const queue = await stack.queue();
  const pending = queue.pending.find((e) => e.id === added.json.entry.id);
  await stack.apply([{
    id: pending.id, fingerprint: pending.fingerprint, action: 'publish', type: 'question',
    title: 'Can I save a route offline?', tags: ['mobile'], confidence: 93,
    reason: 'A real question from a visitor, written in Polish. Nothing like it on the board yet. Published with an English title so other visitors can find it.',
    title_en: 'Can I save a route offline?',
  }], { reviewer: 'Claude Opus', digest: '1 published: an offline-routes question (translated from Polish).\n0 spam today.' });
  await stack.admin('admin.comment', { body: { id: pending.id, body: 'Yes: save the area on Wi-Fi first and your routes stay on the phone.', public: true } });

  // 1. the demo page with the tab
  {
    const { page, context } = await newPage({ colorScheme: 'light' });
    await page.goto(stack.siteUrl + '/');
    await page.locator('#arghbox-root .t').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('demo-page.png') });
    await context.close();
  }

  // 2. the list, light and dark
  for (const scheme of ['light', 'dark']) {
    const { page, context } = await newPage({ colorScheme: scheme });
    await openList(page);
    await page.screenshot({ path: shot(`dialog-list-${scheme}.png`) });
    await context.close();
  }

  // 3. the add form with similar suggestions, and 4. the entry detail with the owner's comments
  {
    const { page, context } = await newPage({ colorScheme: 'light' });
    await openList(page);
    await panel(page).getByRole('button', { name: 'Add your argh' }).click();
    await panel(page).getByLabel('In a few words').pressSequentially('Dark theme for the dialog', { delay: 20 });
    await panel(page).locator('.sim, [class*=similar], .sg').first().waitFor({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('add-similar.png') });
    await panel(page).getByRole('button', { name: 'Back' }).click().catch(() => {});
    await page.keyboard.press('Escape');
    await context.close();
  }
  {
    const { page, context } = await newPage({ colorScheme: 'light' });
    await openList(page);
    await panel(page).locator('.card', { hasText: 'Dark mode for the widget' }).click();
    await panel(page).locator('.cm').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('entry-detail.png') });
    await context.close();
  }

  // 5. the phone view
  {
    const { page, context } = await newPage({ ...devices['Pixel 7'], colorScheme: 'light', deviceScaleFactor: 2 });
    await openList(page);
    await page.screenshot({ path: shot('phone.png') });
    await context.close();
  }

  // 6. the admin page
  {
    const { page, context } = await newPage({ colorScheme: 'light' });
    await page.goto(stack.adminUrl);
    await page.getByLabel('Owner token').fill(stack.ownerToken);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('tab', { name: /Dashboard/ }).waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('admin-dashboard.png') });

    await page.getByRole('tab', { name: /^Published/ }).click();
    const card = page.locator('article.entry').filter({ hasText: 'Can I save a route offline?' }).first();
    await card.waitFor();
    await card.locator('.entry-toggle').click();
    await card.locator('.ai').waitFor();
    await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    const b = await card.boundingBox();
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.screenshot({
      path: shot('admin-entry.png'),
      fullPage: true,
      clip: { x: Math.max(0, b.x - 24), y: Math.max(0, b.y + scrollY - 24), width: b.width + 48, height: Math.min(b.height, 640) + 24 },
    });
    await context.close();
  }
  console.log(`Screenshots written to ${path.relative(process.cwd(), OUT) || OUT}`);
} finally {
  await browser.close();
  await stack.stop();
}
