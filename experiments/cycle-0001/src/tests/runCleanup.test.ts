import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type * as RunModule from '../run';

test('failed cleanup saves partial evidence and a later DELETE retries after concurrent callers share the first attempt', async () => {
  // Arrange: execute the compiled coordinator with a failing host boundary, retaining real evidence writes.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cleanup-retry-'));
  const filename = join(__dirname, '../run.js');
  const nativeRequire = createRequire(filename);
  const exports: Partial<typeof RunModule> = {};
  const releases: string[] = [];
  let browserPending = true;
  let browserAttempts = 0;
  const breakpoints = [{ id: 'owned-breakpoint' }];
  const cdp = { closed: false, close() { cdp.closed = true; releases.push('cdp'); } };
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, AbortController, performance, process, setInterval, clearInterval,
    require: (name: string) => {
      if (name === 'vscode') return {
        version: 'test', extensions: { getExtension: () => undefined },
        window: { tabGroups: { all: [] } },
        debug: { breakpoints, removeBreakpoints: () => { breakpoints.splice(0); releases.push('breakpoint'); } },
      };
      if (name === './hostBrowser') return { HostBrowser: class {
        async close() { browserAttempts++; releases.push('browser'); if (browserPending) throw new Error('Native debugger acquisition remains pending'); }
      } };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.ExperimentRun);
  const run = new exports.ExperimentRun({ artifactRoot: directory, templateRoot: directory, fixtureOrigin: 'http://127.0.0.1', descriptorPath: '', revision: 'test', workingTreeDirty: true, sourceHash: 'test', extensionHash: 'test', host: { id: 'cursor', productVersion: 'test', apiVersion: 'test', commit: 'test' } }, 'normal');
  // Inject handles at the same native boundaries where real preparation would acquire them.
  Object.defineProperty(run, 'breakpoint', { value: breakpoints[0] });
  Object.defineProperty(run, 'cdp', { value: cdp });
  try {
    // Act
    const attempts = await Promise.allSettled([run.cleanup(), run.cleanup()]);
    const partial = JSON.parse(await readFile(join(run.evidence.directory, 'manifest.json'), 'utf8'));
    // Assert
    assert.deepEqual(attempts.map(attempt => attempt.status), ['rejected', 'rejected']);
    assert.equal(browserAttempts, 1);
    assert.deepEqual(releases, ['cdp', 'breakpoint', 'browser']);
    assert.equal(cdp.closed, true);
    assert.equal(breakpoints.length, 0);
    assert.equal(partial.cleaned, false);
    assert.match(partial.failures[0], /Native debugger acquisition remains pending/);
    assert.equal(run.evidence.events.some(event => event.type === 'cleanup.failed'), true);
    browserPending = false;
    await run.cleanup();
    assert.equal(browserAttempts, 2);
    assert.equal(run.view().cleaned, true);
    const final = JSON.parse(await readFile(join(run.evidence.directory, 'manifest.json'), 'utf8'));
    assert.equal(final.cleaned, true);
    assert.match(final.failures[0], /Native debugger acquisition remains pending/);
    await run.cleanup();
    assert.equal(browserAttempts, 2);
  } finally { browserPending = false; await run.cleanup(); await rm(directory, { recursive: true }); }
});
