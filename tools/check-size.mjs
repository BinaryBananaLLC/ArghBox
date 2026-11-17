// Fails when the widget files exceed their gzipped budgets (SPEC section 11).
// Usage: node tools/check-size.mjs
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// The loader runs on every page of the host site, so its budget stays tight. The app is only
// downloaded when a visitor shows intent (hover, focus or click on the tab), so it has more room.
const budgets = [
  ['arghbox/arghbox.js', 4 * 1024],
  ['arghbox/arghbox-app.js', 20 * 1024],
  // The mobile app page script: tiny too, it runs before anything shows in the app's WebView.
  ['arghbox/app-page.js', 2 * 1024],
]
let failed = false
for (const [file, max] of budgets) {
  const buf = readFileSync(path.join(root, file))
  const gz = gzipSync(buf, { level: 9 }).length
  const ok = gz <= max
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}: ${buf.length} bytes, ${gz} gzipped (budget ${max})`)
}
process.exit(failed ? 1 : 0)
