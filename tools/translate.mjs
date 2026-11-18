#!/usr/bin/env node
// OWNER ONLY, PAID. Translates the widget strings with Azure OpenAI.
//
//   node tools/translate.mjs <lang...> [--paid] [--all]
//
// Contributors do not need this script: add a language by copying arghbox/i18n/en.json (see docs/translations.md).
//
// What it does: translates the keys of arghbox/i18n/en.json that are missing from i18n/<lang>.json, or whose
// English text changed since the last run (a hash of each English source string is kept in
// arghbox/i18n/.translate-state.json), checks the answer (placeholders, plural keys), writes i18n/<lang>.json
// and rewrites the LABELS and LANGS blocks in arghbox/arghbox.js.
//
// Needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT in the environment, or the
// git-ignored file .secrets/azure-openai.json with {"endpoint", "apiKey", "deployment"}.
// Without --paid (or --yes) it is a DRY RUN: it prints what would be sent, with the estimated characters and
// requests, and calls nothing. Only --paid calls the API. Each language is saved (file, state, LABELS and LANGS)
// as soon as it is done, so a failure on language 2 never makes the next run pay for language 1 again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
export const API_VERSION = '2024-08-01-preview';
const BATCH = 50;
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

// ---- pure functions ----

export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** `{name}` placeholders of a string, sorted, with duplicates. */
export function placeholders(s) {
  return (String(s).match(/\{[A-Za-z0-9_]+\}/g) || []).sort();
}

/** Plural categories the language uses, in a stable order. Falls back to one and other. */
export function pluralCategories(lang) {
  try {
    const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    return PLURAL_CATEGORIES.filter((c) => cats.includes(c));
  } catch {
    return ['one', 'other'];
  }
}

/** Splits `votes.funny.one` into { base: 'votes.funny', cat: 'one' }, or null when the key is not plural. */
export function splitPlural(key) {
  const i = key.lastIndexOf('.');
  if (i < 0) return null;
  const cat = key.slice(i + 1);
  return PLURAL_CATEGORIES.includes(cat) ? { base: key.slice(0, i), cat } : null;
}

/**
 * The keys the target language needs, each with the English text it is translated from.
 * Non-plural keys map one to one. For a plural group, the language gets its own categories; each is
 * translated from the English `one` (when the category is `one`) or `other`.
 * Returns an array of { key, source } in English file order.
 */
export function expectedKeys(en, lang) {
  const cats = pluralCategories(lang);
  const out = [];
  const seen = new Set();
  for (const key of Object.keys(en)) {
    if (key === '_meta') continue;
    const p = splitPlural(key);
    if (!p) {
      out.push({ key, source: en[key] });
      continue;
    }
    if (seen.has(p.base)) continue;
    seen.add(p.base);
    const one = en[`${p.base}.one`];
    const other = en[`${p.base}.other`] ?? one;
    for (const c of cats) out.push({ key: `${p.base}.${c}`, source: c === 'one' && one !== undefined ? one : other });
  }
  return out;
}

/**
 * Which expected keys need (re)translating. `existing` is the current i18n/<lang>.json, `state` the saved
 * hashes for this language ({key: hashOfSource}), `all` forces everything.
 */
export function keysToTranslate(expected, existing, state, all = false) {
  return expected.filter(({ key, source }) => {
    if (all) return true;
    if (typeof existing[key] !== 'string' || existing[key] === '') return true;
    return state[key] !== sha(source);
  });
}

/** Validates a model answer for the requested items. Returns { ok, problems, clean }. */
export function validateTranslation(items, answer) {
  const problems = [];
  const clean = {};
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { ok: false, problems: ['The answer is not a JSON object.'], clean };
  for (const { key, source } of items) {
    const v = answer[key];
    if (typeof v !== 'string' || v.trim() === '') {
      problems.push(`${key}: missing or empty`);
      continue;
    }
    const want = placeholders(source).join(' ');
    const got = placeholders(v).join(' ');
    if (want !== got) {
      problems.push(`${key}: placeholders differ (English has "${want}", translation has "${got}")`);
      continue;
    }
    if (/[<>]/.test(v) && !/[<>]/.test(source)) {
      problems.push(`${key}: the translation contains markup that the English text does not`);
      continue;
    }
    clean[key] = v.trim();
  }
  const asked = new Set(items.map((i) => i.key));
  for (const k of Object.keys(answer)) if (!asked.has(k)) problems.push(`${k}: was not asked for`);
  return { ok: problems.length === 0, problems, clean };
}

