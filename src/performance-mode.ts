import path from 'path';

export type PluginPerformanceMode = 'legacy-plugin' | 'optimized-plugin';

const LEGACY_ALIASES = new Set(['legacy', 'old', 'legacy-plugin', '0.2.46']);
const OPTIMIZED_ALIASES = new Set(['optimized', 'new', 'optimized-plugin', '0.2.47']);

/**
 * Select the plugin execution profile. Optimized mode is the production default;
 * legacy mode is retained for A/B verification and emergency rollback.
 */
export function getPluginPerformanceMode(value: string | undefined = process.env.DC_PLUGIN_MODE): PluginPerformanceMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized && LEGACY_ALIASES.has(normalized)) return 'legacy-plugin';
  if (normalized && OPTIMIZED_ALIASES.has(normalized)) return 'optimized-plugin';
  return 'optimized-plugin';
}

export function isOptimizedPluginMode(value?: string): boolean {
  return getPluginPerformanceMode(value) === 'optimized-plugin';
}

/** Adaptive polling is aggressive for the first 250ms, then backs off. */
export function getPollDelayMs(elapsedMs: number, mode: PluginPerformanceMode = getPluginPerformanceMode()): number {
  if (mode === 'legacy-plugin') return 50;
  return elapsedMs < 250 ? 10 : 50;
}

/**
 * Route only a conservative allow-list of simple native commands through a
 * lightweight shell. Commands containing shell-specific syntax stay on the
 * configured shell.
 */
export function getFastShellForSimpleCommand(command: string, platform: NodeJS.Platform = process.platform): string | null {
  const trimmed = command.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;

  if (/[$`{};&|<>^%]/.test(trimmed) || trimmed.includes('[[') || trimmed.includes(']]')) return null;
  if (/\b(?:Get|Set|New|Remove|Start|Stop|Write|Test|Invoke|Select|Where|ForEach|Measure|ConvertTo|ConvertFrom)-[A-Za-z]/i.test(trimmed)) {
    return null;
  }

  const match = trimmed.match(/^"([^"]+)"|^'([^']+)'|^([^\s]+)/);
  const token = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!token) return null;
  const executable = path.basename(token).toLowerCase();

  if (platform === 'win32') {
    const safe = new Set([
      'echo', 'whoami', 'hostname', 'ver', 'where', 'node', 'node.exe',
      'npm', 'npm.cmd', 'npx', 'npx.cmd', 'python', 'python.exe', 'python3',
      'git', 'git.exe', 'rg', 'rg.exe', 'curl', 'curl.exe'
    ]);
    return safe.has(executable) || /\.(?:exe|cmd|bat)$/i.test(executable) ? 'cmd.exe' : null;
  }

  const safe = new Set([
    'echo', 'printf', 'true', 'false', 'pwd', 'whoami', 'hostname', 'uname',
    'date', 'node', 'npm', 'npx', 'python', 'python3', 'git', 'rg', 'grep',
    'sed', 'awk', 'find', 'ls', 'wc', 'head', 'tail', 'cat', 'stat',
    'shasum', 'md5', 'curl'
  ]);
  return safe.has(executable) ? '/bin/sh' : null;
}
