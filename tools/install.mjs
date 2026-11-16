#!/usr/bin/env node
// Copies the arghbox/ folder (and optionally the triage skill) into a site repository.
//
//   node tools/install.mjs --target <site repo> --public <public dir> [--skill] [--dry-run]
//   node tools/install.mjs --target <site repo> --skill-only
//
//   --target   the site repository (must exist)
//   --public   the folder that is served as the web root, relative to --target (e.g. public_html, public, www, .)
//   --skill-only  copy only the triage skill (when you upload the arghbox/ folder yourself); --public is not needed
//   --skill    also copy skill/arghbox-triage/ to <target>/.claude/skills/arghbox-triage/
//   --dry-run  print what would happen and change nothing
//   --quiet    print one summary line and the notes only (for build scripts that run it every time)
//
// From the npm package the same tool is `npx arghbox install [--public <dir>] [--skill] ...`, with --target
// defaulting to the current folder.
//
// Safe to run again to upgrade: code files are replaced, but config.php, any *.sqlite file and everything in
// data/ except its .htaccess and index.html are never touched. A changed skill file is saved as <name>.bak first.
// Files that a new version no longer has are listed, never deleted. Symbolic links in the destination are never
// written through; symbolic links in the source are followed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** Files of the source folder that must never be copied (local secrets, databases, tooling state). */
export function isExcluded(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  // Only the owner's own config.php (arghbox/config.php). lib/config.php is code that must ship.
  if (rel === 'config.php') return true;
  if (/\.sqlite/.test(base)) return true;
  if (base === '.translate-state.json') return true;
  if (parts[0] === 'data' && base !== '.htaccess' && base !== 'index.html') return true;
  return false;
}

/**
 * Existing files in these places are kept as they are (the install's own data): the owner's config.php,
 * databases and everything in data/ except the two files that protect that folder, which are updated.
 */
export function isProtected(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (rel === 'config.php' || /\.sqlite/.test(base)) return true;
  return parts[0] === 'data' && !(parts.length === 2 && (base === '.htaccess' || base === 'index.html'));
}

/**
 * Relative file names under dir, sorted. Symbolic links are followed (a linked file is copied as a file, a linked
 * folder is walked); a broken link or a link loop is reported through onWarn instead of being skipped silently.
 */
function walk(dir, base = '', onWarn = () => {}, seen = new Set()) {
  const out = [];
  let real;
  try { real = fs.realpathSync(dir); } catch { return out; }
  if (seen.has(real)) {
    onWarn(`Skipped ${dir}: it links back to a folder that is already being copied.`);
    return out;
  }
  seen = new Set(seen).add(real);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    let st;
    try { st = fs.statSync(full); } catch {
      onWarn(`Skipped ${full}: a symbolic link that points nowhere.`);
      continue;
    }
    if (st.isDirectory()) out.push(...walk(full, rel, onWarn, seen));
    else if (st.isFile()) out.push(rel);
  }
  return out.sort();
}

/** Files below dir as they really are (links are not followed), as relative names. */
function walkReal(dir, base = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkReal(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** The first symbolic link on the way from root down to file (root included), or null. Never follows them. */
function symlinkOnPath(root, file) {
  const parts = path.relative(root, file).split(path.sep).filter(Boolean);
  let cur = root;
  for (const p of ['', ...parts]) {
    if (p) cur = path.join(cur, p);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) return cur;
    } catch { return null; }
  }
  return null;
}

/**
 * Plans (and, unless dryRun, performs) the install. Returns { actions, gitignore, warnings }.
 * Each action is { kind: 'create' | 'update' | 'same' | 'keep' | 'skip', file } with `file` relative to the target.
 * An update of a skill file saves the old file as <name>.bak first (action.backup is set).
 */
