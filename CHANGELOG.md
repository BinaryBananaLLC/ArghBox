# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Local preview:** on `localhost`, `127.0.0.1` or `*.localhost`, when no ArghBox answers (no server, no PHP, no `config.php`), the dialog shows sample entries and a "Local preview" note instead of an error. Voting and adding work and save nothing, so a site can try its integration before it has a box. `window.ArghBoxConfig = { localPreview: false }` turns it off. See "Test on your computer" in `docs/install.md`.
- **Styling:** hosts can restyle the tab and the dialog with CSS custom properties: `--arghbox-accent`, `--arghbox-bg`, `--arghbox-fg`, `--arghbox-muted`, `--arghbox-card`, `--arghbox-border`, `--arghbox-line` and `--arghbox-font` (`docs/configuration.md`).
- **CORS:** an `allowed_origins` entry ending in `:*` (for example `'http://localhost:*'`) allows that host on any port. `tools/dev.mjs` uses it, so a site's dev server works with the local box whatever port it got.
- **Docs:** how to open the box from your own header icon or About page button, with the logo snippet.

### Changed

- **Look:** the tab shows the ArghBox mark on a cream badge instead of the plain box icon, and the dialog uses the ArghBox palette (warm ink text, cream panels, a night-brown dark theme).
- **Copy:** the list and the add form now say what the box is for and that no account is needed, and the thank-you screen thanks the visitor for helping improve the site.
- **Credit:** "Powered by ArghBox" carries the logo and links to arghbox.com.
- `data-accent` now sets `--arghbox-accent`. A host's own `--accent` variable no longer leaks into the widget.
- The dialog script's size budget is 21 KB gzipped (was 20 KB). The loader stays under 4 KB.

## [0.1.0] - 2026-11-17

The first public version.

### Added

- **Widget:** a Feedback tab (loader under 4 KB gzipped) and a dialog loaded on first intent, with a public list, voting, search, tag filters, statuses, owner comments, an add form with similar-entry suggestions, and "Your arghs". Shadow DOM, light and dark themes, a full-screen sheet on phones, keyboard and screen-reader support, funny and neutral wording, translatable strings, and a JavaScript API with `#arghbox` links.
- **Backend:** a PHP 8.1+ and SQLite API for shared hosting from one folder. Cloudflare Turnstile, hashed IPs and voter keys, rate limits, honeypot, CORS allow-list and an Atom feed. No visitor cookies.
- **Health check** (`api.php?action=health`): version, database location, Turnstile and proxy-header state, and a `warnings` list for the owner. It does not warn that the IP header is ignored when the web server has already put the visitor's address in `REMOTE_ADDR` (LiteSpeed on Hostinger behind Cloudflare).
- **Admin page:** statuses, public comments and private notes, private owner tasks, merge, reject, tags, a full action log with undo, and exports as JSON, CSV and Jira CSV.
- **AI triage:** a Claude Code skill (`arghbox-triage`) that rejects spam, merges duplicates, tags and flags, with checked verdicts applied in one transaction, a confidence gate and whole-run undo. No paid AI calls.
- **MCP server** (`mcp.php`): search, triage and update the box from Claude Code, Cursor and VS Code, with a read-only token and no delete tool.
- **npm package** `arghbox`: `npx arghbox install` copies the server folder and the triage skill into a site (safe to re-run from a `prebuild` script, never touches `config.php` or data), `npx arghbox secrets` makes the tokens, and `import { version } from 'arghbox'` gives the version for the script tag. Published with npm provenance by the release workflow, which also attaches the zips with build provenance attestations to the GitHub Release.
- **Reports and blocks:** visitors can report a published entry (spam, rude or abusive, off topic, other). Three reports from different people (`report_hide_at`) hide it until it is reviewed. The admin page has a Reported list (open reports on published, pending or flagged entries), "Keep it (dismiss reports)" for public entries and "Put it back (dismiss reports)" for hidden ones, a list of blocked authors, Block author and Unblock author. Blocked authors' new posts are rejected quietly (`limits.block_days`). Triage decides reported entries (`keep` or `reject`) and may set `block_author` for clear spam or abuse. The MCP server has `arghbox_dismiss_reports`, `arghbox_block_author` and `arghbox_unblock_author`. New config: `contact_url` (a "Contact" link in the dialog), `report_hide_at`, `limits.reports_per_hour` and `limits.block_days`. Schema version 4.
- **Mobile apps:** `arghbox/app.html` shows the whole board full screen in an app's WebView, with no sign-in, URL parameters, `context.app` (platform and version, shown on the admin page) and a bridge that posts events (open, close, add, vote and link, for external links) to Swift, Kotlin, React Native and Flutter. An opt-in `app_pass` helps WebViews that cannot pass Turnstile. See `docs/mobile.md`, with an App Store guideline 1.2 and Google Play checklist.
- **Tools:** a local dev server with a demo site, secret generation, install and release-zip scripts, a seed loader, a size check, a README screenshot capture, and an owner-only translation script.
- **Docs:** install guide, configuration, triage, MCP, integrations, translations and API reference, plus a trademark policy (`TRADEMARKS.md`).
