#!/usr/bin/env node
// Prints a fresh `secret`, an owner token and a triage token (and their sha256) as a config snippet.
//
//   node tools/new-secrets.mjs           the secret, the owner token and the triage token
//   node tools/new-secrets.mjs --read    also a read-only token (for reporting and "what are users asking?" sessions)
//
// Also available as `npx arghbox secrets [--read]` from the npm package.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');

/** The secrets text for config.php: a new secret, owner and triage tokens and, with read, a read token. */
export function secretsText({ read = false, now = new Date() } = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const ownerToken = token();
  const triageToken = token();
  const readToken = read ? token() : null;
  return `ArghBox secrets (generated ${now.toISOString()})

IMPORTANT: the tokens below are shown ONCE. Save them in your password manager now.
Only their sha256 hashes go into config.php; ArghBox never stores the tokens themselves.

  Owner token  (sign in on /arghbox/admin/):   ${ownerToken}
  Triage token (save as .arghbox/token for the triage skill): ${triageToken}${readToken ? `\n  Read token   (read-only MCP and exports, hand it out for reporting): ${readToken}` : ''}

Paste this into config.php (it replaces the same keys there):

    'secret' => '${secret}',
    'owner_token_sha256' => '${sha(ownerToken)}',
    'triage_token_sha256' => '${sha(triageToken)}',${readToken ? `\n    'read_token_sha256' => '${sha(readToken)}',` : ''}
`;
}

/** Runs the tool with command-line arguments; returns the exit code. `command` names it in the usage line. */
export function main(args = process.argv.slice(2), { command = 'node tools/new-secrets.mjs' } = {}) {
  const usage = `Usage: ${command} [--read]`;
  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage);
    return 0;
  }
  const unknown = args.filter((a) => a !== '--read');
  if (unknown.length) {
    console.error(`Unknown option: ${unknown[0]}\n${usage}`);
    return 2;
  }
  console.log(secretsText({ read: args.includes('--read') }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