export function install({ target, publicDir, skill = false, skillOnly = false, dryRun = false, sourceRoot = REPO }) {
  if (!target) throw new Error('--target is required');
  if (skillOnly) skill = true;
  if (!skillOnly && (publicDir === undefined || publicDir === null || publicDir === '')) throw new Error('--public is required (use . when the site root is the repository root)');
  const targetAbs = path.resolve(target);
  if (!fs.existsSync(targetAbs) || !fs.statSync(targetAbs).isDirectory()) throw new Error(`Target folder not found: ${targetAbs}`);
  const publicAbs = path.resolve(targetAbs, skillOnly ? '.' : publicDir);
  const rel = path.relative(targetAbs, publicAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('--public must be a folder inside --target');

  const actions = [];
  const warnings = [];
  // A typo in --public would otherwise quietly make a new folder that the site never serves.
  if (!skillOnly && !fs.existsSync(publicAbs)) {
    warnings.push(`The folder ${rel.split(path.sep).join('/')}/ did not exist${dryRun ? ' (it would be created)' : ' and was created'}. If your web root has another name, delete it and run again with the right --public.`);
  }
  const show = (p) => path.relative(targetAbs, p).split(path.sep).join('/');
  const copyTree = (srcDir, destDir, filter, { backup = false } = {}) => {
    const files = walk(srcDir, '', (w) => warnings.push(w));
    for (const f of files) {
      if (filter && !filter.include(f)) continue;
      const src = path.join(srcDir, ...f.split('/'));
      const dest = path.join(destDir, ...f.split('/'));
      const shown = show(dest);
      const link = symlinkOnPath(destDir, dest);
      if (link) {
        actions.push({ kind: 'skip', file: shown });
        warnings.push(`Did not touch ${shown}: ${show(link)} is a symbolic link, and ArghBox never writes through links.`);
        continue;
      }
      const exists = fs.existsSync(dest);
      let kind;
      if (exists && filter && filter.keep(f)) kind = 'keep';
      else if (!exists) kind = 'create';
      else kind = fs.readFileSync(src).equals(fs.readFileSync(dest)) ? 'same' : 'update';
      const action = { kind, file: shown };
      if (kind === 'update' && backup) action.backup = `${shown}.bak`;
      actions.push(action);
      if (!dryRun && (kind === 'create' || kind === 'update')) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (action.backup) fs.copyFileSync(dest, dest + '.bak');
        fs.copyFileSync(src, dest);
      }
    }
    // Files that are installed but no longer part of the new version: report, never delete.
    const known = new Set(files);
    const stale = walkReal(destDir).filter((f) => !known.has(f) && !f.endsWith('.bak') && !isProtected(f) && f !== 'error.log');
    if (stale.length) {
      const list = stale.slice(0, 10).map((f) => show(path.join(destDir, ...f.split('/'))));
      warnings.push(`${stale.length} file(s) in ${show(destDir)} are not part of this version any more (left in place; delete them if you do not need them): ${list.join(', ')}${stale.length > 10 ? ', ...' : ''}`);
    }
  };

  const srcWidget = path.join(sourceRoot, 'arghbox');
  const versionOf = (dir) => {
    try { return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); } catch { return null; }
  };
  const oldVersion = versionOf(path.join(publicAbs, 'arghbox'));
  const newVersion = versionOf(srcWidget);
  if (!skillOnly) {
    if (!fs.existsSync(srcWidget)) throw new Error(`Source folder not found: ${srcWidget}`);
    copyTree(srcWidget, path.join(publicAbs, 'arghbox'), { include: (f) => !isExcluded(f), keep: isProtected });
  }

  if (skill) {
    const srcSkill = path.join(sourceRoot, 'skill', 'arghbox-triage');
    if (!fs.existsSync(srcSkill)) throw new Error(`Skill folder not found: ${srcSkill}`);
    copyTree(srcSkill, path.join(targetAbs, '.claude', 'skills', 'arghbox-triage'), null, { backup: true });
  }

  const pub = rel.split(path.sep).join('/');
  if (!skillOnly && oldVersion && newVersion && oldVersion !== newVersion) {
    warnings.push(`Upgraded ArghBox ${oldVersion} to ${newVersion}. Change ?v=${oldVersion} to ?v=${newVersion} in the script tag on your pages so visitors fetch the new files.`);
  }
  const prefix = pub === '' ? '' : `${pub}/`;
  const gitignore = skillOnly ? ['.arghbox/'] : [
    '# ArghBox: never commit secrets or data',
    `${prefix}arghbox/config.php`,
    `${prefix}arghbox/data/*`,
    `!${prefix}arghbox/data/.htaccess`,
    `!${prefix}arghbox/data/index.html`,
    '.arghbox/',
  ];
  const hasConfig = fs.existsSync(path.join(publicAbs, 'arghbox', 'config.php')) || fs.existsSync(path.join(publicAbs, '..', 'arghbox-private', 'config.php'));
  if (!skillOnly && !hasConfig) {
    warnings.push('No arghbox/config.php here. That is fine if your config lives in arghbox-private/ next to the web root on the server (the best place, see https://github.com/BinaryBananaLLC/ArghBox/blob/main/docs/install.md#3-decide-where-configphp-and-the-data-go). Without a config.php somewhere, ArghBox answers "not_configured".');
  }
  return { actions, gitignore, warnings, dryRun, version: newVersion, publicPrefix: prefix };
}

