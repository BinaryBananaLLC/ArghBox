// Playwright end-to-end tests for the widget, the admin page and the website.
// Specs live in e2e/*.spec.mjs and start their own servers through the fixtures in e2e/support/.
//
// Projects:
//   desktop       Desktop Chrome, every spec
//   phone         Pixel 7 (Chromium), every spec
//   firefox       Desktop Firefox, widget.spec + demo.spec (the widget is what runs in visitors' browsers)
//   webkit-phone  iPhone 13 (WebKit, the engine of every iOS browser), widget.spec + demo.spec
// The admin page is for the owner only, so it is tested in Chromium (desktop and phone).
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI
const BROWSER_SPECS = /(widget|demo)\.spec\.mjs$/

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.mjs',
  // ARGHBOX_E2E_OUTPUT_DIR keeps parallel runs on one machine apart.
  outputDir: process.env.ARGHBOX_E2E_OUTPUT_DIR || 'test-results',
  fullyParallel: false,
  // Every test starts its own PHP or Node servers on free ports, so workers never share state. CI runners have
  // 2 to 4 cores, and PHP plus a browser per worker is heavy: 2 there, up to 4 on a developer machine.
  workers: CI ? 2 : Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2))),
  retries: CI ? 1 : 0,
  // Sized for a cold CI runner (WebKit and Firefox start slower than Chromium).
  timeout: CI ? 60_000 : 30_000,
  expect: { timeout: CI ? 10_000 : 5_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'firefox', testMatch: BROWSER_SPECS, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-phone', testMatch: BROWSER_SPECS, use: { ...devices['iPhone 13'] } },
  ],
})
