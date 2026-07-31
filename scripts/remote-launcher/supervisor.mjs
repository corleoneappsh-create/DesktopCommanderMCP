import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024;
const DEFAULT_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

export function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireLock(lockPath, pid = process.pid) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.writeFileSync(lockPath, `${pid}\n`, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isInteger(owner) && processIsAlive(owner)) return false;
    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(lockPath, `${pid}\n`, { flag: 'wx', mode: 0o600 });
    return true;
  }
}

export function rotateLogIfNeeded(logPath, maxBytes = DEFAULT_MAX_LOG_BYTES) {
  try {
    if (fs.statSync(logPath).size < maxBytes) return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const rotated = `${logPath}.${new Date().toISOString().replace(/[:.]/g, '')}`;
  fs.renameSync(logPath, rotated);
  return rotated;
}

function appendLog(logPath, chunk, maxBytes) {
  rotateLogIfNeeded(logPath, maxBytes);
  fs.appendFileSync(logPath, chunk, { mode: 0o600 });
}

export async function runSupervisor(options = {}) {
  const node = options.node || process.execPath;
  const entry = options.entry;
  const logPath = options.logPath;
  const lockPath = options.lockPath || `${logPath}.lock`;
  const maxLogBytes = options.maxLogBytes || DEFAULT_MAX_LOG_BYTES;
  if (!entry || !logPath) throw new Error('entry and logPath are required');
  if (!acquireLock(lockPath)) return 75;

  let child;
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (child && !child.killed) child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let retryMs = options.retryMs || DEFAULT_RETRY_MS;
  try {
    while (!stopping) {
      appendLog(logPath, `${new Date().toISOString()} START pid=${process.pid}\n`, maxLogBytes);
      const started = Date.now();
      child = spawn(node, [entry, 'remote', '--persist-session'], {
        env: { ...process.env, DC_PLUGIN_MODE: process.env.DC_PLUGIN_MODE || 'optimized-plugin' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.on('data', (chunk) => appendLog(logPath, chunk, maxLogBytes));
      child.stderr.on('data', (chunk) => appendLog(logPath, chunk, maxLogBytes));
      const code = await new Promise((resolve) => child.once('exit', resolve));
      appendLog(logPath, `${new Date().toISOString()} EXIT code=${code}\n`, maxLogBytes);
      if (stopping) break;
      retryMs = Date.now() - started > 60_000 ? DEFAULT_RETRY_MS : Math.min(MAX_RETRY_MS, retryMs * 2);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
    return 0;
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const entry = process.env.ENTRY || path.join(root, 'dist', 'index.js');
  const logPath = process.env.LOG || path.join(path.dirname(fileURLToPath(import.meta.url)), 'desktop-commander-remote.log');
  const code = await runSupervisor({ node: process.env.NODE || process.execPath, entry, logPath });
  process.exit(code);
}
