# ArghBox technical specification

This is the contract every part of ArghBox is built against: the upload folder, the PHP API,
the widget, the admin page, the triage skill and the tests. When code and this file disagree,
fix one of them in the same change. Version 0.1.2.

## 1. Constraints (apply to every file)

- **PHP 8.1 compatible.** Cheap shared hosts commonly run PHP 8.1 or 8.2. Do not use
  PHP 8.2+ features: no `readonly` classes, no DNF types, no `true`/`false`/`null` standalone
  types, no `#[\SensitiveParameter]`-only behaviour, no 8.3 typed class constants, no
  `json_validate`, no 8.4 property hooks or `new` without parentheses chaining, no 8.5 pipe
  operator `|>`. Extensions you may rely on: PDO + pdo_sqlite, json, hash, openssl or random
  (`random_bytes`), mbstring is optional (fall back to `strlen`/`preg_*` with `u`). curl is optional (fall
  back to `file_get_contents` with a stream context).
- **No Composer, no npm at runtime.** The `arghbox/` folder is uploaded as is.
- **No build step for site owners.** `arghbox.js` and `arghbox-app.js` are hand-written,
  readable ES2019 JavaScript (no modules, no transpiling). They run in the last two versions of
  Chrome, Firefox, Safari and Edge, including iOS Safari.
- **Privacy.** Never store raw IPs, full user agents, emails or cookies for visitors. The only
  cookie ArghBox sets is the admin session cookie on the admin page.
- **Secrets** live only in `config.php` (git-ignored) or environment variables. Never in code,
  docs, tests output or logs. Tests generate their own throwaway secrets.
- **Node scripts** (`tools/`, `skill/`, `tests/`) use Node 22+ built-ins only (`node:test`,
  `fetch`, `node:fs`, ...). Playwright is the only dev dependency. They must work on Windows and
  macOS: no bash, use `path.join`, no shell-specific quoting.
- **Windows dev machines.** A Windows `php` (for example from Scoop) often ships pdo_sqlite,
  openssl, curl and mbstring DLLs without enabling them in php.ini. Every script that starts PHP must check
  `php -m` and add `-d extension_dir=<dir of php.exe>/ext -d extension=pdo_sqlite -d
  extension=openssl -d extension=curl -d extension=mbstring` for missing ones (shared helper
  `tests/helpers/php.mjs`, also used by `tools/dev.mjs`). `php -S` on Windows is single-threaded
  (`PHP_CLI_SERVER_WORKERS` is not supported there), so PHP must never call back into the same
  `php -S` server: the fake Turnstile verify endpoint is a separate Node HTTP server.

## 2. Repository layout

```
arghbox/                  the folder site owners upload, served at /arghbox/
  arghbox.js              loader: tab + JS API, < 4 KB gzipped
  arghbox-app.js          dialog, loaded on first intent, < 22 KB gzipped
  arghbox-preview.js      the local preview's in-memory box, loaded only on a local dev host (section 8)
  app.html                the mobile app page: the dialog full screen, for an app's WebView (section 8b)
  app-page.js             that page's script: URL parameters, loader tag, bridges to the app, < 2 KB gzipped
  i18n/en.json            widget strings (source of truth for translations)
  api.php                 the only PHP entry point for JSON
  admin/index.php         admin page shell (HTML + security headers)
  admin/admin.js          admin page logic
  admin/admin.css
  lib/*.php               PHP code (.htaccess: deny all)
  data/.htaccess          fallback data folder (deny all) + index.html (empty)
  config.example.php
  .htaccess               see section 4
  VERSION                 "0.1.2"
skill/arghbox-triage/     copied into a site repo as .claude/skills/arghbox-triage/
  SKILL.md  PROMPT.md  RULES.md  triage.mjs
.claude/skills/arghbox-triage/SKILL.md   thin wrapper so the ArghBox repo can triage its own boards
tools/                    dev.mjs, new-secrets.mjs, seed.mjs, install.mjs, pack.mjs,
                          translate.mjs, check-size.mjs, capture.mjs, render-art.mjs
bin/arghbox.mjs           the `arghbox` command of the npm package (install, secrets, version, help)
index.mjs, index.d.ts     the package's JavaScript API: version, serverDir, skillDir, install()
demo/                     the demo site "Contoso Tasks": served with the real PHP box by tools/dev.mjs, and built
                          for GitHub Pages by tools/build-pages.mjs with backend.js (api.php emulated in the
                          browser, localStorage), admin-note.js and phone-bridge.js (demo only, never shipped)
art/                      logo and brand sources (SVG), rendered PNGs, favicons (art/brand/)
tests/                    node:test suites (*.test.mjs) and tests/helpers/
tests/fixtures/           box-30.json and other fixtures
e2e/                      Playwright specs (*.spec.mjs) for widget, admin and demo
docs/                     SPEC.md (this file) and user docs
```

Version string `0.1.2` appears in `arghbox/VERSION`, `ArghBox.version` in both JS files,
`ARGHBOX_VERSION` in `lib/version.php` and `package.json`. A unit test keeps them equal.

## 3. Configuration (`config.php`)

`config.php` returns a PHP array. `config.example.php` documents every key with comments.

