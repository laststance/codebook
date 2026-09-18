import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type * as RunModule from '../run';

test('cleanup closes both owned source tabs even when closing a tab replaces its siblings handles', async () => {
  // Arrange: the real coordinator uses a host boundary that invalidates sibling tab handles after each close call.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-paired-tabs-'));
  const filename = join(__dirname, '../run.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof RunModule> = {};
  class TextInput { constructor(readonly uri: { fsPath: string }) {} }
  let tabs = ['/server', '/client', '/unrelated'].map(path => ({ input: new TextInput({ fsPath: path }) }));
  const calls: number[] = [];
  const tabGroups = {
    get all() { return [{ tabs }]; },
    async close(input: typeof tabs | (typeof tabs)[number]): Promise<boolean> {
      const requested = Array.isArray(input) ? input : [input]; calls.push(requested.length);
      if (requested.some(tab => !tabs.includes(tab))) throw new Error('Tab close: Invalid tab not found!');
      tabs = tabs.filter(tab => !requested.includes(tab)).map(tab => ({ input: tab.input }));
      return true;
    },
  };
  runInNewContext(await readFile(filename, 'utf8'), { exports, AbortController, performance, process, setInterval, clearInterval,
    require: (name: string) => {
      if (name === 'vscode') return { version: 'test', extensions: { getExtension: () => undefined }, debug: {}, window: { tabGroups }, TabInputText: TextInput };
      if (name === 'codebook-cycle-0001/dist/hostBrowser') return {};
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.PairedRun);
  const run = new exports.PairedRun({ artifactRoot: directory, templateRoot: directory, descriptorPath: '', revision: 'test', dirty: true, sourceHash: 'test', nodeExecutable: '/node', host: { id: 'cursor', productVersion: 'test', apiVersion: 'test', commit: 'test' } }, 'normal');
  run.participants.server.source = { sourcePath: '/server', source: '', javascript: '', sourceMap: '{}', breakpointLine: 1 };
  run.participants.browser.source = { sourcePath: '/client', source: '', javascript: '', sourceMap: '{}', breakpointLine: 1 };
  try {
    // Act
    await run.cleanup();
    // Assert
    assert.deepEqual(calls, [2]); assert.deepEqual(tabs.map(tab => tab.input.uri.fsPath), ['/unrelated']); assert.equal(run.view().cleaned, true);
  } finally { await rm(directory, { recursive: true }); }
});
