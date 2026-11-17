# HTTP API

Everything goes through one file: `https://example.com/arghbox/api.php?action=<name>`. This page is for people who build on top of ArghBox (a custom front end, a dashboard, a backup script). The widget and the admin page use exactly these calls.

Conventions:

- Requests with a body use JSON (`Content-Type: application/json`), up to 16 KB for public actions and 256 KB for admin actions.
- Every answer is JSON with `Cache-Control: no-store`, except the Atom feed and exports.
- Success: `{"ok": true, ...}`. Failure: an HTTP 4xx or 5xx status and `{"ok": false, "error": "<code>", "message": "<English sentence>", "field": "<name>", "retry_after": <seconds>}` (the last two only when they apply).
- Error codes: `bad_request`, `invalid_input` (with `field`), `method_not_allowed`, `not_found`, `origin_not_allowed`, `turnstile_failed`, `turnstile_not_configured`, `pass_invalid`, `pass_expired`, `rate_limited` (429, with a `Retry-After` header), `unauthorized` (401), `forbidden` (403), `conflict` (409), `not_configured` (503), `busy` (503 with `Retry-After: 2`: the database is locked by another request, try again) and `server_error`.

## Public actions

### Cross-origin calls

Calls from your own origin need nothing. To call the API from another origin in a browser, list it in `allowed_origins` in `config.php`. Allowed origins get the CORS headers (`Access-Control-Allow-Origin`, methods GET, POST, OPTIONS, headers `Content-Type` and `X-ArghBox-Voter`). A POST from any other origin answers 403 `origin_not_allowed`. Admin actions never send CORS headers.

### The entry object

```json
{ "id": 12, "type": "idea", "title": "Dark mode", "body": "", "votes": 14,
  "status": "planned", "status_at": "2026-11-20T09:00:00Z", "tags": ["design", "map"],
  "comments": [{"body": "Coming in December.", "at": "2026-11-20T09:00:00Z"}],
  "similar": 2, "aliases": ["Night theme please"], "source": "visitor",
  "created_at": "2026-11-14T10:00:00Z" }
```

`type` is `idea`, `bug` or `question`. `status` is `open`, `planned`, `in_progress`, `done` or `declined`. `similar` counts the entries merged into this one and `aliases` lists their titles (up to 10). `comments` are your public comments, oldest first (up to 20). `source` is `owner` for items you published yourself.

### The voter key and the pass

- A **voter key** is a random string of 22 to 64 characters from `A-Za-z0-9_-` that the browser makes for itself (the widget keeps it in `localStorage` as `arghbox:voter`). It stands in for an account.
- A **pass** is a short-lived signed token you get by proving a Turnstile challenge (`session`). It is tied to the caller's IP and lasts 30 minutes by default. Voting, adding and reporting need one. (Mobile apps can use `session` with `{"app": true}` when `app_pass` is on, see below.)

### `GET list`

Header `X-ArghBox-Voter: <voter key>` is optional. No Turnstile needed.

Answer: `{ok, site: {name}, welcome, max_links, version, turnstile_site_key, moderation, credit, contact, app_pass, entries, tag_counts: [{tag, count}], voted: [id]}`. `contact` is `contact_url` from the config (`""` when unset). `app_pass` is true when the app pass is on. `entries` holds every published entry of every status, most votes first then newest, up to 500. It never contains pending, flagged, rejected, merged or private entries. `max_links` is `limits.max_links`, so the widget can validate with the same number (a link is one `http(s)://...` address or one bare `www....` address). `voted` lists the ids this voter key voted on.

### `POST session`

Body `{"turnstile": "<token from the Turnstile widget>"}`. Answer: `{ok, pass, expires_at, expires_in}`. Rate-limited per visitor.

