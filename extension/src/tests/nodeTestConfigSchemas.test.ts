import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeTestConfigSchema } from '../nodeTestConfigSchemas';
import { createConfiguredStudy } from './utils/createConfiguredStudy';

test('a repository-local Vitest file can declare observed library state without a browser action', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration;
  const input = { version: 1, adapter: 'vitest-node', book: browser.book,
    testFile: 'packages/query-core/src/__tests__/subscribable.test.tsx',
    testHash: 'a'.repeat(64),
    source: { path: 'packages/query-core/src/subscribable.ts', hash: browser.source.hash, line: 10, column: 1 },
    inspections: [{ path: 'listener', mode: 'value', required: true }] };
  // Act
  const result = nodeTestConfigSchema.parse(input);
  // Assert
  assert.equal(result.adapter, 'vitest-node');
  assert.equal(result.testFile, 'packages/query-core/src/__tests__/subscribable.test.tsx');
  assert.equal(result.inspections[0]?.path, 'listener');
});

test('a Node test request cannot execute a shell command or read a test outside the repository', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration;
  const base = { version: 1, adapter: 'vitest-node', book: browser.book, testFile: 'src/value.test.ts', testHash: 'a'.repeat(64), source: browser.source,
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }] };
  // Act / Assert
  for (const testFile of ['/tmp/value.test.ts', '../value.test.ts', 'src/../value.test.ts', 'src/value.ts', 'src/value.test.ts\nrm -rf /']) {
    assert.equal(nodeTestConfigSchema.safeParse({ ...base, testFile }).success, false);
  }
  assert.equal(nodeTestConfigSchema.safeParse({ ...base, command: 'sh -c anything' }).success, false);
  assert.equal(nodeTestConfigSchema.safeParse({ ...base, adapter: 'shell' }).success, false);
  assert.equal(nodeTestConfigSchema.safeParse({ ...base, testName: 'a\n--inspect=0.0.0.0' }).success, false);
});

test('a Node test stop requires a captured runtime value', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration;
  const base = { version: 1, adapter: 'vitest-node', book: browser.book, testFile: 'src/value.test.ts', testHash: 'a'.repeat(64), source: browser.source,
    inspections: [{ path: 'nextTheme', mode: 'type', required: true }] };
  // Act / Assert
  assert.equal(nodeTestConfigSchema.safeParse(base).success, false);
  assert.equal(nodeTestConfigSchema.safeParse({ ...base, inspections: [{ path: 'nextTheme', mode: 'value', required: true }] }).success, true);
});
