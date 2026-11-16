// linkify: auto-links http(s) URLs in owner-written text (welcome, comments). Never used for visitor text.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { app, arghboxDir } from './load.mjs'

const { linkify } = app().helpers
const parts = (t) => JSON.parse(JSON.stringify(linkify(t)))
const urls = (t) => parts(t).filter((p) => p.url).map((p) => p.url)

test('linkify: plain text stays one text part, empty input is empty', () => {
  assert.deepEqual(parts('no links here'), [{ text: 'no links here' }])
  assert.deepEqual(parts(''), [])
  assert.deepEqual(parts(null), [])
})

test('linkify: a URL in the middle splits the text', () => {
  assert.deepEqual(parts('See https://example.com/docs for more'), [
    { text: 'See ' }, { url: 'https://example.com/docs', label: 'https://example.com/docs' }, { text: ' for more' },
  ])
})

test('linkify: trailing punctuation is not part of the URL', () => {
  for (const p of ['.', ',', '!', '?', ';', ':', '"', "'", '...', '?!']) {
    assert.deepEqual(urls('Go to https://example.com/a' + p), ['https://example.com/a'], 'trailing ' + p)
  }
  assert.deepEqual(parts('Read https://example.com.')[2], { text: '.' })
  assert.deepEqual(urls('Query stays: https://example.com/s?q=1&r=2.'), ['https://example.com/s?q=1&r=2'])
})

test('linkify: parentheses', () => {
  assert.deepEqual(urls('(see https://example.com/a)'), ['https://example.com/a']) // wrapping paren is not part of it
  assert.deepEqual(urls('https://en.wikipedia.org/wiki/Foo_(bar)'), ['https://en.wikipedia.org/wiki/Foo_(bar)']) // balanced stays
  assert.deepEqual(urls('(https://en.wikipedia.org/wiki/Foo_(bar)).'), ['https://en.wikipedia.org/wiki/Foo_(bar)'])
})

test('linkify: several URLs, http and https, case-insensitive scheme', () => {
  assert.deepEqual(urls('a http://one.example, b HTTPS://two.example/x! c https://three.example?y=1'), [
    'http://one.example', 'HTTPS://two.example/x', 'https://three.example?y=1',
  ])
})

test('linkify: other schemes are never linked, javascript: especially', () => {
  for (const t of ['ftp://example.com/file', 'mailto:me@example.com', 'javascript:alert(1)', 'JAVASCRIPT:alert(document.cookie)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', '//example.com', 'www.example.com', 'xhttps://example.com']) {
    assert.deepEqual(urls(t), [], t)
  }
  assert.deepEqual(urls('javascript:alert("https://ok.example")'), ['https://ok.example']) // only the genuine https URL, as its own link
  assert.deepEqual(urls('http://'), [])
  assert.deepEqual(urls('see http://. now'), [])
})

test('linkify: long URLs are shortened in the middle, href keeps the exact URL', () => {
  const long = 'https://example.com/' + 'a'.repeat(80) + '/end.html'
  const [p] = parts(long)
  assert.equal(p.url, long)
  assert.ok(p.label.length < 50 && p.label.includes('…'))
  assert.ok(p.label.startsWith('https://example.com/') && p.label.endsWith('/end.html'))
  assert.equal(parts('https://short.example/x')[0].label, 'https://short.example/x')
})

test('linkify: HTML in the text is just text (the app never uses innerHTML for it)', () => {
  assert.deepEqual(parts('<a href="https://evil.example">x</a>').filter((p) => p.url).map((p) => p.url), ['https://evil.example'])
  const src = fs.readFileSync(path.join(arghboxDir, 'arghbox-app.js'), 'utf8')
  const rich = src.slice(src.indexOf('function rich('), src.indexOf('function ic('))
  assert.ok(!/innerHTML/.test(rich))
  assert.match(rich, /rel: 'noopener nofollow ugc'/)
  assert.match(rich, /target: '_blank'/)
})
