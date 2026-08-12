import assert from 'assert';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = 'true';

const {
  startProcess,
  interactWithProcess,
  forceTerminate,
  MAX_INTERACT_RESPONSE_OUTPUT_CHARS
} = await import('../dist/tools/improved-process-tools.js');

function textOf(result) {
  return result.content?.map(item => item.type === 'text' ? item.text : '').join('\n') ?? '';
}

const started = await startProcess({ command: 'node -i', timeout_ms: 5000 });
const pidMatch = textOf(started).match(/PID\s+(\d+)/);
assert.ok(pidMatch, 'Node REPL PID should be present');
const pid = Number(pidMatch[1]);

try {
  const small = await interactWithProcess({ pid, input: `console.log('INTERACT_SMALL_OK')`, timeout_ms: 5000, wait_for_prompt: true });
  const smallText = textOf(small);
  assert.ok(smallText.includes('INTERACT_SMALL_OK'), 'small interact output must remain visible');
  assert.ok(!smallText.includes('INTERACT OUTPUT TRUNCATED FOR CLIENT'), 'small interact output must not be truncated');

  const large = await interactWithProcess({
    pid,
    input: `console.log('IHEAD' + 'x'.repeat(96*1024) + 'ITAIL')`,
    timeout_ms: 5000,
    wait_for_prompt: true,
    verbose_timing: true
  });
  const text = textOf(large);
  assert.ok(text.includes('INTERACT OUTPUT TRUNCATED FOR CLIENT'), 'large interact output must be marked truncated');
  assert.ok(text.includes('IHEAD'), 'interact head marker must survive');
  assert.ok(text.includes('ITAIL'), 'interact tail marker must survive');
  assert.ok(text.includes('Input executed'), 'interact status must remain visible');
  assert.ok(text.includes('Timing Information'), 'timing metadata must remain visible');
  assert.ok(text.length <= MAX_INTERACT_RESPONSE_OUTPUT_CHARS + 4096, `interact response too large: ${text.length}`);
  console.log(`PASS interact output char cap: response=${text.length} cap=${MAX_INTERACT_RESPONSE_OUTPUT_CHARS}`);
} finally {
  await forceTerminate({ pid });
}
