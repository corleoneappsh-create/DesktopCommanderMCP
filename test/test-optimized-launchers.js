import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const ps = await fs.readFile(new URL('../scripts/remote-launcher/start-remote-optimized.ps1', import.meta.url), 'utf8');
const sh = await fs.readFile(new URL('../scripts/remote-launcher/start-remote-optimized.sh', import.meta.url), 'utf8');
assert.doesNotMatch(ps, /Add-Content|ForEach-Object/i);
assert.match(ps, />>\s*\$Log\s*2>&1/);
assert.match(sh, />>\s*"\$LOG"\s*2>&1/);
assert.match(ps, /--persist-session/);
assert.match(sh, /--persist-session/);
console.log('PASS optimized launchers use direct stream redirection and persistent sessions');
