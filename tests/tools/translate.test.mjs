// Tests for tools/translate.mjs. Nothing here calls a real API: fetch is mocked, and the CLI is only run with --dry-run.
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as T from '../../tools/translate.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const en = {
  _meta: { lang: 'en', name: 'English', version: '0.2.0' },
  'tab.label': 'Feedback',
  'hello': 'Hello {name}',
  'votes.one': '{n} vote',
  'votes.other': '{n} votes',
}

test('placeholders are compared as multisets', () => {
  assert.deepEqual(T.placeholders('{a} and {b} and {a}'), ['{a}', '{a}', '{b}'])
  assert.deepEqual(T.placeholders('none'), [])
})

test('plural keys follow the categories of the target language', () => {
  assert.deepEqual(T.expectedKeys(en, 'de').map((k) => k.key), ['tab.label', 'hello', 'votes.one', 'votes.other'])
  const pl = T.expectedKeys(en, 'pl')
  assert.deepEqual(pl.map((k) => k.key), ['tab.label', 'hello', 'votes.one', 'votes.few', 'votes.many', 'votes.other'])
  assert.equal(pl.find((k) => k.key === 'votes.few').source, '{n} votes')
  assert.equal(pl.find((k) => k.key === 'votes.one').source, '{n} vote')
  assert.deepEqual(T.expectedKeys(en, 'ja').map((k) => k.key), ['tab.label', 'hello', 'votes.other'])
})

test('only missing or changed keys are translated', () => {
  const expected = T.expectedKeys(en, 'de')
  const state = Object.fromEntries(expected.map((k) => [k.key, T.sha(k.source)]))
  const existing = { 'tab.label': 'Rückmeldung', hello: 'Hallo {name}', 'votes.one': '{n} Stimme', 'votes.other': '{n} Stimmen' }
  assert.deepEqual(T.keysToTranslate(expected, existing, state), [])
  assert.deepEqual(T.keysToTranslate(expected, { ...existing, hello: undefined }, state).map((k) => k.key), ['hello'])
  assert.deepEqual(T.keysToTranslate(expected, existing, { ...state, 'tab.label': 'stale' }).map((k) => k.key), ['tab.label'])
  assert.equal(T.keysToTranslate(expected, existing, state, true).length, expected.length)
})

test('validation catches missing keys, broken placeholders and stray markup', () => {
  const items = [{ key: 'hello', source: 'Hello {name}' }, { key: 'x', source: 'Plain' }]
  assert.equal(T.validateTranslation(items, { hello: 'Hallo {name}', x: 'Schlicht' }).ok, true)
  const bad = T.validateTranslation(items, { hello: 'Hallo {nome}', x: '' })
  assert.equal(bad.ok, false)
  assert.equal(bad.problems.length, 2)
  assert.equal(T.validateTranslation(items, { hello: 'Hallo {name}', x: '<b>Schlicht</b>' }).ok, false)
  assert.equal(T.validateTranslation(items, { hello: 'Hallo {name}', x: 'S', extra: 'y' }).ok, false)
  assert.equal(T.validateTranslation(items, null).ok, false)
})

test('rewriteLoader replaces both marker blocks and escapes non-ASCII', () => {
  const js = 'a\n  /* arghbox:labels:start */\n  var LABELS = {"en":"Feedback"};\n  /* arghbox:labels:end */\n  /* arghbox:langs:start */\n  var LANGS = ["en"];\n  /* arghbox:langs:end */\nb'
  const out = T.rewriteLoader(js, { en: 'Feedback', pl: 'Opinie', ja: 'フィードバック' }, ['pl', 'en', 'ja'])
  assert.match(out, /var LABELS = \{"en":"Feedback","ja":"\\u30d5.*","pl":"Opinie"\};/)
  assert.match(out, /var LANGS = \["en","ja","pl"\];/)
  assert.ok(out.startsWith('a\n') && out.endsWith('\nb'))
  assert.throws(() => T.rewriteLoader('no markers', {}, ['en']), /markers/)
})

