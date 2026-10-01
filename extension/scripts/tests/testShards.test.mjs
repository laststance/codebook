import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildTestTimings } from '../utils/buildTestTimings.mjs'
import { planTestShards } from '../utils/planTestShards.mjs'
import { runTestInvocation } from '../utils/runTestInvocation.mjs'

/** Tells whether `node --test` would run a test of this name in the given planned call, following its documented name and skip pattern rules. @example runsTest({ files: ['a.test.js'], skipPattern: '/^(?:x)$/' }, 'y') // => true */
function runsTest(invocation, name) {
  const matches = (literal) => new RegExp(literal.slice(1, -1)).test(name)
  if (invocation.skipPattern && matches(invocation.skipPattern)) return false
  return invocation.namePattern ? matches(invocation.namePattern) : true
}

/** Counts how many planned calls of all shards would run one test of one file. @example timesRun(plan, 'a.test.js', 'opens') // => 1 */
function timesRun(plan, file, name) {
  return plan
    .flat(2)
    .filter(
      (invocation) =>
        invocation.files.includes(file) && runsTest(invocation, name),
    ).length
}

test('every test of a slow file runs in exactly one call, including a test the timings do not know', () => {
  // Arrange
  const timings = {
    files: {
      'slow.test.js': {
        totalMs: 25_000,
        tests: {
          'waits for the deadline': 9_000,
          'opens the reader': 6_000,
          'closes the reader': 5_000,
          'keeps the draft': 3_000,
          'restores focus': 2_000,
        },
      },
      'quick.test.js': { totalMs: 300 },
    },
  }

  // Act
  const plan = planTestShards({
    files: ['quick.test.js', 'slow.test.js'],
    timings,
    shards: 3,
    lanes: 2,
  })

  // Assert
  const runsPerTest = [
    'waits for the deadline',
    'opens the reader',
    'closes the reader',
    'keeps the draft',
    'restores focus',
    'a test added after the recording',
  ].map((name) => timesRun(plan, 'slow.test.js', name))
  assert.deepEqual(runsPerTest, [1, 1, 1, 1, 1, 1])
  assert.equal(timesRun(plan, 'quick.test.js', 'any test of a whole file'), 1)
})

test('a test name with regular-expression characters is run only by the part that names it', () => {
  // Arrange
  const timings = {
    files: {
      'names.test.js': {
        totalMs: 18_000,
        tests: {
          'refuses a (b) [c] {d} 1+1 /x/ $5 ^ a.b | c?': 9_000,
          'refuses a (b) [c] {d} 1+1 /x/ $5 ^ a.b | c? twice': 9_000,
        },
      },
    },
  }

  // Act
  const plan = planTestShards({
    files: ['names.test.js'],
    timings,
    shards: 2,
    lanes: 1,
  })

  // Assert
  assert.equal(
    timesRun(
      plan,
      'names.test.js',
      'refuses a (b) [c] {d} 1+1 /x/ $5 ^ a.b | c?',
    ),
    1,
  )
  assert.equal(
    timesRun(
      plan,
      'names.test.js',
      'refuses a (b) [c] {d} 1+1 /x/ $5 ^ a.b | c? twice',
    ),
    1,
  )
  // A longer or shorter name is another test and belongs to the complement part.
  assert.equal(timesRun(plan, 'names.test.js', 'refuses a (b)'), 1)
})

test('a test file the timings do not know still runs in exactly one call', () => {
  // Arrange
  const timings = { files: { 'known.test.js': { totalMs: 2_000 } } }

  // Act
  const plan = planTestShards({
    files: ['known.test.js', 'added.test.js'],
    timings,
    shards: 4,
    lanes: 2,
  })

  // Assert
  assert.equal(timesRun(plan, 'added.test.js', 'any test'), 1)
  assert.equal(timesRun(plan, 'known.test.js', 'any test'), 1)
})

