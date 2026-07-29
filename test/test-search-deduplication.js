import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SearchManager, stopSearchManagerCleanup } from '../dist/search-manager.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testOutputRoot = path.join(projectRoot, 'test', 'test_output');
await fs.mkdir(testOutputRoot, { recursive: true });
const tempDir = await fs.mkdtemp(path.join(testOutputRoot, 'dc-search-dedup-'));
await fs.writeFile(path.join(tempDir, 'corpus.txt'), Buffer.alloc(16 * 1024 * 1024, 97));
const options = {
  rootPath: tempDir,
  pattern: 'RDC_PATTERN_THAT_DOES_NOT_EXIST_0247',
  searchType: 'content',
  ignoreCase: true,
  timeout: 5000,
  maxResults: 20
};

try {
  process.env.DC_PLUGIN_MODE = 'legacy-plugin';
  const legacy = new SearchManager();
  const [legacyA, legacyB] = await Promise.all([
    legacy.startSearch(options),
    legacy.startSearch(options)
  ]);
  assert.notEqual(legacyA.sessionId, legacyB.sessionId, 'legacy mode must preserve separate search workers');
  legacy.terminateSearch(legacyA.sessionId);
  legacy.terminateSearch(legacyB.sessionId);

  process.env.DC_PLUGIN_MODE = 'optimized-plugin';
  const optimized = new SearchManager();
  const [optimizedA, optimizedB] = await Promise.all([
    optimized.startSearch(options),
    optimized.startSearch(options)
  ]);
  assert.equal(optimizedA.sessionId, optimizedB.sessionId, 'optimized mode must coalesce identical active searches');
  assert.equal(Boolean(optimizedA.reused || optimizedB.reused), true, 'one optimized request must report reuse');
  optimized.terminateSearch(optimizedA.sessionId);

  console.log('PASS legacy=2 search sessions, optimized=1 reused search session');
} finally {
  delete process.env.DC_PLUGIN_MODE;
  stopSearchManagerCleanup();
  await fs.rm(tempDir, { recursive: true, force: true });
}
