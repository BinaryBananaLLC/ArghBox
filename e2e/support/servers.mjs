/**
 * Test servers and Playwright fixtures for widget specs.
 *
 *   import { test, expect, hostUrl, setTurnstileMode } from './support/servers.mjs'
 *   test('x', async ({ page, api, servers }) => {
 *     await page.goto(hostUrl(servers, 'plain', { 'data-position': 'left' }))
 *   })
 *
 * startServers() starts, on random ports:
 *   - a static server (servers.siteUrl): host pages from e2e/support/host-pages/ at /<name>.html and the
 *     real arghbox/ folder at /arghbox/ (JS and JSON with Cache-Control: public, max-age=3600 like .htaccess).
 *     `/arghbox/api.php` is answered by the fake API, so the default data-api (api.php next to the script) works.
 *   - the fake API on its own port (servers.apiUrl): a cross-origin API, used with `api: 'cross'`.
 *   Both share one fake API state (servers.api, see fake-api.mjs).
 *
 * Host pages are templates: the marker <!--ARGHBOX--> is replaced by the widget <script> tag. Query parameters
 * of the page URL configure it: every `data-*` parameter becomes an attribute (data-position=left), `api=cross`
 * sets data-api to the cross-origin fake API, `widget=0` leaves the widget out, `v=` is the ?v= of the script
 * URL (default 0.1.0), `htmllang=pl` sets <html lang>. Use hostUrl() to build such URLs.
 *
 * To run a spec against another backend (the real PHP server), pass `apiHandler: null` and `arghboxDir`
 * options to startServers, or start your own server and use only the host pages (`startStaticServer`).
 *
 * Fixtures exported through `test`:
 *   servers (worker)  the running servers
 *   api               servers.api, reset before every test (auto fixture)
 *   page              Playwright page with the Turnstile stub already routed (mode 'pass')
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect } from '@playwright/test'
import { createFakeApi, startFakeApi } from './fake-api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.join(here, '..', '..')
export const stubSource = fs.readFileSync(path.join(here, 'turnstile-stub.js'), 'utf8')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }

function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

export function scriptTag(params, apiUrl) {
  const v = params.get('v') || '0.1.0'
  const attrs = []
  for (const [k, val] of params) if (k.startsWith('data-')) attrs.push(`${k}="${escapeAttr(val)}"`)
  if (params.get('api') === 'cross' && apiUrl) attrs.push(`data-api="${escapeAttr(apiUrl)}"`)
  return `<script src="/arghbox/arghbox.js?v=${escapeAttr(v)}" defer ${attrs.join(' ')}></script>`
}

export async function startStaticServer({ hostDir = path.join(here, 'host-pages'), arghboxDir = path.join(repoRoot, 'arghbox'), apiHandler = null, apiUrl = '' } = {}) {
  const requests = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    requests.push(url.pathname + url.search)
    if (url.pathname === '/arghbox/api.php' && apiHandler) {
      apiHandler(req, res).catch(() => { try { res.writeHead(500); res.end() } catch {} })
      return
    }
    let file
    let cache = 'no-store'
    if (url.pathname.startsWith('/arghbox/')) {
      file = path.join(arghboxDir, url.pathname.slice('/arghbox/'.length))
      if (/\.(js|json)$/.test(file)) cache = 'public, max-age=3600'
      if (!file.startsWith(arghboxDir)) { res.writeHead(403); return res.end() }
    } else {
      file = path.join(hostDir, url.pathname === '/' ? 'plain.html' : url.pathname.slice(1))
      if (!file.startsWith(hostDir)) { res.writeHead(403); return res.end() }
    }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
      const type = TYPES[path.extname(file)] || 'application/octet-stream'
      let out = buf
      if (type.startsWith('text/html')) {
        const html = buf.toString('utf8')
        const withScript = url.searchParams.get('widget') === '0' ? html.replace('<!--ARGHBOX-->', '') : html.replace('<!--ARGHBOX-->', scriptTag(url.searchParams, apiUrl))
        out = Buffer.from(withScript.replace('<html lang="en"', `<html lang="${escapeAttr(url.searchParams.get('htmllang') || 'en')}"`), 'utf8')
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
      res.end(out)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const siteUrl = `http://127.0.0.1:${server.address().port}`
  return { server, siteUrl, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) }
}

export async function startServers(options = {}) {
  const api = options.api || createFakeApi()
  const cross = await startFakeApi(api)
  const site = await startStaticServer({ apiHandler: options.apiHandler === null ? null : api.handler, apiUrl: cross.url, ...options.static })
  return {
    api,
    siteUrl: site.siteUrl,
    apiUrl: cross.url,
    requests: site.requests,
    close: async () => { await site.close(); await cross.close() },
  }
}

/** Build the URL of a host page: hostUrl(servers, 'plain', {'data-tone': 'neutral', api: 'cross'}) + optional #hash. */
export function hostUrl(servers, name = 'plain', params = {}, hash = '') {
  const q = new URLSearchParams(params).toString()
  return `${servers.siteUrl}/${name}.html${q ? '?' + q : ''}${hash}`
}

export async function installTurnstileStub(page) {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSource }))
}

/** 'pass' | 'interactive' | 'error'; takes effect for the next challenge. */
export async function setTurnstileMode(page, mode) {
  await page.addInitScript((m) => { window.__turnstileMode = m }, mode)
  await page.evaluate((m) => { window.__turnstileMode = m }, mode).catch(() => {})
}

export const test = base.extend({
  servers: [async ({}, use) => {
    const servers = await startServers()
    await use(servers)
    await servers.close()
  }, { scope: 'worker' }],
  // auto: the fake API is reset before every test, even when the test does not ask for it
  api: [async ({ servers }, use) => {
    servers.api.reset()
    servers.requests.length = 0
    await use(servers.api)
  }, { auto: true }],
  page: async ({ page }, use) => {
    await installTurnstileStub(page)
    await use(page)
  },
})

export { expect }
