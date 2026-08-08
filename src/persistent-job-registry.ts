import fs from 'fs';
import os from 'os';
import path from 'path';

export type PersistentJobStatus = 'running' | 'completed' | 'orphaned';

export interface PersistentJobRecord {
  pid: number;
  startedAt: string;
  endedAt?: string;
  status: PersistentJobStatus;
  exitCode?: number | null;
  logPath: string;
}

interface RegistryDocument {
  version: 1;
  jobs: PersistentJobRecord[];
}

const MAX_RETAINED_JOBS = 200;

export class PersistentJobRegistry {
  readonly baseDir: string;
  readonly registryPath: string;
  private jobs = new Map<number, PersistentJobRecord>();

  constructor(baseDir = process.env.DC_JOB_REGISTRY_DIR || path.join(os.homedir(), '.desktop-commander', 'jobs')) {
    this.baseDir = baseDir;
    this.registryPath = path.join(baseDir, 'registry.json');
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    this.load();
    this.reconcile();
  }

  register(pid: number, startedAt = new Date()): PersistentJobRecord {
    const record: PersistentJobRecord = {
      pid,
      startedAt: startedAt.toISOString(),
      status: 'running',
      logPath: path.join(this.baseDir, `${pid}-${startedAt.getTime()}.log`),
    };
    fs.closeSync(fs.openSync(record.logPath, 'a', 0o600));
    this.jobs.set(pid, record);
    this.persist();
    return { ...record };
  }

  complete(pid: number, exitCode: number | null): void {
    const record = this.jobs.get(pid);
    if (!record) return;
    record.status = 'completed';
    record.exitCode = exitCode;
    record.endedAt = new Date().toISOString();
    this.persist();
  }

  get(pid: number): PersistentJobRecord | undefined {
    const record = this.jobs.get(pid);
    return record ? { ...record } : undefined;
  }

  list(): PersistentJobRecord[] {
    return Array.from(this.jobs.values()).map((record) => ({ ...record }));
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  reconcile(): void {
    let changed = false;
    for (const record of this.jobs.values()) {
      if (record.status === 'running' && !this.isProcessAlive(record.pid)) {
        record.status = 'orphaned';
        record.exitCode = null;
        record.endedAt = record.endedAt || new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8')) as RegistryDocument;
      for (const record of parsed.jobs || []) {
        if (Number.isInteger(record.pid) && typeof record.logPath === 'string') {
          this.jobs.set(record.pid, record);
        }
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        const corruptPath = `${this.registryPath}.corrupt-${Date.now()}`;
        try { fs.renameSync(this.registryPath, corruptPath); } catch { /* best effort */ }
      }
    }
  }

  private persist(): void {
    const retained = Array.from(this.jobs.values())
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .slice(-MAX_RETAINED_JOBS);
    this.jobs = new Map(retained.map((record) => [record.pid, record]));
    const temporaryPath = `${this.registryPath}.${process.pid}.${Date.now()}.tmp`;
    const document: RegistryDocument = { version: 1, jobs: retained };
    fs.writeFileSync(temporaryPath, JSON.stringify(document, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.registryPath);
    try { fs.chmodSync(this.registryPath, 0o600); } catch { /* Windows ACLs may not expose POSIX modes */ }
  }
}
