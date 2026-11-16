#!/usr/bin/env node
// Builds the release zips into dist/ using only Node built-ins:
//   dist/arghbox-<version>.zip               the arghbox/ folder (upload it to your web root)
//   dist/arghbox-triage-skill-<version>.zip  the triage skill (copy it to .claude/skills/)
//
//   node tools/pack.mjs [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isExcluded } from './install.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// ---- minimal ZIP writer and reader ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of a buffer, as an unsigned number. */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The timestamp stamped on every file of a zip: SOURCE_DATE_EPOCH (seconds) when set, otherwise the newest
 * modification time of the packed files, so FTP clients set to "overwrite if newer" upload an upgrade, and an
 * unchanged tree still gives the same zip. Falls back to 2026-01-01 for files without a time.
 */
export function releaseDate(files = [], env = process.env) {
  const sde = env.SOURCE_DATE_EPOCH;
  if (sde && /^[0-9]+$/.test(sde)) return new Date(Number(sde) * 1000);
  const newest = Math.max(0, ...files.map((f) => (f.mtime instanceof Date ? f.mtime.getTime() : 0)));
  return newest > 0 ? new Date(newest) : new Date(Date.UTC(2026, 0, 1));
}

/** MS-DOS time and date words (UTC fields, 2 second resolution, not before 1980). */
export function dosDateTime(d) {
  const y = Math.max(1980, d.getUTCFullYear());
  const date = ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { date, time };
}

/**
 * Builds a zip from [{name, data: Buffer}] (names use forward slashes). Files are deflated when that
 * makes them smaller, otherwise stored. Returns a Buffer.
 */
export function buildZip(files, { date } = {}) {
  const { date: DOS_DATE, time: DOS_TIME } = dosDateTime(date || releaseDate(files));
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    let method = 8;
    let body = zlib.deflateRawSync(data, { level: 9 });
    if (body.length >= data.length) {
      method = 0;
      body = data;
    }
    const flags = 0x0800; // UTF-8 names
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, spec 2.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // regular file, rw-r--r--
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Reads a zip made by buildZip (or any simple zip). Returns [{name, data}] and verifies every CRC. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lnLen = buf.readUInt16LE(lho + 26);
    const leLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnLen + leLen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---- what goes into the zips ----

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/** Files of one folder as zip entries under `prefix/`, skipping what `skip(rel)` says. */
export function collect(srcDir, prefix, skip = () => false) {
  return walk(srcDir)
    .filter((rel) => !skip(rel))
    .map((rel) => {
      const full = path.join(srcDir, ...rel.split('/'));
      return { name: `${prefix}/${rel}`, data: fs.readFileSync(full), mtime: fs.statSync(full).mtime };
    });
}

export function readVersion(root = REPO) {
  return fs.readFileSync(path.join(root, 'arghbox', 'VERSION'), 'utf8').trim();
}

/** Builds both zips into outDir; returns [{file, files, bytes}]. */
export function pack({ root = REPO, outDir = path.join(root, 'dist'), env = process.env } = {}) {
  const version = readVersion(root);
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [
    [`arghbox-${version}.zip`, collect(path.join(root, 'arghbox'), 'arghbox', isExcluded)],
    [`arghbox-triage-skill-${version}.zip`, collect(path.join(root, 'skill', 'arghbox-triage'), 'arghbox-triage')],
  ];
  return jobs.map(([name, files]) => {
    const file = path.join(outDir, name);
    const zip = buildZip(files, { date: releaseDate(files, env) });
    fs.writeFileSync(file, zip);
    return { file, files: files.length, bytes: zip.length };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > 0 ? path.resolve(process.argv[i + 1]) : undefined;
  for (const r of pack({ outDir })) console.log(`${path.relative(process.cwd(), r.file)}  ${r.files} files, ${r.bytes} bytes`);
}