| Key | Default | Meaning |
|---|---|---|
| `site_name` | `'My site'` | Shown in the dialog title and admin page |
| `site_url` | `''` | The site's public URL (admin links, triage packet) |
| `about` | `''` | One paragraph about the site, for the triage AI |
| `turnstile_site_key` | `''` | Public Turnstile key |
| `turnstile_secret_key` | `''` | Secret Turnstile key |
| `turnstile_verify_url` | Cloudflare siteverify URL | Overridable for tests |
| `secret` | required | 64 hex chars; HMAC key for IP hashes, voter hashes, passes, receipts, admin cookies |
| `owner_token_sha256` | `''` | sha256 hex of the owner token (admin page sign-in, admin API) |
| `triage_token_sha256` | `''` | sha256 hex of the triage token (admin API only) |
| `trusted_ip_header` | `''` | `''` uses `REMOTE_ADDR`; `'HTTP_CF_CONNECTING_IP'` behind Cloudflare; `'HTTP_X_REAL_IP'` for Hostinger CDN |
| `allowed_origins` | `[]` | Extra origins allowed to call the public API (CORS). Same origin always works. An entry ending in `:*` (`'http://localhost:*'`) allows that scheme and host on any port, or none; meant for development |
| `data_dir` | `null` | Absolute path; `null` means automatic (below) |
| `moderation` | `'pending'` | `'pending'`: new entries wait for triage. `'publish'`: shown at once. |
| `auto_apply_min_confidence` | `80` | Triage decisions below it are stored as `flag` (owner decides) |
| `credit` | `true` | Show the small "ArghBox" credit link in the dialog |
| `tags` | `[]` | Optional preset tags offered first to the triage AI and the owner, e.g. `['map', 'export', 'mobile']` |
| `welcome` | `''` | Short plain-text note from the owner shown at the top of the dialog (at most 500 chars), e.g. "Tell us what bugs you. We read everything and reply here." |
| `read_token_sha256` | `''` | sha256 hex of an optional read-only token: admin GET actions, export and MCP read tools only |
| `mcp_enabled` | `true` | Serve `mcp.php` (section 7b) |
| `triage_public_writes` | `false` | Let the triage token (REST and MCP) put new text on the public board: public comments and tasks, publishing, rewriting published text. Deprecated alias: `mcp_allow_public_comments` |
| `trusted_proxies` | `[]` | Addresses or CIDRs of proxies allowed to set `trusted_ip_header` (default for `HTTP_CF_CONNECTING_IP`: Cloudflare's ranges) |
| `turnstile_hostnames` | `[]` | Extra hostnames accepted from Turnstile besides the host of `site_url` |
| `journal_mode` | `'delete'` | `'delete'` or `'wal'` (falls back to delete) |
| `contact_url` | `''` | Optional `https://`, `http://` or `mailto:` link (at most 300 chars) shown as "Contact" in the dialog footer. Anything else is treated as `''`. App stores ask apps with user posts to publish contact details (section 6b) |
| `report_hide_at` | `3` | A published visitor entry reported by this many different people (distinct IP hashes, open reports) is hidden until reviewed (section 6b). `0` = never hide automatically. Integer 0 to 100 |
| `app_pass` | `false` | Opt-in, weaker protection for mobile apps whose WebView cannot pass Turnstile: `session` with `{app: true}` returns a pass without the human check (section 6b). Off by default |
| `limits` | see below | Rate limits and form checks |

`limits` defaults: `entries_per_hour` 5, `votes_per_hour` 60, `sessions_per_hour` 20,
`votes_per_ip_per_entry` 3, `admin_logins_per_hour` 10, `pass_ttl_seconds` 1800, `min_fill_ms`
2500, `max_links` 2, `mcp_calls_per_minute` 120, `mcp_writes_per_minute` 30, `sessions_global_per_hour`
2000, `auth_failures_global_per_hour` 500, `mine_per_hour` 120, `reports_per_hour` 10, `block_days` 90.
Missing keys fall back to defaults (merge, do not replace).

**Where config.php is found**, first match wins:
1. `getenv('ARGHBOX_CONFIG')` (absolute path; used by tests and dev)
2. `dirname($_SERVER['DOCUMENT_ROOT']) . '/arghbox-private/config.php'` (outside the web root)
3. `arghbox/config.php` (next to `api.php`; protected by `.htaccess`)

No config: every action except `health` answers 503 `not_configured`.

**Where data lives** (`arghbox.sqlite`), first usable wins:
1. `data_dir` from config, if set, writable and **outside** the document root
2. `getenv('ARGHBOX_DATA_DIR')`
3. `dirname($_SERVER['DOCUMENT_ROOT']) . '/arghbox-private'` (created with mode 0700 if missing)
4. `arghbox/data/` (inside the web root, protected by its `.htaccess`); `health` reports
   `data_dir: "inside_webroot_protected"` as a warning

SQLite: `PRAGMA journal_mode=DELETE`, `busy_timeout=5000`, `foreign_keys=ON`. Schema version in
the `meta` table; migrations run inside a transaction on the first request after an upgrade.

## 4. `.htaccess` (Apache and LiteSpeed)

- `Options -Indexes`
- Deny `config.php`, `config.example.php`, `*.sqlite*`, `VERSION`, and the folders `lib/` and
  `data/` (each also has its own `Require all denied` `.htaccess`, with the
  `<IfModule !mod_authz_core.c>` fallback).
- `api.php` and `admin/index.php` send their own `Cache-Control: no-store` headers.
- `arghbox.js`, `arghbox-app.js` and `i18n/*.json`: `Cache-Control: public, max-age=3600`.
  Host pages bust the cache with `?v=<version>` on the script URL; the loader passes the same
  `?v=` to `arghbox-app.js` and the i18n files.

## 5. Data model (SQLite)

```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- idea | bug | question
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  title_original TEXT NOT NULL,
  body_original TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'visitor', -- visitor | owner (created on the admin page)
  state TEXT NOT NULL,             -- pending | published | rejected | merged | flagged | private
  status TEXT NOT NULL DEFAULT 'open', -- open | planned | in_progress | done | declined
  status_at TEXT NULL,             -- when status last changed
  merged_into INTEGER NULL REFERENCES entries(id),
  reject_reason TEXT NULL,         -- spam | abuse | off_topic | test | unclear | other (state rejected)
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array of tags, at most 3
  external_url TEXT NULL,          -- admin only: linked issue (Jira, GitHub, Linear), http(s), <= 500 chars
  votes INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '{}',  -- JSON {page, lang, browser, os, screen, app?: {platform, version}}
  ai TEXT NULL,                    -- JSON, admin only (section 7)
  author_hash TEXT NOT NULL,       -- HMAC of the IP (same as votes.ip_hash); '' for owner items
  author_voter TEXT NOT NULL DEFAULT '', -- voter_hash of the author (schema 4); '' for owner items and older entries
  receipt_hash TEXT NOT NULL,      -- '' for owner items
  created_at TEXT NOT NULL,        -- ISO 8601 UTC, e.g. 2026-11-14T10:00:00Z
  updated_at TEXT NOT NULL
);
CREATE TABLE comments (            -- the owner's comments on an entry
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  body TEXT NOT NULL,              -- 1 to 2000 chars
  public INTEGER NOT NULL DEFAULT 1, -- 1: shown in the widget; 0: private note, admin only
  hidden INTEGER NOT NULL DEFAULT 0, -- 1: withdrawn (nothing is deleted)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  voter_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  moved_from INTEGER NULL,         -- source entry id when copied by a merge
  created_at TEXT NOT NULL,
  UNIQUE(entry_id, voter_hash)
);
CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,             -- owner | triage:<reviewer> | system
  run_id INTEGER NULL REFERENCES runs(id),
  kind TEXT NOT NULL,              -- create | publish | reject | merge | flag | pending | private | set_status | tag | edit | comment | comment_edit | undo
                                   -- | report_hide | dismiss_reports | block | unblock (schema 4, section 6b)
  entry_id INTEGER NOT NULL,
  before TEXT NOT NULL,            -- JSON snapshot of the entry's mutable fields
  after TEXT NOT NULL,             -- JSON snapshot + {moved_vote_ids: [...]} for merges, {cleared_report_ids: [...]},
                                   -- {block_id} or {block_ids: [...]} (section 6b)
  undone_by INTEGER NULL
);
CREATE TABLE reports (             -- schema 4: visitors' reports about published entries (section 6b)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  reason TEXT NOT NULL,            -- spam | abusive | off_topic | other
  voter_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleared_at TEXT NULL,            -- set when reviewed: the entry was kept or published again
  cleared_by INTEGER NULL,         -- the action that cleared it
  UNIQUE(entry_id, voter_hash)
);
CREATE TABLE blocks (              -- schema 4: authors blocked by the owner or triage (section 6b)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,       -- the entry the block was made from
  author_hash TEXT NOT NULL,       -- the entry's author_hash ('' when unknown)
  voter_hash TEXT NOT NULL,        -- the entry's author_voter ('' when unknown)
  note TEXT NOT NULL DEFAULT '',   -- admin only, at most 500 chars
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,        -- created_at + limits.block_days
  lifted_at TEXT NULL
);
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  counts TEXT NOT NULL,            -- JSON {publish, reject, merge, flag, skipped}
  digest TEXT NOT NULL DEFAULT ''
);
CREATE TABLE limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Indexes on `entries(state)`, `votes(entry_id)`, `votes(ip_hash, entry_id)`, `actions(entry_id)`,
`actions(run_id)`, `reports(entry_id)`, `blocks(author_hash)`, `blocks(voter_hash)`. Add more if useful; the column
names above are the contract. Schema version 4 adds `entries.author_voter`, `reports` and `blocks`; the migration
leaves `author_voter` empty on older entries.

**Hashes** (all `hash_hmac('sha256', <label>|<value>, secret)`, hex):
`ip|<ip>` → `ip_hash`/`author_hash`; `voter|<voter key>` → `voter_hash`;
`receipt|<receipt>` → `receipt_hash`. The admin API exposes only the first 8 characters of
`author_hash` (as `author`) so the AI and the owner can spot bursts from one source.

**Mutable fields** (snapshotted in `actions.before/after`): `state, status, status_at, type,
title, body, merged_into, reject_reason, tags, external_url, ai`. Comment actions snapshot the comment row
(`{comment_id, body, public, hidden}`); undoing a `comment` hides it, undoing a `comment_edit`
restores the previous body/flags.

**Tags**: lowercase, `^[a-z0-9][a-z0-9-]{1,23}$`, at most 3 per entry, stored sorted and unique.
The vocabulary is whatever tags entries use, plus the optional `tags` list in the config
(presets the owner wants offered first). The triage skill assigns them; the owner can edit them.

**Private items**: entries the owner creates on the admin page are `source: owner` and start in
state `private` (or `published` if the owner ticks "public"). Private items are never in the
public API, never in the triage decisions, and have no votes. The owner can publish one later
(state `private` → `published`) or make a published owner item private again.

**Fingerprint**: first 16 hex chars of `sha256(id|state|status|type|title|body|merged_into)`, and when the entry
has open reports (section 6b), `|r:` plus their ids in ascending order joined by commas is appended before hashing.
Changes whenever an entry is changed or reported again, so a triage decision made on stale data is skipped.

**Invariants**
- Nothing is ever deleted (except `limits` rows older than 1 day, trimmed during writes).
- `entries.votes` always equals `COUNT(*) FROM votes WHERE entry_id = id`.
- A new entry starts with one vote: its author's (`voter_hash` of the voter key sent with it).
- **Merge A → B**: B must end up `published`. A becomes `merged`, `merged_into = B`. Each vote of
  A whose `voter_hash` has no vote on B is copied to B with `moved_from = A`; the copied vote ids
  go into `after.moved_vote_ids`. A keeps its own votes (so undo is simple). Merging into an
  entry that is itself merged resolves to the final target. A merge that would create a cycle,
  or target A itself, is refused.
- **Voting on a merged entry** counts for its final target (the response carries the target id).
- **Undo** of action X: restore X's `before` fields, delete the votes listed in
  `after.moved_vote_ids` (the only deletion allowed), recompute vote counts, log a new `undo`
  action pointing at X (`X.undone_by = new id`). Refused (`conflict`) when the same entry has a
  later action that is not undone. Undoing a run undoes its actions newest first and reports the
  ones it could not undo.

## 6. Public API (`api.php?action=...`)

All responses: `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Request bodies are JSON
(`Content-Type: application/json`), max 16 KB. Success: `{"ok": true, ...}`. Error: HTTP 4xx/5xx
with `{"ok": false, "error": "<code>", "message": "<English sentence>", "field"?: "<name>",
"retry_after"?: <seconds>}`.

Error codes: `bad_request`, `invalid_input`, `method_not_allowed`, `not_found`,
`origin_not_allowed`, `turnstile_failed`, `turnstile_not_configured`, `pass_invalid`,
`pass_expired`, `rate_limited` (429 + `Retry-After` header), `unauthorized`, `forbidden`
(403: a read-only token on a write, or the owner token on MCP), `conflict`, `not_configured`,
`busy` (503 + `Retry-After: 2`: another PHP worker holds the database; retry), `server_error`.

**CORS.** Same-origin requests need nothing. For an `Origin` in `allowed_origins` (exact match, or
an entry `<scheme>://<host>:*` matching that scheme and host with any port or none), answer with
`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, `Access-Control-Allow-Methods: GET,
POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, X-ArghBox-Voter`, `Access-Control-Max-Age:
600`, and answer `OPTIONS` with 204. A POST whose `Origin` is neither same-origin nor allowed
gets 403 `origin_not_allowed`. Admin actions never send CORS headers.

**Public entry object**
```json
{ "id": 12, "type": "idea", "title": "Dark mode", "body": "", "votes": 14,
  "status": "planned", "status_at": "2026-11-20T09:00:00Z", "tags": ["design", "map"],
  "comments": [{"body": "Coming in December.", "at": "2026-11-20T09:00:00Z"}],
  "similar": 2, "aliases": ["Night theme please", "Tryb ciemny"],
  "source": "visitor", "created_at": "2026-11-14T10:00:00Z" }
```
`similar` = number of entries merged into it; `aliases` = their titles (at most 10); `comments`
= the owner's public, non-hidden comments, oldest first (at most 20). `source` is `owner` for
items the owner published from the admin page (shown with an "From the team" label).

| Action | Method | Request | Response |
|---|---|---|---|
| `list` | GET | header `X-ArghBox-Voter` (optional) | `{ok, site:{name}, welcome, max_links (= `limits.max_links`; one link is one `http(s)://...` URL or one bare `www....` address, so `https://www.a.com` is one), version, turnstile_site_key, moderation, credit, contact (= `contact_url`, `''` when unset), app_pass (bool, config `app_pass`), entries:[Entry], tag_counts:[{tag, count}], voted:[id]}`. All `published` entries of every status (open, planned, in progress, done, declined), sorted by votes desc then newest, at most 500. Never private, pending, flagged, rejected or merged entries. `tag_counts` covers the listed entries, most used first. `voted` lists the entry ids this voter key voted on. No Turnstile needed. |
| `session` | POST | `{turnstile}` or `{app: true}` | `{ok, pass, expires_at}`. Verifies the Turnstile token with `turnstile_secret_key` (sends `remoteip` too). Rate-limited by `sessions_per_hour`. `{app: true}` without a `turnstile` token: a pass without the human check when config `app_pass` is true (same rate limits), else 403 `turnstile_failed` (section 6b). |
| `add` | POST | `{pass, voter, type, title, body, context:{page, lang, browser, os, screen, app?}, hp, elapsed_ms}` | `{ok, entry: Entry + {state}, receipt}`. `state` is `pending` or `published` (config `moderation`); always `pending` when the author is blocked (section 6b). |
| `report` | POST | `{pass, voter, id, reason}` | `{ok, id}`. A visitor reports a published visitor entry; `reason` is `spam`, `abusive`, `off_topic` or `other`. See section 6b. |
| `vote` | POST | `{pass, voter, id, on}` | `{ok, id, votes, voted}`; `id` is the final target after merges. `on:false` removes this voter's vote (only a direct vote, never a moved one). Voting again when already voted is not an error: returns current state. |
| `mine` | POST | `{receipts:[string]}` (at most 50) | `{ok, entries:[{receipt, id, type, title, state, status, tags, comments, merged_into, merged_into_title, reject_reason}]}`. Lets visitors see what happened to their own entries, including why one was not published (`reject_reason`), and where a merged one went. `flagged` is reported as `pending` (the owner's queue is not the visitor's business). |
| `feed` | GET | | Atom 1.0 (`Content-Type: application/atom+xml; charset=utf-8`, `Cache-Control: public, max-age=600`): the 50 most recently updated published entries. Each item has the title prefixed with its status when it is not open ("[Done] Dark mode"), the body plus the latest public comment as text content, `updated` = `updated_at`, and a link to `site_url` + `#arghbox-<id>`. Feed id and title come from `site_url` and `site_name`. Lets people follow the backlog and changelog in any feed reader, or pipe it into Slack or Zapier. |
| `health` | GET | | HTTP 200 when this install can serve requests, else 503 with `ok: false` (config missing or invalid, pdo_sqlite not loaded, or no usable data dir). `turnstile: false` does not flip `ok`. **Anonymous:** `{ok, version, php, sqlite, config, config_valid, data_dir, turnstile, ip_header, moderation, admin}` (`php` is major.minor, `ip_header` is `configured` or `not_configured`). **With a valid owner, triage or read bearer, or the admin cookie:** the same plus `config_location`, `data_dir_warning`, `turnstile_test_keys` and `warnings`, with the full `php` version and `ip_header` `present` or `missing`. Never secrets, paths or IPs. |

**Pass**: `base64url(json {h: ip_hash, e: expires_unix, n: nonce}) . '.' . base64url(hmac)` with
the `secret` (label `pass|`). Refuse when the signature is wrong (`pass_invalid`), expired
(`pass_expired`) or `h` differs from the caller's current IP hash (`pass_invalid`).

**Voter key**: 22 to 64 chars of `[A-Za-z0-9_-]`, made by the widget (`crypto.getRandomValues`,
base64url of 18 bytes) and kept in localStorage `arghbox:voter`.

**Validation for `add`** (`invalid_input` with `field`):
- `type` in `idea`, `bug`, `question`
- `title`: trimmed, whitespace collapsed, 4 to 120 characters (Unicode-aware)
- `body`: trimmed, 0 to 2000 characters, newlines kept, other control characters removed
- links (`http://`, `https://`, `www.`) in title + body: at most `limits.max_links`
- `hp` (honeypot) must be empty: otherwise answer `ok` with a fake pending entry id 0 and store
  nothing (bots should not learn)
- `elapsed_ms` below `limits.min_fill_ms`: same silent fake success
- `context.page`: must start with `/`, query and hash stripped server-side too, max 200 chars;
  `lang` max 12 `[A-Za-z-]`; `browser`, `os` max 40 chars; `screen` in `small`, `medium`,
  `large` (anything else dropped)
- `context.app` (sent by the mobile app page, section 8b): an object `{platform, version}`; `platform` in `ios`,
  `android`, `other`; `version` 1 to 20 chars of `[0-9A-Za-z._+-]`. Invalid members are dropped; when neither
  survives, `app` is dropped. Never an error.

**Rate limits** (per `ip_hash`, sliding by the hour window): `entries_per_hour`,
`votes_per_hour`, `sessions_per_hour`, `reports_per_hour`; `votes_per_ip_per_entry` counts the votes from one
`ip_hash` on one entry.

## 6b. Reports, blocks and the app pass

These exist so the box is safe to show inside mobile apps, and they help on the web too. App Store guideline 1.2
(and Google Play's user-generated content policy) ask apps that show other people's posts for: a way to filter
objectionable content (ArghBox: nothing is public before review), a way to report it with a timely response
(reports below), a way to block abusive users (blocks below) and published contact details (`contact_url`).

**Reports.**
- `POST report {pass, voter, id, reason}` needs a valid pass and voter key, like `vote`.
- `reason`: `spam`, `abusive`, `off_topic` or `other`; anything else is `invalid_input` with `field: "reason"`.
- Only a `published` entry with `source: visitor` can be reported. Any other id (unknown, pending, merged, rejected,
  private, owner items) answers 404 `not_found`.
- Rate limit `reports_per_hour` per IP hash (429 `rate_limited`).
- One report per voter key per entry: reporting again answers `{ok: true, id}` and changes nothing.
- When the caller's IP hash or voter hash matches an active block, the answer is the same `{ok: true, id}`, and
  nothing is stored.
- The answer never says whether the entry was hidden.
- A report is **open** while `cleared_at` is null. The number of **reporters** of an entry is
  `COUNT(DISTINCT ip_hash)` over its open reports.

**Auto-hide.** In the same transaction as the insert: when `report_hide_at > 0`, the entry is `published`, and its
reporters reach `report_hide_at`, the entry's state becomes `pending`. That is logged as action `report_hide`, actor
`system`, an entry-field action like `pending`. It leaves the public list and the feed and waits in the owner's and
triage's pending queue. The author's `mine` shows "waiting for review". Undoing it restores `published`.

**Clearing reports** (the entry was reviewed and kept):
- `admin.dismiss_reports {id}`, or a triage `keep` decision: sets `cleared_at` and `cleared_by` on every open
  report of the entry. Logged as `dismiss_reports` with `after.cleared_report_ids`. Undo sets them open again.
- Any change of an entry's state to `published` (`admin.update`, an `admin.apply` publish, a publish through MCP)
  also clears its open reports, as part of that same action (`after.cleared_report_ids`). Undoing that action
  re-opens them.
- Rejecting, flagging or merging does not clear reports.

**Blocks.**
- `admin.block {id, note?}` blocks the author of visitor entry `id`: one `blocks` row with the entry's
  `author_hash` and `author_voter`, `expires_at` = now + `limits.block_days` days. Logged as `block` with
  `after.block_id`; undo lifts it (`lifted_at`).
- Owner items answer 409 `conflict` (no author). An author with an active block matching both hashes is not blocked
  twice: the answer is ok and nothing is logged.
- `admin.unblock {id}` lifts every active block whose `author_hash` (when non-empty) equals the entry's
  `author_hash` or whose `voter_hash` (when non-empty) equals its `author_voter`. Logged as `unblock` with
  `after.block_ids`; undo re-activates them.
- A block is **active** while `lifted_at` is null and `expires_at` is in the future. A request matches it when its IP
  hash equals a non-empty `author_hash`, or its voter hash equals a non-empty `voter_hash`.
- Effects of a matching block:
  - `add` is stored, but as `rejected` with `reject_reason: abuse` (logged as `reject`, actor `system`, summary
    saying the author is blocked), and answers exactly like a normal add, including the `state` that `moderation`
    would give, so the author cannot tell. The owner can still find and publish it, because blocks by IP can catch
    innocent people behind the same mobile carrier address.
  - `report` is ignored as above.
  - Votes are not affected.
- `dismiss_reports`, `block` and `unblock` actions neither block nor are blocked by the undo of entry-field actions
  (like comment actions). `report_hide` is an entry-field action. Among themselves, `block` and `unblock` actions
  on the same entry follow the usual rule: undoing one is refused (409 `conflict`) while a later `block` or
  `unblock` on that entry is not undone.

**Admin side.**
- The admin entry object adds `reports: {open, total, reasons: {spam, abusive, off_topic, other}, last_at}`.
  `reasons` counts open reports only, and `last_at` is the newest open report or null. It also adds
  `author_blocked` (bool, an active block matches the entry's author).
- `admin.queue` adds `reported: [AdminEntry]`: published visitor entries with at least one open report, oldest open
  report first. Pending entries keep their `reports`, so the AI sees why an auto-hidden entry came back.
- An entry is **reported** when it has at least one open report and its state is `published`, `pending` or
  `flagged` (rejected and merged entries are settled, whatever their reports).
- `admin.entries` accepts `reported=1` (reported entries, as just defined) and `blocked=1` (visitor entries whose
  author matches an active block).
- `admin.stats` adds `counts.reported` (reported entries, as defined above, so it equals the admin page's Reported
  list) and `blocks` (number of active blocks).
- Triage actors may call `admin.dismiss_reports`, `admin.block` and `admin.unblock`. None of them puts text on the
  public board.

**Triage decisions** (section 7), in addition:
- `keep` is allowed only on a published entry with open reports: it clears them, logged `dismiss_reports` with the
  `run_id` and the reviewer's note in `after.ai` (`{action, confidence, reason, reviewer, run_id, at}`), so the log
  shows why.
- `reject` is also allowed on a published visitor entry with open reports.
- Below `auto_apply_min_confidence`, `keep` and such a `reject` are skipped with `low_confidence`, not flagged: the
  entry stays public and stays in the owner's Reported list.
- `block_author: true` is optional on any `reject` whose `reject_reason` is `spam` or `abuse`. It is applied only
  when the reject itself is applied (not when it is flagged or skipped) and is logged `block` with the `run_id`. On
  other actions or reasons it is `invalid_input`. The `applied` row of such a decision carries `blocked` (bool):
  false when the author was already blocked or has no author hashes. Neither case fails the reject or the batch.
- Run counts add `keep` and `block`. `keep` is ordered with publish, reject and flag (before merges).

**App pass (opt-in).**
- When config `app_pass` is true, `POST session {app: true}` (no `turnstile`) returns a normal pass (same format,
  TTL and IP binding) without asking Cloudflare. It uses the same `sessions_per_hour` and `sessions_global_per_hour`
  limits.
- It is a weaker model, common in mobile apps: any client can ask for it, so it proves neither a human nor a
  genuine app. Posts stay safe because they wait for review; votes are then limited only by
  `votes_per_ip_per_entry` and `votes_per_hour`, and the web widget's Turnstile no longer adds protection.
- `health` reports `app_pass` (bool) to everyone. For authorised callers, `warnings` adds: "app_pass is on: anyone
  can get a pass without the human check, so votes are limited only by the per-IP caps."
- With a `turnstile` token in the body, the Turnstile path is used as before.

## 7. Admin API

Same file, `api.php?action=admin.*`. Authentication, either:
- `Authorization: Bearer <token>` where `sha256(token)` equals `owner_token_sha256` (actor
  `owner`) or `triage_token_sha256` (actor `triage:<reviewer>`; reviewer from the request, or
  `triage`). Compare with `hash_equals`.
- The admin cookie `arghbox_admin` from `admin.login` plus header `X-ArghBox-CSRF` on every POST
  (actor `owner`).

Missing or wrong: 401 `unauthorized`. `admin.login` attempts are rate-limited per IP hash.

A bearer token matching `read_token_sha256` (actor `read`) may call the GET actions only
(`admin.me`, `admin.queue`, `admin.entry`, `admin.entries`, `admin.log`, `admin.runs`,
`admin.stats`, `admin.export`); any POST answers 403 `forbidden` (a new error code).

**Admin cookie**: stateless and signed: `base64url(json {a:"owner", e:expiry}) . '.' . hmac`
(label `admin|`), lifetime 12 hours, `HttpOnly`, `SameSite=Strict`, `Secure` when the request is
HTTPS (or `X-Forwarded-Proto: https`), path = the folder of `api.php`. CSRF token =
`hmac('csrf|' . cookie value)`.

**Admin entry object** = public entry + `state, merged_into, reject_reason, external_url,
title_original, body_original, context, ai, author, fingerprint, updated_at, reports, author_blocked` (section 6b),
and `comments` lists every comment as `{id, body, public, hidden, created_at, updated_at}`.

| Action | Method | Request | Response |
|---|---|---|---|
| `admin.login` | POST | `{token}` (owner token only) | sets cookie; `{ok, csrf}` |
| `admin.logout` | POST | | clears cookie; `{ok}` |
| `admin.me` | GET | | `{ok, actor, csrf}` (csrf only for cookie sessions) |
| `admin.queue` | GET | | `{ok, site:{name, url, about}, moderation, auto_apply_min_confidence, tags:[{tag, count}] (vocabulary incl. config presets with count 0), pending:[AdminEntry], flagged:[AdminEntry], published:[{id, type, title, body (first 300 chars), votes, status, tags, aliases, fingerprint}], private:[{id, type, title, status, tags}], reported:[AdminEntry]}`. Pending oldest first. `private` is context only (the owner's own tasks). `reported`: section 6b. |
| `admin.apply` | POST | `{run:{reviewer, digest}, decisions:[Decision]}` | `{ok, run_id, applied:[{id, action, flagged_instead:bool}], skipped:[{id, reason}]}` |
| `admin.create` | POST | `{type, title, body?, status?, tags?, public?:bool}` | `{ok, entry: AdminEntry}`. Owner's own item: `source: owner`, state `private` (or `published` when `public` is true), no votes. Validated like `add` but no Turnstile, no link limit. |
| `admin.entry` | GET | `?id=` | `{ok, entry: AdminEntry, actions:[last 20 log rows for it]}` |
| `admin.export` | GET | `?format=json\|csv\|jira-csv&state=` | A download (`Content-Disposition: attachment; filename="arghbox-<site>-<yyyymmdd>.<ext>"`; jira-csv: `...-<yyyymmdd>-jira.csv`). **json**: `{exported_at, version, site, tags, entries:[AdminEntry], runs:[Run]}`: everything needed to move to another tool. **csv**: one row per entry (UTF-8 with BOM for Excel): id, type, state, status, title, body, votes, tags, created_at, updated_at, merged_into, reject_reason, external_url, source, public comments joined with blank lines. **jira-csv**: published visitor and owner entries that are open, planned or in progress, with Jira's import columns `Summary, Description, Issue Type, Labels` (Issue Type: bug → Bug, idea → Story, question → Task; Description ends with "From ArghBox #<id>, <votes> votes"). `state` filters csv/json (default: every state except `rejected`). |
| `admin.update` | POST | `{id, state?, status?, type?, title?, body?, tags?, reject_reason?, external_url?, merge_into?}` | `{ok, entry: AdminEntry}`. Owner edits. `state` in `published`, `rejected`, `flagged`, `pending`, `private` (`private` only for owner items; `pending` only for visitor items); rejecting needs a `reject_reason` (default `other`); `merge_into` performs a merge. One action logged per changed field group. |
| `admin.comment` | POST | `{id, body, public?:bool}` (default public) | `{ok, comment, entry: AdminEntry}` |
| `admin.comment_update` | POST | `{comment_id, body?, public?, hidden?}` | `{ok, comment, entry: AdminEntry}` |
| `admin.undo` | POST | `{action_id}` or `{run_id}` | `{ok, undone:[action_id], refused:[{action_id, reason}]}` |
| `admin.entries` | GET | `?state=&status=&type=&source=&tag=&q=&reported=1&sort=newest\|oldest\|votes&limit=50&offset=0` | `{ok, total, entries:[AdminEntry]}`, newest first by default; `q` searches title, body and comments; `reported=1` keeps entries with open reports |
| `admin.dismiss_reports` | POST | `{id}` | `{ok, entry: AdminEntry}`. Clears the entry's open reports (section 6b) |
| `admin.block` | POST | `{id, note?}` | `{ok, entry: AdminEntry}`. Blocks the author of a visitor entry (section 6b) |
| `admin.unblock` | POST | `{id}` | `{ok, entry: AdminEntry}`. Lifts the active blocks matching that entry's author |
| `admin.log` | GET | `?run_id=&entry_id=&limit=100&offset=0` | `{ok, total, actions:[{id, at, actor, run_id, kind, entry_id, entry_title, summary, undone_by, undoable}]}` newest first; `summary` is a short English sentence |
| `admin.runs` | GET | `?limit=20` | `{ok, runs:[{id, at, reviewer, counts, digest}]}` newest first |
| `admin.stats` | GET | | `{ok, counts:{pending, published, rejected, merged, flagged, private, reported}, votes, blocks, entries_last_7_days, last_run: Run\|null}` |

**Decision** (from the triage skill):
```json
{ "id": 31, "fingerprint": "9f2c...", "action": "publish | reject | merge | flag | tag | keep",
  "merge_into": 4, "type": "idea | bug | question", "title": "Cleaned title (optional)",
  "tags": ["export", "kml"], "reject_reason": "spam | abuse | off_topic | test | unclear | other",
  "block_author": false,
  "confidence": 92, "reason": "Admin-only explanation, at most 500 chars",
  "title_en": "English translation for the owner (optional, at most 200 chars)" }
```
Server rules for `admin.apply`:
- Decisions may target `pending` entries (any action except `tag` and `keep`) and `published` visitor or
  owner entries (`merge` or `tag` only; plus `keep` or `reject` when it has open reports, section 6b). Anything
  else is skipped with `invalid_state`. Unknown id: `not_found`. Fingerprint differs: `changed`.
- `block_author` (optional, default false): section 6b.
- `tags` (0 to 3, format above) is allowed on `publish`, `flag` and `tag` (required for `tag`);
  it replaces the entry's tags. `reject_reason` is required on `reject`. A `tag` decision never
  turns into a flag and is applied whatever the confidence.
- `confidence < auto_apply_min_confidence` and action is not `flag`: stored as `flag`,
  `flagged_instead: true`; the suggested action stays in `ai`.
- Order: publish, reject and flag decisions first, then merges, so a merge may target an entry
  published in the same batch. A merge target that is not `published` after that: skipped with
  `merge_target_invalid`.
- `title` may change only the wording (validated like `add`); `title_original` keeps the
  visitor's text. `type` may be corrected.
- Each applied decision writes `entries.ai` = `{action, confidence, reason, title_en, reviewer,
  run_id, at, applied}` and one action row with `run_id`. The run row stores the counts
  (`publish, reject, merge, flag, tag, skipped`) and the digest (at most 2000 chars).
- All of one request runs in one transaction.

### Implementation details (settled while building the backend)

- **Body size.** `admin.*` POST bodies may be up to 256 KB, so a large triage batch fits.
  Public actions keep the 16 KB limit.
- **`session`** returns `expires_in` (seconds) next to `expires_at` (ISO).
- **Vote cap.** Hitting `votes_per_ip_per_entry` answers 429 `rate_limited` with
  `retry_after` 3600. The author's own vote counts towards the cap.
- **Undo.**
  - A refused single `action_id` undo answers 409 `conflict` with `{undone: [], refused:
    [...]}`. A `run_id` undo answers 200 and lists its refusals.
  - `create` is not undoable: make the item private or reject it instead.
  - Comment actions and entry actions do not block each other's undo.
- **Merges.** A merged entry cannot be re-merged or have its state changed through
  `admin.update` (409); undo the merge instead. `merged_into` always stores the final target,
  and `mine` reports that target.
- **`admin.apply` skip reasons**, in addition to those above:
  - `invalid_input`: a malformed decision, such as a missing `reject_reason` or bad tags. A
    failing decision is skipped; the rest of the batch still applies.
  - `low_confidence`: a `merge` on a published entry below the threshold. It is skipped, not
    flagged.
- **Health** adds `config_valid` (false when the config is found but its secret is
  malformed; other actions then answer `not_configured`).
- **Stats.** `admin.stats.entries_last_7_days` counts visitor entries only.
- **Test-only switch.** `ARGHBOX_NO_CURL=1` (environment, tests only) forces the non-curl
- **Triage gate (security).** Unless `triage_public_writes` is on, an actor `triage:*` (REST or MCP) gets 403
  `forbidden` for: public comments (`admin.comment` defaults to private for triage), `comment_update` setting
  `public: true`, un-hiding or editing a public comment, `admin.create` with `public: true`, title or body edits of
  published entries, and `admin.update state=published`. The only way for triage to publish is `admin.apply` on pending
  entries. `admin.apply` applies `title` and `type` only for `publish` or `flag` decisions on pending entries (links
  limited as in `add`).
- **Undo.** A triage actor cannot undo the owner's actions or a run that contains them. Undoing A→B is refused while
  B has been merged into another entry since (votes would be counted twice).
- **Admin cookie.** It binds to `sha256(owner_token_sha256)` and the `meta` value `admin_epoch`; logout bumps the epoch,
  and rotating the owner token invalidates every cookie. `admin.login` and `admin/index.php` refuse plain http except
  on loopback hosts (https is recognised from `HTTPS`, `X-Forwarded-Proto` or `CF-Visitor`).
- **Client IP.** Normalised with `inet_pton`: IPv4-mapped IPv6 is IPv4, IPv6 is keyed by its /64. Proxy headers are
  honoured only from trusted proxies (see `trusted_proxies`). Wrong bearers are throttled per IP and globally
  (`auth_failures_global_per_hour`); correct tokens never are. `session` skips Cloudflare for empty, over-long
  (> 2048) or non-token strings and also has a global cap. Turnstile answers must match the `site_url` host (or
  `turnstile_hostnames`) and the action `arghbox` when reported.
- **Text hygiene.** Control characters, zero-width, bidi and invisible format characters are stripped from titles,
  bodies, comments, tags and context; a title needs a letter or digit.
- **Database.** New databases are `arghbox-<8 hex of hmac('db', secret)>.sqlite` (an existing `arghbox.sqlite` keeps
  being used), mode 0600, in a folder that gets a deny-all `.htaccess` and an empty `index.html`. Write transactions
  use `BEGIN IMMEDIATE` with a 5 s `busy_timeout`; a still-locked database is retried once after a short pause, then
  answered as 503 `busy`. Default journal mode is `delete` (see `journal_mode`). `error.log` rotates to
  `error.log.1` at 256 KB.
- **Feed.** Its `rel="self"` link is built from `site_url` (omitted without one), never from request headers.
  Turnstile path.
- **Seed fields.** The seed format also accepts `days_ago`, `status_days_ago` and
  `status_at`, so the demo data never looks stale.
- **Export.**
  - CSV cells holding visitor text (title, body, comments) that start with `=`, `+`, `-`,
    `@`, a tab or a CR get a leading `'`, so nobody can plant a spreadsheet formula.
  - The JSON export is the bare object, with no `ok` key.
  - `jira-csv` downloads as `arghbox-<site>-<yyyymmdd>-jira.csv`, so it never overwrites the plain CSV saved the same day. Its description says "1 vote" or "N votes".
- **Feed.** It adds `<published>`, a `<category>` per tag and a `rel="self"` link. Without
  `site_url`, its ids are `urn:arghbox:<hash>`.
- **MCP.**
  - The owner token answers 403 `forbidden` with an explanation.
  - A body over 64 KB answers 413 with `-32600`.
  - The optional reason or note on `arghbox_merge` and `arghbox_reject`, and the comment on
    `arghbox_set_status`, are stored as private comments (public only when
    `triage_public_writes` allows and the call asks for it).

## 7b. MCP server (`mcp.php`)

An MCP endpoint so MCP clients can search, triage and update the box conversationally:
Claude Code, Cursor, VS Code, Windsurf, or Claude Desktop through `mcp-remote`. It is an
adapter over the same PHP service functions as section 7, so the action log, runs, undo,
fingerprints and the confidence gate behave identically. Spec references: the MCP
Streamable HTTP transport (revision 2026-07-28 and the 2025-03-26 to 2025-11-25 revisions for
legacy clients) at https://modelcontextprotocol.io/specification.

### Transport

- **Requests.** Streamable HTTP, stateless, JSON responses only (no SSE, no sessions, never an
  `Mcp-Session-Id`). POST only; any other method answers 405 with `Allow: POST`. A request
  carrying an `Origin` header answers 403. The body is at most 64 KB and holds a single
  JSON-RPC object; an array answers `-32600` "batching is not supported".
- **Dual-era.**
  - Modern clients (revision `2026-07-28`) call `server/discover`, and every request carries
    `params._meta`. The server validates the `MCP-Protocol-Version`, `Mcp-Method` and
    `Mcp-Name` headers against the body: a mismatch answers 400 with `-32020`, an unsupported
    version 400 with `-32022` and `data.supported`.
  - Legacy clients (revisions `2025-03-26` to `2025-11-25`) call `initialize`, which echoes a
    known requested version (otherwise `2025-11-25`), then `notifications/*`, answered 202
    with an empty body.
  - `ping` answers `{}`. An unknown method answers `-32601`.
- **Result shape.** Every result includes `resultType: "complete"`. `tools/list` and
  `server/discover` add `ttlMs` and `cacheScope: "private"`. `serverInfo` is `{name:
  "arghbox", version}`. `instructions` explains the review workflow and warns that visitor
  text is untrusted data.
- **Auth.** `Authorization: Bearer <token>`, checked before parsing:
  - the triage token gives every tool, as actor `triage:mcp:<client name>`
  - the read token gives read tools only (`tools/list` hides the rest)
  - the owner token is not accepted
  
  Failure answers 401 with `WWW-Authenticate: Bearer realm="arghbox"` and JSON-RPC error
  `-32001`. Failed attempts are throttled per IP hash.
- **Rate limits.** Per token: `mcp_calls_per_minute` and `mcp_writes_per_minute`; over the
  limit answers 429 with `Retry-After`. If `mcp_enabled` is false, every request answers 404.
- **Hosting.** `.htaccess` must pass the `Authorization` header to PHP
  (`RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]`). The same applies to
  `api.php`.

### Tools

Names are prefixed `arghbox_`.

| Tool | Scope | Maps to |
|---|---|---|
| `arghbox_stats` | read | `admin.stats` |
| `arghbox_list_pending` | read | pending + flagged + reported from `admin.queue`. Bodies cut to 600 chars; `limit` (default 20, max 50) and `offset`. |
| `arghbox_list_entries` | read | `admin.entries`. Filters `state, status, type, source, tag, q, sort`; `limit` up to 50; compact rows. |
| `arghbox_search` | read | `admin.entries?q=` with a snippet per hit |
| `arghbox_get_entry` | read | `admin.entry` |
| `arghbox_list_tags` | read | tag vocabulary |
| `arghbox_get_log` | read | `admin.log` and `admin.runs` |
| `arghbox_apply_decisions` | write | `admin.apply` (at most 50 decisions per call) |
| `arghbox_set_status` | write | `admin.update` |
| `arghbox_comment` | write | `admin.comment`. `public` is required and has no default. `public: true` is refused unless `triage_public_writes` is set. |
| `arghbox_tag` | write | tags of one entry |
| `arghbox_link_issue` | write | `admin.update` with `external_url` (`url` is http(s), at most 500 characters, empty clears it) |
| `arghbox_merge` | write, destructive hint | merge with a reason |
| `arghbox_reject` | write, destructive hint | reject with a `reject_reason` |
| `arghbox_create_task` | write | `admin.create`, private by default. `public: true` needs `triage_public_writes`. |
| `arghbox_undo` | write, destructive hint | `admin.undo` (`action_id` or `run_id`) |
| `arghbox_dismiss_reports` | write | `admin.dismiss_reports` (`id`): keep a reported entry |
| `arghbox_block_author` | write, destructive hint | `admin.block` (`id`, optional `note`) |
| `arghbox_unblock_author` | write | `admin.unblock` (`id`) |

`context.app.platform` and `context.app.version` are visitor text: they are listed in `untrusted.fields` like the
other context fields.

- **Annotations.** Read tools `{readOnlyHint: true, openWorldHint: false}`; write tools
  `readOnlyHint: false`. Merge, reject and undo also carry `destructiveHint: true`.
- **No delete tool.** There is none, and no tool fetches URLs or files.
- **Results.** Tool output is `content: [{type: "text", text: <json>}]` plus
  `structuredContent`. Validation and business errors come back as `isError: true` results,
  not JSON-RPC errors.
- **Untrusted text.** Every result that contains visitor text carries
  `untrusted: {note, fields: [json paths]}`.

### Setup for owners

`triage.mjs mcp-config` prints the exact `claude mcp add --transport http arghbox <url>/mcp.php
--header "Authorization: Bearer <token>"` command (with a placeholder, never the real token).
It also prints a `.mcp.json` block that uses a `headersHelper` script reading `.arghbox/token`,
so the token is never pasted into a config file.

## 8. Widget

### Script tag
```html
<script src="/arghbox/arghbox.js?v=0.1.2" defer></script>
```
Attributes (all optional):

| Attribute | Values | Default |
|---|---|---|
| `data-api` | URL of `api.php` | `api.php` next to the script |
| `data-position` | `right`, `left` | `right` |
| `data-offset` | vertical position of the tab, `10`–`90` (% of viewport height) | `50` |
| `data-label` | tab text | `"Feedback"` (from strings) |
| `data-lang` | language code | `<html lang>`, else `en` |
| `data-theme` | `auto` (prefers-color-scheme), `light`, `dark`, `host` (follows `html.dark` class or `html[data-theme="dark"]`, watched with a MutationObserver) | `auto` |
| `data-accent` | any CSS colour, including `var(--host-var)` (custom properties cross the shadow boundary); sets `--arghbox-accent` on the wrapper (see Host styling) | `#e8553d` |
| `data-tone` | `funny`, `neutral` | `funny` |
| `data-tab` | `on`, `off` (no tab; open with the JS API or a `#arghbox` link) | `on` |
| `data-tab-min-width` | viewport width in px below which the edge tab is not shown (it follows rotation and resizing). `ArghBox.open()`, `#arghbox` links and `ArghBox.showTab()` still work, and `#arghbox-root[data-tab]` and the `arghbox:tab` event follow. For pages that have their own Feedback button on narrow screens | `0` (always shown) |
| `data-closable` | `on`, `off`: a small × on the tab hides it | `on` |
| `data-dismiss-days` | days the tab stays hidden after ×, `0` = this page view only | `30` |
| `data-preview` | `on`: soft launch; tab only shows after this browser has opened a URL with `#arghbox` once (remembered in localStorage `arghbox:preview`) | off |
| `data-z` | z-index | `2147483000` |
| `data-credit` | `off` hides the credit link even when the server allows it | on |

### JavaScript API and events
```js
window.ArghBox = {
  version: '0.1.2',
  open(options),   // options: {type: 'idea'|'bug'|'question', view: 'list'|'add'}; loads the app if needed
  close(),
  showTab(),       // also clears a × dismissal
  hideTab(),
};
```
- Visiting or linking to `#arghbox` (or `#arghbox-add`, `#arghbox-bug`, or `#arghbox-<id>` for
  one entry's detail, used by the Atom feed) opens the dialog. The widget then removes that hash
  with `history.replaceState`, so the host's hash routing is untouched.
- Events on `window` (`CustomEvent`): `arghbox:ready`, `arghbox:open`, `arghbox:close`,
  `arghbox:add` (`detail: {type}`), `arghbox:vote` (`detail: {on}`), `arghbox:dismiss`, and
  `arghbox:tab` (`detail: {visible}`) whenever the tab appears or disappears. Never put visitor
  text in `detail`.
- Tab state for host layouts: `#arghbox-root` carries `data-tab="shown"` or `data-tab="hidden"`.
  A host that needs to make room for the tab (for example a panel on the same edge) reads this
  attribute and listens to `arghbox:tab`. It never reads the widget's shadow DOM.
- A queue for calls before load: `window.ArghBox = window.ArghBox || {q: []}` stub pattern is
  not required; `ArghBox.open` exists as soon as the deferred loader ran.

### Loader (`arghbox.js`, < 4 KB gzipped)
- Runs after parse (defer). Never throws into the host page (wrap everything in try/catch). Does
  no network request at load.
- Finds its own URL with `document.currentScript` (fallback: the last `script[src*="arghbox.js"]`).
- Creates `<div id="arghbox-root">` at the end of `body` with an **open** Shadow DOM. Styles go
  into the shadow root as a constructable stylesheet (`adoptedStyleSheets`, every supported browser
  has it; the app keeps a `<style>` fallback). Nothing else in the host DOM: the Turnstile
  container (below) is a child of `#arghbox-root` and exists only during a challenge.
- Renders the tab: vertical "Feedback" label on the chosen edge under the ArghBox mascot (the pixel
  box as an ink silhouette, `art/tab-icon.svg`, an inline SVG built with `createElementNS`) on a
  white badge, and the ×
  (a separate button with `aria-label="Hide feedback button"`). Keyboard focusable, visible
  focus ring, respects `prefers-reduced-motion`.
- Prefetches `arghbox-app.js` on tab `pointerenter`, `focus` or `touchstart`; loads it on click
  or `ArghBox.open()`, then calls `window.__arghboxApp.mount(shadowRoot, options)` (the contract
  between the two files).
- Holds the tab labels for translated languages between the markers
  `/* arghbox:labels:start */` and `/* arghbox:labels:end */` as `var LABELS = {"en":"Feedback"};`
  (`tools/translate.mjs` rewrites this block), and the list of available languages between
  `/* arghbox:langs:start */` and `/* arghbox:langs:end */` as `var LANGS = ["en"];`.

### App (`arghbox-app.js`, < 22 KB gzipped)
- Fetches `i18n/<lang>.json` (lang matched against `LANGS`: exact, then the part before `-`,
  else `en`) and `api.php?action=list` in parallel when it mounts.
- **Dialog**: `role="dialog"`, `aria-modal="true"`, labelled by its title, focus trapped, Esc and
  a click on the backdrop close it, focus returns to the element that opened it. A backdrop click
  is a primary-button press and release both on the backdrop: a text selection dragged out of a
  field, or a press on the backdrop let go in the panel, does not close it. Esc and Tab pressed
  while an input method composes (Chinese, Japanese, Korean) are left to it. Desktop: a panel of about
  420 px on the tab's side; phones (< 640 px wide) and short screens (≤ 480 px tall, a phone on its
  side): full-screen sheet. On short screens the header, the form and the footer scroll as one, so
  the fields always get room. Body scroll of the host page is not locked in a way that jumps (no
  layout shift).
- **Host overlays**: while the dialog is open, it probes the top and bottom edges of the panel every
  0.7 s with `elementFromPoint`. Whatever the host shows above the dialog there (an anchor ad and its
  collapse handle, a cookie bar, a chat button) moves the panel's top or bottom edge clear of it
  (`--sat` / `--sab` on the wrapper), so it never covers the header, the Close button or Send.
  A probe that hits something moves past it and probes again (up to 4 times), so an ad and the
  handle hanging under it are both cleared. Elements taller than 40% of the screen are ignored (a
  host dialog). Nothing of the host is hidden or changed.
- **Views**:
  - List (a public backlog):
    - Tabs Ideas / Bugs (questions show under Ideas with a "Question" badge) and sort Top /
      New.
    - A search box filtering the loaded entries as you type, using the same matching as the
      similar search. Tag chips filter by `tag_counts`.
    - The owner's `welcome` text (plain text, line breaks kept) at the top when set.
    - Owner-written text only (`welcome`, the owner's public comments in the detail view, "Your
      posts" and closed-item excerpts) has `http(s)://` URLs turned into links (`target="_blank"`,
      `rel="noopener nofollow ugc"`, long URLs shortened in the middle, trailing `.,!?;:` and
      unbalanced `)` left out, built with DOM nodes, never `innerHTML`). Visitor text (titles,
      bodies, aliases) is never linked.
    - A search with no results offers "Nothing like that yet. Add it as a new post", which
      opens the add form with the search text as the title (as a bug report in the Bugs tab).
    - Two sections: **Open** (open, planned, in progress) and **Closed** (done, then declined),
      the closed one collapsed behind "Closed (N)".
    - Each card shows the vote button with its count, a status badge for non-open statuses,
      tags, "+N similar" when `similar > 0`, a comment count, and "From the team" for
      `source: owner`.
  - Entry detail (click a card; Back returns to the list with its scroll and filters kept):
    - the full text, status and its date, tags, the vote button
    - the owner's public comments as a dated thread labelled with the site name
    - the merged titles ("Also asked as ...")
    - for declined entries, the latest comment is the explanation
  - "Your posts": this browser's own entries via `mine`, shown above the list when any exist.
    Receipts are kept in localStorage `arghbox:receipts`, at most 50. States:
    - pending: "waiting for review"
    - published: opens its detail
    - merged: "merged into #4 <title>", which opens #4
    - rejected: "not published" plus the reason in friendly words (`reject_reason`: spam →
      "looked like spam", off_topic → "not about this site", test → "looked like a test",
      unclear → "we could not tell what it is about", abuse → "broke the house rules",
      other → no reason)
    - the owner's public comments
  - Add:
    - Fields: type selector (Idea / Bug / Question), title, optional details, and a honeypot
      field hidden from people and screen readers. The heading, the placeholders and the Send
      button follow the type: "Suggest an idea" / "Send idea", "Report a bug" / "Send bug report"
      (details: "What did you do, and what happened instead?"), "Ask a question" / "Send question".
    - The Send button says what the visitor waits for: "Checking you are human..." with a spinner
      while Turnstile runs, "Tick the box above to send" (no spinner) while Cloudflare shows its
      checkbox, then "Sending..." with a spinner.
    - While the title is typed (debounced 150 ms), up to 3 similar entries appear, open and
      closed ("Is it one of these? Vote instead"). Open ones have vote buttons; closed ones
      show their status and the start of the latest comment ("Declined: we keep the map 2D
      only...").
    - Similarity is computed in the browser from the loaded list, with no network: titles,
      aliases, tags and the start of the body; lowercase, accents and punctuation stripped,
      word overlap plus prefix matches.
    - Enter in the title moves on to the details (it does not send half a report); Ctrl+Enter
      or Cmd+Enter sends from any field. The details box grows with the text (up to half the
      viewport height).
    - The draft (type, title, details) is kept while the page is open. Closed with an unsent
      draft on screen, the dialog reopens on the form when opened with no route (the tab,
      `ArghBox.open()`); a route (`#arghbox`, a view) still wins. Sending clears the draft.
  - Thanks: "Thanks, we got it." (pending) or "Thanks, it is listed." (publish mode), with "Thanks for helping
    us improve {site}!".
  - **Report** (section 6b): the detail view of a visitor entry (never `source: owner`) has a small "Report"
    button. It opens an inline choice of four reasons (Spam, Rude or abusive, Not about this site or app,
    Something else) with "Send report" and "Cancel". Sending needs a pass, like voting. On success the entry id
    joins localStorage `arghbox:reported` (array of ids, at most 200, newest kept; not `arghbox:hidden`, which is the
    loader's tab-dismissal time), the dialog goes back to the list
    and shows "Thanks. We will take a look. You will not see this one again." Hidden ids are left out of the
    list, the search, the similar suggestions and the tag counts shown. Errors use the usual friendly strings.
  - **Contact**: when `list.contact` is set, the footer shows a "Contact" link to it (`target="_blank"`,
    `rel="noopener"`).
- **Context sent with `add`**: `page` = `location.pathname` only; `lang` = page language;
  `browser` and `os` = coarse family from `navigator.userAgentData` or the UA string (e.g.
  "Chrome", "Firefox", "Safari", "Edge"; "Windows", "macOS", "Android", "iOS", "Linux");
  `screen` = `small` (< 640 px wide), `medium` (< 1200), `large`. The form does not show it
  (visitors read it as debug output); `docs/configuration.md` asks site owners to mention it in their
  privacy policy.
- **Turnstile**: once the list has given the site key, add
  `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once. The add form starts
  a challenge as soon as it opens (votes and reports when they are made). Each challenge renders a
  fresh widget (`appearance: 'interaction-only'`, `size: 'flexible'`, `compact` under 360 px)
  into a light-DOM `<div id="arghbox-turnstile">` appended to `#arghbox-root` (Turnstile does not
  render reliably inside a shadow root), and removes it once settled, so nothing stays in the host's
  DOM. The box shows through a `<slot name="ts">` at the top of every footer, right above the button
  that waits for it, and only while Cloudflare needs an interaction; unslotted it is not rendered,
  so a late challenge never shows after the dialog closed. Exchange the token for a pass (`session`)
  and keep the pass in memory until it expires. A `pass_invalid` or `pass_expired` error resets Turnstile, gets a new pass
  and retries the request once. If Turnstile cannot load (blocked, offline), the list still
  works and voting/adding show a friendly message.
- **Errors**: every error code from section 6 maps to a friendly string; `rate_limited` shows
  the wait in minutes. The dialog never shows raw JSON.
- **Credit**: when `credit` is true and `data-credit` is not `off`, a small "Powered by ArghBox" link
  with the ArghBox mascot in its own colours (`art/logo-mark-small.svg`) in the footer, to `https://arghbox.com/`
  (`rel="noopener"`, `target="_blank"`).
- **What the box is for**: every view says it in plain words. The list is titled "Ideas, bugs and questions",
  with "Suggest an idea, report a bug or ask a question about {site}. No account needed."; the add form says
  "We read every one. No account needed." These follow the usual pattern of feedback widgets: a short title,
  one line on what to do and that no account is needed, and a thank-you at the end.
- **Local preview**: when the first `list` fails with `network`, `not_configured` or an answer that is not JSON
  at all, on a page whose host is `localhost`, `127.0.0.1`, `[::1]` or `*.localhost`, and
  `window.ArghBoxConfig.localPreview` is not `false`, the app loads `arghbox-preview.js?v=<version>` (with the
  nonce and the Trusted Types policy) and sends every API call to its in-memory box instead: sample entries of
  every type and status, voting and adding that work until a reload, no Turnstile (it answers `app_pass: true`),
  no receipts, ids above 900000 so remembered votes and reports never touch a real box. The `welcome` text says
  "Local preview", what did not answer (the API URL without its scheme, so it is not a link) and links to
  `docs/install.md#test-on-your-computer`. A JSON error from a real box never switches to the preview.
  Production hosts never load the file. The point: a site can try its integration (placement, colours, its own
  buttons and links) on its dev server before it has PHP or a box.
- **Host styling**: hosts restyle the widget with CSS custom properties set on `:root` or `#arghbox-root` (they
  cross the shadow boundary): `--arghbox-accent` (what `data-accent` sets on the wrapper, so the attribute wins),
  `--arghbox-bg`, `--arghbox-fg`, `--arghbox-muted`, `--arghbox-card`, `--arghbox-border`, `--arghbox-line` and
  `--arghbox-font`. The colour ones apply to the theme that is showing. A host's plain `--accent` does not leak in.
- **Copy**: plain words that name what visitors post: ideas, bugs and questions. "ArghBox" is the
  product name only; no string calls a post an "argh" (a unit test checks `en.json`). The funny tone
  (default) only adds a few small jokes, such as the empty Bugs tab and the rate-limit message;
  `data-tone="neutral"` drops them. Both tones are keys in `i18n/en.json` (`*.funny` / `*.neutral`
  pairs only where they differ).

### Strings (`i18n/<lang>.json`)
Flat object of `key: string`. Placeholders `{name}`. Plurals use `Intl.PluralRules` categories as
key suffixes: `votes.one`, `votes.other` (translations may add `.few`, `.many`, `.two`, `.zero`);
fall back to `.other`, then to English. `_meta` key holds `{lang, name, version}`.

### Implementation details (settled while building the widget)

- **String lookup order:** `key.<tone>.<plural>`, `key.<tone>.other`, `key.<tone>`,
  `key.<plural>`, `key.other`, `key`, then the same in English. v1 has about 140 keys and about 650
  English words.
- **Client-side error keys:** `err.turnstile_unavailable`, `err.network` and
  `err.title_short`.
- **Mount contract:** `window.__arghboxApp.mount(shadowRoot, cfg)` returns `{open(options,
  fromElement), close(), isOpen()}`. Pure helpers sit on `window.__arghboxApp.helpers` for the
  unit tests.
- **Theme:** the app applies `data-theme`, not the loader. The tab uses accent colours only. Default tokens come
  from the ArghBox palette (`art/README.md`): light `#fff` background, ink `#2b1d1a`, muted `#6e5d56`, cream
  `#fff6e9` panels; dark night `#1f1613`, cream text, `#2c211d` panels. Text tokens pass 4.5:1, borders 3:1.
- **Accent contrast:** filled buttons and the tab use the accent mixed 78% with black
  (`color-mix`), so white text passes WCAG AA. The plain accent is for highlights only.
- **Prefetch:** done with `fetch(no-cors)`, so the loader adds nothing to the host's `<head>`.
- **Host element:** `#arghbox-root` carries inline `all: initial !important; position: fixed
  !important; z-index: <data-z> !important`. This is the only host element ArghBox styles,
  and the only way to survive host rules like `div { display: flex !important }`.
- **Hide button label:** the × button's `aria-label` is a fixed English string, because the
  loader fetches no strings.
- **Not handled yet:**
  - right-to-left layouts
  - list virtualisation (up to 500 entries are rendered at once)

## 8b. Mobile apps: the app page (`app.html`)

A native app (Swift, Kotlin, React Native, Flutter, ...) shows the box by opening
`https://example.com/arghbox/app.html` in a WebView. Visitors see the whole board (list, search, vote, add,
"Your posts", report) with no sign-in. The page is on the site's own host, so Turnstile accepts it like the web
widget (Cloudflare supports Turnstile in WebViews, with JavaScript and DOM storage enabled). The voter key and
receipts live in the WebView's localStorage, which persists per app install.

**URL parameters** (all optional; invalid values are ignored, never echoed into the page):

| Parameter | Values | Effect |
|---|---|---|
| `platform` | `ios`, `android`, `other` (any letter case) | `context.app.platform` |
| `version` | 1 to 20 chars of `[0-9A-Za-z._+-]`; a space is read as `+`, because an unencoded `+` arrives as a space | `context.app.version` (the app's version) |
| `from` | a path starting with one `/` (not `//`), at most 200 chars, no `?`, `#` or whitespace | `data-page`: the app screen the feedback came from, e.g. `/settings` (default `/`) |
| `view` | `list`, `add` | what opens first (default `list`) |
| `type` | `idea`, `bug`, `question` | preselected type of the add form |
| `theme` | `auto`, `light`, `dark` | `data-theme` (default `auto`) |
| `accent` | `#rgb` or `#rrggbb` | `data-accent` |
| `lang` | 2 to 12 chars of `[A-Za-z-]` | `data-lang` |
| `tone` | `funny`, `neutral` | `data-tone` |

A hash `#arghbox-<id>` (or `#arghbox-add`, `#arghbox-bug`) opens that view, as on the web.

**`app.html`**:
- Static HTML, `<!doctype html>`, `lang="en"`, `<title>Feedback</title>`, `<meta name="robots" content="noindex">`,
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `color-scheme: light
  dark`, and a body background that matches the theme, so there is no white flash.
- A `<meta http-equiv="Content-Security-Policy">`: `default-src 'self'; script-src 'self'
  https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self'
  data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'`.
- No inline script: it loads `app-page.js?v=<version>`. The version in `app.html` is kept equal to the others by
  the version test.
- A `<noscript>` line says the page needs JavaScript.

**`app-page.js`** (ES2019, no modules, < 2 KB gzipped, checked by `tools/check-size.mjs`):
- Reads and validates the parameters.
- Sets `window.ArghBoxConfig = {app: {platform, version}}` (only the valid members; `{}` when none). Then it
  appends the loader `<script src="arghbox.js?v=<version>">` with `data-tab="off"`, `data-credit` left on, and the
  `data-page`, `data-theme`, `data-accent`, `data-lang` and `data-tone` attributes from the parameters.
- When the loader is ready, it calls `ArghBox.open({view, type})`, unless the hash already routes to a view.
- **Bridge to the app**: on `arghbox:open`, `arghbox:close`, `arghbox:add` and `arghbox:vote`, it posts
  `{source: "arghbox", type: "open" | "close" | "add" | "vote", detail}` (the event's detail, never visitor text) to
  every bridge that exists:
  - React Native: `window.ReactNativeWebView.postMessage(JSON string)`
  - iOS WKWebView: `window.webkit.messageHandlers.arghbox.postMessage(object)`
  - Android: `window.ArghBoxAndroid.postMessage(JSON string)` (an `addJavascriptInterface` object)
  - Flutter: `window.ArghBoxFlutter.postMessage(JSON string)` (a `JavaScriptChannel`; not named `ArghBox`, which is
    the widget's API)
- **External links**: the dialog's links (Contact, the credit link, links in the owner's comments; visitor text is
  never linked) open with `target="_blank"`, which a WKWebView ignores and other WebViews open in place. So
  `app-page.js` listens for clicks (using `composedPath()` to see into the open shadow root): when a bridge exists,
  a click on an `http(s):` or `mailto:` link prevents the default and posts `{source: "arghbox", type: "link",
  detail: {url}}`, and the app opens it in the system browser. Without a bridge the link behaves normally.
- **Delivery**: a bridge counts as reached only when its `postMessage` returned without throwing.
- **Load failure**: when the loader script fails to load, the page shows "Feedback could not load" with a "Try
  again" button that reloads the page.
- **Close**: on `arghbox:close`, after posting, when no bridge exists, it navigates to the fixed URL
  `arghbox://close`, which an app without a bridge intercepts. The URL is fixed and never taken from a parameter,
  so there is no open redirect. It then shows a small "Feedback closed" screen with an "Open again" button (what a
  normal browser shows, since nothing intercepts the URL).

**Page mode in `arghbox-app.js`**: active when `window.ArghBoxConfig.app` is an object.
- The dialog is a full-screen sheet at every width. Its content is at most 640 px wide and centred, with
  `env(safe-area-inset-*)` padding. There is no backdrop to tap. Esc and the close button still close it.
- `add` sends `context.app` (validated as in section 6) and `context.page` from `data-page`.
- When `list.app_pass` is true, the pass comes from `session {app: true}` and Turnstile is not loaded at all.
  Otherwise it is Turnstile, as on the web.

**Hosting**: `.htaccess` serves `app-page.js` like the other scripts (`max-age=3600`, busted with `?v=`), and
`app.html` with `Cache-Control: no-cache, no-transform` (no-transform stops Cloudflare injecting its analytics
script, which the CSP would block), `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`
(a meta CSP cannot set frame-ancestors). `admin.css` and `admin.js` get `no-cache, no-transform` too, because they
load without `?v=`. `tools/install.mjs` copies both with the rest of the folder.

## 9. Admin page (`/arghbox/admin/`)

- `admin/index.php` sends `Cache-Control: no-store, no-transform` (so proxies such as Cloudflare
  do not inject scripts, like the Web Analytics beacon, that the CSP would block), `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, and `Content-Security-Policy: default-src 'self'; script-src
  'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';
  base-uri 'none'; form-action 'self'`, and `<meta name="robots" content="noindex">`.
- Sign-in form with the owner token → `admin.login`. Session kept by the cookie; `admin.me` on
  load decides between sign-in and dashboard. Sign out button.
- Dashboard: counts per state, the last run with its digest (rendered as plain text with line
  breaks, never as HTML), entries in the last 7 days.
- Entry lists by state with search, type filter and tag filter: Pending, Flagged, **Reported**
  (`admin.entries?reported=1`, any state), Published, Rejected, Merged, and **My tasks**. The dashboard shows the
  reported count and the number of active blocks, and the Reported list comes right after Pending.
- An entry with reports shows "Reported by N people: spam 2, rude 1" (open reports), the time of the last one, and
  "Hidden after reports" when it is pending with open reports. A published one has **Keep it (dismiss reports)**
  (`admin.dismiss_reports`); a hidden (pending) one has **Put it back (dismiss reports)**, which publishes it
  (`admin.update state=published`, which clears its reports), next to the usual reject.
- The Reported tab's count equals `counts.reported`. The dashboard mentions reported entries next to the pending
  ones, and its "Active author blocks" count opens the entries whose author is blocked (`admin.entries?blocked=1`).
- The log shows readable labels for every kind ("Hidden after reports", "Reports dismissed", "Author blocked",
  "Author unblocked"), never the raw kind names. The block confirmation says the block lasts 90 days by default
  (`limits.block_days`) and can be undone.
- Visitor entries have **Block author** (confirm first, optional note) or, when `author_blocked`, **Unblock
  author**, and an "Author blocked" badge. The log shows readable summaries for `report_hide`,
  `dismiss_reports`, `block` and `unblock`.
- The context line shows the app when present ("App: iOS 2.3.1").
- **My tasks** are the owner's private items, with a "New task" form: type, title, details,
  status, tags, and a "public" checkbox. A task can be made public later, and a public owner
  item can be made private again.
- Each entry shows:
  - title, body, the originals when different, context, author tag, votes, status, tags
  - the AI note: action, confidence, reason, English translation, reviewer
  - the comment thread: public comments and private notes marked differently, with edit and
    hide
- Actions on each entry:
  - publish, reject (with a reason picker), flag, back to pending, make private (owner items)
  - merge into # (with a search picker)
  - edit title and type, edit tags (with suggestions from the vocabulary), set status
  - add a public comment or a private note
- Log: actions newest first with actor, summary and an Undo button when `undoable`; runs list
  with digest and "Undo this run" (confirm first).
- All visitor text is inserted with `textContent`, never `innerHTML`.
- Works at phone width.

## 10. Triage skill

Files: `skill/arghbox-triage/` — `SKILL.md`, `PROMPT.md`, `RULES.md`, `triage.mjs`.

**Site configuration** in the site's repository (git-ignored folder `.arghbox/`):
- `.arghbox/site.json`: `{"url": "https://example.com/arghbox/"}` (the folder; the script calls
  `<url>api.php`). Or `ARGHBOX_URL`.
- `.arghbox/token`: the triage token. Or `ARGHBOX_TOKEN`. Never printed, never logged.
- Work files: `.arghbox/run/queue.json`, `.arghbox/run/packet.md`, `.arghbox/run/verdicts.json`,
  history `.arghbox/history/<run_id>.json`, log `.arghbox/applied.ndjson`.

**Commands** (`node <skill dir>/triage.mjs <command> [--dir .arghbox] [--url ...]`):
- `fetch`: `admin.queue` → `queue.json` + `packet.md`; prints the counts and the next step.
  Prints `Nothing to triage.` and exits 0 when there are no pending entries. Keeps an existing
  `verdicts.json` unless `--fresh`.
- `check`: validates `verdicts.json` against `queue.json`; prints each problem with the entry id;
  exit 1 on problems.
- `apply`: runs `check`, then `admin.apply`; appends to `applied.ndjson`, saves the history file,
  clears `run/`, prints counts (published, rejected, merged, flagged, flagged instead, skipped
  with reasons) and the admin page URL.
- `status`: `admin.stats` + what is waiting locally.
- `undo --run <id>` or `undo --last`: `admin.undo` for a run.
- Exit codes: 0 ok, 1 validation problems, 2 configuration or network error (message says what
  to fix: missing token, 401, not JSON / not deployed, unreachable).

**verdicts.json**
```json
{
  "reviewer": "Claude Opus 5.5",
  "digest": "3 to 6 short lines for the owner, plain text, at most 1200 chars",
  "decisions": [ Decision, ... ]
}
```
`check` rules:
- Coverage: every pending entry in `queue.json` has exactly one decision, and so does every entry in `reported`
  (`keep` or `reject` only, section 6b). Flagged and private entries in the queue are context only (the owner's
  queue and tasks) and get no decision.
- `block_author: true` only on a `reject` with `reject_reason` `spam` or `abuse`.
- `fetch` prints `Nothing to triage.` only when there are no pending and no reported entries. `packet.md` has a
  "Reported" section (each entry with its open report count and reasons), and pending entries show their reports
  ("hidden after 3 reports"). `RULES.md` says a report is a signal, not a verdict: keep entries that are merely
  unpopular or critical, reject spam, abuse and off-topic posts, and set `block_author` only for clear spam or abuse
  with confidence 90 or more.
- Allowed actions: on published entries only `merge` or `tag`; `tag` only on published
  entries.
- Ids exist, and fingerprints match `queue.json`.
- `merge_into` is present only on merges. It points at an entry that is published, or that is
  published in this file. It is not the entry itself, creates no cycle, and is never a private
  item.
- `reject_reason` is present on every reject.
- `tags`: 0 to 3, each matching the tag format, required on `tag`. It is a warning (not an
  error) when a tag is new to the vocabulary, so the AI reuses tags.
- Limits: `confidence` an integer 0–100; `reason` 1–500 chars; `title` 4–120 chars when
  present; `title_en` at most 200; `digest` at most 1200; `reviewer` non-empty.

## 11. Tooling

| Tool | Does |
|---|---|
| `tools/dev.mjs [--port 8787] [--seed] [--origin http://localhost:5173] [--dev-dir <dir>]` | Starts the fake Turnstile verify server and `php -S` on `demo/` + `arghbox/` (router maps `/arghbox/*` to the `arghbox/` folder; `--site <dir>` serves another folder instead of `demo/`, e.g. a marketing site that installs ArghBox), with a dev config in `.dev/` (git-ignored) using Cloudflare's always-pass test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`), prints the URLs and the dev owner token. `--seed` loads `tests/fixtures/demo-seed.json` (published entries) on first start. `--origin` adds an allowed origin. `--dev-dir <dir>` (default `.dev` in the repo; relative paths resolve from the current folder) holds everything generated (config, tokens, `arghbox/site.json` and `token`, default data dir), so parallel servers never share state; `--fresh` wipes only that data. |
| `tools/new-secrets.mjs` | Prints a new `secret`, an owner token, a triage token and their sha256 values as a ready-to-paste config snippet. |
| `tools/seed.mjs --config <config.php> --file <json>` | Loads entries straight into the SQLite database of a dev or test install by running `tools/seed.php` with the PHP CLI and the `lib/` code. There is no seeding endpoint over HTTP. Seed entries: `{type, title, body, state, status, source, tags, votes (number of fake voters), comments: [{body, public}], merged_into (index in the file), reject_reason, author (any string, hashed like an IP so bursts can be simulated), created_at, context}`. |
| `tools/install.mjs --target <site repo> [--public <public dir>] [--no-skill] [--skill-only] [--dry-run] [--quiet]` | Copies `arghbox/` to `<target>/<public>/arghbox/` (never overwrites `config.php` or `data/`), and, unless `--no-skill`, the skill to `<target>/.claude/skills/arghbox-triage/` and `<target>/.agents/skills/arghbox-triage/` (Codex). Without `--public` it uses the first of: a candidate folder that already holds `arghbox/VERSION`, else the first existing of `public`, `public_html`, `static`, `www`, `htdocs`, else `.` when `index.html` or `index.php` exists, else exit code 2; it prints the folder it picked. `--skill` is accepted and ignored. The exported `install()` still requires `publicDir` and writes the `.agents` copy only with `agentsSkill: true`; `detectPublicDir(target)` returns `{ dir, reason }` or null. Prints the `.gitignore` lines to add; `--quiet` prints one summary line and the notes (for `prebuild` scripts). |
| `tools/pack.mjs` | Builds `dist/arghbox-<version>.zip` (the `arghbox/` folder) and `dist/arghbox-triage-skill-<version>.zip`. |
| `bin/arghbox.mjs` (npm: `npx arghbox`) | `install` (as `tools/install.mjs`, `--target` defaults to the current folder), `secrets [--read]` (as `tools/new-secrets.mjs`), `version`, `help`. Exit code 2 on a usage error. |
| `index.mjs` (npm: `import ... from 'arghbox'`) | `version` (the package version, equal to `arghbox/VERSION`), `serverDir`, `skillDir` (absolute paths in the installed package) and `install(options)` (the installer, `target` defaulting to the current folder). Types in `index.d.ts`. |

### The npm package

`arghbox` on npmjs.com holds the `arghbox/` folder (without `config.php`, databases, `data/` contents, logs and `.bak` files), the triage skill, `bin/`, `index.mjs`/`index.d.ts`, `tools/install.mjs` and `tools/new-secrets.mjs`. It has no runtime dependencies. `package.json`, `arghbox/VERSION`, `lib/version.php` and the CHANGELOG heading always carry the same version (`tests/tools/package.test.mjs`). `.github/workflows/release.yml` publishes a version only when the owner runs it (Actions, Release, Run workflow, or a pushed `vX.Y.Z` tag). The tag is the only input: every job writes its version into the files with `tools/set-version.mjs` (package.json and the lockfile, `arghbox/VERSION`, `lib/version.php`, the widget headers and constants, docs and tests; CHANGELOG `## [Unreleased]` becomes the dated section used as the release notes), and after npm published, a last job commits the same change back to the branch (not for pre-releases). It refuses a tag older than package.json, a version already on npm and an already published release, builds the zips and the npm tarball with build provenance attestations, creates the GitHub Release (draft first, then published), and publishes to npm with `--provenance` (`--tag next` for pre-release versions). It runs no tests. `publishConfig` has no `provenance`, so a local `npm publish` works too.
| `tools/translate.mjs <lang...> [--paid] [--all]` | **Owner only, paid** (Azure OpenAI). Translates missing or changed keys of `arghbox/i18n/en.json` into `i18n/<lang>.json`, updates the LABELS and LANGS blocks in `arghbox.js`. Reads `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` from the environment or the git-ignored `.secrets/azure-openai.json`. Without `--paid` it only prints what it would send and costs nothing. Agents never run it with `--paid`. |
| `tools/check-size.mjs` | Fails when `arghbox.js` > 4 KB, `arghbox-app.js` > 22 KB or `app-page.js` > 2 KB gzipped. |
| `tools/render-art.mjs` | Renders the PNG art (favicons into `art/brand/`, social card, README banner) from `art/` sources with Playwright. |
| `tools/build-pages.mjs [--out <dir>] [--serve [--port 8790]]` | Builds the GitHub Pages demo into `dist/pages/`: `demo/` plus the browser files of `arghbox/` (no PHP), the admin shell taken from `admin/index.php` as `arghbox/admin/index.html`, and `demo/backend.js` added before the widget, admin and app page scripts (it answers `api.php` in the browser; admin password `demo`). `--serve` serves it under `/ArghBox/` like GitHub Pages (`npm run demo`). `.github/workflows/demo.yml` publishes it after each successful Release run, or when run by hand. |
| `tools/capture.mjs` | Takes the README screenshots of the real widget and admin page (on the demo page) with Playwright into `docs/images/`. |

## 12. Tests

- `npm test` → `node --test "tests/**/*.test.mjs"`: unit tests for PHP (through the API on a
  `php -S` per test file with a temp data dir, `ARGHBOX_CONFIG`, and the fake Turnstile verify
  server), the triage script, the tools, and pure widget helpers. Runs offline.
- `npm run test:e2e` → Playwright `e2e/*.spec.mjs` (Chromium; phone and desktop projects) against
  `tools/dev.mjs`-style servers started by Playwright `webServer` or a global setup. Turnstile's
  `api.js` is replaced with a stub via `page.route` so tests run offline.
- `npm run test:all` runs both plus `check-size`.
- Reports, blocks, the app pass and `context.app` have API tests (`tests/api/reports.test.mjs`,
  `tests/api/app.test.mjs`), MCP tests and triage `check` tests. The app page has a Playwright spec
  (`e2e/app-page.spec.mjs`, phone and desktop) that fakes the four bridges with `addInitScript`. The widget's
  Report flow and the admin page's Reported list each have Playwright tests.
- No CI and no test automation on GitHub (owner decision 2026-11-17, after a CI matrix with macOS and Windows
  used the whole month of free minutes while the repo was private). Tests run locally: `npm run test:all`. The only
  workflow is the owner-run release; Dependabot opens grouped pull requests once a month.