Body `{"app": true}` (no `turnstile`) is for mobile apps whose WebView cannot pass Turnstile. When `app_pass` is true in `config.php` it returns a normal pass without the human check, under the same rate limits. Otherwise it answers 403 `turnstile_failed`. This is a weaker protection: see [mobile.md](mobile.md#the-app_pass-fallback). With a `turnstile` token in the body, Turnstile is used as before.

### `POST add`

Body:

```json
{ "pass": "...", "voter": "<voter key>", "type": "idea", "title": "Dark mode",
  "body": "Optional details", "hp": "", "elapsed_ms": 9000,
  "context": {"page": "/pricing", "lang": "en", "browser": "Chrome", "os": "Windows", "screen": "large"} }
```

Rules: `title` is 4 to 120 characters (spaces collapsed), `body` up to 2000, at most `max_links` links in total. `hp` is a honeypot and must stay empty, and `elapsed_ms` is how long the form was open (too fast is treated as a bot). Bots get a fake success so they learn nothing. `context.page` must start with `/` and loses any query or hash; `screen` is `small`, `medium` or `large`. `context.app` is optional and comes from the mobile app page: `{"platform": "ios", "version": "2.3.1"}` (`platform` is `ios`, `android` or `other`; `version` is 1 to 20 characters from `0-9 A-Z a-z . _ + -`). Invalid members are dropped, never an error.

Answer: `{ok, entry: <entry> + {state}, receipt}`. `state` is `pending` or `published`, depending on `moderation`. Keep the `receipt`: it lets the visitor see what happened to the entry later (`mine`). The author's own vote is counted automatically. When the author is blocked, the entry is stored as rejected (reason `abuse`) and the answer still says `state: "pending"`; the author learns nothing.

### `POST vote`

Body `{"pass": "...", "voter": "<voter key>", "id": 12, "on": true}`. Answer: `{ok, id, votes, voted}`. Voting again when already voted is not an error: you get the current state. `on: false` withdraws a vote. If the entry was merged, the vote counts for its target, and `id` in the answer is the target. One voter key counts once per entry; one IP can add at most `votes_per_ip_per_entry` votes to an entry (429 `rate_limited` after that).

### `POST report`

Body `{"pass": "...", "voter": "<voter key>", "id": 12, "reason": "spam"}`. `reason` is `spam`, `abusive`, `off_topic` or `other` (anything else is `invalid_input` with `field: "reason"`). Answer: `{ok, id}`.

- Only a published visitor entry can be reported. Any other id (unknown, pending, merged, rejected, private, an owner item) answers 404 `not_found`.
- One report per voter key per entry. Reporting again answers `{ok, id}` and changes nothing.
- Rate-limited per visitor by `reports_per_hour` (429 `rate_limited`).
- When `report_hide_at` different people (by IP hash) have an open report on an entry, it goes back to `pending` and leaves the public list. The answer never says whether that happened.
- A blocked author's report gets the same `{ok, id}`, and nothing is stored.

### `POST mine`

Body `{"receipts": ["<receipt>", ...]}` (up to 50). Answer: `{ok, entries: [{receipt, id, type, title, state, status, tags, comments, merged_into, merged_into_title, reject_reason}]}`. A flagged entry, or one hidden after reports, is reported as `pending` ("waiting for review"). `reject_reason` is one of `spam`, `abuse`, `off_topic`, `test`, `unclear`, `other`.

### `GET feed`

An Atom 1.0 feed (`application/atom+xml`), cached for 10 minutes: the 50 most recently updated published entries. See [integrations.md](integrations.md).

### `GET health`

`ok` is true (HTTP 200) when the install can serve requests: config found and valid, `pdo_sqlite` loaded, data dir usable. Otherwise HTTP 503 with `ok: false` and the same fields; `turnstile: false` alone does not flip it. It never reveals secrets, paths or IP addresses, and it is the only action that answers while the box is not configured.

**Anonymous callers** get:

| Field | Values |
|---|---|
| `ok` | `true` (200) or `false` (503) |
| `version` | ArghBox version, for example `"0.1.0"` |
| `php` | PHP major.minor only, for example `"8.2"` |
| `sqlite` | SQLite version, or `null` when `pdo_sqlite` is not loaded |
| `config` | `"found"` or `"missing"` |
| `config_valid` | `true` when the config is found and its `secret` is 64 hex characters |
| `data_dir` | `"outside_webroot"`, `"inside_webroot_protected"` or `"error"` |
| `turnstile` | `true` when both Turnstile keys are set |
| `ip_header` | `"configured"` or `"not_configured"` |
| `app_pass` | `true` when the app pass is on |
| `moderation` | `"pending"`, `"publish"` or `null` (no config) |
| `admin` | `true` when an owner token hash is set |

**Authorised callers** (an owner, triage or read bearer token, or the admin cookie) get the same fields, with these differences and additions:

| Field | Values |
|---|---|
| `php` | the full PHP version, for example `"8.2.12"` |
| `ip_header` | `"not_configured"`, `"present"` (this request carried the header) or `"missing"` |
| `config_location` | `"env"`, `"private"` or `"local"` |
| `data_dir_warning` | a sentence when the data folder's parent looks like a web root (named `public_html`, `www`, `htdocs`, `html`, or holding an `index.php` / `index.html`), else `null` |
| `turnstile_test_keys` | `true` when the Turnstile secret is one of Cloudflare's test secrets (every visitor passes) |
| `warnings` | a list of sentences: the data folder warning, the test keys warning, and the app pass warning ("app_pass is on: anyone can get a pass without the human check, so votes are limited only by the per-IP caps."), and the proxy-header warning (the header is ignored because this request did not come from a Cloudflare address or a trusted proxy, and the web server had not already put the visitor's address in `REMOTE_ADDR`) |

Example: `curl -H "Authorization: Bearer <triage token>" "https://example.com/arghbox/api.php?action=health"`.

## Admin actions

All admin actions are `api.php?action=admin.<name>`.

### Authentication

Either:

- `Authorization: Bearer <token>` with the **owner token** (acts as `owner`), the **triage token** (acts as `triage:<reviewer>`) or the **read token** (GET actions only; any POST answers 403 `forbidden`). Tokens are compared by sha256 against the hashes in `config.php`.
- A cookie session: `POST admin.login` with `{"token": "<owner token>"}` sets the `arghbox_admin` cookie (12 hours, HttpOnly, SameSite=Strict) and returns `{ok, csrf}`. Send the `csrf` value in the `X-ArghBox-CSRF` header on every POST.

Wrong or missing credentials answer 401 `unauthorized`. Sign-in attempts are rate-limited.

### The admin entry object

The public entry plus `state` (`pending`, `published`, `rejected`, `merged`, `flagged`, `private`), `merged_into`, `reject_reason`, `external_url`, `title_original`, `body_original`, `context`, `ai` (the AI note), `author` (the first 8 characters of the author's IP hash, to spot bursts), `fingerprint` (it also changes when a report is made or cleared on the entry), `updated_at`, `comments` listing every comment as `{id, body, public, hidden, created_at, updated_at}`, and two fields about reports and blocks:

- `reports`: `{open, total, reasons: {spam, abusive, off_topic, other}, last_at}`. `open` is the number of open reports, `reasons` counts the open ones only, and `last_at` is the time of the newest open report (or null). A report is open until you keep or publish the entry (publishing it by any route clears its open reports). Rejecting, flagging or merging does not clear them.
- `author_blocked`: true when an active block matches the entry's author.

`context` may hold `app: {platform, version}` when the entry came from the mobile app page.

### Reading

| Action | Method and query | Answer |
|---|---|---|
| `admin.me` | GET | `{ok, actor, csrf}` |
| `admin.queue` | GET | `{ok, site, moderation, auto_apply_min_confidence, tags, pending, flagged, published, private, reported}`: what the triage skill works from. `reported` lists published visitor entries with open reports, the oldest open report first (an auto-hidden entry is pending, so it comes in `pending` with its `reports`). Pending entries keep their `reports`, so you see why an auto-hidden entry came back |
| `admin.entry` | GET `?id=` | `{ok, entry, actions}` (the last 20 log rows for it) |
| `admin.entries` | GET `?state=&status=&type=&source=&tag=&q=&reported=1&blocked=1&sort=newest\|oldest\|votes&limit=50&offset=0` | `{ok, total, entries}`; `q` searches titles, bodies and comments; `reported=1` keeps the reported entries: at least one open report and the state `published`, `pending` or `flagged` (rejected and merged entries are settled); `blocked=1` keeps visitor entries whose author matches an active block |
| `admin.log` | GET `?run_id=&entry_id=&limit=100&offset=0` | `{ok, total, actions: [{id, at, actor, run_id, kind, entry_id, entry_title, summary, undone_by, undoable}]}` |
| `admin.runs` | GET `?limit=20` | `{ok, runs: [{id, at, reviewer, counts, digest}]}` |
| `admin.stats` | GET | `{ok, counts, votes, blocks, entries_last_7_days, last_run}`. `counts.reported` is the number of reported entries (the same rule as `reported=1`, so it equals the length of that list), `blocks` the number of active author blocks |
| `admin.export` | GET `?format=json\|csv\|jira-csv&state=` | A file download (`arghbox-<site>-<yyyymmdd>.<ext>`; `jira-csv` is `...-jira.csv`), see [integrations.md](integrations.md) |

### Changing things

| Action | Body | Notes |
|---|---|---|
| `admin.login`, `admin.logout` | `{token}` / none | Cookie sessions |
| `admin.create` | `{type, title, body?, status?, tags?, public?}` | Your own item: private unless `public` is true. No votes, no Turnstile |
| `admin.update` | `{id, state?, status?, type?, title?, body?, tags?, reject_reason?, external_url?, merge_into?}` | Edits. Rejecting needs a `reject_reason` (default `other`). `merge_into` merges. A merged entry cannot be changed: undo the merge instead (409) |
| `admin.comment` | `{id, body, public?}` | `public` defaults to true. 1 to 2000 characters |
| `admin.comment_update` | `{comment_id, body?, public?, hidden?}` | Hiding withdraws a comment; nothing is deleted |
| `admin.undo` | `{action_id}` or `{run_id}` | Refused with 409 when a later action on the same entry is not undone |
| `admin.apply` | `{run: {reviewer, digest}, decisions: [...]}` | Applies triage decisions in one transaction |
| `admin.dismiss_reports` | `{id}` | Keep a reported entry: clears its open reports (publishing an entry, for example "Put it back", clears them too). Answer `{ok, entry}`. Logged as `dismiss_reports`, and undoable |
| `admin.block` | `{id, note?}` | Block the author of a visitor entry for `limits.block_days` days (default 90). `note` is for you only (500 characters). An owner item answers 409 `conflict`. Blocking an author who is already blocked changes nothing and logs nothing |
| `admin.unblock` | `{id}` | Lift every active block that matches that entry's author |

The triage token may call `admin.dismiss_reports`, `admin.block` and `admin.unblock`: none of them puts text on the public board.

Changing an entry's state to `published` (`admin.update`, a publish decision) also clears its open reports, as part of the same logged action; undoing it opens them again. Rejecting, flagging or merging does not clear them.

A **decision** looks like:

```json
{ "id": 31, "fingerprint": "9f2c...", "action": "publish", "merge_into": 4,
  "type": "idea", "title": "Cleaned title", "tags": ["export"], "reject_reason": "spam",
  "block_author": false, "confidence": 92, "reason": "Admin-only explanation", "title_en": "English translation" }
```

`action` is `publish`, `reject`, `merge`, `flag`, `tag` or `keep`. `keep` is for a published entry with open reports: it clears them (logged as `dismiss_reports` with the run). A `reject` is also allowed on a published visitor entry with open reports. Below `auto_apply_min_confidence`, `keep` and such a `reject` are skipped with `low_confidence` (not flagged), so the entry stays public and stays in your Reported list. `block_author: true` is optional on a `reject` whose `reject_reason` is `spam` or `abuse`; it blocks the author when the reject is applied, and is `invalid_input` anywhere else. The run's counts add `keep` and `block`. The `fingerprint` comes from the queue; if the entry changed since, the decision is skipped as `changed`. Below `auto_apply_min_confidence` a decision is stored as a flag instead. The answer lists what was `applied` and what was `skipped`, each with a reason. An applied `reject` row carries `blocked` (true when this decision blocked the author; false when the author was already blocked or has nothing to block on), which is what the triage script's "authors blocked" counts.

Nothing is ever deleted: rejecting hides, merging moves votes by copy, and everything is in the log.

## MCP

The MCP endpoint is documented in [mcp.md](mcp.md).
