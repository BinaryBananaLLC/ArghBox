# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and click **Report a vulnerability** (or go straight to the [advisory form](https://github.com/BinaryBananaLLC/ArghBox/security/advisories/new)). Include:

- the steps to reproduce the problem,
- the ArghBox version or commit you tested, and your PHP version and host if it matters,
- what an attacker could do with it.

Please do not include real tokens or your `config.php`.

You should get a reply within a week. Once the problem is confirmed, it will be fixed and released, and you will be credited in the release notes unless you would rather not be. Please give us a reasonable time to ship a fix before you publish details.

## What is in scope

The widget, the PHP API, the admin page, the MCP endpoint and the triage script in this repository. Examples: cross-site scripting through visitor text, ways around the rate limits or Turnstile check that are cheap and repeatable, authentication or CSRF problems on the admin or MCP endpoints, leaking the database, config or tokens, and prompt-injection paths that let visitor text make the triage AI or MCP tools do something the owner did not intend.

Problems in your hosting, in Cloudflare, or in Claude Code itself are out of scope here.

## Supported versions

Only the latest release is supported. Security fixes ship as a new release, so upgrade with `npm install --save-dev arghbox@latest` or the newest zip from the [releases](https://github.com/BinaryBananaLLC/ArghBox/releases).

## Good practice for site owners

- Keep `config.php` and the database outside the web root (see [docs/install.md](docs/install.md)).
- Keep the owner token, triage token and read token in a password manager. Give AI tools the triage or read token, never the owner token.
- Leave `mcp_allow_public_comments` off unless you need it.
- Upload new versions when they come out.
