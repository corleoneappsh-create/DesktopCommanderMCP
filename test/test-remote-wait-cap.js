import assert from 'node:assert/strict';
import { DesktopCommanderIntegration } from '../dist/remote-device/desktop-commander-integration.js';

async function runCase(toolName, inputArgs, expectedArgs, expectedTimeout) {
  const integration = new DesktopCommanderIntegration();
  let captured;
  integration.isReady = true;
  integration.mcpClient = {
    callTool: async (...args) => {
      captured = args;
      return { ok: true };
    }
  };
  await integration.callClientTool(toolName, inputArgs);
  assert.deepEqual(captured[0].arguments, expectedArgs);
  assert.equal(captured[2].timeout, expectedTimeout);
  assert.equal(captured[2].maxTotalTimeout, expectedTimeout);
}

await runCase(
  'start_process',
  { command: 'sleep', timeout_ms: 80_000 },
  { command: 'sleep', timeout_ms: 20_000 },
  30_000
);
await runCase(
  'read_process_output',
  { pid: 123, timeout_ms: 45_000 },
  { pid: 123, timeout_ms: 20_000 },
  30_000
);
await runCase(
  'start_process',
  { command: 'fast', timeout_ms: 10_000 },
  { command: 'fast', timeout_ms: 10_000 },
  30_000
);
await runCase('read_file', { path: 'x' }, { path: 'x' }, 60_000);
console.log('PASS remote wait cap and timeout forwarding');
