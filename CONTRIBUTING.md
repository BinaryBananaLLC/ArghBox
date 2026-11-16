# Contributing to ArghBox

Thanks for helping. Send bug reports, ideas and questions with the Feedback tab on [arghbox.com](https://arghbox.com/), where ArghBox collects its own feedback. Code, docs fixes and translations come here as pull requests. For anything bigger than a small fix, please post the idea on the board first so we can agree on the approach before you spend your time. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need Node.js 22 or newer, PHP 8.1 or newer with `pdo_sqlite`, `openssl`, `curl` and `mbstring`, and Git.

```
git clone https://github.com/BinaryBananaLLC/ArghBox.git
cd ArghBox
npm install
npx playwright install chromium firefox webkit
```

On Windows, a PHP from Scoop often ships these extensions without enabling them. The scripts handle that for you (they add the right `-d extension=...` flags), so you do not have to edit `php.ini`.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the demo site, the real backend and a fake Turnstile on http://localhost:8787, seeded with demo data. The admin page is at `/arghbox/admin/`; the owner token is printed. |
| `npm test` | Unit tests (`node --test`): PHP through the API, the triage script, the tools and the widget helpers. Works offline. |
| `npm run test:e2e` | Playwright tests: the widget in Chromium (desktop and phone), Firefox and WebKit (iPhone), the admin page in Chromium. Turnstile is replaced by a stub. |
| `npm run check:size` | Fails when the loader exceeds 4 KB or the app exceeds 20 KB gzipped. |
| `npm run test:all` | All of the above. |
| `npm run capture` | Retakes the README screenshots into `docs/images/`. |
| `npm run pack` | Builds the release zips into `dist/`. |
| `npm pack` | Builds the npm package tarball, exactly what `npm install arghbox` gets. `npm pack --dry-run` lists its files. |

### Running several dev servers

`node tools/dev.mjs` keeps everything it generates (config, tokens, `site.json`, the data) in `.dev/` inside the repository. To run more than one at once, or to run it from another repository, give each its own folder and port:

```
node tools/dev.mjs --port 8788 --dev-dir ../my-dev-state --origin http://localhost:4173 --seed
```

`--dev-dir` can be any path (relative paths start at your current folder). `--fresh` wipes only that folder's data. `--site <dir>` serves your own folder instead of the demo page, which is how a site that installs ArghBox can try it locally. `node tools/dev.mjs --help` lists everything.

## The rules

- **PHP 8.1 compatible.** Shared hosts run PHP 8.1 and 8.2. Do not use 8.2+ syntax (readonly classes, DNF types, standalone `true`/`false`/`null` types, `json_validate`, property hooks, the pipe operator). CI runs `php -l` on every PHP file with PHP 8.1 to catch this. Extensions you can rely on: PDO with SQLite, json, hash and openssl or random. `mbstring` and `curl` are optional.
- **No build step, no runtime dependencies.** The `arghbox/` folder is uploaded as it is. The widget is hand-written ES2019 without modules. Node scripts use only Node built-ins. Playwright is the only dev dependency.
- **Size budgets.** `arghbox.js` stays under 4 KB gzipped, because it loads on every page of the host site. `arghbox-app.js` stays under 20 KB gzipped. Run `npm run check:size`.
- **Privacy.** Never store raw IP addresses, full user agents, emails or visitor cookies. Visitor text is shown with `textContent`, never `innerHTML`.
- **Secrets** live only in `config.php` (git-ignored) or the environment. Tests make their own throwaway secrets. Never put real tokens, keys or email addresses in code, docs or fixtures.
- **Nothing is deleted.** Moderation and merges are reversible and logged.
- **Spec first.** [docs/SPEC.md](docs/SPEC.md) is the contract. When code and spec disagree, fix one of them in the same change.
- **Tests with every change.** Fix a bug with a test that fails first. New behaviour gets a unit test, and widget or admin changes get an end-to-end test where it makes sense.

## Style

Plain, readable code with short comments that explain why. Match what is around you. `.editorconfig` sets the basics (UTF-8, LF line endings, a final newline). Write docs in clear, friendly, plain English. Please do not use emojis in code, docs or commit messages.

## Adding a language

Copy `arghbox/i18n/en.json` to `arghbox/i18n/<code>.json`, translate the values, keep the `{placeholders}`, add your language to the `LABELS` and `LANGS` blocks in `arghbox/arghbox.js`, and open a pull request. Step by step in [docs/translations.md](docs/translations.md). Please do not run `tools/translate.mjs --paid`: it is the owner's paid script (without `--paid` it only prints a plan).

## Pull requests

1. Branch from `main`, keep the change focused.
2. Run `npm run test:all`.
3. Fill in the pull request template.
4. Be patient and kind: this is a small project.

## Releasing (maintainers)

Releases come only from the **Release** workflow, never from a laptop or the Releases page:

1. Set the new version in `package.json`, `arghbox/VERSION` and `arghbox/lib/version.php`, and give it a dated `## [x.y.z] - YYYY-MM-DD` section in `CHANGELOG.md`. `npm test` fails until all four agree.
2. Merge to `main`, then run **Actions, Release, Run workflow** with the tag `vx.y.z`.

The workflow runs the tests, builds the zips and the npm tarball with provenance attestations, publishes the GitHub Release, and publishes `arghbox` to npm with provenance. A version with a hyphen (`0.2.0-rc.1`) becomes a pre-release and goes to npm under the `next` tag. The one-time npm setup is described at the top of `.github/workflows/release.yml`.

## Security

Please do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
