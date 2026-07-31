import assert from 'node:assert';
import fs from 'node:fs/promises';

const ps = await fs.readFile(new URL('../scripts/remote-launcher/start-remote-optimized.ps1', import.meta.url), 'utf8');
const sh = await fs.readFile(new URL('../scripts/remote-launcher/start-remote-optimized.sh', import.meta.url), 'utf8');
const supervisor = await fs.readFile(new URL('../scripts/remote-launcher/supervisor.mjs', import.meta.url), 'utf8');
assert.match(ps, /supervisor\.mjs/);
assert.match(sh, /supervisor\.mjs/);
assert.doesNotMatch(ps, /Stop-Process|taskkill/i);
assert.doesNotMatch(sh, /kill\s+-(?:TERM|KILL)/i);
assert.match(supervisor, /remote', '--persist-session/);
assert.match(supervisor, /acquireLock/);
assert.match(supervisor, /rotateLogIfNeeded/);
assert.match(supervisor, /MAX_RETRY_MS/);
console.log('PASS launchers delegate to the locked rotating persistent-session supervisor');