test('azureUrl uses the chat completions path and the 2024-08-01-preview api version', () => {
  assert.equal(
    T.azureUrl('https://res.openai.azure.com/', 'gpt-x'),
    'https://res.openai.azure.com/openai/deployments/gpt-x/chat/completions?api-version=2024-08-01-preview',
  )
})

test('callAzure sends the key as a header and parses the JSON answer (mocked fetch)', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = { url, init }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"hello":"Hallo {name}"}' } }] }) }
  }
  const messages = T.buildMessages({ lang: 'de', langName: 'German', items: [{ key: 'hello', source: 'Hello {name}' }] })
  const r = await T.callAzure({ endpoint: 'https://r.openai.azure.com', apiKey: 'k', deployment: 'd', messages, fetchImpl })
  assert.deepEqual(r, { hello: 'Hallo {name}' })
  assert.equal(seen.init.headers['api-key'], 'k')
  assert.ok(!seen.url.includes('k=') || seen.url.includes('api-version='))
  const body = JSON.parse(seen.init.body)
  assert.equal(body.response_format.type, 'json_object')
  assert.match(body.messages[0].content, /placeholder/)
  await assert.rejects(T.callAzure({ endpoint: 'https://r', apiKey: 'k', deployment: 'd', messages, fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'slow down' }) }), /429/)
})

