import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapPregateTests } from '../utils/mapPregateTests.mjs'
import {
  combinedSummary,
  planPregateRuns,
  runSummaryLine,
} from '../utils/planPregateRuns.mjs'

// Value: protects=the pre-gate's local lane when it selects product tests together with the package tests, which rebuild extension/dist while they run; fails_when=both are passed to one node --test call, so product tests fail to load their modules from dist (906 of 5,725 failed on Cycle 0048's branch), or the script tests run with more than four at a time; why_new=Cycle 0048 task 32 (found while the pre-gate ran on PR #106); seam=none; no_claim=the run itself, which run-pregate-tests.mjs makes from this plan
test('the pre-gate runs the selected product tests first, then the script tests four at a time, in two calls', () => {
  // Arrange
  const files = [
    '/repo/extension/scripts/tests/package.test.mjs',
    '/repo/extension/dist/tests/wikiUpdateFlow.test.js',
    '/repo/.codex/restore-product-context.test.mjs',
    '/repo/extension/dist/tests/utils/within.test.js',
  ]

  // Act
  const runs = planPregateRuns(files)

  // Assert
  assert.deepEqual(runs, [
    {
      files: [
        '/repo/extension/dist/tests/wikiUpdateFlow.test.js',
        '/repo/extension/dist/tests/utils/within.test.js',
      ],
      args: [],
    },
    {
      files: [
        '/repo/extension/scripts/tests/package.test.mjs',
        '/repo/.codex/restore-product-context.test.mjs',
      ],
      args: ['--test-concurrency=4'],
    },
  ])
})

// Value: protects=the count of the pre-gate's lane, which it takes from the first summary line of the output; fails_when=a run's own summary line keeps its form, so the pre-gate counts only the first run, or the combined summary leaves a run out; why_new=Cycle 0048 task 32; seam=none; no_claim=the runner's own summary format, which is node:test's spec reporter as this repository runs it
test('the pre-gate reads one summary that adds up both runs, as each run’s own summary is marked as the run’s', () => {
  // Arrange
  const outputs = [
    '✔ a (1ms)\nℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 12.5',
    '✖ b (2ms)\nℹ tests 3\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 30',
  ]

  // Act
  const marked = outputs[0].split('\n').map(runSummaryLine)
  const summary = combinedSummary(outputs)

  // Assert
  assert.deepEqual(marked, [
    '✔ a (1ms)',
    'ℹ run tests 2',
    'ℹ run suites 0',
    'ℹ run pass 2',
    'ℹ run fail 0',
    'ℹ run cancelled 0',
    'ℹ run skipped 0',
    'ℹ run todo 0',
    'ℹ run duration_ms 12.5',
  ])
  assert.deepEqual(summary, [
    'ℹ tests 5',
    'ℹ pass 3',
    'ℹ fail 1',
    'ℹ cancelled 0',
    'ℹ skipped 1',
    'ℹ todo 0',
  ])
})

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
