# Install ArghBox

This guide takes about 10 minutes. It is written for Hostinger and similar shared hosts (cPanel, hPanel, DirectAdmin), but any host with PHP 8.1 or newer, SQLite and Apache or LiteSpeed works.

You need:

- A website where you can add one line of HTML to your pages.
- Hosting with **PHP 8.1 or newer** and the `pdo_sqlite` extension (almost every host has both). A file manager or FTP access.
- A free Cloudflare account, for Turnstile.
- Node.js 22 or newer on your own computer, for the helper tools and the triage skill. (No Node on the server.) ArghBox is on npm as [`arghbox`](https://www.npmjs.com/package/arghbox): the package holds the `arghbox/` server folder, the triage skill and an `arghbox` command that installs both.

Want to see it first? Try the live demo on [arghbox.com](https://arghbox.com): click the Feedback tab. Or run `npm install` and `npm run dev` in this repository. It starts a demo site with a seeded box on your machine.

## 1. Create a Turnstile widget

Turnstile is Cloudflare's free, mostly invisible bot check. Your domain does **not** need to be on Cloudflare.

1. Sign in at the [Cloudflare dashboard](https://dash.cloudflare.com/) and open **Turnstile** in the sidebar.
2. Click **Add widget**. Give it a name (for example "My site feedback") and add your domain, for example `example.com`. Add `www.example.com` too if you use it.
3. For widget mode choose **Managed**. ArghBox shows the challenge only when Cloudflare needs the visitor to interact.
4. Create it and copy the **site key** and the **secret key**. Keep the secret key private.

Just want to try the install first? Cloudflare publishes test keys that always pass, on any domain: site key `1x00000000000000000000AA` and secret key `1x0000000000000000000000000000000AA`. Swap in your real keys before you go live, because the test keys let bots through too.

## 2. Make your secrets and write `config.php`

On your computer, in your site's repository (or in any folder):

```
npx arghbox secrets
```

(In a clone of this repository, `node tools/new-secrets.mjs` does the same.)

It prints a `secret`, an **owner token**, a **triage token** and the sha256 hashes of both tokens. Save the two tokens in your password manager now: they are shown once, and only their hashes go into the config. (Add `--read` to also get a read-only token, see [mcp.md](mcp.md).)

- The **owner token** signs you in to the admin page.
- The **triage token** is for the triage skill and the MCP server. It is a different token on purpose.

Copy `arghbox/config.example.php` to a new file named `config.php` and fill in the keys. Paste the three lines the script printed over the empty `'secret'`, `'owner_token_sha256'` and `'triage_token_sha256'` lines. A minimal config:

```php
<?php
return [
    'site_name' => 'My site',
    'site_url' => 'https://example.com',
    'about' => 'What your site does and who uses it, in a sentence or two. The triage AI reads this.',
    'turnstile_site_key' => '0x4AAAAAAA...',
    'turnstile_secret_key' => '0x4AAAAAAA...',
    'secret' => '<from new-secrets>',
    'owner_token_sha256' => '<from new-secrets>',
    'triage_token_sha256' => '<from new-secrets>',
];
```

Every key is explained in [configuration.md](configuration.md). Never commit `config.php`.

## 3. Decide where `config.php` and the data go

ArghBox looks for `config.php` in this order and uses the first one it finds:

1. The path in the `ARGHBOX_CONFIG` environment variable (mostly for development).
2. **`arghbox-private/config.php` in the folder above your web root.** This is the best place: it cannot be reached from the web at all.
3. `config.php` next to `api.php`, inside `arghbox/`. A `.htaccess` file blocks it, but it is still inside the web root.

The SQLite database lives in the same `arghbox-private` folder when it exists (and ArghBox creates the folder if it can). Otherwise it falls back to `arghbox/data/`, which is protected by its own `.htaccess`. The health check (below) tells you which one is in use.

**On Hostinger** your web root is usually `/home/uXXXX/domains/example.com/public_html`. The private folder is its sibling:

```
domains/example.com/
  public_html/          <- your web root
    arghbox/            <- you upload this
  arghbox-private/      <- you create this, put config.php inside
```

Create `arghbox-private` in File Manager (it must sit next to `public_html`, not inside it), then upload `config.php` into it. If your host does not let you create folders above the web root, use option 3.

Keep an eye on `data_dir` in the health check (step 5). If PHP cannot write to `arghbox-private`, ArghBox quietly falls back to `arghbox/data/` and the health check says `inside_webroot_protected`. Your site keeps working, but it is a different, empty database. Fix the folder's permissions (755 or 775) instead of living with it.

When something goes wrong, ArghBox writes a line to `error.log` in the same folder as the database (`arghbox-private/error.log`). It is a short technical log (about 250 KB at most, then it starts over) and the quickest way to learn what a vague "something went wrong" was. Read it in File Manager; if there is no such file, ArghBox could not write anywhere, see the `data_dir` row in Troubleshooting.

## 4. Get the folder onto your site

**From npm (recommended when your site is in a Git repository).** In the site's repository:

```
npm install --save-dev arghbox
npx arghbox install --public <public dir> --skill
```

`<public dir>` is the folder your site serves as its web root, relative to the repository: `public_html`, `public`, `src/public` (VitePress), `static` or `.` when the repository root is the web root. The command copies the `arghbox/` folder there and the triage skill to `.claude/skills/arghbox-triage/`, never overwrites `config.php` or `data/`, and prints the `.gitignore` lines to add. Add `--dry-run` to see what it would do first, or `--skill-only` when you upload the folder yourself and only want the skill. Then deploy your site the way you always do: the `arghbox/` folder goes along.

**Let the build keep it in sync.** If your site has a build step, run the install from it, so the copy always matches the version in `package.json` and you never commit it:

```json
"scripts": {
  "predev": "arghbox install --public public --skill --quiet",
  "prebuild": "arghbox install --public public --skill --quiet"
}
```

npm runs `predev` and `prebuild` before `npm run dev` and `npm run build`. `--quiet` prints one line. Git-ignore the copies: `public/arghbox/`, `.claude/skills/arghbox-triage/` and `.arghbox/`. A `config.php` you keep inside `public/arghbox/` stays where it is, and stays ignored with the folder.

**Without npm.** Download `arghbox-<version>.zip` from the [GitHub releases](https://github.com/BinaryBananaLLC/ArghBox/releases), unzip it, and upload the `arghbox` folder. Or upload this repository's `arghbox/` folder directly, or run `node tools/install.mjs --target <your site repo> --public <public dir> --skill` from a clone (the same installer as `npx arghbox install`).

To check that a download is the real thing: `gh attestation verify arghbox-<version>.zip --repo BinaryBananaLLC/ArghBox`. The npm package shows its provenance on npmjs.com and in `npm audit signatures`.

With **File Manager**: open `public_html`, upload the zip, and use Extract. With **FTP or SFTP**: upload the whole `arghbox` folder, keeping the hidden `.htaccess` files (turn on "show hidden files" in your client). The `.htaccess` files matter: they block the `lib/` and `data/` folders and the config.

The folder must end up at `https://example.com/arghbox/`. (The `config.example.php` inside it is harmless and blocked by `.htaccess`; you may delete it.)

## Upgrading

1. With npm: `npm install --save-dev arghbox@latest`, then `npx arghbox install` with the same options as before (a `prebuild` script does that for you), and deploy. Without npm: upload the new `arghbox/` folder over the old one. Your `config.php` and database are not part of the package or the download, so they stay. Files that a newer version no longer uses are not deleted; they are harmless.
2. Change the `?v=` number in the script tag on your pages to the new version, so visitors' browsers fetch the new files. The installer reminds you. In a build config you can use the installed version instead of typing it: `import { version } from 'arghbox'`.
3. Open the health check: `version` shows the new number. Database changes (if a version has any) are applied by the first request that touches the database, with nothing for you to do.

Before an upgrade you can copy `arghbox.sqlite` (it is one file, in `arghbox-private/`) as a backup, or export JSON from the admin page.

## 5. Check the health

Open this in your browser, or use curl with your triage token to see the full details (the anonymous answer hides where things are):

```
https://example.com/arghbox/api.php?action=health
curl -H "Authorization: Bearer <triage token>" https://example.com/arghbox/api.php?action=health
```

You should see JSON with `"ok": true` (HTTP 200). If something essential is missing (config, `pdo_sqlite`, a writable data folder) you get HTTP 503 with `"ok": false`, which uptime monitors can watch. What to look at:

| Field | Good value |
|---|---|
| `config` | `"found"` |
| `config_location` | `"private"` (best) or `"local"` |
| `data_dir` | `"outside_webroot"` (best). `"inside_webroot_protected"` works but is a warning. |
| `turnstile` | `true` |
| `config_valid` | `true` |
| `php`, `sqlite` | your PHP version and a SQLite version. If `sqlite` is `null`, PHP has no `pdo_sqlite` extension: enable it in your hosting panel's PHP settings |
| `ip_header` | `"not_configured"` is right unless you are behind a CDN (see step 7) |
| `admin` | `true` |

Without a token you only get `ok`, `version`, `php` (major.minor), `sqlite`, `config`, `config_valid`, `data_dir`, `turnstile`, `ip_header` (`configured` or not), `moderation` and `admin`. With the owner, triage or read token (or after signing in) you also get `config_location`, the full PHP version, `data_dir_warning`, `turnstile_test_keys`, the proxy-header check (`ip_header` becomes `present` or `missing`) and a `warnings` list: read it after every deploy. The full list is in [api.md](api.md). The health check never shows secrets or paths. `"ok": true` means the box can serve requests, but still read the fields above: a missing Turnstile key, for example, does not turn it off.

Then open `https://example.com/arghbox/admin/` and sign in with the **owner token**. Sign-in only works over `https://` (on a real domain; `localhost` is exempt), because it sends your token.

### If your host is not Apache or LiteSpeed

ArghBox's protection files (`.htaccess`) only work on Apache and LiteSpeed. **OpenLiteSpeed and nginx ignore `.htaccess`**, so there:

- Keep `config.php` and the data in `arghbox-private/` above the web root (step 3); that is protection that needs no rules.
- Add the equivalent deny rules yourself. nginx: `location ~ ^/arghbox/(lib|data)/ { deny all; }` and `location ~* /arghbox/(config.*|VERSION|.*\.sqlite.*|.*\.(bak|old|orig|save|swp|swo|tmp|dist)|.*~)$ { deny all; }`, plus `location ~ /\.(?!well-known) { deny all; }`. OpenLiteSpeed: add a rewrite or context rule with the same patterns in the WebAdmin console.
- Pass the `Authorization` header to PHP (nginx: `fastcgi_param HTTP_AUTHORIZATION $http_authorization;`).
- ArghBox also writes a deny-all `.htaccess` into its data folder, which only helps on Apache and LiteSpeed.
- Test it: `https://example.com/arghbox/config.php`, `.../arghbox/lib/db.php` and `.../arghbox-private/` must not show anything.

Also check that the protected files really are blocked. `https://example.com/arghbox/config.php`, `https://example.com/arghbox/config.example.php` and `https://example.com/arghbox/data/arghbox.sqlite` (if the database is in `data/`) must answer 403 or 404, and never download anything. `https://example.com/arghbox/lib/db.php` should answer 403, 404 or an empty page.

## 6. Add the script tag

Put this before `</body>` (or in the `<head>`, it is deferred) on every page where you want the tab:

```html
<script src="/arghbox/arghbox.js?v=0.1.0" defer></script>
```

Change the `?v=` number when you upgrade, so visitors' browsers fetch the new files. Reload your site and you should see the **Feedback** tab on the right edge. Options for position, theme, colour and language are in [configuration.md](configuration.md).

Try it: open the tab, add a test idea. It lands in the admin page under **Pending**.

## 7. If your site is behind a CDN or a cache

If your domain uses Cloudflare's proxy (the orange cloud), Hostinger's CDN or any page-cache plugin, two things matter.

**Real visitor IPs.** Without help, ArghBox sees Cloudflare's addresses, so rate limits would treat everyone as one visitor. Set this in `config.php`:

```php
'trusted_ip_header' => 'HTTP_CF_CONNECTING_IP',
```

Hostinger's own CDN uses `'HTTP_X_REAL_IP'`. Then open the health check: `ip_header` should say `"present"`. Only set a header your host or CDN really sets, because a visitor could fake any other one.

Some web servers already put the visitor's address in place of Cloudflare's before ArghBox runs. LiteSpeed on Hostinger does this, and only for requests that really come from Cloudflare. ArghBox notices and uses that address, so the health check shows `"present"` with no proxy warning. Keep the setting above anyway: it is what tells ArghBox the site sits behind Cloudflare.

**No caching of the API.** `/arghbox/api.php`, `/arghbox/mcp.php` and `/arghbox/admin/` must never come from a cache: a cached `list` shows visitors old votes, and a cached admin answer can be someone else's. They send `Cache-Control: no-store` themselves, and CDNs normally respect that, but a "cache everything" page rule, a host-level page cache or a caching plugin may not. Check it twice:

```
curl -s -D - -o /dev/null "https://example.com/arghbox/api.php?action=health"
```

(In PowerShell: `curl.exe -s -D - -o NUL "https://example.com/arghbox/api.php?action=health"`. Or open the browser's developer tools, Network tab, and click the request.) Run it twice and read the headers:

- `cache-control: no-store` must be there. If it is missing, something in front of PHP rewrote it.
- No cache header may say a hit: Cloudflare's `cf-cache-status` must be `DYNAMIC`, `BYPASS` or absent (never `HIT`), LiteSpeed's `x-litespeed-cache` must not be `hit`, and `age` must be absent or `0`.

If something caches it, add a bypass rule for the path `/arghbox/*` (Cloudflare: Rules, Cache Rules, "Bypass cache"; LiteSpeed Cache plugin: add `/arghbox/` to "Do Not Cache URIs"). The Atom feed (`action=feed`) is the one endpoint meant to be cached, for 10 minutes. The JavaScript files may be cached for an hour; the `?v=` number in your script tag is what refreshes them.

## 8. Install the triage skill and run the first triage

On your computer, in the repository of your site (or any folder where you run Claude Code):

1. If you ran `npx arghbox install ... --skill` in step 4, the skill is already in `.claude/skills/arghbox-triage/`. Otherwise run `npx arghbox install --skill-only`, or unzip the skill zip from the releases into `.claude/skills/`.
2. Create a `.arghbox/` folder with two files, and add `.arghbox/` to your `.gitignore`:
   - `.arghbox/site.json`: `{"url": "https://example.com/arghbox/"}`
   - `.arghbox/token`: the **triage token** from step 2
3. Start Claude Code in that folder and say: **"Empty the ArghBox."** (With nothing waiting it just says so. Add a test idea on your site first.)

Claude fetches the waiting entries, judges them by the rules, shows you what it did and applies the verdicts. Open the admin page to see the run and undo anything. More in [triage.md](triage.md).

## Troubleshooting

Start with the health check (step 5) and `arghbox-private/error.log`. Then find your symptom:

| What you see | Why | What to do |
|---|---|---|
| Health shows `"config": "missing"`, and every other call answers 503 `not_configured` ("config.php is missing") | ArghBox did not find `config.php` | Check the path from step 3: `arghbox-private/config.php` next to `public_html`, or `arghbox/config.php`. The file must be named exactly `config.php` (not `config.php.txt` or `config.example.php`) |
| Health shows `"config_valid": false`, other calls answer 503 `not_configured` ("needs a secret of 64 hex characters") | The file was found but `secret` is empty, too short or not hex | Run `node tools/new-secrets.mjs` again and paste the `'secret'` line (64 characters from 0-9 and a-f) |
| Health says `"admin": false` or `"turnstile": false` | `owner_token_sha256`, or one of the Turnstile keys, is empty | Fill it in `config.php` |
| Blank page or HTTP 500, or health shows `"sqlite": null` | PHP older than 8.1, no `pdo_sqlite` extension, or a typo in `config.php` | Check the PHP version and extensions in the hosting panel; `config.php` must start with `<?php`. `error.log` names the problem |
| `data_dir` says `"error"`, or other calls answer 500 "Something went wrong" | ArghBox cannot write its database anywhere | Make `arghbox-private` (or `arghbox/data`) writable by PHP, usually permissions 755 or 775 on the folder |
| `data_dir` says `"inside_webroot_protected"` although you made `arghbox-private` | PHP could not write to `arghbox-private`, so ArghBox used `arghbox/data/` instead (a separate database) | Fix the permissions of `arghbox-private`. If you already collected entries in `arghbox/data/`, copy `arghbox.sqlite` over to `arghbox-private/` while the site is quiet |
| The tab does not appear | Wrong folder, a Content Security Policy, or you hid the tab with the small × | Open the browser console. A 404 on `arghbox.js` means the folder must be `/arghbox/arghbox.js`. A CSP must allow your own origin for scripts, `https://challenges.cloudflare.com` for scripts and frames, and `connect-src 'self'`. Run `ArghBox.showTab()` in the console to bring back a tab you hid with the × |
| "Turnstile could not load" or votes fail | The site key does not match your domain in the Cloudflare widget settings, or an ad blocker blocks Cloudflare | The list still works without it; voting and adding need it. Add your domain (and `www.`) to the widget |
| `turnstile_failed`: HTTP 403 "human check failed", or HTTP 502 and `error.log` says "verifier unreachable" | 403: the secret key is wrong. 502: the server cannot reach Cloudflare. Some hosts block outgoing requests, and PHP on a home Windows machine often has no certificate bundle (`curl.cainfo` in `php.ini`) | Ask your host to allow `challenges.cloudflare.com`; on your own PC point `curl.cainfo` at a CA bundle file |
| The admin page says the token is not right | You used the triage token, or the hash in `config.php` is not the one printed next to the owner token | Use the **owner** token. Too many tries are rate-limited for an hour |
| The admin page or the AI says 401 although the token is right | The `Authorization` header does not reach PHP | The included `.htaccess` passes it on for Apache and LiteSpeed. On nginx or PHP-FPM setups without `.htaccess`, ask your host to pass the header through |
| Triage says `The site answered 401` | `.arghbox/token` (or `ARGHBOX_TOKEN`) holds the wrong token: it must be the **triage** token, not the owner token, and not the hash | Paste the triage token again. Check that the `triage_token_sha256` in `config.php` is the hash printed next to it |
| Triage says "not JSON" or "Is ArghBox deployed there" | The URL in `.arghbox/site.json` is not the folder that contains `api.php` | It must end in `/arghbox/`, for example `https://example.com/arghbox/` |
| Triage says "Cannot reach" | The site or your network is down, or the address is wrong | Open the URL in a browser; try again later |
| Visitors see old votes, the admin shows stale data, or `cache-control` is missing | A CDN or cache plugin caches the API | See "No caching of the API" in step 7 |
| Everyone shares one rate limit ("too many" for new visitors) | You are behind a CDN or proxy and `trusted_ip_header` is empty | See step 7 |
| After an upgrade visitors still get the old widget | Browsers cached `arghbox.js` | Change `?v=` in the script tag (see Upgrading) |

Still stuck? [Open a bug report](https://github.com/BinaryBananaLLC/ArghBox/issues/new/choose) on GitHub. Mention your ArghBox and PHP versions and your host, and paste the output of the health check (it contains no secrets).
