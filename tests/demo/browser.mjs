// A tiny fake browser for demo/backend.js: loads it into a node:vm context with a minimal window, document and
// localStorage, and talks to it through the overridden fetch, the way the widget and the admin page do.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo', 'backend.js'), 'utf8');
export const API = 'http://localhost/arghbox/api.php';

export function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    map: m,
  };
}

export const voterKey = (n = 'a') => (n + 'V'.repeat(30)).slice(0, 30);

/** Load backend.js into a fresh context. Pass `storage` to share one localStorage between several "tabs". */
export function loadBackend({ storage = makeStorage(), originalFetch, brokenStorage = false, extra = {} } = {}) {
  const listeners = {};
  const events = [];
  const downloads = [];
  const win = {
    document: {
      baseURI: 'http://localhost/arghbox/admin/index.html',
      addEventListener: (type, fn, capture) => { (listeners[type] ||= []).push({ fn, capture }); },
      createElement: () => ({ click() { downloads.push({ href: this.href, download: this.download }); }, remove() {} }),
      body: { appendChild() {} },
    },
    localStorage: brokenStorage ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } } : storage,
    fetch: originalFetch ?? (async (url) => ({ passthrough: String(url) })),
    Response, URL, URLSearchParams, Blob, DOMException,
    CustomEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent: (e) => { events.push(e.type); return true; },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout() {},
    ...extra,
  };
  win.URL.createObjectURL = (blob) => { win.lastBlob = blob; return 'blob:demo'; };
  win.URL.revokeObjectURL = () => {};
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SOURCE, win, { filename: 'demo/backend.js' });

  /** Call the API like the clients do. Resolves {status, json, text, headers}. */
  async function call(action, { method, body, query = {}, headers = {}, voter, csrf, token } = {}) {
    const qs = new URLSearchParams({ action, ...query });
    const h = { ...headers };
    if (voter) h['X-ArghBox-Voter'] = voter;
    if (csrf) h['X-ArghBox-CSRF'] = csrf;
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const init = { method: method ?? (body !== undefined ? 'POST' : 'GET'), headers: h };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await win.fetch(`${API}?${qs}`, init);
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8'); // keeps a BOM, unlike res.text()
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, json, text };
  }

  const state = () => JSON.parse(JSON.stringify(win.ArghBoxDemo.state()));
  return { win, storage, events, downloads, listeners, call, state };
}
