import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readBoundedText } from '../utils/readBoundedText';
import type * as DiscoveryModule from '../utils/readDevelopmentBundle';
import * as constants from '../constants';

/** Exercises real discovery/file reads with smaller resource ceilings for failure-path tests. @example const harness = await discovery(['static/a.js']); */
async function discovery(candidates: string[], totalLimitBytes?: number, expiredAfterManifest = false, expiredAfterExtraction = false) {
  const target = await mkdtemp(join(tmpdir(), 'codebook-discovery-')), reads: string[] = [];
  const manifestPath = join(target, '.next/dev/server/app/page_client-reference-manifest.js');
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(join(target, 'theme.tsx'), 'setTheme(otherTheme);\n');
  await writeFile(manifestPath, `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify({ clientModules: { [join(target, 'src/components/Header/index.tsx')]: { chunks: candidates } } })};`);
  const filename = join(__dirname, '../utils/readDevelopmentBundle.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof DiscoveryModule> = {};
  let extracted = false;
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, Buffer, AbortSignal, performance: { now: () => extracted || expiredAfterManifest && reads.length >= 2 ? 30_001 : 0 },
    require(name: string) {
      if (name === '../constants') return { ...constants, TARGET_SOURCE_PATH: 'theme.tsx', TARGET_SOURCE_HASH: '83d6b787fc37b4a5d141c20f07d11088b5b36b3aed36cd21210f9e795e2e75b9', DISCOVERY_LIMIT_BYTES: totalLimitBytes ?? constants.DISCOVERY_LIMIT_BYTES };
      if (name === './readBoundedText') return { readBoundedText: async (path: string, limit: number, signal: AbortSignal) => { reads.push(path); return readBoundedText(path, limit, signal); } };
      if (name === './extractDevelopmentModule' && expiredAfterExtraction) return { extractDevelopmentModule: (...arguments_: Parameters<typeof import('../utils/extractDevelopmentModule').extractDevelopmentModule>) => {
        const result = nativeRequire(name).extractDevelopmentModule(...arguments_); extracted = true; return result;
      } };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.readDevelopmentBundle);
  return { target, reads, acquire: exports.readDevelopmentBundle, close: () => rm(target, { recursive: true, force: true }) };
}

test('a declared chunk outside the isolated build is rejected before reading that path', async () => {
  // Arrange
  const harness = await discovery(['../outside.js']);
  try {
    // Act / Assert
    await assert.rejects(harness.acquire(harness.target), /escapes the isolated build/);
    assert.equal(harness.reads.length, 2);
  } finally { await harness.close(); }
});

test('too many declared chunks reject discovery before any candidate file read', async () => {
  // Arrange
  const harness = await discovery(Array.from({ length: 2049 }, (_, index) => `static/${index}.js`));
  try {
    // Act / Assert
    await assert.rejects(harness.acquire(harness.target), /chunk count exceeds contract/);
    assert.equal(harness.reads.length, 2);
  } finally { await harness.close(); }
});

test('aggregate build reads stop within the shared ceiling even when every individual chunk is small', async () => {
  // Arrange
  const harness = await discovery(['a.js', 'b.js'], 700);
  await writeFile(join(harness.target, '.next/dev/a.js'), 'a'.repeat(300));
  await writeFile(join(harness.target, '.next/dev/b.js'), 'b'.repeat(300));
  try {
    // Act / Assert
    await assert.rejects(harness.acquire(harness.target), /Text exceeds byte limit/);
    assert.equal(harness.reads.length, 4);
  } finally { await harness.close(); }
});

test('the discovery deadline rejects another candidate instead of granting a fresh per-file lifetime', async () => {
  // Arrange
  const harness = await discovery(['a.js'], undefined, true);
  try {
    // Act / Assert
    await assert.rejects(harness.acquire(harness.target), /resource limit exceeded/);
    assert.equal(harness.reads.length, 2);
  } finally { await harness.close(); }
});

test('cancelled preparation cannot start source or manifest reads', async () => {
  // Arrange
  const harness = await discovery(['a.js']), controller = new AbortController(); controller.abort();
  try {
    // Act / Assert
    await assert.rejects(harness.acquire(harness.target, controller.signal), /abort/i);
    assert.equal(harness.reads.length, 0);
  } finally { await harness.close(); }
});

test('the final chunk cannot publish a source tuple after extraction crosses the shared discovery deadline', async () => {
  // Arrange
  const harness = await discovery(['a.js'], undefined, false, true);
  const source = 'setTheme(otherTheme);\n';
  const map = { version: 3, sources: [join(harness.target, 'theme.tsx')], sourcesContent: [source], names: [], mappings: 'AAAA' };
  const script = `${source}//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=${constants.TARGET_SCRIPT_URL}\n`;
  await writeFile(join(harness.target, '.next/dev/a.js'), `eval(${JSON.stringify(script)});`);
  try {
    // Act / Assert
    await assert.rejects(harness.acquire(harness.target), /resource limit exceeded/);
    assert.equal(harness.reads.length, 3);
  } finally { await harness.close(); }
});
