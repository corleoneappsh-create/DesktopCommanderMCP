import assert from 'assert';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = 'true';

const {
  startProcess,
  readProcessOutput,
  MAX_READ_RESPONSE_OUTPUT_CHARS
} = await import('../dist/tools/improved-process-tools.js');

function textOf(result) {
  return result.content?.map(item => item.type === 'text' ? item.text : '').join('\n') ?? '';
}

function pidOf(result) {
  const match = textOf(result).match(/PID\s+(\d+)/);
  assert.ok(match, 'PID should be present');
  return Number(match[1]);
}

const normal = await startProcess({ command: `node -e "console.log('NORMAL_READ_OK')"`, timeout_ms: 5000 });
const normalRead = await readProcessOutput({ pid: pidOf(normal), offset: -3, length: 3, timeout_ms: 1000 });
const normalText = textOf(normalRead);
assert.ok(normalText.includes('NORMAL_READ_OK'), 'normal output should remain readable');
assert.ok(!normalText.includes('PROCESS OUTPUT TRUNCATED FOR CLIENT'), 'normal output must not be truncated');

const longChars = 96 * 1024;
const started = await startProcess({
  command: `node -e "process.stdout.write('READ_HEAD\\n');process.stdout.write('x'.repeat(${longChars}));process.stdout.write('\\nREAD_TAIL\\n')"`,
  timeout_ms: 5000
});
const pid = pidOf(started);
const read = await readProcessOutput({ pid, offset: -3, length: 3, timeout_ms: 1000, verbose_timing: true });
const text = textOf(read);
assert.ok(text.includes('PROCESS OUTPUT TRUNCATED FOR CLIENT'), 'large read response must be marked truncated');
assert.ok(text.includes('READ_TAIL'), 'tail marker must survive client truncation');
assert.ok(text.includes('Process completed'), 'process status must remain visible after truncation');
assert.ok(text.includes('Timing:'), 'timing metadata must remain visible after truncation');
assert.ok(text.length <= MAX_READ_RESPONSE_OUTPUT_CHARS + 2048, `read response too large: ${text.length}`);

console.log(`PASS read_process_output char cap: response=${text.length} cap=${MAX_READ_RESPONSE_OUTPUT_CHARS}`);
