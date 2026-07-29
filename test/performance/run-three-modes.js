import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  forceTerminate,
  interactWithProcess,
  readProcessOutput,
  startProcess
} from '../../dist/tools/improved-process-tools.js';
import { SearchManager, stopSearchManagerCleanup } from '../../dist/search-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = value => Math.round(value * 100) / 100;
const textOf = result => result.content?.map(item => item.type === 'text' ? item.text : '').join('\n') ?? '';
const pidOf = result => Number(textOf(result).match(/PID\s+(-?\d+)/)?.[1]);

function directCommand() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("RDC_DIRECT")'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 && output === 'RDC_DIRECT'
      ? resolve(performance.now() - started)
      : reject(new Error(`direct command failed: ${code} ${output}`)));
  });
}

async function pluginCommand(mode) {
  process.env.DC_PLUGIN_MODE = mode;
  const started = performance.now();
  const result = await startProcess({ command: 'node -e "process.stdout.write(\'RDC_PLUGIN\')"', timeout_ms: 3000 });
  const text = textOf(result);
  assert.match(text, /RDC_PLUGIN/);
  return { ms: performance.now() - started, shell: text.match(/shell:\s*([^\)]+)/)?.[1] ?? 'unknown' };
}

async function makeWorker(tempDir) {
  const worker = path.join(tempDir, 'benchmark-worker.mjs');
  await fs.writeFile(worker, `
process.stdout.write('READY>\\n');
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
  return worker;
}

async function directStream(worker, repetitions) {
  const child = spawn(process.execPath, [worker], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  let buffer = '';
  const waiters = [];
  const queuedLines = [];
  const nextLine = () => queuedLines.length > 0
    ? Promise.resolve(queuedLines.shift())
    : new Promise(resolve => waiters.push(resolve));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else queuedLines.push(line);
    }
  });
  assert.equal(await nextLine(), 'READY>');
  const times = [];
  for (let i = 0; i < repetitions; i++) {
    const marker = `DIRECT_${i}`;
    const received = nextLine();
    const started = performance.now();
    child.stdin.write(marker + '\n');
    assert.equal(await received, marker);
    times.push(performance.now() - started);
  }
  child.kill();
  return times;
}

async function pluginStream(mode, worker, repetitions) {
  process.env.DC_PLUGIN_MODE = mode;
  const startedProcess = await startProcess({ command: `node "${worker}"`, timeout_ms: 10000 });
  assert.match(textOf(startedProcess), /READY>/);
  const pid = pidOf(startedProcess);
  assert.ok(Number.isInteger(pid));
  await readProcessOutput({ pid, offset: 0, length: 20, timeout_ms: 0 });
  const times = [];
  try {
    for (let i = 0; i < repetitions; i++) {
      const marker = `${mode}_${i}`;
      await interactWithProcess({ pid, input: marker, wait_for_prompt: false, timeout_ms: 1000 });
      const started = performance.now();
      const result = await readProcessOutput({ pid, offset: 0, length: 20, timeout_ms: 1500 });
      assert.match(textOf(result), new RegExp(marker));
      times.push(performance.now() - started);
    }
  } finally {
    await forceTerminate({ pid });
  }
  return times;
}

async function pluginDedup(mode, corpusDir) {
  process.env.DC_PLUGIN_MODE = mode;
  const manager = new SearchManager();
  const options = {
    rootPath: corpusDir,
    pattern: 'RDC_BENCHMARK_NO_MATCH_0247',
    searchType: 'content',
    timeout: 5000,
    maxResults: 10
  };
  const started = performance.now();
  const [a, b] = await Promise.all([manager.startSearch(options), manager.startSearch(options)]);
  const elapsed = performance.now() - started;
  manager.terminateSearch(a.sessionId);
  if (b.sessionId !== a.sessionId) manager.terminateSearch(b.sessionId);
  return { ms: elapsed, sessions: new Set([a.sessionId, b.sessionId]).size, reused: Boolean(a.reused || b.reused) };
}

export async function runThreeModeBenchmark({ enforce = false, repetitions = 7 } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-three-mode-'));
  const corpusDir = path.join(tempDir, 'corpus');
  await fs.mkdir(corpusDir);
  await fs.writeFile(path.join(corpusDir, 'large.txt'), Buffer.alloc(16 * 1024 * 1024, 98));
  const worker = await makeWorker(tempDir);

  try {
    const directShell = [];
    for (let i = 0; i < repetitions; i++) directShell.push(await directCommand());
    const directStreaming = await directStream(worker, repetitions);

    const legacyShell = [];
    let legacyShellName = '';
    for (let i = 0; i < repetitions; i++) {
      const sample = await pluginCommand('legacy-plugin');
      legacyShell.push(sample.ms);
      legacyShellName = sample.shell;
    }
    const legacyStreaming = await pluginStream('legacy-plugin', worker, repetitions);
    const legacySearch = await pluginDedup('legacy-plugin', corpusDir);

    const optimizedShell = [];
    let optimizedShellName = '';
    for (let i = 0; i < repetitions; i++) {
      const sample = await pluginCommand('optimized-plugin');
      optimizedShell.push(sample.ms);
      optimizedShellName = sample.shell;
    }
    const optimizedStreaming = await pluginStream('optimized-plugin', worker, repetitions);
    const optimizedSearch = await pluginDedup('optimized-plugin', corpusDir);

    const report = {
      version: '0.2.47',
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      repetitions,
      modes: {
        direct: {
          description: 'No plugin; direct child_process execution',
          shellMedianMs: round(median(directShell)),
          streamingMedianMs: round(median(directStreaming))
        },
        legacyPlugin: {
          description: 'Plugin behavior compatible with 0.2.46',
          shell: legacyShellName,
          shellMedianMs: round(median(legacyShell)),
          streamingMedianMs: round(median(legacyStreaming)),
          duplicateSearchSessions: legacySearch.sessions,
          duplicateSearchElapsedMs: round(legacySearch.ms)
        },
        optimizedPlugin: {
          description: '0.2.47 optimized plugin profile',
          shell: optimizedShellName,
          shellMedianMs: round(median(optimizedShell)),
          streamingMedianMs: round(median(optimizedStreaming)),
          duplicateSearchSessions: optimizedSearch.sessions,
          duplicateSearchElapsedMs: round(optimizedSearch.ms),
          searchReused: optimizedSearch.reused
        }
      }
    };

    if (enforce) {
      assert.equal(report.modes.legacyPlugin.duplicateSearchSessions, 2);
      assert.equal(report.modes.optimizedPlugin.duplicateSearchSessions, 1);
      assert.equal(report.modes.optimizedPlugin.searchReused, true);
      assert.ok(report.modes.optimizedPlugin.streamingMedianMs <= report.modes.legacyPlugin.streamingMedianMs * 1.75 + 15,
        `optimized streaming regression: ${JSON.stringify(report.modes)}`);
      assert.ok(report.modes.optimizedPlugin.shellMedianMs <= report.modes.legacyPlugin.shellMedianMs * 2 + 20,
        `optimized shell regression: ${JSON.stringify(report.modes)}`);
    }

    const outputDir = path.join(projectRoot, 'artifacts', 'performance');
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `three-mode-${process.platform}-${process.arch}.json`);
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    console.log(`REPORT ${outputPath}`);
    return report;
  } finally {
    delete process.env.DC_PLUGIN_MODE;
    stopSearchManagerCleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runThreeModeBenchmark({ enforce: process.argv.includes('--enforce') });
}
