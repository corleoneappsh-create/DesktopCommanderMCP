import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  forceTerminate,
  interactWithProcess,
  readProcessOutput,
  startProcess
} from '../dist/tools/improved-process-tools.js';

function textOf(result) {
  return result.content?.map(item => item.type === 'text' ? item.text : '').join('\n') ?? '';
}

function pidOf(result) {
  const match = textOf(result).match(/PID\s+(-?\d+)/);
  assert.ok(match, `PID not found in: ${textOf(result)}`);
  return Number(match[1]);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-line-worker-'));
const worker = path.join(tempDir, 'line-worker.mjs');
await fs.writeFile(worker, `
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    process.stdout.write(line + '\\n');
  }
});
`);

try {
  for (const mode of ['legacy-plugin', 'optimized-plugin']) {
    process.env.DC_PLUGIN_MODE = mode;
    const started = await startProcess({ command: `node "${worker}"`, timeout_ms: 150 });
    const pid = pidOf(started);
    try {
      for (let i = 0; i < 10; i++) {
        const marker = `RDC_${mode}_${i}`;
        await interactWithProcess({ pid, input: marker, wait_for_prompt: false, timeout_ms: 1000 });
        const read = await readProcessOutput({ pid, offset: 0, length: 20, timeout_ms: 1500 });
        assert.match(textOf(read), new RegExp(marker), `${mode} lost marker ${marker}`);
      }
    } finally {
      await forceTerminate({ pid });
    }
  }
  console.log('PASS 20/20 sequential output markers preserved across both plugin profiles');
} finally {
  delete process.env.DC_PLUGIN_MODE;
  await fs.rm(tempDir, { recursive: true, force: true });
}