test('run() with a mocked fetch writes the language file, state and loader blocks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-tr-'))
  try {
    fs.mkdirSync(path.join(root, 'arghbox', 'i18n'), { recursive: true })
    fs.writeFileSync(path.join(root, 'arghbox', 'i18n', 'en.json'), JSON.stringify(en))
    fs.writeFileSync(path.join(root, 'arghbox', 'arghbox.js'), '/* arghbox:labels:start */\n  var LABELS = {"en":"Feedback"};\n  /* arghbox:labels:end */\n  /* arghbox:langs:start */\n  var LANGS = ["en"];\n  /* arghbox:langs:end */\n')
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push(url)
      const input = JSON.parse(JSON.parse(init.body).messages[1].content)
      const answer = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, 'DE ' + v]))
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }
    }
    const env = { AZURE_OPENAI_ENDPOINT: 'https://r.openai.azure.com', AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' }
    await T.run({ langs: ['de'], dryRun: false, all: false, paid: true }, { root, env, fetchImpl, log: () => {} })
    assert.equal(calls.length, 1)
    const de = JSON.parse(fs.readFileSync(path.join(root, 'arghbox', 'i18n', 'de.json'), 'utf8'))
    assert.equal(de._meta.lang, 'de')
    assert.equal(de['votes.one'], 'DE {n} vote')
    assert.match(fs.readFileSync(path.join(root, 'arghbox', 'arghbox.js'), 'utf8'), /var LANGS = \["en","de"\];/)
    // a second run has nothing to translate
    await T.run({ langs: ['de'], dryRun: false, all: false, paid: true }, { root, env, fetchImpl, log: () => {} })
    assert.equal(calls.length, 1)
    // dry run never calls fetch
    await T.run({ langs: ['fr'], dryRun: true, all: false }, { root, env: {}, fetchImpl: () => { throw new Error('network!') }, log: () => {} })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('CLI --dry-run needs no credentials, prints the plan and writes nothing', () => {
  const before = fs.readFileSync(path.join(REPO, 'arghbox', 'arghbox.js'), 'utf8')
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'translate.mjs'), 'pl', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, AZURE_OPENAI_ENDPOINT: '', AZURE_OPENAI_API_KEY: '', AZURE_OPENAI_DEPLOYMENT: '' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /pl \(Polish\): \d+ of \d+ strings to translate/)
  assert.equal(fs.readFileSync(path.join(REPO, 'arghbox', 'arghbox.js'), 'utf8'), before)
  assert.ok(!fs.existsSync(path.join(REPO, 'arghbox', 'i18n', 'pl.json')))
  const bad = spawnSync(process.execPath, [path.join(REPO, 'tools', 'translate.mjs'), '--oops'], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
})

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-tr-'))
  fs.mkdirSync(path.join(root, 'arghbox', 'i18n'), { recursive: true })
  fs.writeFileSync(path.join(root, 'arghbox', 'i18n', 'en.json'), JSON.stringify(en))
  fs.writeFileSync(path.join(root, 'arghbox', 'arghbox.js'), '/* arghbox:labels:start */\n  var LABELS = {"en":"Feedback"};\n  /* arghbox:labels:end */\n  /* arghbox:langs:start */\n  var LANGS = ["en"];\n  /* arghbox:langs:end */\n')
  return root
}
const ENV = { AZURE_OPENAI_ENDPOINT: 'https://r.openai.azure.com', AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' }

test('without --paid nothing is sent, even with credentials, and the estimate is printed', async () => {
  const root = mkRoot()
  try {
    const args = T.parseArgs(['de'])
    assert.equal(args.paid, false)
    assert.equal(T.parseArgs(['de', '--paid']).paid, true)
    assert.equal(T.parseArgs(['de', '--yes']).paid, true)
    const lines = []
    const fetchImpl = () => { throw new Error('the API must not be called without --paid') }
    await T.run(args, { root, env: ENV, fetchImpl, log: (l) => lines.push(l) })
    assert.ok(lines.some((l) => /estimate: \d+ characters in 1 request/.test(l)), lines.join('\n'))
    assert.ok(!fs.existsSync(path.join(root, 'arghbox', 'i18n', 'de.json')))
    // --dry-run wins over --paid
    await T.run({ ...T.parseArgs(['de', '--paid']), dryRun: true }, { root, env: ENV, fetchImpl, log: () => {} })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('each language is saved as soon as it is done: a failure on language 2 keeps language 1 and its state', async () => {
  const root = mkRoot()
  try {
    let n = 0
    const fetchImpl = async (url, init) => {
      n++
      if (n > 1) return { ok: false, status: 500, text: async () => 'boom' }
      const input = JSON.parse(JSON.parse(init.body).messages[1].content)
      const answer = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, 'DE ' + v]))
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }
    }
    await assert.rejects(T.run({ langs: ['de', 'fr'], paid: true }, { root, env: ENV, fetchImpl, log: () => {} }), /500/)
    const i18n = path.join(root, 'arghbox', 'i18n')
    assert.ok(fs.existsSync(path.join(i18n, 'de.json')))
    assert.ok(!fs.existsSync(path.join(i18n, 'fr.json')))
    const state = JSON.parse(fs.readFileSync(path.join(i18n, '.translate-state.json'), 'utf8'))
    assert.ok(state.de && !state.fr)
    assert.match(fs.readFileSync(path.join(root, 'arghbox', 'arghbox.js'), 'utf8'), /var LANGS = \["en","de"\];/)
    // a re-run asks only for the missing language
    const urls = []
    const ok = async (url, init) => { urls.push(url); return fetchOk(init) }
    const fetchOk = async (init) => {
      const input = JSON.parse(JSON.parse(init.body).messages[1].content)
      const answer = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, 'FR ' + v]))
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }
    }
    await T.run({ langs: ['de', 'fr'], paid: true }, { root, env: ENV, fetchImpl: ok, log: () => {} })
    assert.equal(urls.length, 1)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('CLI without --paid is a dry run even when credentials exist', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'translate.mjs'), 'pl'], {
    encoding: 'utf8',
    env: { ...process.env, AZURE_OPENAI_ENDPOINT: 'http://127.0.0.1:9', AZURE_OPENAI_API_KEY: 'x', AZURE_OPENAI_DEPLOYMENT: 'x' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Nothing is sent without --paid/)
  assert.ok(!fs.existsSync(path.join(REPO, 'arghbox', 'i18n', 'pl.json')))
})
