// Loads arghbox.js / arghbox-app.js in node:vm with a minimal window/document stub (no DOM, no network).
// Shared by the widget unit tests; not a test itself (the test runner only picks *.test.mjs).
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const arghboxDir = path.join(root, 'arghbox')

export function loadScript(file, extra = {}) {
  const window = {
    btoa: (s) => Buffer.from(s, 'latin1').toString('base64'),
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a } },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {}, __arghboxTest: true, ...extra,
  }
  const document = { currentScript: null, querySelector: () => null, addEventListener() {}, documentElement: { lang: 'en' }, body: null }
  window.window = window
  window.document = document
  const ctx = vm.createContext({ window, document, console, setTimeout, clearTimeout })
  vm.runInContext(fs.readFileSync(path.join(arghboxDir, file), 'utf8'), ctx, { filename: file })
  return window
}

export const app = (extra) => loadScript('arghbox-app.js', extra).__arghboxApp
export const loader = () => loadScript('arghbox.js').ArghBox
export const en = () => JSON.parse(fs.readFileSync(path.join(arghboxDir, 'i18n', 'en.json'), 'utf8'))
