#!/usr/bin/env node
// Load seed entries straight into the SQLite database of a dev or test install.
//   node tools/seed.mjs --config <config.php> --file <seed.json> [--if-empty]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phpArgs, phpPath } from '../tests/helpers/php.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Run tools/seed.php. Returns { status, stdout, stderr }. */
export function seed({ config, file, ifEmpty = false, dataDir }) {
  const args = phpArgs([path.join(HERE, 'seed.php'), path.resolve(file), ...(ifEmpty ? ['--if-empty'] : [])]);
  const env = { ...process.env, ARGHBOX_CONFIG: path.resolve(config) };
  if (dataDir) env.ARGHBOX_DATA_DIR = path.resolve(dataDir);
  const r = spawnSync(phpPath(), args, { encoding: 'utf8', env, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const config = arg('--config');
  const file = arg('--file');
  if (!config || !file) {
    console.error('Usage: node tools/seed.mjs --config <config.php> --file <seed.json> [--if-empty]');
    process.exit(2);
  }
  const r = seed({ config, file, ifEmpty: process.argv.includes('--if-empty') });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}