function parseArgs(argv) {
  const o = { target: null, publicDir: null, skill: false, skillOnly: false, dryRun: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--target') o.target = value();
    else if (a === '--public') o.publicDir = value();
    else if (a === '--skill') o.skill = true;
    else if (a === '--skill-only') o.skillOnly = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return o;
}

/** The usage text; `command` is how the tool was started, and `targetOptional` is true for the npm CLI. */
export function usage(command = 'node tools/install.mjs', targetOptional = false) {
  const t = targetOptional ? '[--target <site repo>]' : '--target <site repo>';
  return `Usage: ${command} ${t} --public <public dir> [--skill] [--dry-run] [--quiet]\n   or: ${command} ${t} --skill-only [--dry-run] [--quiet]`;
}

/**
 * Runs the installer with command-line arguments and returns the exit code. `command` names the tool in messages;
 * `defaultTarget` is used when --target is not given (the npm CLI passes the current folder).
 */
export function main(argv = process.argv.slice(2), { command = 'node tools/install.mjs', defaultTarget = null, sourceRoot = REPO } = {}) {
  const USAGE = usage(command, defaultTarget !== null);
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) {
      console.log(USAGE);
      return 0;
    }
    if (!o.target && defaultTarget !== null) o.target = defaultTarget;
    const r = install({ ...o, sourceRoot });
    const counts = {};
    for (const a of r.actions) {
      counts[a.kind] = (counts[a.kind] || 0) + 1;
      if (!o.quiet && a.kind !== 'same') console.log(`${r.dryRun ? 'would ' : ''}${a.kind.padEnd(6)} ${a.file}${a.backup ? `   (your old copy is saved as ${path.basename(a.backup)})` : ''}`);
    }
    const summary = `${counts.create || 0} new, ${counts.update || 0} updated, ${counts.same || 0} unchanged${counts.keep ? `, ${counts.keep} kept (your config and data)` : ''}${counts.skip ? `, ${counts.skip} skipped (symbolic links)` : ''}`;
    if (o.quiet) {
      console.log(`ArghBox${r.version ? ` ${r.version}` : ''}: ${r.dryRun ? 'dry run, ' : ''}${summary}.`);
    } else {
      console.log(`\n${r.dryRun ? 'Dry run, nothing was changed. ' : ''}${summary}. Your config.php and data are never touched.`);
      console.log('\nAdd these lines to the .gitignore of your site repository:\n');
      console.log(r.gitignore.join('\n'));
      if (!o.skillOnly) {
        const pub = r.publicPrefix;
        console.log(`\n(If a build script runs this for you on every build, as the README shows, git-ignore the copies instead: ${pub}arghbox/${o.skill ? ' and .claude/skills/arghbox-triage/' : ''}, plus .arghbox/.)`);
      }
    }
    for (const w of r.warnings) console.log(`${o.quiet ? '' : '\n'}Note: ${w}`);
    if (!o.quiet && (o.skill || o.skillOnly)) {
      console.log('\nNext, for the triage skill: in the repository root create .arghbox/site.json ({"url": "https://example.com/arghbox/"}) and .arghbox/token (your triage token), then ask Claude Code to "Empty the ArghBox". See https://github.com/BinaryBananaLLC/ArghBox/blob/main/docs/triage.md.');
    }
    return 0;
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
