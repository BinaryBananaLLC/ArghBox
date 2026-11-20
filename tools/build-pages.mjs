#!/usr/bin/env node
// Builds the live demo for GitHub Pages: demo/ (Contoso Tasks, a made-up site) plus the browser files of
// arghbox/ (the real widget, admin page and mobile app page). GitHub Pages runs no PHP, so the build adds
// demo/backend.js to each page: it answers api.php in the browser and keeps the box in localStorage.
// The source files stay as they are, so `npm run dev` keeps serving demo/ with the real PHP box.
//
//   node tools/build-pages.mjs [--out DIR]               build into dist/pages (git-ignored)
//   node tools/build-pages.mjs --serve [--port 8790]     build, then serve it at http://localhost:8790/ArghBox/
//
// The Demo workflow (.github/workflows/demo.yml) runs the build and publishes dist/pages.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_OUT = path.join(REPO, 'dist', 'pages')
/** The path GitHub Pages serves a project site under: https://<owner>.github.io/ArghBox/ */
export const BASE_PATH = '/ArghBox/'

// demo/ files that go online. demo/README.md stays on GitHub.
const DEMO_FILES = ['demo.css', 'demo.js', 'contoso.svg', 'backend.js', 'admin-note.js', 'phone-bridge.js']
// arghbox/ files a browser loads. No PHP, no config, no data: none of it would run on a static host.
const ARGHBOX_FILES = ['arghbox.js', 'arghbox-app.js', 'app-page.js', 'admin/admin.js', 'admin/admin.css', 'admin/logo.svg']

/** Puts `tags` right before the first `marker` in `html`; throws when the marker is missing (a renamed tag). */
function insertBefore(html, marker, tags, file) {
  const at = html.indexOf(marker)
  if (at < 0) throw new Error(`build-pages: "${marker}" not found in ${file}`)
  return html.slice(0, at) + tags + '\n' + html.slice(at)
}

/** Builds the demo into `out` (emptied first). Returns { out, version, files }. */
export function buildPages({ out = DEFAULT_OUT } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version
  const v = `?v=${version}`
  const src = (...p) => path.join(REPO, ...p)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'arghbox', 'admin'), { recursive: true })
  fs.mkdirSync(path.join(out, 'arghbox', 'i18n'), { recursive: true })
  const write = (rel, text) => fs.writeFileSync(path.join(out, rel), text)

  // The Contoso page: the in-browser box goes where the page marks it, before demo.js and the loader.
  const index = fs.readFileSync(src('demo', 'index.html'), 'utf8')
  const marker = '<!-- arghbox-demo-backend -->'
  if (!index.includes(marker)) throw new Error(`build-pages: "${marker}" not found in demo/index.html`)
  write('index.html', index.replace(marker, `<script src="backend.js${v}"></script>`))
  for (const f of DEMO_FILES) fs.copyFileSync(src('demo', f), path.join(out, f))

  for (const f of ARGHBOX_FILES) fs.copyFileSync(src('arghbox', f), path.join(out, 'arghbox', f))
  for (const f of fs.readdirSync(src('arghbox', 'i18n'))) {
    if (/^[\w-]+\.json$/.test(f)) fs.copyFileSync(src('arghbox', 'i18n', f), path.join(out, 'arghbox', 'i18n', f))
  }

  // The mobile app page: the box, then the stand-in for the app's bridge (used inside the demo page's phone).
  const app = fs.readFileSync(src('arghbox', 'app.html'), 'utf8')
  write('arghbox/app.html', insertBefore(app, '<script src="app-page.js', `<script src="../backend.js${v}"></script>\n<script src="../phone-bridge.js${v}"></script>`, 'arghbox/app.html'))

  // The admin page: index.php is headers plus a static HTML shell. Pages serves the shell as index.html.
  const php = fs.readFileSync(src('arghbox', 'admin', 'index.php'), 'utf8')
  const shell = php.slice(php.lastIndexOf('?>') + 2).replace(/^\s+/, '')
  if (!/^<!doctype html>/i.test(shell)) throw new Error('build-pages: arghbox/admin/index.php no longer ends with the HTML shell')
  write('arghbox/admin/index.html', insertBefore(shell, '<script src="admin.js', `<script src="../../backend.js${v}"></script>\n<script src="../../admin-note.js${v}"></script>`, 'arghbox/admin/index.php'))

  // No Jekyll: serve the files as they are.
  write('.nojekyll', '')

  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(out, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) walk(rel)
      else files.push(rel)
    }
  }
  walk('')
  const php2 = files.filter((f) => f.endsWith('.php'))
  if (php2.length) throw new Error(`build-pages: PHP files in the output: ${php2.join(', ')}`)
  return { out, version, files: files.sort() }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

/**
 * Serves a built demo like GitHub Pages does: under BASE_PATH, index.html for folders, a redirect for a folder
 * without its slash, 404 for anything else (api.php included: on Pages it does not exist).
 * Returns { url, close }.
 */
export function servePages({ dir = DEFAULT_OUT, port = 0, host = '127.0.0.1' } = {}) {
  const root = path.resolve(dir)
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (!u.pathname.startsWith(BASE_PATH)) {
      res.writeHead(u.pathname === '/' || u.pathname === BASE_PATH.slice(0, -1) ? 301 : 404, { Location: BASE_PATH })
      return res.end()
    }
    let rel
    try { rel = decodeURIComponent(u.pathname.slice(BASE_PATH.length)) } catch { rel = '\0' }
    let file = path.resolve(root, rel)
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(404); return res.end() }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!u.pathname.endsWith('/')) { res.writeHead(301, { Location: u.pathname + '/' + u.search }); return res.end() }
      file = path.join(file, 'index.html')
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><title>404</title><p>File not found')
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const p = server.address().port
      resolve({ url: `http://${host}:${p}${BASE_PATH}`, port: p, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) }) })
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const out = opt('--out') ? path.resolve(opt('--out')) : DEFAULT_OUT
  const { files, version } = buildPages({ out })
  console.log(`Demo ${version}: ${files.length} files in ${path.relative(process.cwd(), out) || '.'}`)
  if (args.includes('--serve')) {
    const { url } = await servePages({ dir: out, port: Number(opt('--port') || 8790) })
    console.log(`Serving the GitHub Pages demo at ${url}  (admin password: demo). Press Ctrl+C to stop.`)
  }
}
