#!/usr/bin/env node
// Prints {"Authorization": "Bearer <token>"} for an MCP client's `headersHelper`.
// Reads the triage token from ARGHBOX_TOKEN or <dir>/token (--dir, default .arghbox).
import fs from 'node:fs';
import path from 'node:path';

const i = process.argv.indexOf('--dir');
const dir = path.resolve(process.cwd(), i > 0 && process.argv[i + 1] ? process.argv[i + 1] : '.arghbox');
let token = (process.env.ARGHBOX_TOKEN || '').trim();
if (!token) {
  try {
    token = fs.readFileSync(path.join(dir, 'token'), 'utf8').trim();
  } catch { /* missing */ }
}
if (!token) {
  process.stderr.write(`No triage token: put it in ${path.join(dir, 'token')} or set ARGHBOX_TOKEN.\n`);
  process.exit(1);
}
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }) + '\n');
