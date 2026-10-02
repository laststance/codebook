// Runs one balanced share of the compiled extension tests, or records the timings that balance them.
//
//   node scripts/test-shard.mjs --shard 3/8 --lanes 2   one CI job's share
//   node scripts/test-shard.mjs                         the whole suite on this machine
//   node scripts/test-shard.mjs --shard 3/8 --lanes 2 --list   print that share's plan without running it
//   node scripts/test-shard.mjs --record                run every file and rewrite test-timings.json
//
// Build first (`pnpm build` or `pnpm build:fast`); this script only reads dist/tests.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { basename, join } from 'node:path'
import { run } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { buildTestTimings } from './utils/buildTestTimings.mjs'
import { planTestShards } from './utils/planTestShards.mjs'
import { runTestInvocation } from './utils/runTestInvocation.mjs'
import {
  TEST_TIMINGS_FILE,
  TIMING_RECORD_CONCURRENCY,
} from './utils/testShardConstants.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const testDirectory = join(extension, 'dist/tests')
const timingsPath = join(extension, TEST_TIMINGS_FILE)

/** Reads `index/total` and refuses a share that does not exist, which would silently run nothing. @example parseShard('3/8') // => { shard: 3, shards: 8 } */
function parseShard(text) {
  const [, index, total] = /^(\d+)\/(\d+)$/.exec(text) ?? []
  const shard = Number(index),
    shards = Number(total)
  if (!(shard >= 1 && shard <= shards))
    throw new Error('--shard must be index/total with 1 <= index <= total.')
  return { shard, shards }
}

/** Reads the command line of this script. @example readOptions() // => { shard: 2, shards: 8, lanes: 2, list: false, record: false } */
function readOptions() {
  const { values } = parseArgs({
    options: {
      shard: { type: 'string', default: '1/1' },
      lanes: { type: 'string', default: String(availableParallelism()) },
      list: { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
    },
  })
  const lanes = Number(values.lanes)
  if (!(Number.isInteger(lanes) && lanes >= 1))
    throw new Error('--lanes must be a positive integer.')
  return {
    ...parseShard(values.shard),
    lanes,
    list: values.list,
    record: values.record,
  }
}

/** Lists the compiled test files; an empty list means the build is missing and must not pass as "0 tests". @example await readTestFiles() // => ['citation.test.js', …] */
async function readTestFiles() {
  const files = (await readdir(testDirectory).catch(() => []))
    .filter((file) => file.endsWith('.test.js'))
    .toSorted()
  if (files.length === 0)
    throw new Error(`No compiled test files in ${testDirectory}; build first.`)
  return files
}

/** Reads one finished top-level test from a runner event; a nested test belongs to its top-level test, which is the unit a name pattern can select. @example finishedTest(event) // => { file: 'service.test.js', name: 'opens', ms: 12.4, failed: false } */
function finishedTest(event) {
  if (event.type !== 'test:pass' && event.type !== 'test:fail') return undefined
  if (event.data.nesting !== 0) return undefined
  return {
    file: basename(event.data.file),
    name: event.data.name,
    ms: event.data.details.duration_ms,
    failed: event.type === 'test:fail',
  }
}

/** Runs every test file once and rewrites the timings file from the observed durations; refuses to record a failing run. @example await recordTimings(files) */
async function recordTimings(files) {
  const results = []
  const events = run({
    files: files.map((file) => join(testDirectory, file)),
    concurrency: TIMING_RECORD_CONCURRENCY,
  })
  for await (const event of events) {
    const finished = finishedTest(event)
    if (finished) results.push(finished)
  }
  const failed = results.filter((result) => result.failed).length
  if (failed > 0)
    throw new Error(`${failed} tests failed; timings were not recorded.`)
  await writeFile(
    timingsPath,
    `${JSON.stringify(buildTestTimings(results), null, 2)}\n`,
  )
  console.log(`Recorded ${results.length} tests in ${TEST_TIMINGS_FILE}.`)
}

/** Reads the number of tests a `node --test` call reports in its summary. @example countTests('ℹ tests 12\nℹ pass 12') // => 12 */
function countTests(output) {
  const summary = /^ℹ tests (\d+)$/m.exec(output)
  return summary ? Number(summary[1]) : 0
}

/** Names a planned call in one line of the log. @example callLabel({ files: ['a.test.js', 'b.test.js'] }) // => '2 files' */
function callLabel(invocation) {
  return invocation.files.length === 1
    ? invocation.files[0]
    : `${invocation.files.length} files`
}

/** Runs one planned call and prints its report with the planned duration beside the measured one, which shows when the timings file needs a new recording. @example await runCall({ files: ['a.test.js'], ms: 300 }) // => { tests: 4, failed: false } */
async function runCall(invocation) {
  const result = await runTestInvocation(invocation, testDirectory)
  const tests = countTests(result.output)
  process.stdout.write(
    `${result.output}▶ ${callLabel(invocation)}: ${tests} tests, ${(result.elapsedMs / 1000).toFixed(1)} s (planned ${(invocation.ms / 1000).toFixed(1)} s)\n`,
  )
  const failed = result.code !== 0
  if (failed)
    console.error(
      `✖ ${invocation.files.join(', ')} ended with exit code ${result.code} (signal ${result.signal}).`,
    )
  return { tests, failed }
}

/** Runs the lanes of one shard side by side and each lane's calls in order. @example await runLanes(plan[0]) // => { tests: 201, failedCalls: 0 } */
async function runLanes(lanes) {
  const outcomes = await Promise.all(
    lanes.map(async (lane) => {
      const calls = []
      for (const invocation of lane) calls.push(await runCall(invocation))
      return calls
    }),
  )
  const calls = outcomes.flat()
  return {
    tests: calls.reduce((sum, call) => sum + call.tests, 0),
    failedCalls: calls.filter((call) => call.failed).length,
  }
}

const options = readOptions()
const files = await readTestFiles()
if (options.record) {
  await recordTimings(files)
} else {
  const timings = JSON.parse(await readFile(timingsPath, 'utf8'))
  const lanes = planTestShards({ files, timings, ...options })[
    options.shard - 1
  ]
  if (options.list) {
    console.log(JSON.stringify(lanes, null, 2))
  } else {
    const startedAt = performance.now()
    const { tests, failedCalls } = await runLanes(lanes)
    console.log(
      `Shard ${options.shard}/${options.shards}: ${tests} tests in ${lanes.flat().length} calls on ${options.lanes} lanes, ${Math.round((performance.now() - startedAt) / 1000)} s, ${failedCalls} failed calls.`,
    )
    if (failedCalls > 0) process.exitCode = 1
  }
}