test('a slow file is spread over the lanes so that every lane of every shard takes the same planned time', () => {
  // Arrange
  const timings = {
    files: {
      'slow.test.js': {
        totalMs: 32_000,
        tests: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name) => [name, 4_000]),
        ),
      },
      'w.test.js': { totalMs: 1_000 },
      'x.test.js': { totalMs: 1_000 },
      'y.test.js': { totalMs: 1_000 },
      'z.test.js': { totalMs: 1_000 },
    },
  }

  // Act
  const plan = planTestShards({
    files: Object.keys(timings.files),
    timings,
    shards: 2,
    lanes: 2,
  })

  // Assert: four parts of two tests (8,000 ms plus 500 ms per call) and one quick file (1,000 ms plus 400 ms) per lane.
  const plannedLaneMs = plan.flatMap((shard) =>
    shard.map((lane) => lane.reduce((sum, call) => sum + call.ms, 0)),
  )
  assert.deepEqual(plannedLaneMs, [9_900, 9_900, 9_900, 9_900])
})

test('every shard computes the same plan whatever order the test files are listed in', () => {
  // Arrange
  const timings = {
    files: {
      'a.test.js': { totalMs: 3_000 },
      'b.test.js': { totalMs: 3_000 },
      'c.test.js': { totalMs: 3_000 },
    },
  }

  // Act
  const sorted = planTestShards({
    files: ['a.test.js', 'b.test.js', 'c.test.js'],
    timings,
    shards: 2,
    lanes: 1,
  })
  const reversed = planTestShards({
    files: ['c.test.js', 'b.test.js', 'a.test.js'],
    timings,
    shards: 2,
    lanes: 1,
  })

  // Assert
  assert.deepEqual(reversed, sorted)
  assert.deepEqual(sorted, [
    [[{ files: ['a.test.js', 'c.test.js'], ms: 6_800 }]],
    [[{ files: ['b.test.js'], ms: 3_400 }]],
  ])
})

test('a recording keeps per-test durations only for a file slow enough to split and adds up tests that share a name', () => {
  // Arrange
  const results = [
    { file: 'slow.test.js', name: 'waits', ms: 5_000.4 },
    { file: 'slow.test.js', name: 'waits', ms: 4_000.2 },
    { file: 'slow.test.js', name: 'opens', ms: 12.3 },
    { file: 'quick.test.js', name: 'opens', ms: 20.6 },
  ]

  // Act
  const timings = buildTestTimings(results)

  // Assert
  assert.deepEqual(timings, {
    files: {
      'quick.test.js': { totalMs: 21 },
      'slow.test.js': { totalMs: 9_013, tests: { opens: 12, waits: 9_001 } },
    },
  })
})

test('a part of a split file ends with its selected test and does not wait for a timer another test would leave', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-test-shard-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'sample.test.js'),
    [
      "const { test } = require('node:test')",
      "test('selected', () => { setTimeout(() => {}, 60_000) })",
      "test('other', () => { throw new Error('must not run') })",
    ].join('\n'),
  )

  // Act
  const result = await runTestInvocation(
    { files: ['sample.test.js'], namePattern: '/^(?:selected)$/' },
    directory,
  )

  // Assert
  assert.equal(result.code, 0)
  assert.match(result.output, /^ℹ tests 1$/m)
  assert.match(result.output, /^ℹ pass 1$/m)
  assert.equal(result.elapsedMs < 30_000, true)
})

test('a failing test makes its call end with a failure exit code and names the test in the output', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-test-shard-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'failing.test.js'),
    [
      "const { test } = require('node:test')",
      "test('reports the refusal', () => { throw new Error('refused') })",
    ].join('\n'),
  )

  // Act
  const result = await runTestInvocation(
    { files: ['failing.test.js'] },
    directory,
  )

  // Assert
  assert.equal(result.code, 1)
  assert.match(result.output, /✖ reports the refusal/)
})
