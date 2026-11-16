// The JavaScript side of the arghbox npm package: where its files are, its version, and the installer.
//
//   import { version, serverDir, skillDir, install } from 'arghbox';
//
// Use `version` for the ?v= of the script tag, so it changes with every upgrade:
//   <script src="/arghbox/arghbox.js?v=${version}" defer></script>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install as installInto } from './tools/install.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** The package version, which is also the version of the arghbox/ folder (arghbox/VERSION). */
export const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** The arghbox/ folder to upload to the web root (PHP backend, widget, admin page). */
export const serverDir = path.join(ROOT, 'arghbox');

/** The triage skill folder that goes to .claude/skills/arghbox-triage/. */
export const skillDir = path.join(ROOT, 'skill', 'arghbox-triage');

/**
 * Copies the arghbox/ folder (and with `skill` the triage skill) into a site, like `arghbox install`.
 * Never touches config.php or data/. Returns { actions, gitignore, warnings, dryRun, version }.
 */
export function install({ target = process.cwd(), publicDir, skill = false, skillOnly = false, dryRun = false } = {}) {
  return installInto({ target, publicDir, skill, skillOnly, dryRun, sourceRoot: ROOT });
}
