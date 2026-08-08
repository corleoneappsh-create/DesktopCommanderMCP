import assert from 'node:assert/strict';
import {
  getFastShellForSimpleCommand,
  getPluginPerformanceMode,
  getPollDelayMs,
  isOptimizedPluginMode
} from '../dist/performance-mode.js';

assert.equal(getPluginPerformanceMode(undefined), 'optimized-plugin');
assert.equal(getPluginPerformanceMode('legacy'), 'legacy-plugin');
assert.equal(getPluginPerformanceMode('old'), 'legacy-plugin');
assert.equal(getPluginPerformanceMode('0.2.46'), 'legacy-plugin');
assert.equal(getPluginPerformanceMode('new'), 'optimized-plugin');
assert.equal(getPluginPerformanceMode('0.2.47'), 'optimized-plugin');
assert.equal(getPluginPerformanceMode('0.2.48'), 'optimized-plugin');
assert.equal(getPluginPerformanceMode('unknown'), 'optimized-plugin');
assert.equal(isOptimizedPluginMode('optimized'), true);
assert.equal(isOptimizedPluginMode('legacy'), false);

assert.equal(getPollDelayMs(0, 'legacy-plugin'), 50);
assert.equal(getPollDelayMs(0, 'optimized-plugin'), 10);
assert.equal(getPollDelayMs(249, 'optimized-plugin'), 10);
assert.equal(getPollDelayMs(250, 'optimized-plugin'), 50);

assert.equal(getFastShellForSimpleCommand('node -v', 'win32'), 'cmd.exe');
assert.equal(getFastShellForSimpleCommand('echo hello', 'darwin'), '/bin/sh');
assert.equal(getFastShellForSimpleCommand('git status', 'linux'), '/bin/sh');
assert.equal(getFastShellForSimpleCommand('Get-Date', 'win32'), null);
assert.equal(getFastShellForSimpleCommand('echo $SHELL', 'darwin'), null);
assert.equal(getFastShellForSimpleCommand('echo a && echo b', 'linux'), null);
assert.equal(getFastShellForSimpleCommand('Write-Output 7', 'win32'), null);

console.log('PASS performance mode resolution, polling policy, and safe shell routing');
