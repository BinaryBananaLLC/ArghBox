// Finds PHP and the flags needed to enable pdo_sqlite, openssl, curl and mbstring when
// the local php.ini does not (the owner's Windows install). Shared by tests and tools.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const WANTED = ['pdo_sqlite', 'openssl', 'curl', 'mbstring'];
let cached = null;

function tryRun(bin, args) {
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

/** Absolute path (or command name) of a working PHP CLI. Throws when none is found. */
export function phpPath() {
  if (cached) return cached.bin;
  const candidates = [];
  if (process.env.ARGHBOX_PHP) candidates.push(process.env.ARGHBOX_PHP);
  if (process.env.PHP_BIN) candidates.push(process.env.PHP_BIN);
  candidates.push('php');
  if (process.platform === 'win32') {
    candidates.push(path.join(os.homedir(), 'scoop', 'apps', 'php', 'current', 'php.exe'));
    candidates.push('C:\\php\\php.exe', 'C:\\tools\\php\\php.exe');
  }
  for (const c of candidates) {
    const out = tryRun(c, ['-m']);
    if (out !== null) {
      const have = new Set(out.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
      cached = { bin: c, modules: have };
      return c;
    }
  }
  throw new Error('PHP CLI not found. Install PHP 8.1+ or set ARGHBOX_PHP to its path.');
}

/** `-d` flags that enable the extensions php.ini leaves off. */
export function phpFlags() {
  const bin = phpPath();
  const missing = WANTED.filter((m) => !cached.modules.has(m));
  if (missing.length === 0) return [];
  const flags = [];
  let exe = bin;
  if (!path.isAbsolute(exe)) {
    const out = tryRun(process.platform === 'win32' ? 'where' : 'which', [bin]);
    if (out) exe = out.split(/\r?\n/)[0].trim();
  }
  const extDir = path.join(path.dirname(exe), 'ext');
  if (fs.existsSync(extDir)) flags.push('-d', `extension_dir=${extDir}`);
  for (const m of missing) flags.push('-d', `extension=${m}`);
  return flags;
}

/** Full argument list for a PHP invocation: flags first, then `extra`. */
export function phpArgs(extra = []) {
  return [...phpFlags(), ...extra];
}

/** `php -v` major.minor as a string like "8.5". */
export function phpVersion() {
  const out = tryRun(phpPath(), ['-r', 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;']);
  return out ? out.trim() : '';
}

/** A free TCP port (listen on 0 briefly). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Kill a child process and its children (php -S on Windows can leave php.exe behind). */
export function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        .on('exit', () => setTimeout(resolve, 200))
        .on('error', () => {
          try { child.kill('SIGKILL'); } catch { /* gone */ }
        });
    } else {
      try { child.kill('SIGKILL'); } catch { resolve(); }
    }
    setTimeout(resolve, 3000).unref();
  });
}

/** Spawn `php -S` and wait until it answers. `docroot` may be a directory; `router` optional. */
/**
 * Throw a clear error when something already answers on 127.0.0.1:port. php -S on Windows can bind
 * a port another server is already using, and requests then reach the wrong server silently, so a
 * connect probe is used (a listen probe can succeed on Windows even when the port is taken).
 */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (inUse) => {
      socket.destroy();
      if (inUse) reject(new Error(`Port ${port} is already in use on 127.0.0.1. Pick another one with --port.`));
      else resolve();
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function startPhpServer({ docroot, router, env = {}, port, cwd, quiet = true }) {
  if (port) await assertPortFree(port);
  port = port || (await freePort());
  const args = phpArgs(['-S', `127.0.0.1:${port}`, '-t', docroot]);
  if (router) args.push(router);
  const child = spawn(phpPath(), args, {
    cwd: cwd || docroot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', quiet ? 'ignore' : 'inherit'],
    windowsHide: true,
  });
  child.on('error', () => {});
  const origin = `http://127.0.0.1:${port}`;
  // A loaded machine (parallel test files, browsers, other agents) can take far longer than a quiet one to start php.
  const deadline = Date.now() + 45000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('php -S exited early with code ' + child.exitCode);
    try {
      await fetch(origin + '/__ready__');
      break;
    } catch {
      if (Date.now() > deadline) {
        await killTree(child);
        throw new Error('php -S did not start in time');
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  return { child, port, origin, stop: () => killTree(child) };
}
