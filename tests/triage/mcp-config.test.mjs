import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mcpConfig } from '../../skill/arghbox-triage/triage.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skill', 'arghbox-triage');
const run = (script, args, cwd, env = {}) =>
  new Promise((resolve) => {
    execFile(process.execPath, [path.join(SKILL, script), ...args], { cwd, env: { ...process.env, ARGHBOX_TOKEN: '', ARGHBOX_URL: '', ...env }, encoding: 'utf8' }, (e, stdout, stderr) =>
      resolve({ code: e ? e.code : 0, stdout, stderr }));
  });

test('mcpConfig: placeholder command and a headersHelper snippet with the right paths', () => {
  const out = mcpConfig({ url: 'https://maps.example.com/arghbox/', helperPath: '.claude/skills/arghbox-triage/mcp-headers.mjs' });
  assert.ok(out.includes('claude mcp add --transport http arghbox https://maps.example.com/arghbox/mcp.php --header "Authorization: Bearer <YOUR_TRIAGE_TOKEN>"'));
  const json = JSON.parse(out.slice(out.indexOf('{\n'), out.indexOf('\n}\n') + 2));
  assert.deepEqual(json.mcpServers.arghbox, { type: 'http', url: 'https://maps.example.com/arghbox/mcp.php', headersHelper: 'node .claude/skills/arghbox-triage/mcp-headers.mjs' });
  const other = mcpConfig({ url: 'https://x.test/arghbox/api.php', helperPath: 'skill/arghbox-triage/mcp-headers.mjs', dir: '.dev/arghbox' });
  assert.ok(other.includes('https://x.test/arghbox/mcp.php'));
  assert.ok(other.includes('node skill/arghbox-triage/mcp-headers.mjs --dir .dev/arghbox'));
});

test('mcp-config never prints the token; mcp-headers prints it only as a header object', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arghbox-mcp-'));
  try {
    const token = 'secret-token-' + 'k'.repeat(30);
    fs.mkdirSync(path.join(work, '.arghbox'));
    fs.writeFileSync(path.join(work, '.arghbox', 'site.json'), JSON.stringify({ url: 'https://maps.example.com/arghbox/' }));
    fs.writeFileSync(path.join(work, '.arghbox', 'token'), token + '\n');
    const r = await run('triage.mjs', ['mcp-config'], work, { ARGHBOX_TOKEN: token });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(token));
    assert.match(r.stdout, /<YOUR_TRIAGE_TOKEN>/);
    assert.match(r.stdout, /mcp\.php/);

    const h = await run('mcp-headers.mjs', [], work);
    assert.equal(h.code, 0, h.stderr);
    assert.deepEqual(JSON.parse(h.stdout), { Authorization: `Bearer ${token}` });
    const env = await run('mcp-headers.mjs', ['--dir', 'nowhere'], work, { ARGHBOX_TOKEN: 'from-env' });
    assert.deepEqual(JSON.parse(env.stdout), { Authorization: 'Bearer from-env' });
    const none = await run('mcp-headers.mjs', ['--dir', 'nowhere'], work);
    assert.equal(none.code, 1);
    assert.equal(none.stdout, '');

    fs.rmSync(path.join(work, '.arghbox', 'site.json'));
    const noUrl = await run('triage.mjs', ['mcp-config'], work);
    assert.equal(noUrl.code, 2);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
