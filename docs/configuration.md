# Configuration

ArghBox is configured in two places: `config.php` on the server (what the box does), and attributes on the script tag (how the widget looks on a page).

## `config.php`

A PHP file that returns an array. `arghbox/config.example.php` documents every key. Where the file goes is explained in [install.md](install.md). Never commit it.

| Key | Default | Meaning |
|---|---|---|
| `site_name` | `'My site'` | Shown in the dialog title and on the admin page. |
| `site_url` | `''` | The site's public URL. Used in admin links, the triage packet and the Atom feed links. |
| `about` | `''` | One paragraph about your site and its audience. The triage AI reads it to tell on-topic from off-topic. |
| `turnstile_site_key` | `''` | Public Cloudflare Turnstile key. |
| `turnstile_secret_key` | `''` | Secret Turnstile key. |
| `turnstile_verify_url` | Cloudflare's siteverify URL | Only change it for tests. |
| `secret` | required | 64 hex characters. The key for the hashes of IPs and voters and for signing passes, receipts and admin cookies. Make it with `npx arghbox secrets` (or `node tools/new-secrets.mjs` in a clone). |
| `owner_token_sha256` | `''` | sha256 hex of the owner token. Signs you in to the admin page and the admin API. |
| `triage_token_sha256` | `''` | sha256 hex of the triage token. Admin API and MCP only. Use it for the triage skill. |
| `read_token_sha256` | `''` | Optional sha256 hex of a read-only token: admin GET actions, exports and MCP read tools. |
| `trusted_ip_header` | `''` | Which header carries the visitor's IP. Empty uses the connection address. Use `'HTTP_CF_CONNECTING_IP'` behind Cloudflare and `'HTTP_X_REAL_IP'` behind Hostinger's CDN. The header is only believed when the connection itself comes from a trusted proxy: Cloudflare's published address ranges (built in) for `HTTP_CF_CONNECTING_IP`, or the addresses in `trusted_proxies`. `'HTTP_X_FORWARDED_FOR'` needs `trusted_proxies`; the right-most address that is not one of your proxies wins. IPv6 visitors are grouped by their /64 and IPv4-mapped addresses count as IPv4. |
| `trusted_proxies` | `[]` | Addresses or CIDR ranges of your own proxies, for example `['203.0.113.7', '10.0.0.0/8']`. Overrides the built-in Cloudflare list for `HTTP_CF_CONNECTING_IP`. |
| `allowed_origins` | `[]` | Extra origins that may call the public API from a browser (CORS), for example `['https://www.example.com']`. Your own origin always works. An origin ending in `:*`, such as `'http://localhost:*'`, allows that host on any port: meant for development (see [Test on your computer](install.md#test-on-your-computer)). |
| `data_dir` | `null` | Absolute path for the database, outside the web root. `null` means automatic (see below). |
| `moderation` | `'pending'` | `'pending'`: new entries wait for triage or your review. `'publish'`: they show at once. |
| `auto_apply_min_confidence` | `80` | Triage verdicts below this confidence are stored as "flag" for you to decide. |
| `credit` | `true` | Show the small "Powered by ArghBox" link, with the ArghBox logo, in the dialog footer. It links to arghbox.com. |
| `tags` | `[]` | Preset tags offered first to the triage AI and to you, for example `['map', 'export', 'mobile']`. |
| `welcome` | `''` | A short plain-text note from you at the top of the dialog (up to 500 characters). |
| `mcp_enabled` | `true` | Serve `mcp.php` (see [mcp.md](mcp.md)). |
| `triage_public_writes` | `false` | Let the triage token (the AI, over REST or MCP) put new text on the public board: public comments, public tasks, publishing entries and rewriting published titles or texts. Off, it can still triage (publish or reject pending entries through `apply`, status, tags, merges, links) and write private notes. Old name `mcp_allow_public_comments` is still accepted. |
| `turnstile_hostnames` | `[]` | Hostnames a Turnstile token may be issued for, besides the host of `site_url`. Tokens also must carry the action `arghbox` when Cloudflare reports one. The check is skipped with Cloudflare's test keys. |
| `journal_mode` | `'delete'` | SQLite journal mode. `'delete'` works everywhere. `'wal'` lets readers and the writer overlap and creates `-wal` and `-shm` files next to the database (already blocked by the deny rules); do not use it on network filesystems. WAL falls back to `delete` when it cannot be enabled. |
| `contact_url` | `''` | A link shown as "Contact" in the dialog footer: `https://`, `http://` or `mailto:`, at most 300 characters. Anything else counts as empty. App stores want contact details for apps with user posts, see [mobile.md](mobile.md). |
| `report_hide_at` | `3` | A published visitor entry that this many different people (different IP hashes) have reported is hidden until you review it (it waits as pending; "Put it back" on the admin page publishes it again and dismisses the reports). `0` never hides automatically. A whole number from 0 to 100. |
| `app_pass` | `false` | For mobile apps whose WebView cannot pass Turnstile: hand out a pass without the human check. A weaker protection, so it is off by default. Read [mobile.md](mobile.md#the-app_pass-fallback) first. |
| `limits` | see below | Rate limits and form checks. |

### `limits`

Missing keys fall back to these defaults, so you only list what you change.

| Key | Default | Meaning |
|---|---|---|
| `entries_per_hour` | 5 | New entries per visitor (per IP hash) per hour. |
| `votes_per_hour` | 60 | Votes per visitor per hour. |
| `sessions_per_hour` | 20 | Turnstile checks per visitor per hour. |
| `votes_per_ip_per_entry` | 3 | Votes from one IP on one entry (people share networks, so more than 1). |
| `admin_logins_per_hour` | 10 | Wrong tokens per visitor per hour on the admin API, sign-in and MCP. A correct token is never throttled. |
| `pass_ttl_seconds` | 1800 | How long a passed Turnstile check lasts. |
| `min_fill_ms` | 2500 | Forms filled faster than this are treated as bots (silently). |
| `max_links` | 2 | Links allowed in one entry. |
| `mcp_calls_per_minute` | 120 | MCP calls per token per minute. |
| `mcp_writes_per_minute` | 30 | MCP write calls per token per minute. |
| `sessions_global_per_hour` | 2000 | Turnstile checks per hour for the whole site, whatever the number of visitors. |
| `auth_failures_global_per_hour` | 500 | Wrong tokens per hour for the whole site (REST and MCP). |
| `mine_per_hour` | 120 | "Your arghs" lookups per visitor per hour. |
| `reports_per_hour` | 10 | Reports per visitor (per IP hash) per hour. |
| `block_days` | 90 | How long "Block author" lasts. You can lift a block at any time. |

### Where things are found

`config.php`, first match wins: the `ARGHBOX_CONFIG` environment variable, then `arghbox-private/config.php` above the web root, then `arghbox/config.php`.

The database (`arghbox.sqlite`), first usable wins: `data_dir` from the config (if writable and outside the web root), the `ARGHBOX_DATA_DIR` environment variable, `arghbox-private/` above the web root, then `arghbox/data/` (protected by `.htaccess`, reported as a warning by the health check).

## Mobile apps

Apps show the board in a WebView with `arghbox/app.html`. It takes URL parameters (`platform`, `version`, `from`, `view`, `type`, `theme`, `accent`, `lang`, `tone`) instead of script tag attributes. See [mobile.md](mobile.md).

## Script tag attributes

```html
<script src="/arghbox/arghbox.js?v=0.1.1" defer
        data-position="left" data-theme="host" data-accent="#2563eb"></script>
```

All attributes are optional.

| Attribute | Values | Default |
|---|---|---|
| `data-api` | URL of `api.php` | `api.php` next to the script |
| `data-position` | `right`, `left` | `right` |
| `data-offset` | Vertical position of the tab, 10 to 90 (percent of the window height) | `50` |
| `data-label` | Tab text | "Feedback" (translated when the language is available) |
| `data-lang` | Language code, for example `pl` | the page's `<html lang>`, else `en` |
| `data-theme` | `auto` follows the visitor's light or dark setting, `light`, `dark`, or `host` follows your site (the `dark` class on `<html>` or `data-theme="dark"` on it) | `auto` |
| `data-accent` | Any CSS colour, including `var(--your-variable)`. The same as `--arghbox-accent` below, and wins over it | `#e8553d` |
| `data-tone` | `funny`, `neutral` | `funny` |
| `data-tab` | `on`, `off`. With `off` there is no tab: open the box from your own button or link | `on` |
| `data-tab-min-width` | Viewport width in px below which the edge tab is not shown, for example `600` when the tab would cover text on narrow phones and your header has its own Feedback button. `ArghBox.open()`, `#arghbox` links and `ArghBox.showTab()` still work, and it follows rotating a phone | `0` (always shown) |
| `data-closable` | `on`, `off`. A small × on the tab hides it | `on` |
| `data-dismiss-days` | Days the tab stays hidden after ×. `0` means this page view only | `30` |
| `data-preview` | `on` is a soft launch: the tab only shows in browsers that opened a URL with `#arghbox` once | off |
| `data-z` | z-index of the widget | `2147483000` |
| `data-credit` | `off` hides the credit link even when the server allows it | on |
| `data-page` | A fixed page path to record with entries instead of the real one (see below) | the real path |

### Opening the box from your own page

The tab is only one way in. Any page can open the same dialog from its own buttons, for example an icon in your header next to your other contact icons, or a "Share an idea" button on your About or Contact page.

- A link or a visit to `#arghbox` opens the dialog. `#arghbox-add` opens the add form, `#arghbox-bug` starts a bug report, and `#arghbox-<id>` opens one entry (the Atom feed links use this). The widget removes the hash again, so the URL stays clean. Links need no JavaScript, work in Markdown (`[Share an idea](#arghbox-add)`) and still work when they are clicked before the widget has loaded. They must open in the same tab (no `target="_blank"`).
- From JavaScript: `ArghBox.open({ type: 'bug', view: 'add' })`, `ArghBox.close()`, `ArghBox.showTab()` and `ArghBox.hideTab()`. Before the deferred script has run, `ArghBox` is not there yet, so links are the safer choice for content that shows at once.
- Events on `window`: `arghbox:ready`, `arghbox:open`, `arghbox:close`, `arghbox:add`, `arghbox:vote`, `arghbox:dismiss` and `arghbox:tab`. They never carry visitor text.

```html
<!-- in the header: the ArghBox logo as an icon link -->
<a href="#arghbox" aria-label="Feedback: share an idea or report a bug" title="Feedback">
  <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
    <path fill="#ffc83d" d="M17 1l2 4h3l-1 4 3 3-4 1-1 4-3-3-4 3v-5l-3-1 2-3-1-4 4 1z"/>
    <path fill="#e8553d" d="M3 13h26v8H3zM5 21v8h22v-8M10 17h12"/>
  </svg>
</a>

<!-- on the About or Contact page -->
<a class="button" href="#arghbox-add">Share an idea</a>
<a class="button" href="#arghbox-bug">Report a bug</a>
```

The logo files are in [art/](../art/README.md). Using the logo to point at ArghBox is fine; see [TRADEMARKS.md](../TRADEMARKS.md).

### Colours and fonts

By default the widget wears ArghBox's own palette: the red accent, warm ink text, cream panels, and a dark theme in the brand's night colours. `data-accent` and `data-theme` cover most sites. To match your design further, set these CSS custom properties in your own stylesheet, on `:root` or on `#arghbox-root`. Custom properties cross the widget's Shadow DOM, nothing else does.

| Property | What it colours | Default (light / dark) |
|---|---|---|
| `--arghbox-accent` | The tab, the main buttons, selected states and highlights. Darkened where needed so white text stays readable | `#e8553d` |
| `--arghbox-bg` | Dialog background | `#fff` / `#1f1613` |
| `--arghbox-fg` | Text | `#2b1d1a` / `#fff6e9` |
| `--arghbox-muted` | Secondary text | `#6e5d56` / `#b8a8a0` |
| `--arghbox-card` | Soft panels: the Ideas and Bugs switch, suggestions, comments | `#fff6e9` / `#2c211d` |
| `--arghbox-border` | Borders of fields, chips and vote buttons | `#8f7c73` / `#8a7870` |
| `--arghbox-line` | Dividers | `#eee3d6` / `#3b2d28` |
| `--arghbox-font` | Font of the tab and the dialog | the system font |

```css
:root { --arghbox-accent: #2563eb; --arghbox-font: Inter, system-ui, sans-serif; }
/* the colour properties apply to the theme that is showing, so set them per theme */
html.dark { --arghbox-bg: #0f172a; --arghbox-card: #1e293b; }
```

Keep text readable: `--arghbox-fg` and `--arghbox-muted` need a contrast of at least 4.5:1 on `--arghbox-bg` and `--arghbox-card`, and `--arghbox-border` at least 3:1.

### Content Security Policy

ArghBox works under a strict CSP. These are the sources it needs. Replace `https://example.com` with the origin that serves `/arghbox/` (write `'self'` when that is your own site).

| Directive | Allow | Why |
|---|---|---|
| `script-src` | the ArghBox origin, and `https://challenges.cloudflare.com` | `arghbox.js`, `arghbox-app.js` and the Turnstile script |
| `frame-src` | `https://challenges.cloudflare.com` | The Turnstile check runs in a frame |
| `connect-src` | the ArghBox origin, plus the origin of `data-api` when you set it to another one | `api.php` calls and the language files |

```
Content-Security-Policy: script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'
```

You do **not** need `style-src 'unsafe-inline'`: the widget attaches its styles as constructable stylesheets, which every supported browser has (Safari since 16.4).

- **Nonces.** If your CSP uses `'nonce-...'`, put the nonce on the ArghBox script tag as usual. The loader passes it on to the scripts and styles it adds, so no extra source is needed.
- **Trusted Types.** If you enforce them (`require-trusted-types-for 'script'`), add `trusted-types arghbox` to the policy. ArghBox creates one policy named `arghbox` for the script URLs it loads.
- A report-only policy is a good way to check your own rule set before you enforce it.

### Single-page apps with hash routing

If your site routes with the URL hash (Vue Router in hash mode, React `HashRouter`), a link such as `<a href="#arghbox">` would be read by your router as a page, and ArghBox's `#arghbox` hash handling can fight with it. Open the box from a button instead:

```html
<button type="button" onclick="ArghBox.open()">Feedback</button>
<button type="button" onclick="ArghBox.open({ type: 'bug', view: 'add' })">Report a bug</button>
```

`#arghbox` links are fine on sites without a hash router.

### Keeping secrets out of the recorded page

Every entry records the page path (never the query or the hash), and the add form shows it before sending. If your URL paths themselves contain secrets (a password-reset token, a magic link, an invoice id), tell ArghBox what to record instead.

- `data-page` on the script tag sets a fixed path for the page, for example `data-page="/account/reset"`. Use it on pages whose real URL must never be recorded.
- `window.ArghBoxConfig.redactPage` is a function that receives the real path and returns the path to record. Define it before the dialog opens, for example in your own script above the ArghBox tag:

```html
<script>
  window.ArghBoxConfig = {
    redactPage: function (path) {
      return path.replace(/^\/reset\/[^\/]+/, '/reset/:token').replace(/^\/invoice\/\d+/, '/invoice/:id');
    }
  };
</script>
<script src="/arghbox/arghbox.js?v=0.1.1" defer></script>
```

What the function returns is what the form shows and what is stored. Return `''` to record no page at all.
