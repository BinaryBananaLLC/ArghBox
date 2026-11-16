#!/usr/bin/env node
// The `arghbox` command of the npm package.
//
//   npx arghbox install --public <public dir> [--skill] [--skill-only] [--target <site repo>] [--dry-run] [--quiet]
//   npx arghbox secrets [--read]
//   npx arghbox version
//   npx arghbox help
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as installMain } from '../tools/install.mjs';
import { main as secretsMain } from '../tools/new-secrets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HELP = `ArghBox ${VERSION}: the complaint box your AI empties for you.

Usage: arghbox <command> [options]

Commands:
  install    Copy the arghbox/ server folder into your site (and the triage skill with --skill).
             Safe to run again: it never touches config.php or data/, and upgrades the code.
               --public <dir>   the folder served as the web root, relative to --target (public, public_html, .)
               --skill          also copy the triage skill to .claude/skills/arghbox-triage/
               --skill-only     copy only the triage skill
               --target <dir>   the site repository (default: the current folder)
               --dry-run        show what would change and change nothing
               --quiet          one summary line, for build scripts ("prebuild": "arghbox install ... --quiet")
  secrets    Print a new secret, owner and triage tokens and the config.php lines (--read adds a read-only token).
  version    Print the version.
  help       Print this help.

Docs: https://github.com/BinaryBananaLLC/ArghBox#readme`;

export function run(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'install':
      return installMain(rest, { command: 'arghbox install', defaultTarget: process.cwd(), sourceRoot: ROOT });
    case 'secrets':
      return secretsMain(rest, { command: 'arghbox secrets' });
    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION);
      return 0;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\nRun "arghbox help" for the commands.`);
      return 2;
  }
}

process.exitCode = run(process.argv.slice(2));