/** Chat messages for one batch. */
export function buildMessages({ lang, langName, items, siteHint = 'a feedback widget for small websites' }) {
  const cats = pluralCategories(lang);
  const system = [
    `You translate the interface strings of ${siteHint} from English into ${langName} (${lang}).`,
    'Return one JSON object that has exactly the same keys as the input and the translated strings as values.',
    'Rules:',
    '- Keep every {placeholder} exactly as written (same names, same count). Do not translate what is inside braces.',
    '- Keep the tone: short, friendly and a little playful in keys containing ".funny", plain in the rest.',
    '- Keys ending in .zero, .one, .two, .few, .many or .other are plural forms. Write the grammatically correct form for that category in the target language.',
    `- The plural categories of ${lang} are: ${cats.join(', ')}.`,
    '- Do not add HTML, quotes or explanations. Keep punctuation style natural for the language.',
    '- Do not translate the product name "ArghBox".',
  ].join('\n');
  const input = {};
  for (const { key, source } of items) input[key] = source;
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input, null, 1) },
  ];
}

/** Request body for the chat completions call. */
export function buildRequest(messages) {
  return { messages, response_format: { type: 'json_object' } };
}

/** The chat completions URL for an Azure OpenAI resource. */
export function azureUrl(endpoint, deployment) {
  const base = String(endpoint).replace(/\/+$/, '');
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${API_VERSION}`;
}

/** Sends one batch. `fetchImpl` is injectable so tests never touch the network. Returns the parsed JSON object. */
export async function callAzure({ endpoint, apiKey, deployment, messages, fetchImpl = fetch }) {
  const res = await fetchImpl(azureUrl(endpoint, deployment), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify(buildRequest(messages)),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch { /* ignore */ }
    throw new Error(`Azure OpenAI answered ${res.status}. ${detail}`);
  }
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('Azure OpenAI answered without a message.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The model did not return valid JSON.');
  }
}

/** Result file contents in English key order (plural extras follow their group). */
export function assembleLang({ en, lang, name, version, translations, expected }) {
  const out = { _meta: { lang, name, version } };
  for (const { key } of expected) out[key] = translations[key];
  return out;
}

const ascii = (s) => s.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** Rewrites the LABELS and LANGS marker blocks of arghbox.js. */
export function rewriteLoader(js, labels, langs) {
  const sorted = ['en', ...langs.filter((l) => l !== 'en').sort()];
  const labelObj = {};
  for (const l of sorted) if (labels[l]) labelObj[l] = labels[l];
  const block = (name) => new RegExp(`(/\\* arghbox:${name}:start \\*/\\r?\\n)[\\s\\S]*?(\\r?\\n\\s*/\\* arghbox:${name}:end \\*/)`);
  let out = js;
  const re1 = block('labels');
  const re2 = block('langs');
  if (!re1.test(out) || !re2.test(out)) throw new Error('The LABELS or LANGS markers were not found in arghbox.js');
  out = out.replace(re1, (m, a, b) => `${a}  var LABELS = ${ascii(JSON.stringify(labelObj))};${b}`);
  out = out.replace(re2, (m, a, b) => `${a}  var LANGS = ${ascii(JSON.stringify(sorted))};${b}`);
  return out;
}

/** Language name in English and in the language itself. */
export function languageNames(lang) {
  let english = lang;
  let native = lang;
  try {
    english = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang;
    native = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) || english;
  } catch { /* keep codes */ }
  return { english, native: native.charAt(0).toLocaleUpperCase(lang) + native.slice(1) };
}

export function loadSecrets(env = process.env, repo = REPO) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(repo, '.secrets', 'azure-openai.json'), 'utf8'));
  } catch { /* optional */ }
  return {
    endpoint: env.AZURE_OPENAI_ENDPOINT || file.endpoint || file.AZURE_OPENAI_ENDPOINT || '',
    apiKey: env.AZURE_OPENAI_API_KEY || file.apiKey || file.AZURE_OPENAI_API_KEY || '',
    deployment: env.AZURE_OPENAI_DEPLOYMENT || file.deployment || file.AZURE_OPENAI_DEPLOYMENT || '',
  };
}

// ---- the command ----

export function parseArgs(argv) {
  const o = { langs: [], dryRun: false, all: false, paid: false };
  for (const a of argv) {
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--all') o.all = true;
    else if (a === '--paid' || a === '--yes') o.paid = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(a)) o.langs.push(a);
    else throw new Error(`Not a language code: ${a}`);
  }
  return o;
}

/** Runs the job. `root` is the repo folder; `fetchImpl` and `log` are injectable for tests. */
export async function run({ langs, dryRun = false, all = false, paid = false }, { root = REPO, env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  if (!langs.length) throw new Error('Usage: node tools/translate.mjs <lang...> [--paid] [--all]   (without --paid nothing is sent)');
  dryRun = dryRun || !paid;
  const i18n = path.join(root, 'arghbox', 'i18n');
  const en = JSON.parse(fs.readFileSync(path.join(i18n, 'en.json'), 'utf8'));
  const version = en._meta?.version || '0.1.1';
  const statePath = path.join(i18n, '.translate-state.json');
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch { /* first run */ }
  const secrets = loadSecrets(env, root);
  if (!dryRun && (!secrets.endpoint || !secrets.apiKey || !secrets.deployment)) {
    throw new Error('Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT, or create .secrets/azure-openai.json. Add --dry-run (or leave out --paid) to see what would be sent.');
  }
  const report = [];
  for (const lang of langs) {
    if (lang === 'en') {
      log('Skipping en: it is the source language.');
      continue;
    }
    const file = path.join(i18n, `${lang}.json`);
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* new language */ }
    const expected = expectedKeys(en, lang);
    const todo = keysToTranslate(expected, existing, state[lang] || {}, all);
    const { english, native } = languageNames(lang);
    log(`${lang} (${english}): ${todo.length} of ${expected.length} strings to translate.`);
    report.push({ lang, todo: todo.length, total: expected.length });
    if (dryRun) {
      const batches = [];
      for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
      const chars = batches.reduce((n, b) => n + buildMessages({ lang, langName: english, items: b }).reduce((m, x) => m + x.content.length, 0), 0);
      log(`  estimate: ${chars} characters in ${batches.length} request(s). Nothing is sent without --paid.`);
      log(`  ${batches.length} request(s) to ${azureUrl(secrets.endpoint || 'https://<resource>.openai.azure.com', secrets.deployment || '<deployment>').replace('%3Cdeployment%3E', '<deployment>')}`);
      if (batches[0]) {
        const m = buildMessages({ lang, langName: english, items: batches[0] });
        log(`  first request, system prompt:\n${m[0].content.split('\n').map((l) => '    ' + l).join('\n')}`);
        log(`  first request, user message (${m[1].content.length} chars):\n${m[1].content.split('\n').slice(0, 8).map((l) => '    ' + l).join('\n')}${batches[0].length > 6 ? '\n    ...' : ''}`);
      }
      continue;
    }
    const translations = {};
    for (const { key } of expected) if (typeof existing[key] === 'string' && !todo.some((t) => t.key === key)) translations[key] = existing[key];
    for (let i = 0; i < todo.length; i += BATCH) {
      const items = todo.slice(i, i + BATCH);
      let result = null;
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        const answer = await callAzure({ ...secrets, messages: buildMessages({ lang, langName: english, items }), fetchImpl });
        const v = validateTranslation(items, answer);
        if (v.ok) result = v.clean;
        else if (attempt === 2) throw new Error(`Translation to ${lang} failed validation:\n  ${v.problems.join('\n  ')}`);
        else log(`  retrying a batch: ${v.problems.length} problem(s)`);
      }
      Object.assign(translations, result);
    }
    const out = assembleLang({ en, lang, name: native, version, translations, expected });
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    state[lang] = Object.fromEntries(expected.map(({ key, source }) => [key, sha(source)]));
    // Save after every language: a failure on the next one must not make a re-run pay for this one again.
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
    updateLoader(i18n, root);
    log(`  wrote ${path.relative(root, file)}, the state file and the LABELS and LANGS blocks`);
  }
  if (!dryRun) log('Run npm run check:size next.');
  return report;
}

/** Rewrites the LABELS and LANGS blocks of arghbox.js from the i18n files that exist. */
function updateLoader(i18n, root) {
  {
    const files = fs.readdirSync(i18n).filter((f) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?\.json$/.test(f));
    const langList = files.map((f) => f.replace(/\.json$/, ''));
    const labels = {};
    for (const l of langList) {
      try {
        labels[l] = JSON.parse(fs.readFileSync(path.join(i18n, `${l}.json`), 'utf8'))['tab.label'];
      } catch { /* skip */ }
    }
    const loader = path.join(root, 'arghbox', 'arghbox.js');
    fs.writeFileSync(loader, rewriteLoader(fs.readFileSync(loader, 'utf8'), labels, langList));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
