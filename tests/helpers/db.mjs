// Direct SQLite access for tests that must look inside (or age) the database of a throwaway box.
//   dbRows(box, 'SELECT * FROM blocks')            -> array of rows
//   dbExec(box, 'UPDATE blocks SET expires_at = ?', ['2000-01-01T00:00:00Z'])
//   dbFile(dir)                                    -> path of the .sqlite file in a data directory
// Runs a tiny PHP script (pdo_sqlite is guaranteed by the test setup), so nothing new is needed on the dev machine.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { phpArgs, phpPath } from './php.mjs';

const SCRIPT = '$d = new PDO("sqlite:" . $argv[1]); $d->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $d->exec("PRAGMA busy_timeout=5000");'
  + '$p = json_decode($argv[3], true); $s = $d->prepare($argv[2]); $s->execute($p);'
  + 'echo json_encode($s->columnCount() > 0 ? $s->fetchAll(PDO::FETCH_ASSOC) : []);';

export function dbFile(dir) {
  const f = fs.readdirSync(dir).find((n) => n.endsWith('.sqlite'));
  if (!f) throw new Error('no sqlite file in ' + dir);
  return path.join(dir, f);
}

export function dbRows(boxOrDir, sql, params = []) {
  const dir = typeof boxOrDir === 'string' ? boxOrDir : boxOrDir.dataDir;
  const r = spawnSync(phpPath(), phpArgs(['-r', SCRIPT, dbFile(dir), sql, JSON.stringify(params)]), { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('php failed: ' + r.stderr + r.stdout);
  return JSON.parse(r.stdout);
}

export const dbExec = dbRows;
