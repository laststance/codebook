import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapPregateTests } from '../utils/mapPregateTests.mjs'

// Value: protects=the pre-gate's local lane, which runs the extension's TypeScript tests as the JavaScript the build writes; fails_when=a selected TypeScript test is passed to node as its .ts source (every test of it fails to load, as when the pre-gate ran `bun test` on them) or lands outside dist/tests, also for a test in a subfolder; no_claim=the build itself, which the runner script starts before it maps
test('the pre-gate runs a selected TypeScript test of the extension as the JavaScript the build wrote for it, also in a subfolder', () => {
  // Arrange
  const selected = [
    'extension/src/tests/wikiUpdateFlow.test.ts',
    'extension/src/tests/utils/within.test.ts',
  ]

  // Act
  const files = mapPregateTests('/repo', selected)

  // Assert
  assert.deepEqual(files, [
    '/repo/extension/dist/tests/wikiUpdateFlow.test.js',
    '/repo/extension/dist/tests/utils/within.test.js',
  ])
})

// Value: protects=the script tests and the compaction hook's test, which are JavaScript already; fails_when=the runner looks for them under dist or drops them; no_claim=none beyond protects
test('the pre-gate runs a selected script test and the compaction hook test as they are', () => {
  // Arrange
  const selected = [
    'extension/scripts/tests/testShards.test.mjs',
    '.codex/restore-product-context.test.mjs',
  ]

  // Act
  const files = mapPregateTests('/repo', selected)

  // Assert
  assert.deepEqual(files, [
    '/repo/extension/scripts/tests/testShards.test.mjs',
    '/repo/.codex/restore-product-context.test.mjs',
  ])
})

// Value: protects=a pre-gate selection that this runner cannot run, which must stop the lane with the file's name; fails_when=such a file is passed on, so node reports a load error or the lane counts fewer tests than were selected; no_claim=which files the pre-gate selects, which its import graph decides
test('the pre-gate runner refuses a selected file that is no test it can run, and names it', () => {
  // Arrange
  const selected = ['extension/src/extension.ts']

  // Act
  const map = () => mapPregateTests('/repo', selected)

  // Assert
  assert.throws(map, {
    message:
      'The pre-gate selected extension/src/extension.ts, which is no test this runner runs (TypeScript tests under extension/src/tests/, script tests under extension/scripts/tests/, or .codex/*.test.mjs).',
  })
})
