import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeTestConfigSchema } from '../nodeTestConfigSchemas'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

test('a repository-local Vitest file can declare observed library state without a browser action', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration
  const input = {
    version: 1,
    adapter: 'vitest-node',
    book: browser.book,
    testFile: 'packages/query-core/src/__tests__/subscribable.test.tsx',
    testHash: 'a'.repeat(64),
    source: {
      path: 'packages/query-core/src/subscribable.ts',
      hash: browser.source.hash,
      line: 10,
      column: 1,
    },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
  }
  // Act
  const result = nodeTestConfigSchema.parse(input)
  // Assert
  assert.equal(result.adapter, 'vitest-node')
  assert.equal(
    result.testFile,
    'packages/query-core/src/__tests__/subscribable.test.tsx',
  )
  assert.equal(result.inspections[0]?.path, 'listener')
})

test('a Node test request cannot execute a shell command or read a test outside the repository', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration
  const base = {
    version: 1,
    adapter: 'vitest-node',
    book: browser.book,
    testFile: 'src/value.test.ts',
    testHash: 'a'.repeat(64),
    source: browser.source,
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
  }
  // Act / Assert
  for (const testFile of [
    '/tmp/value.test.ts',
    '../value.test.ts',
    'src/../value.test.ts',
    'src/value.ts',
    'src/value.test.ts\nrm -rf /',
  ]) {
    assert.equal(
      nodeTestConfigSchema.safeParse({ ...base, testFile }).success,
      false,
    )
  }
  assert.equal(
    nodeTestConfigSchema.safeParse({ ...base, command: 'sh -c anything' })
      .success,
    false,
  )
  assert.equal(
    nodeTestConfigSchema.safeParse({ ...base, adapter: 'shell' }).success,
    false,
  )
  assert.equal(
    nodeTestConfigSchema.safeParse({
      ...base,
      testName: 'a\n--inspect=0.0.0.0',
    }).success,
    false,
  )
})

test('a Node test file path cannot be passed to Vitest as a command-line option', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration
  const base = {
    version: 1,
    adapter: 'vitest-node',
    book: browser.book,
    testHash: 'a'.repeat(64),
    source: browser.source,
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
  }
  // Act / Assert
  for (const testFile of [
    '--config=./value.test.ts',
    '-r/value.test.ts',
    '--reporter=./value.spec.js',
  ]) {
    assert.equal(
      nodeTestConfigSchema.safeParse({ ...base, testFile }).success,
      false,
      testFile,
    )
  }
  assert.equal(
    nodeTestConfigSchema.safeParse({
      ...base,
      testFile: 'src/--config=value.test.ts',
    }).success,
    true,
    'an option-like name deeper in the path is still an ordinary file filter',
  )
})

test('a Node test cites its test by the enclosing describe titles followed by the test title', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration
  const base = {
    version: 1,
    adapter: 'vitest-node',
    book: browser.book,
    testFile: 'app/lib/data.test.ts',
    testHash: 'a'.repeat(64),
    source: browser.source,
    inspections: [{ path: 'invoice', mode: 'value', required: true }],
  }
  // Act
  const result = nodeTestConfigSchema.parse({
    ...base,
    testTitles: [
      'invoice data queries',
      'converts stored invoice cents to dollars for the edit form',
    ],
  })
  // Assert
  assert.deepEqual(result.testTitles, [
    'invoice data queries',
    'converts stored invoice cents to dollars for the edit form',
  ])
  assert.equal(
    nodeTestConfigSchema.safeParse({ ...base, testTitles: [] }).success,
    false,
    'an empty title path names no test',
  )
  assert.equal(
    nodeTestConfigSchema.safeParse({
      ...base,
      testTitles: ['invoice data queries', 'converts\n--inspect=0.0.0.0'],
    }).success,
    false,
  )
  assert.equal(
    nodeTestConfigSchema.safeParse({
      ...base,
      testTitles: Array.from({ length: 17 }, () => 'nested'),
    }).success,
    false,
  )
  assert.equal(
    nodeTestConfigSchema.safeParse({
      ...base,
      testTitles: ['adds'],
      testName: 'adds',
    }).success,
    false,
    'one citation cannot name its test twice',
  )
})

test('a saved Node history that named its test with the retired testName still parses', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration
  const saved = {
    version: 1,
    adapter: 'vitest-node',
    book: browser.book,
    testFile: 'app/lib/data.test.ts',
    testHash: 'a'.repeat(64),
    source: browser.source,
    inspections: [{ path: 'invoice', mode: 'value', required: true }],
    testName: 'converts stored invoice cents to dollars for the edit form',
  }
  // Act
  const result = nodeTestConfigSchema.safeParse(saved)
  // Assert
  assert.equal(result.success, true)
})

test('a Node test stop requires a captured runtime value', () => {
  // Arrange
  const browser = createConfiguredStudy().configuration
  const base = {
    version: 1,
    adapter: 'vitest-node',
    book: browser.book,
    testFile: 'src/value.test.ts',
    testHash: 'a'.repeat(64),
    source: browser.source,
    inspections: [{ path: 'nextTheme', mode: 'type', required: true }],
  }
  // Act / Assert
  assert.equal(nodeTestConfigSchema.safeParse(base).success, false)
  assert.equal(
    nodeTestConfigSchema.safeParse({
      ...base,
      inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
    }).success,
    true,
  )
})
