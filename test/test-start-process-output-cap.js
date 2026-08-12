import assert from 'assert';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = 'true';

const { startProcess, MAX_INITIAL_RESPONSE_OUTPUT_CHARS } = await import('../dist/tools/improved-process-tools.js');
const { terminalManager } = await import('../dist/terminal-manager.js');

const SMALL = 'SMALL_OUTPUT_OK';
const BEGIN = 'BEGIN_MARKER';
const MIDDLE = 'MIDDLE_MARKER';
const END = 'END_MARKER';

const small = await startProcess({ command: `node -e "console.log('${SMALL}')"`, timeout_ms: 5000 });
const smallText = small.content?.[0]?.text ?? '';
assert.ok(smallText.includes(SMALL), 'small output must remain unchanged');
assert.ok(!smallText.includes('INITIAL OUTPUT TRUNCATED'), 'small output must not be marked truncated');

const payload = 256 * 1024;
const command = `node -e "process.stdout.write('${BEGIN}\\n');process.stdout.write('a'.repeat(${payload / 2}));process.stdout.write('\\n${MIDDLE}\\n');process.stdout.write('b'.repeat(${payload / 2}));process.stdout.write('\\n${END}\\n')"`;
const large = await startProcess({ command, timeout_ms: 5000 });
const text = large.content?.[0]?.text ?? '';
assert.ok(text.includes('INITIAL OUTPUT TRUNCATED'), 'large initial response must be marked truncated');
assert.ok(text.includes(BEGIN), 'head must be preserved');
assert.ok(text.includes(END), 'tail must be preserved');
assert.ok(!text.includes(MIDDLE), 'middle should be omitted from the client response');
assert.ok(text.length <= MAX_INITIAL_RESPONSE_OUTPUT_CHARS + 1024, `response too large: ${text.length}`);

const pidMatch = text.match(/PID (\d+)/);
assert.ok(pidMatch, 'response must include process PID');
const pid = Number(pidMatch[1]);
const retained = terminalManager.getOutputSinceSnapshot(pid, { totalChars: 0, lineCount: 0 }) ?? '';
assert.ok(retained.includes(BEGIN), 'retained buffer must keep beginning for this test payload');
assert.ok(retained.includes(MIDDLE), 'retained buffer must keep omitted middle');
assert.ok(retained.includes(END), 'retained buffer must keep tail');
assert.ok(retained.length > text.length * 4, 'server-retained output should remain much larger than client response');

console.log(`PASS start_process client output cap: response=${text.length} retained=${retained.length} cap=${MAX_INITIAL_RESPONSE_OUTPUT_CHARS}`);
