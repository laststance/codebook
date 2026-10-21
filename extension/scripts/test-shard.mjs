// Runs one balanced share of the compiled extension tests, or records the timings that balance them.
//
//   node scripts/test-shard.mjs --shard 3/8 --lanes 2   one CI job's share
//   node scripts/test-shard.mjs                         the whole suite on this machine
//   node scripts/test-shard.mjs --shard 3/8 --lanes 2 --list   print that share's plan without running it
//   node scripts/test-shard.mjs --record                run every file and rewrite test-timings.json; a test or hook that takes longer than the silence limit, or a run that sends nothing for it, fails the recording
//   node scripts/test-shard.mjs --whole-split-files     run the files the plan splits, whole and with Node's default exit; with none split it says so and passes
//   --record takes no --whole-split-files, --list, --shard or --lanes: a recording runs every file and ignores them, so the pair is refused
//   --silence-seconds 120                               end a call that prints nothing for this long (at most 2147483)
//
// Build first (`pnpm build` or `pnpm build:fast`); this script only reads dist/tests.
import { readdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { buildTestTimings } from './utils/buildTestTimings.mjs'
import { collectTestRun } from './utils/collectTestRun.mjs'
import { parseSilenceSeconds } from './utils/parseSilenceSeconds.mjs'
import { planTestShards } from './utils/planTestShards.mjs'
import { planWholeSplitFiles } from './utils/planWholeSplitFiles.mjs'
import { readRunSummary } from './utils/readRunSummary.mjs'
import { readTestTimings } from './utils/readTestTimings.mjs'
import { runTestInvocation } from './utils/runTestInvocation.mjs'
import {
  CALL_SILENCE_TIMEOUT_MS,
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

/** Refuses `--record` beside an option that a recording ignores, so the recording never wins silently over what the caller asked for (and a `--list` never rewrites the timings). Called by {@link readOptions}. @example refuseOptionsARecordingIgnores({ record: true, list: true }) // throws '--record runs every file and rewrites the timings; leave out --list.' */
function refuseOptionsARecordingIgnores(values) {
  if (!values.record) return
  const ignored = ['whole-split-files', 'list', 'shard', 'lanes'].find(
    (name) => values[name],
  )
  if (ignored)
    throw new Error(
      `--record runs every file and rewrites the timings; leave out --${ignored}.`,
    )
}

/** Reads the command line of this script. @example readOptions() // => { shard: 2, shards: 8, lanes: 2, list: false, record: false, wholeSplitFiles: false, silenceSeconds: 120 } */
function readOptions() {
  const { values } = parseArgs({
    options: {
      // No defaults for the two options a recording ignores: a given one is what the refusal below reads.
      shard: { type: 'string' },
      lanes: { type: 'string' },
      list: { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
      'whole-split-files': { type: 'boolean', default: false },
      'silence-seconds': {
        type: 'string',
        default: String(CALL_SILENCE_TIMEOUT_MS / 1000),
      },
    },
  })
  refuseOptionsARecordingIgnores(values)
  const silenceSeconds = parseSilenceSeconds(values['silence-seconds'])
  const lanes = Number(values.lanes ?? availableParallelism())
  if (!(Number.isInteger(lanes) && lanes >= 1))
    throw new Error('--lanes must be a positive integer.')
  return {
    ...parseShard(values.shard ?? '1/1'),
    lanes,
    list: values.list,
    record: values.record,
    wholeSplitFiles: values['whole-split-files'],
    silenceSeconds,
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

/** Says in one sentence what in a recording did not end, or `undefined` when everything ended: a test that did not end within the limit, a hook that did not end (the runner failed the hook's tests for its time), or a run that sent nothing for the limit, with the files that started and did not end. @example describeUnendedRecording({ timedOutTests: [{ file: 'a.test.js', name: 'opens' }], hookTimedOutTests: [], stall: undefined }, 120) // => 'a.test.js: "opens" did not end within 120 s and was ended; timings were not recorded.' */
function describeUnendedRecording(
  { timedOutTests, hookTimedOutTests, stall },
  silenceSeconds,
) {
  const [hung] = timedOutTests
  if (hung)
    return `${hung.file}: ${JSON.stringify(hung.name)} did not end within ${silenceSeconds} s and was ended; timings were not recorded.`
  const [hungHook] = hookTimedOutTests
  if (hungHook)
    return `${hungHook.file}: a hook of ${JSON.stringify(hungHook.name)} did not end within ${silenceSeconds} s and was ended; timings were not recorded.`
  if (stall)
    return `the run sent nothing for ${silenceSeconds} s and was ended; ${stall.files.length > 0 ? `${stall.files.join(', ')} started and did not end` : 'no file was running'}; timings were not recorded.`
  return undefined
}

/** Runs every test file once and rewrites the timings file from the observed durations; refuses to record a failing run, and ends a test or a hook that does not end within `silenceSeconds`, and a run that sends nothing for that long, with every process of the run. @example await recordTimings(files, 120) */
async function recordTimings(files, silenceSeconds) {
  const recording = await collectTestRun({
    files: files.map((file) => join(testDirectory, file)),
    concurrency: TIMING_RECORD_CONCURRENCY,
    testTimeoutMs: silenceSeconds * 1000,
  })
  const { results } = recording
  const unended = describeUnendedRecording(recording, silenceSeconds)
  if (unended) throw new Error(unended)
  const failed = results.filter((result) => result.failed).length
  if (failed > 0)
    throw new Error(`${failed} tests failed; timings were not recorded.`)
  await writeFile(
    timingsPath,
    `${JSON.stringify(buildTestTimings(results), null, 2)}\n`,
  )
  console.log(`Recorded ${results.length} tests in ${TEST_TIMINGS_FILE}.`)
}

/** Reads the number of tests a `node --test` call reports in its last summary block; a line a test printed in that form, or a summary the runner died before, counts none ({@link readRunSummary}). @example countTests('ℹ tests 12\nℹ pass 12\nℹ fail 0') // => 12 */
function countTests(output) {
  return readRunSummary(output)?.tests ?? 0
}

/** Names a planned call in one line of the log. @example callLabel({ files: ['a.test.js', 'b.test.js'] }) // => '2 files' */
function callLabel(invocation) {
  return invocation.files.length === 1
    ? invocation.files[0]
    : `${invocation.files.length} files`
}

/** Names a planned call with its files and, for a part, the note that a test name selects it. @example callFiles({ files: ['a.test.js'], namePattern: '/^(?:x)$/' }) // => 'a.test.js (a part selected by test name)' */
function callFiles(invocation) {
  return `${invocation.files.join(', ')}${invocation.namePattern || invocation.skipPattern ? ' (a part selected by test name)' : ''}`
}

/** Writes the one line that says why a call failed: ended for its silence, a failing exit code, or no test counted (a runner that died before its summary, however it exited). Writes nothing for a call that passed. @example reportFailedCall(invocation, result, 0, 120) */
function reportFailedCall(invocation, result, tests, silenceSeconds) {
  if (result.timedOut)
    console.error(
      `✖ ${callFiles(invocation)} printed nothing for ${silenceSeconds} s and was ended; the test after the last one printed above did not end.`,
    )
  else if (result.code !== 0)
    console.error(
      `✖ ${invocation.files.join(', ')} ended with exit code ${result.code} (signal ${result.signal}).`,
    )
  else if (tests === 0)
    console.error(
      `✖ ${callFiles(invocation)} ran no test: its output counts none, so the runner may have ended before its summary.`,
    )
}

/** Runs one planned call and prints its report with the planned duration beside the measured one, which shows when the timings file needs a new recording; a call that printed nothing for `silenceSeconds` is ended and named, and a call that counted no test fails. @example await runCall({ files: ['a.test.js'], ms: 300 }, 120) // => { tests: 4, failed: false } */
async function runCall(invocation, silenceSeconds) {
  const result = await runTestInvocation(invocation, testDirectory, {
    silenceTimeoutMs: silenceSeconds * 1000,
  })
  const tests = countTests(result.output)
  process.stdout.write(
    `${result.output}▶ ${callLabel(invocation)}: ${tests} tests, ${(result.elapsedMs / 1000).toFixed(1)} s (planned ${(invocation.ms / 1000).toFixed(1)} s)\n`,
  )
  // A call ended for its silence fails whatever the runner exits with after the SIGTERM: a runner that winds down with 0 must not turn a hung test into a pass.
  // A call that counted no test ran nothing it was planned for (its plan names files), so it must not pass either.
  const failed = result.timedOut || result.code !== 0 || tests === 0
  if (failed) reportFailedCall(invocation, result, tests, silenceSeconds)
  return { tests, failed }
}

/** Runs the lanes of one shard side by side and each lane's calls in order. @example await runLanes(plan[0], 120) // => { tests: 201, failedCalls: 0 } */
async function runLanes(lanes, silenceSeconds) {
  const outcomes = await Promise.all(
    lanes.map(async (lane) => {
      const calls = []
      for (const invocation of lane)
        calls.push(await runCall(invocation, silenceSeconds))
      return calls
    }),
  )
  const calls = outcomes.flat()
  return {
    tests: calls.reduce((sum, call) => sum + call.tests, 0),
    failedCalls: calls.filter((call) => call.failed).length,
  }
}

/** Reads the command line and checks the options that depend on each other; a refusal is one line for the reader, not a stack trace of this script, and ends the script with code 1. @example readCheckedOptions() // => { shard: 1, shards: 1, lanes: 2, list: false, record: false, wholeSplitFiles: false, silenceSeconds: 120 } */
function readCheckedOptions() {
  try {
    const checked = readOptions()
    if (checked.wholeSplitFiles && checked.shards !== 1)
      throw new Error(
        '--whole-split-files runs on one runner; leave out --shard.',
      )
    return checked
  } catch (error) {
    console.error(`✖ ${error.message}`)
    process.exit(1)
  }
}

const options = readCheckedOptions()
const files = await readTestFiles()
if (options.record) {
  await recordTimings(files, options.silenceSeconds)
} else {
  // A refusal is one line for the reader, not a stack trace of this script.
  const timings = await readTestTimings(timingsPath).catch((error) => {
    console.error(`✖ ${error.message}`)
    process.exit(1)
  })
  const lanes = options.wholeSplitFiles
    ? planWholeSplitFiles({ files, timings, lanes: options.lanes })
    : planTestShards({ files, timings, ...options })[options.shard - 1]
  if (options.list) {
    console.log(JSON.stringify(lanes, null, 2))
  } else if (options.wholeSplitFiles && lanes.flat().length === 0) {
    // The job runs the files the shards split, whole. With none split there is nothing to run and nothing failed, so it says so and passes; "0 tests in 0 calls" would read as a run that counted nothing.
    console.log('No test file is split, so no file runs whole.')
  } else {
    const startedAt = performance.now()
    const { tests, failedCalls } = await runLanes(lanes, options.silenceSeconds)
    // No shard is involved in a run of the split files; the line says what ran.
    const runName = options.wholeSplitFiles
      ? 'Split files whole'
      : `Shard ${options.shard}/${options.shards}`
    console.log(
      `${runName}: ${tests} tests in ${lanes.flat().length} calls on ${options.lanes} lanes, ${Math.round((performance.now() - startedAt) / 1000)} s, ${failedCalls} failed calls.`,
    )
    if (failedCalls > 0) process.exitCode = 1
  }
}
