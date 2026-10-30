import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildTestTimings } from '../utils/buildTestTimings.mjs'
import { describeFailedRecording } from '../utils/describeFailedRecording.mjs'
import { describeUnendedRecording } from '../utils/describeUnendedRecording.mjs'
import { endProcessTree } from '../utils/endProcessTree.mjs'
import { killProcessIds } from '../utils/killProcessIds.mjs'
import { listProcessIdsUnder } from '../utils/listProcessIdsUnder.mjs'
import { parseSilenceSeconds } from '../utils/parseSilenceSeconds.mjs'
import { plainOutputEnvironment } from '../utils/plainOutputEnvironment.mjs'
import { planCallEnd } from '../utils/planCallEnd.mjs'
import { planTestShards } from '../utils/planTestShards.mjs'
import { readProcessStates } from '../utils/readProcessStates.mjs'
import { readProcessTable } from '../utils/readProcessTable.mjs'
import { readRunSummary } from '../utils/readRunSummary.mjs'
import { readTestTimings } from '../utils/readTestTimings.mjs'
import { runTestInvocation } from '../utils/runTestInvocation.mjs'
import { takeEndStep } from '../utils/takeEndStep.mjs'

import { endProcesses, endProcessesAfter } from './utils/endProcessesAfter.mjs'

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

/** Writes a timings file with the given entries, reads it back with {@link readTestTimings} (so each entry is one the reader accepts) and plans `files` on one shard with one lane. @example await planFromTimingsFile(context, { 'a.test.js': { totalMs: 12 } }, ['a.test.js']) */
async function planFromTimingsFile(context, entries, files) {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-timings-plan-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const timingsPath = join(folder, 'test-timings.json')
  await writeFile(timingsPath, JSON.stringify({ files: entries }))
  const timings = await readTestTimings(timingsPath)
  return planTestShards({ files, timings, shards: 1, lanes: 1 })
}

// Value: protects=the shard plan for a recorded file whose tests add up to 0 ms: the reader accepts it, so the planner plans it (the whole file, at its recorded total) and does not throw a TypeError for a part it has none to fill; fails_when=a split file whose recorded tests are all 0 reaches the planner's packing with 0 parts; why_new=Cycle 0048 task 156 (OCR B: { totalMs: 9000, tests: { a: 0, b: 0 } } threw a raw TypeError); seam=readTestTimings with planTestShards; no_claim=the order or time balance of other files
test('a recorded file whose tests all took 0 ms is planned as one whole file at its recorded total, and the plan does not throw', async (context) => {
  // Arrange
  const entries = {
    'zero.test.js': { totalMs: 9_000, tests: { a: 0, b: 0 } },
  }

  // Act
  const plan = await planFromTimingsFile(context, entries, ['zero.test.js'])

  // Assert
  assert.deepEqual(plan, [[[{ files: ['zero.test.js'], ms: 9_400 }]]])
})

// Value: protects=the shard plan for the other recorded entries the reader accepts and the planner could divide by or count to 0 or Infinity: no tests recorded, a total of 0, a total that is slow with `tests: {}`, and tests whose durations add up past what a number holds; each file is planned and every test of the large one still runs once; fails_when=the part count is 0, NaN or Infinity (a RangeError for an array of that length, or a TypeError from packing into no part); why_new=Cycle 0048 task 156 (every count or division of the planner a valid entry can make 0 or Infinity); seam=readTestTimings with planTestShards; no_claim=the shard or lane count, which test-shard.mjs checks
test('every other entry the timings reader accepts is planned too, including tests whose durations add up past what a number holds', async (context) => {
  // Arrange
  const entries = {
    'huge.test.js': { totalMs: 9_000, tests: { a: 1e308, b: 1e308 } },
    'none.test.js': { totalMs: 0 },
    'empty.test.js': { totalMs: 12_000, tests: {} },
    'one.test.js': { totalMs: 9_000, tests: { only: 9_000 } },
  }

  // Act
  const plan = await planFromTimingsFile(context, entries, Object.keys(entries))

  // Assert
  assert.deepEqual(plan, [
    [
      [
        {
          files: ['empty.test.js', 'none.test.js', 'one.test.js'],
          ms: 12_400 + 400 + 9_400,
        },
        {
          files: ['huge.test.js'],
          ms: 1e308,
          skipPattern: '/^(?:b)$/',
        },
        {
          files: ['huge.test.js'],
          ms: 1e308,
          namePattern: '/^(?:b)$/',
        },
      ],
    ],
  ])
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

test('jobs whose runners sort text differently still give two equally slow tests of a split file to the same parts', () => {
  // Arrange: a locale-aware comparison puts "apple" first, code-unit order puts "Zebra" first.
  const timings = {
    files: {
      'tie.test.js': {
        totalMs: 18_000,
        tests: { apple: 9_000, Zebra: 9_000 },
      },
    },
  }

  // Act
  const plan = planTestShards({
    files: ['tie.test.js'],
    timings,
    shards: 2,
    lanes: 1,
  })

  // Assert: "Zebra" is always the complement part, in whatever locale the job runs.
  assert.deepEqual(plan, [
    [[{ files: ['tie.test.js'], ms: 9_500, skipPattern: '/^(?:apple)$/' }]],
    [[{ files: ['tie.test.js'], ms: 9_500, namePattern: '/^(?:apple)$/' }]],
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
  // A caller's FORCE_COLOR reaches the child run, which then wraps its summary lines in colour codes; the summary is read without them.
  const summary = result.output.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'),
    '',
  )
  assert.equal(result.code, 0)
  assert.match(summary, /^ℹ tests 1$/m)
  assert.match(summary, /^ℹ pass 1$/m)
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

const scriptsDirectory = fileURLToPath(new URL('../', import.meta.url))

/** Source of a compiled test file whose tests only note their file and name in `executed.log` beside it, so a test can read which tests a real `node --test` call ran. @example loggingTestSource(['opens']) // => "const { test } = require('node:test') …" */
function loggingTestSource(names, extra = '') {
  return [
    "const { appendFileSync } = require('node:fs')",
    "const { basename, join } = require('node:path')",
    "const { test } = require('node:test')",
    'const note = (name) => appendFileSync(join(__dirname, "executed.log"), `${basename(__filename)}::${name}\\n`)',
    ...names.map(
      (name) =>
        `test(${JSON.stringify(name)}, () => note(${JSON.stringify(name)}))`,
    ),
    extra,
  ].join('\n')
}

/** Lays out a copy of the shard script and its helpers beside a `dist/tests` of fixture test files and a timings file, so the script can be started as a process without touching the real build. @example await createFixtureExtension(context, { tests: { 'a.test.js': '…' }, timings: { files: {} } }) // => '/tmp/codebook-test-shard-…' */
async function createFixtureExtension(context, { tests, timings }) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-test-shard-script-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'dist/tests'), { recursive: true })
  await cp(join(scriptsDirectory, 'utils'), join(root, 'scripts/utils'), {
    recursive: true,
  })
  await copyFile(
    join(scriptsDirectory, 'test-shard.mjs'),
    join(root, 'scripts/test-shard.mjs'),
  )
  for (const [file, source] of Object.entries(tests))
    await writeFile(join(root, 'dist/tests', file), source)
  if (timings !== undefined)
    await writeFile(
      join(root, 'test-timings.json'),
      typeof timings === 'string' ? timings : JSON.stringify(timings),
    )
  return root
}

/**
 * Makes the fixture's copy of {@link runTestInvocation} start a stand-in script instead of `node --test`, so the shard script (which has no option for it) can be run against a runner that ends at once, prints no summary or winds down with exit code 0 after a SIGTERM. The product code has no seam for this; the fixture's own copy of the file is the seam.
 * @param root - The fixture extension made by {@link createFixtureExtension}.
 * @param source - The source of the stand-in script (CommonJS).
 * @example
 * await useStandInRunner(root, "console.log('started')")
 */
async function useStandInRunner(root, source) {
  const standInPath = join(root, 'stand-in-runner.cjs')
  await writeFile(standInPath, source)
  const utilities = join(root, 'scripts/utils')
  await rename(
    join(utilities, 'runTestInvocation.mjs'),
    join(utilities, 'runTestInvocationOfNode.mjs'),
  )
  await writeFile(
    join(utilities, 'runTestInvocation.mjs'),
    [
      "import { runTestInvocation as runWithNode } from './runTestInvocationOfNode.mjs'",
      'export const runTestInvocation = (invocation, directory, options) =>',
      `  runWithNode(invocation, directory, { ...options, runnerArguments: [${JSON.stringify(standInPath)}] })`,
    ].join('\n'),
  )
}

/** Starts the fixture's shard script and collects its exit code and both streams; `extraEnvironment` adds variables to the script's own (for example `FORCE_COLOR`); a script that outlives `timeoutMs` is ended, which shows as `signal`. @example await runShardScript(root, ['--shard', '1/1', '--lanes', '1']) // => { code: 0, signal: null, stdout: '…', stderr: '' } */
function runShardScript(root, args, timeoutMs = 60_000, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, 'scripts/test-shard.mjs'), ...args],
      {
        cwd: root,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              // An outer NO_COLOR beside the child's FORCE_COLOR makes Node warn on stderr; the child gets none.
              ([name]) => name !== 'NODE_TEST_CONTEXT' && name !== 'NO_COLOR',
            ),
          ),
          ...extraEnvironment,
        },
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    )
  })
}

/** Reads the sorted `file::name` lines that a fixture's tests noted, or none when no test ran. @example await readExecuted(root) // => ['a.test.js::opens'] */
async function readExecuted(root) {
  const text = await readFile(
    join(root, 'dist/tests/executed.log'),
    'utf8',
  ).catch(() => '')
  return text.split('\n').filter(Boolean).toSorted()
}

// Value: protects=the shard job's time limit and its log: a test that never ends is named after a short silence and not after the job's 10-minute timeout with nothing shown; fails_when=a call that prints nothing is left running until its test ends or the job is cancelled; why_new=Cycle 0048 task 25 (test guide, 2026-10-02: no per-call timeout); seam=runTestInvocation with a short silence limit and a real `node --test` child; no_claim=what limit CI uses (CALL_SILENCE_TIMEOUT_MS)
test('a call whose test does not end is ended after its silence limit and reports that it was ended', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-test-shard-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'hanging.test.js'),
    [
      "const { test } = require('node:test')",
      "test('finishes first', () => {})",
      "test('never ends', () => new Promise((resolve) => setTimeout(resolve, 15_000)))",
    ].join('\n'),
  )

  // Act
  const result = await runTestInvocation(
    { files: ['hanging.test.js'] },
    directory,
    { silenceTimeoutMs: 5_000 },
  )

  // Assert
  assert.equal(result.timedOut, true)
  // gstack-timing-ok: the bound is the contract: the call ends by its 5 s silence limit, not by the 15 s the hanging test takes or the 120 s default. The 5 s is also the time the first test has to start and print inside the call, so a slow start-up of 4 s does not drop its line; the 12 s bound sits 3 s below the hanging test's own end.
  assert.equal(result.elapsedMs < 12_000, true)
  assert.match(result.output, /✔ finishes first/)
})

/**
 * Writes a stand-in for `node --test` into a fresh folder: a script that notes each SIGTERM it gets in `sigterms.log` beside it, prints a line at its start and at each SIGTERM, and then does what `afterSigterm` says. The real runner ends within milliseconds of a SIGTERM, so only a stand-in can stay alive long enough to show what the caller does with a runner that prints after its SIGTERM or ignores it. Called by the tests of {@link runTestInvocation}'s silence handling.
 * @param context - The running test, whose end removes the folder.
 * @param afterSigterm - Source of the SIGTERM handler's last statement: `setTimeout(() => process.exit(0), 4_000)` to end late, or `` to stay alive.
 * @returns `{ runnerPath, sigtermCount, hasStarted }`: the script to pass as `runnerArguments`, a function that reads how many SIGTERMs it got, and a function that tells whether the script has started (its SIGTERM handler is installed then).
 * @example
 * const { runnerPath, sigtermCount } = await writeStandInRunner(context, '')
 */
async function writeStandInRunner(context, afterSigterm) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-stand-in-runner-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const runnerPath = join(directory, 'runner.cjs')
  await writeFile(
    runnerPath,
    [
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const marks = join(__dirname, 'sigterms.log')",
      "require('node:fs').writeFileSync(join(__dirname, 'started.log'), 'started')",
      "process.on('SIGTERM', () => {",
      "  appendFileSync(marks, 'SIGTERM\\n')",
      "  console.log('winding down')",
      `  ${afterSigterm}`,
      '})',
      "console.log('started')",
      'setInterval(() => {}, 1_000)',
    ].join('\n'),
  )
  const sigtermCount = async () =>
    (await readFile(join(directory, 'sigterms.log'), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean).length
  const hasStarted = async () =>
    (await readFile(join(directory, 'started.log'), 'utf8').catch(() => '')) ===
    'started'
  return { runnerPath, sigtermCount, hasStarted }
}

/**
 * Runs {@link runTestInvocation} in a fresh Node process that runs nothing else, and answers what the call returned and how many timers that process held once the call had ended. A fresh process makes the timer count the call's own: another test's timer that ends in the meantime cannot change it, as it could change a count of the timers of the test process.
 * Called by the tests of {@link runTestInvocation}'s timers.
 * @param context - The running test, whose end removes the folder of the small script that makes the call.
 * @param options - `{ silenceTimeoutMs, killGraceMs?, runnerArguments?, execPath?, platform?, systemRoot?, settleMs? }`: the options of the call, a path to set as `process.execPath` before the call (a path that is no program makes the spawn fail), a value to set as `process.platform` (the call then plans the end of a silent runner for that system), a folder to set as the `SystemRoot` variable (where the call looks for `System32/taskkill.exe` when `platform` is `win32`), and how long to wait after the call before the timers and handlers are counted (0 by default; a call ended by a program it started needs a moment for that program to exit).
 * @returns `{ result, rejectionCode, timersLeft, handlersLeft }`: the call's `{ timedOut, code, signal, output }` or `undefined` when it was rejected, the rejection's `code`, the timers the process held after the call minus the timers before it, and the number of SIGINT, SIGTERM and SIGHUP listeners the process held after the call (`{ SIGINT: 0, SIGTERM: 0, SIGHUP: 0 }` once the call has ended and released its end).
 * @throws When the helper process printed no JSON result (it crashed or was ended), with its exit code, signal, output and error output in the message.
 * @example
 * const { timersLeft } = await runCallInFreshProcess(context, { silenceTimeoutMs: 2_500, runnerArguments: [runnerPath] })
 */
async function runCallInFreshProcess(context, options) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-fresh-call-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const scriptPath = join(directory, 'call.mjs')
  await writeFile(
    scriptPath,
    [
      "import { tmpdir } from 'node:os'",
      `import { runTestInvocation } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/runTestInvocation.mjs')).href)}`,
      'const { execPath, platform, systemRoot, settleMs = 0, ...callOptions } = JSON.parse(process.argv[2])',
      "const countTimers = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length",
      'if (execPath) process.execPath = execPath',
      "if (platform) Object.defineProperty(process, 'platform', { value: platform })",
      'if (systemRoot !== undefined) process.env.SystemRoot = systemRoot',
      'const timersBefore = countTimers()',
      'let rejectionCode',
      'const result = await runTestInvocation({ files: [] }, tmpdir(), callOptions).catch((error) => { rejectionCode = error.code })',
      // A program the call started to end it (the `taskkill` stand-in) holds a time limit of its own until it has exited, a moment after the call's runner; the timers of the call are counted after this wait.
      'await new Promise((resolve) => setTimeout(resolve, settleMs))',
      "const handlersLeft = { SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM'), SIGHUP: process.listenerCount('SIGHUP') }",
      'console.log(JSON.stringify({ result, rejectionCode, timersLeft: countTimers() - timersBefore, handlersLeft }))',
    ].join('\n'),
  )
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath, JSON.stringify(options)],
      { timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      // A helper that crashed or printed nothing must fail the test with what it did, not with a JSON error from inside this handler.
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(
          new Error(
            `The call helper printed no result (exit code ${code}, signal ${signal}). Output: ${JSON.stringify(stdout)}. Error output: ${JSON.stringify(stderr)}`,
          ),
        )
      }
    })
  })
}

// Value: protects=the runner that is slow to end after its SIGTERM and prints while it winds down: it gets one SIGTERM, not one more for each line it prints, and no kill timer is left to hold the shard process; fails_when=output after the silence SIGTERM starts the fired silence timer again, so the call gets a second SIGTERM and a second kill timer that replaces the first, whose timer then runs on after the call has ended; why_new=Cycle 0048 task 44 (CodeRabbit, OCR B), made independent of load and of other tests by task 59; seam=runTestInvocation in a fresh process with a stand-in runner script (`runnerArguments`) that prints at its SIGTERM and ends 4 s later, a 2.5 s silence limit that leaves room for the stand-in to start and a 10 s grace that a loaded machine does not reach; no_claim=what the real Node runner does (it ends within milliseconds of SIGTERM)
test('a call that prints while it winds down after the silence SIGTERM gets one SIGTERM and leaves no timer behind', async (context) => {
  // Arrange
  const { runnerPath, sigtermCount } = await writeStandInRunner(
    context,
    'setTimeout(() => process.exit(0), 4_000)',
  )

  // Act
  const { result, timersLeft } = await runCallInFreshProcess(context, {
    silenceTimeoutMs: 2_500,
    killGraceMs: 10_000,
    runnerArguments: [runnerPath],
  })

  // Assert
  assert.deepEqual(
    {
      timedOut: result.timedOut,
      code: result.code,
      sigterms: await sigtermCount(),
      printedWhileWindingDown: /winding down/.test(result.output),
      timersLeft,
    },
    {
      timedOut: true,
      code: 0,
      sigterms: 1,
      printedWhileWindingDown: true,
      timersLeft: 0,
    },
  )
})

// Value: protects=the caller of a call whose process cannot be started: the promise is rejected and the silence timer is stopped, so the shard process does not wait out the silence limit (120 s) with nothing to wait for; fails_when=the error handler only rejects and the silence timer runs on; why_new=Cycle 0048 task 44 (CodeRabbit, OCR B), made independent of other tests' timers by task 59; seam=runTestInvocation in a fresh process with `process.execPath` set to a path that is no program, so the spawn fails with ENOENT; no_claim=which code a spawn failure carries on other systems
test('a call whose process cannot be started is rejected and leaves no silence timer running', async (context) => {
  // Arrange
  const options = {
    silenceTimeoutMs: 30_000,
    execPath: join(tmpdir(), 'codebook-no-such-node-program'),
  }

  // Act
  const { rejectionCode, timersLeft } = await runCallInFreshProcess(
    context,
    options,
  )

  // Assert
  assert.deepEqual(
    { rejectionCode, timersLeft },
    { rejectionCode: 'ENOENT', timersLeft: 0 },
  )
})

// Value: protects=the shard job's time limit against a runner that ignores SIGTERM: it is killed once the grace has passed, and the call reports that it was ended; fails_when=the SIGKILL after the grace is missing or never armed, so the call waits for a runner that never ends, or it comes at once with the SIGTERM; why_new=Cycle 0048 task 47 (Testing), made independent of load by task 59; seam=runTestInvocation with a stand-in runner script that ignores SIGTERM, a 2.5 s silence limit that leaves room for the stand-in to start and a 2 s grace passed through the options; no_claim=the 5 s default grace
test('a call that ignores the silence SIGTERM is killed once the grace has passed', async (context) => {
  // Arrange
  const { runnerPath, sigtermCount } = await writeStandInRunner(context, '')

  // Act
  const result = await runTestInvocation({ files: [] }, tmpdir(), {
    silenceTimeoutMs: 2_500,
    killGraceMs: 2_000,
    runnerArguments: [runnerPath],
  })

  // Assert
  assert.deepEqual(
    {
      timedOut: result.timedOut,
      code: result.code,
      signal: result.signal,
      sigterms: await sigtermCount(),
      // gstack-timing-ok: the outcome (one SIGTERM, then SIGKILL) is asserted above; the time only tells a kill after the 2 s grace from one that came with the SIGTERM. A timer never fires early, so the 4.5 s of limit and grace only grows under load; a kill with the SIGTERM would end the call at about 2.5 s, so 3.5 s leaves 1 s on each side, and the upper bound is far below the stand-in's endless life and the 120 s default.
      killedAfterTheGrace:
        result.elapsedMs >= 3_500 && result.elapsedMs < 20_000,
    },
    {
      timedOut: true,
      code: null,
      signal: 'SIGKILL',
      sigterms: 1,
      killedAfterTheGrace: true,
    },
  )
})

// Value: protects=the shard script's report of a hung call: the file is named and the job fails fast with the output so far; fails_when=the script waits for the hung test, or ends the call without naming its file; why_new=Cycle 0048 task 25 (test guide, 2026-10-02); seam=test-shard.mjs started as a process on a fixture build; no_claim=the default limit
test('the shard script ends a silent call, names its file and fails the shard', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: {
      'hanging.test.js': [
        "const { test } = require('node:test')",
        "test('finishes first', () => {})",
        "test('never ends', () => new Promise((resolve) => setTimeout(resolve, 15_000)))",
      ].join('\n'),
    },
    timings: { files: { 'hanging.test.js': { totalMs: 100 } } },
  })

  // Act
  const result = await runShardScript(
    root,
    // gstack-timing-ok: the hanging test never ends in time, so the 6 s limit is the contract that ends the call. It is also the time `finishes first` has to print after the call's spawn (start-up and module load included); the 25 s process limit leaves 19 s above the limit for a loaded start-up.
    ['--shard', '1/1', '--lanes', '1', '--silence-seconds', '6'],
    25_000,
  )

  // Assert
  assert.equal(result.code, 1)
  assert.match(result.stdout, /✔ finishes first/)
  assert.match(
    result.stderr,
    /✖ hanging\.test\.js printed nothing for 6 s and was ended/,
  )
})

// Value: protects=the refusal a person reads when the timings file is gone or damaged; fails_when=the script shows a raw read or parse error without naming the file and `test:shard --record`; why_new=Cycle 0048 task 29 (test guide, 2026-10-02); seam=test-shard.mjs started as a process on a fixture build; no_claim=--record itself
test('a missing, unreadable-as-JSON or wrongly shaped timings file is refused with its name and the way to record it again', async (context) => {
  // Arrange
  const tests = { 'a.test.js': loggingTestSource(['opens']) }
  const missing = await createFixtureExtension(context, { tests })
  const malformed = await createFixtureExtension(context, {
    tests,
    timings: '{"files": ',
  })
  const wrongShape = await createFixtureExtension(context, {
    tests,
    timings: { totals: {} },
  })

  // Act
  const refusals = []
  for (const root of [missing, malformed, wrongShape])
    refusals.push(
      await runShardScript(root, ['--shard', '1/1', '--lanes', '1']),
    )

  // Assert
  for (const refusal of refusals) {
    assert.equal(refusal.code, 1)
    assert.match(refusal.stderr, /test-timings\.json/)
    assert.match(refusal.stderr, /pnpm --dir extension test:shard --record/)
    assert.doesNotMatch(refusal.stderr, /SyntaxError|TypeError|\n\s+at /)
  }
})

// Value: protects=the reader and the memory of the shard script from a shard total or a lane count the planner cannot make bins for: one line `✖ …` with exit code 1 before any plan, where `--shard 1/100000000000000000000` ended in `RangeError: Invalid array length` and a count in the billions would run the planner out of memory; fails_when=the total or the count is accepted at any size (CI uses 14 shards and 2 lanes, and no real use reaches 1,000); why_new=Cycle 0048 task 165 (fixer S, task 156: the parent's probe printed the RangeError at planTestShards.mjs:12); seam=test-shard.mjs --list started as a process on a fixture build, once per refused option and once for the largest accepted ones; no_claim=the plan itself (planTestShards' tests)
test('the shard script refuses a shard total or a lane count above 1000 in one line before any plan, and accepts 1000', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'a.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'a.test.js': { totalMs: 10 } } },
  })

  // Act
  const hugeTotal = await runShardScript(root, [
    '--shard',
    '1/100000000000000000000',
    '--list',
  ])
  const totalAboveBound = await runShardScript(root, [
    '--shard',
    '1/1001',
    '--list',
  ])
  const hugeLanes = await runShardScript(root, [
    '--lanes',
    '100000000000000000000',
    '--list',
  ])
  const lanesAboveBound = await runShardScript(root, [
    '--lanes',
    '1001',
    '--list',
  ])
  const atTheBound = await runShardScript(root, [
    '--shard',
    '1/1000',
    '--lanes',
    '1',
    '--list',
  ])

  // Assert
  assert.deepEqual(
    [hugeTotal, totalAboveBound, hugeLanes, lanesAboveBound].map(
      ({ code, stdout, stderr }) => ({ code, stdout, stderr }),
    ),
    [
      {
        code: 1,
        stdout: '',
        stderr: '✖ --shard total must be at most 1000.\n',
      },
      {
        code: 1,
        stdout: '',
        stderr: '✖ --shard total must be at most 1000.\n',
      },
      { code: 1, stdout: '', stderr: '✖ --lanes must be at most 1000.\n' },
      { code: 1, stdout: '', stderr: '✖ --lanes must be at most 1000.\n' },
    ],
  )
  assert.deepEqual(
    { code: atTheBound.code, stderr: atTheBound.stderr },
    { code: 0, stderr: '' },
  )
})

// Value: protects=the shard script on a machine with more than 1,000 hardware threads: the default lane count is its thread count capped at the bound, so a run with no `--lanes` is not refused as `--lanes must be at most 1000.`, an option the caller did not give; a `--lanes` the caller gives above the bound is still refused (the test above); fails_when=the default is `availableParallelism()` as it is, so a machine that reports 1,001 threads is refused before any plan; why_new=Cycle 0048 task 184 (OCR B: the default lane count was refused by the bound it did not choose); seam=test-shard.mjs --shard 1/1 --list started as a process on a fixture build, with a module loaded first (`--import` through NODE_OPTIONS) that makes os.availableParallelism() answer 1001; no_claim=what a real machine of that size does (the plan of 1,000 lanes is what the script reports for the answer 1001)
test('the shard script plans 1000 lanes, and does not refuse the default, on a machine that reports 1001 hardware threads', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'a.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'a.test.js': { totalMs: 10 } } },
  })
  const machineOf1001Threads = join(root, 'machine-of-1001-threads.mjs')
  await writeFile(
    machineOf1001Threads,
    [
      "import { createRequire, syncBuiltinESMExports } from 'node:module'",
      "const os = createRequire(import.meta.url)('node:os')",
      'os.availableParallelism = () => 1001',
      // The script's named import of availableParallelism reads the synced export.
      'syncBuiltinESMExports()',
    ].join('\n'),
  )

  // Act
  const result = await runShardScript(
    root,
    ['--shard', '1/1', '--list'],
    60_000,
    { NODE_OPTIONS: `--import=${pathToFileURL(machineOf1001Threads).href}` },
  )

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      stderr: result.stderr,
      laneCount: JSON.parse(result.stdout || '[]').length,
    },
    { code: 0, stderr: '', laneCount: 1000 },
  )
})

// Value: protects=the reader of a shard job whose build is missing: the refusal "No compiled test files in <dir>; build first." is one line `✖ …` with exit code 1 and no stack frame, in every mode of the script, like its option and timings refusals; fails_when=the refusal is thrown uncaught, so stderr holds the source line, `Error: …`, `at …` frames and the Node version, in any mode; why_new=Cycle 0048 task 166 (the parent: the same class as the recording's refusals, task 108's rule); seam=test-shard.mjs started as a process on a fixture whose dist/tests is empty, and on one whose dist/tests is missing, once per mode; no_claim=a build that exists but holds no test of the plan
test('the shard script refuses a missing build in one line, with exit code 1, in every mode', async (context) => {
  // Arrange
  const emptyBuild = await createFixtureExtension(context, {
    tests: {},
    timings: { files: {} },
  })
  const missingBuild = await createFixtureExtension(context, {
    tests: {},
    timings: { files: {} },
  })
  await rm(join(missingBuild, 'dist'), { recursive: true, force: true })
  const modes = [
    ['--shard', '1/1', '--lanes', '1'],
    ['--whole-split-files'],
    ['--list'],
    ['--record'],
  ]

  // Act
  const refusals = []
  for (const root of [emptyBuild, missingBuild])
    for (const args of modes) refusals.push(await runShardScript(root, args))

  // Assert
  assert.deepEqual(
    refusals.map(({ code, stdout, stderr }) => ({
      code,
      stdout,
      stderr:
        /^✖ No compiled test files in .*dist[/\\]tests; build first\.\n$/.test(
          stderr,
        )
          ? 'one line'
          : stderr,
    })),
    Array(8).fill({ code: 1, stdout: '', stderr: 'one line' }),
  )
})

// Value: protects=the shard job from a silence limit that is no number above 0 and from a whole-split-files run that names a shard; fails_when=the checks are dropped, so `--silence-seconds soon` or `0` ends every call at once as hung (a timer of NaN or 0 ms fires first) and the job fails with no reason, or `--whole-split-files --shard 2/3` runs the split files on a runner that was meant to run a share of the suite; why_new=the tests of this file cover the timings refusal and the silent call, not the refusals of these two options; seam=test-shard.mjs started as a process on a fixture build; no_claim=the options in a workflow, which workflowPins.test.mjs reads
test('the shard script refuses a silence limit that is no number above 0 and a whole-split-files run that names a shard, and runs no test', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'a.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'a.test.js': { totalMs: 10 } } },
  })

  // Act
  const zeroSeconds = await runShardScript(root, [
    '--shard',
    '1/1',
    '--lanes',
    '1',
    '--silence-seconds',
    '0',
  ])
  const wordForSeconds = await runShardScript(root, [
    '--shard',
    '1/1',
    '--lanes',
    '1',
    '--silence-seconds',
    'soon',
  ])
  const wholeFilesWithAShard = await runShardScript(root, [
    '--shard',
    '2/3',
    '--lanes',
    '1',
    '--whole-split-files',
  ])

  // Assert
  assert.deepEqual(
    [zeroSeconds, wordForSeconds, wholeFilesWithAShard].map(
      ({ code, stderr }) => ({
        code,
        refusal: /✖ (--[a-z-]+ [^\n]*)/.exec(stderr)?.[1],
      }),
    ),
    [
      { code: 1, refusal: '--silence-seconds must be a number above 0.' },
      { code: 1, refusal: '--silence-seconds must be a number above 0.' },
      {
        code: 1,
        refusal: '--whole-split-files runs on one runner; leave out --shard.',
      },
    ],
  )
  assert.deepEqual(await readExecuted(root), [])
})

// Value: protects=the reader of a refused option: every option refusal of test-shard.mjs is one line `✖ <message>` with exit code 1, like its timings refusal, and not the script's stack trace; fails_when=a refusal is thrown uncaught, so stderr holds the source line, `Error: …`, `at …` frames and the Node version; why_new=Cycle 0048 task 108 (QA capture 006); seam=test-shard.mjs started as a process on a fixture build, one call per refused option; no_claim=the refusals of a missing build and a failed recording, which are no option
test('the shard script writes each refused option as one line and nothing else, with exit code 1', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'a.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'a.test.js': { totalMs: 10 } } },
  })
  const refusedCalls = [
    ['--shard', '4/3'],
    ['--shard', 'second'],
    ['--lanes', '0'],
    ['--silence-seconds', 'soon'],
    ['--shard', '2/3', '--whole-split-files'],
  ]

  // Act
  const refusals = []
  for (const args of refusedCalls)
    refusals.push(await runShardScript(root, args))
  const unknownOption = await runShardScript(root, ['--unknown-option'])

  // Assert
  assert.deepEqual(
    refusals.map(({ code, stdout, stderr }) => ({ code, stdout, stderr })),
    [
      {
        code: 1,
        stdout: '',
        stderr: '✖ --shard must be index/total with 1 <= index <= total.\n',
      },
      {
        code: 1,
        stdout: '',
        stderr: '✖ --shard must be index/total with 1 <= index <= total.\n',
      },
      {
        code: 1,
        stdout: '',
        stderr: '✖ --lanes must be a positive integer.\n',
      },
      {
        code: 1,
        stdout: '',
        stderr: '✖ --silence-seconds must be a number above 0.\n',
      },
      {
        code: 1,
        stdout: '',
        stderr:
          '✖ --whole-split-files runs on one runner; leave out --shard.\n',
      },
    ],
  )
  // Node words the refusal of an unknown option itself, so the test reads its start and its one line only.
  assert.equal(unknownOption.code, 1)
  assert.match(
    unknownOption.stderr,
    /^✖ Unknown option '--unknown-option'[^\n]*\n$/,
  )
})

// Value: protects=the shard job on a machine whose environment sets FORCE_COLOR (a CI runner, a terminal wrapper): the spec reporter then colours its summary lines also on a pipe (`ESC[34mℹ tests 1ESC[39m`), so the count read 0 and task 74's rule failed every call as one that ran no test; fails_when=the call starts `node --test` with FORCE_COLOR still in its environment, so the summary line does not match the count; why_new=Cycle 0048 task 109 (Red Team); seam=test-shard.mjs started as a process on a fixture build with FORCE_COLOR=1 and a real `node --test` call; no_claim=other colour variables of other tools
test('the shard script counts the tests of a call and passes when FORCE_COLOR is set in its environment', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'a.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'a.test.js': { totalMs: 10 } } },
  })

  // Act
  const result = await runShardScript(
    root,
    ['--shard', '1/1', '--lanes', '1'],
    60_000,
    { FORCE_COLOR: '1' },
  )

  // Assert
  assert.equal(result.code, 0)
  assert.equal(result.stderr, '')
  assert.match(
    result.stdout,
    /Shard 1\/1: 1 tests in 1 calls on 1 lanes, \d+ s, 0 failed calls\./,
  )
})

// Value: protects=a run of the pre-gate or a shard call that holds a test which starts a child with FORCE_COLOR: Node warns on stderr when NO_COLOR is also set ("The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set"), so that test's empty-stderr claim failed inside the pre-gate's own run; fails_when=plainOutputEnvironment sets NO_COLOR again, so a nested FORCE_COLOR child prints the warning; why_new=Cycle 0048 task 116 (NO_COLOR beside FORCE_COLOR); seam=plainOutputEnvironment's result as the environment of a real node process that also sets FORCE_COLOR; plainOutputEnvironment's result for an environment that holds the caller's own NO_COLOR (Cycle 0048 task 118: its docstring says it stays, and no test pinned it); no_claim=what Node does with a NO_COLOR beside a FORCE_COLOR the caller set itself
test('the plain output environment leaves a nested child that sets FORCE_COLOR without a NO_COLOR warning', () => {
  // Arrange
  const plainEnvironment = plainOutputEnvironment({
    FORCE_COLOR: '1',
    PATH: process.env.PATH ?? '',
  })

  // Act
  const child = spawnSync(process.execPath, ['-e', 'console.log(1)'], {
    encoding: 'utf8',
    env: { ...plainEnvironment, FORCE_COLOR: '1' },
  })

  const callerOwnNoColor = plainOutputEnvironment({
    FORCE_COLOR: '1',
    NO_COLOR: '1',
    PATH: '/usr/bin',
  })

  // Assert
  assert.deepEqual(Object.keys(plainEnvironment), ['PATH'])
  assert.equal(child.stderr, '')
  assert.equal(child.status, 0)
  // A NO_COLOR the caller set stays; only FORCE_COLOR is taken out.
  assert.deepEqual(callerOwnNoColor, { NO_COLOR: '1', PATH: '/usr/bin' })
})

// Value: protects=the shard job's result: a failed call must fail the job; fails_when=test-shard.mjs ends with exit code 0 although a call failed, or prints no failure line; why_new=Cycle 0048 task 27 (test guide, 2026-10-02: the script's own exit code had no test); seam=test-shard.mjs started as a process on a fixture build; no_claim=a failed call in one of several lanes or shards, and a call that fails for its silence or counts no test (their own tests)
test('the shard script exits 1 and reports the failed call when a test fails, and 0 when every test passes', async (context) => {
  // Arrange
  const failing = await createFixtureExtension(context, {
    tests: {
      'failing.test.js': [
        "const { test } = require('node:test')",
        "test('reports the refusal', () => { throw new Error('refused') })",
      ].join('\n'),
    },
    timings: { files: { 'failing.test.js': { totalMs: 100 } } },
  })
  const passing = await createFixtureExtension(context, {
    tests: { 'passing.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'passing.test.js': { totalMs: 100 } } },
  })

  // Act
  const failed = await runShardScript(failing, [
    '--shard',
    '1/1',
    '--lanes',
    '1',
  ])
  const passed = await runShardScript(passing, [
    '--shard',
    '1/1',
    '--lanes',
    '1',
  ])

  // Assert
  assert.equal(failed.code, 1)
  assert.match(failed.stdout, /✖ reports the refusal/)
  assert.match(
    failed.stdout,
    /Shard 1\/1: 1 tests in 1 calls on 1 lanes, \d+ s, 1 failed calls\./,
  )
  assert.match(failed.stderr, /✖ failing\.test\.js ended with exit code 1/)
  assert.equal(passed.code, 0)
  assert.match(passed.stdout, /0 failed calls\./)
})

// Value: protects=the shard job from a call whose runner cannot start (a spawn error: E2BIG for a long name pattern, EAGAIN, ENOMEM): it fails as a call in one line that names the error, counts among the failed calls, its lane goes on to its next call and the other lane finishes; fails_when=the rejection of runTestInvocation reaches the lanes' Promise.all, so the script ends with a stack trace and no last line while the other lane's call runs on with no end; why_new=Cycle 0048 task 204 (native adversarial: a spawn error rejected Promise.all); seam=test-shard.mjs started as a process on a fixture build of three files and two lanes (one lane: `tail.test.js`, then a part of the split file; the other: `other.test.js`, then the split file's other part), with a module loaded first (`--import` through NODE_OPTIONS, only in the script's process) that makes child_process.spawn start a program that does not exist (a real ENOENT error event) for the call that names `tail.test.js`; no_claim=which spawn error a machine under load raises (E2BIG, EAGAIN and ENOMEM reach the same error event as ENOENT)
test('the shard script fails a call whose runner cannot start in one line, runs the next call of its lane and lets the other lane finish', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: {
      'tail.test.js': loggingTestSource(['never runs']),
      'other.test.js': loggingTestSource(['runs in the other lane']),
      'split.test.js': loggingTestSource(['first part', 'second part']),
    },
    // The planner gives tail.test.js and then the part without 'second part' to one lane, other.test.js and then the part 'second part' to the other.
    timings: {
      files: {
        'split.test.js': {
          totalMs: 20_000,
          tests: { 'first part': 10_000, 'second part': 10_000 },
        },
        'tail.test.js': { totalMs: 100 },
        'other.test.js': { totalMs: 50 },
      },
    },
  })
  const spawnThatFailsOneCall = join(root, 'spawn-that-fails-one-call.mjs')
  await writeFile(
    spawnThatFailsOneCall,
    [
      "import { createRequire, syncBuiltinESMExports } from 'node:module'",
      "const childProcess = createRequire(import.meta.url)('node:child_process')",
      // Only the shard script's own process changes spawn; the runners it starts load this module too and must keep theirs.
      "if (process.argv[1].endsWith('test-shard.mjs')) {",
      '  const realSpawn = childProcess.spawn',
      '  childProcess.spawn = (command, args, options) =>',
      "    args.some((argument) => argument.endsWith('tail.test.js'))",
      "      ? realSpawn('codebook-no-such-program', [], options)",
      '      : realSpawn(command, args, options)',
      // The runner's named import of spawn reads the synced export.
      '  syncBuiltinESMExports()',
      '}',
    ].join('\n'),
  )

  // Act
  const result = await runShardScript(
    root,
    ['--shard', '1/1', '--lanes', '2'],
    60_000,
    { NODE_OPTIONS: `--import=${pathToFileURL(spawnThatFailsOneCall).href}` },
  )

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      stderr: result.stderr,
      lastLine: result.stdout
        .trimEnd()
        .split('\n')
        .at(-1)
        .replace(/ \d+ s,/, ' N s,'),
      executed: await readExecuted(root),
    },
    {
      code: 1,
      stderr:
        '✖ tail.test.js could not start: spawn codebook-no-such-program ENOENT.\n',
      lastLine:
        'Shard 1/1: 3 tests in 4 calls on 2 lanes, N s, 1 failed calls.',
      executed: [
        'other.test.js::runs in the other lane',
        'split.test.js::first part',
        'split.test.js::second part',
      ],
    },
  )
})

// Value: protects=the claim that the shards together run the suite exactly once; fails_when=the planned patterns, sent through Node's own name selection, run a test twice or not at all (a name with regular-expression characters, a name that is the start of another, a quote, a backslash, non-ASCII text, or a test the timings do not know); why_new=Cycle 0048 tasks 26 and 27 (test guide, 2026-10-02: the planner's tests used their own regular expression, and nothing compared the shards' test names with the suite's); seam=planTestShards plus runTestInvocation on a fixture build, every shard of two layouts; no_claim=the 3,000 tests of the product suite, whose names are not enumerable without running them
test('every test of a split file and of a whole file runs exactly once across all shards when the planned patterns go through the real runner', async (context) => {
  // Arrange
  const splitNames = [
    'refuses a (b) [c] {d} 1+1 /x/ $5 ^ a.b | c?',
    'refuses a (b) [c] {d} 1+1 /x/ $5 ^ a.b | c? twice',
    'refuses a (b)',
    'ünïcode ✓ name',
    'quote\'s "double" and back\\slash',
    'a/b',
    'plain',
  ]
  const unknownName = 'added after the recording'
  const root = await createFixtureExtension(context, {
    tests: {
      'split.test.js': loggingTestSource([...splitNames, unknownName]),
      'whole.test.js': loggingTestSource(['whole one', 'whole two']),
    },
    timings: {},
  })
  const timings = {
    files: {
      'split.test.js': {
        totalMs: 28_000,
        tests: Object.fromEntries(splitNames.map((name) => [name, 4_000])),
      },
      'whole.test.js': { totalMs: 100 },
    },
  }
  const expected = [
    ...[...splitNames, unknownName].map((name) => `split.test.js::${name}`),
    'whole.test.js::whole one',
    'whole.test.js::whole two',
  ].toSorted()

  // Act
  const executedPerLayout = []
  for (const layout of [
    { shards: 3, lanes: 2 },
    { shards: 5, lanes: 1 },
  ]) {
    await rm(join(root, 'dist/tests/executed.log'), { force: true })
    const plan = planTestShards({
      files: ['split.test.js', 'whole.test.js'],
      timings,
      ...layout,
    })
    const exitCodes = []
    for (const invocation of plan.flat(2))
      exitCodes.push(
        (await runTestInvocation(invocation, join(root, 'dist/tests'))).code,
      )
    executedPerLayout.push({ exitCodes, executed: await readExecuted(root) })
  }

  // Assert
  for (const { exitCodes, executed } of executedPerLayout) {
    assert.equal(
      exitCodes.every((code) => code === 0),
      true,
    )
    assert.deepEqual(executed, expected)
  }
})

// Value: protects=the errors a split file raises after its last test, which the parts hide by ending with their last selected test; fails_when=no run of the split files keeps Node's default exit, so a late rejection or a leaked handle goes unreported on CI; why_new=Cycle 0048 task 26 (test guide, 2026-10-02: no job ran the split files without --test-force-exit); seam=test-shard.mjs --whole-split-files on a fixture build; no_claim=that CI runs it for pull requests (the workflow runs it after a push to main)
test('running the split files whole reports an error raised after their last test and runs only the split files', async (context) => {
  // Arrange
  const lateFailure = `test('leaves a late failure', () => { setTimeout(() => { throw new Error('late boom') }, 500) })`
  const root = await createFixtureExtension(context, {
    tests: {
      'late.test.js': loggingTestSource(['first'], lateFailure),
      'quick.test.js': loggingTestSource(['quick one']),
    },
    timings: {
      files: {
        'late.test.js': {
          totalMs: 18_000,
          tests: { first: 9_000, 'leaves a late failure': 9_000 },
        },
        'quick.test.js': { totalMs: 100 },
      },
    },
  })

  // Act
  const result = await runShardScript(root, [
    '--whole-split-files',
    '--lanes',
    '1',
  ])

  // Assert
  assert.equal(result.code, 1)
  assert.match(result.stdout, /late boom/)
  assert.deepEqual(await readExecuted(root), ['late.test.js::first'])
})

// Value: protects=the reader of the `split-files` job's log: when no file is split (every recorded file is under SPLIT_TEST_FILE_MS) the job says that no file runs whole and passes, instead of the line "Shard 1/1: 0 tests in 0 calls" that reads as a run which counted nothing; fails_when=--whole-split-files with no split file prints the shard line again, runs a call, or fails the job (nothing was split, so there is nothing to fail); why_new=Cycle 0048 task 119 (OCR B: the job passed as a silent no-op); seam=test-shard.mjs --whole-split-files started as a process on a fixture build whose files are all quick; no_claim=the split-file run itself, which the test above covers
test('running the split files whole says that no file is split and passes when every file is quick', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: {
      'quick.test.js': loggingTestSource(['quick one']),
      'other.test.js': loggingTestSource(['other one']),
    },
    timings: {
      files: {
        'quick.test.js': { totalMs: 100 },
        'other.test.js': { totalMs: 200 },
      },
    },
  })

  // Act
  const result = await runShardScript(root, [
    '--whole-split-files',
    '--lanes',
    '2',
  ])

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      executed: await readExecuted(root),
    },
    {
      code: 0,
      stdout: 'No test file is split, so no file runs whole.\n',
      stderr: '',
      executed: [],
    },
  )
})

// Value: protects=the reader of the `split-files` job's log and the owner of the timings file: a run of the split files whole sums up as "Split files whole: …", never "Shard 1/1: …" (no shard is involved), and `--record` with `--whole-split-files` (or with `--list`, `--shard`, `--lanes`, which a recording ignores) is refused in one line before anything runs or is written, instead of the recording winning silently; fails_when=the whole-split-files run prints the shard line again, or the pair is accepted and `--record` rewrites the timings file while the caller asked for a run of the split files; why_new=Cycle 0048 task 137 (OCR B); seam=test-shard.mjs started as a process on a fixture build with one split file; no_claim=the recording itself, which the tests below cover
test('running the split files whole sums up as its own line, and a recording refuses the options it would ignore', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'slow.test.js': loggingTestSource(['first', 'second']) },
    timings: {
      files: {
        'slow.test.js': {
          totalMs: 18_000,
          tests: { first: 9_000, second: 9_000 },
        },
      },
    },
  })
  const timingsBefore = await readFile(join(root, 'test-timings.json'), 'utf8')

  // Act
  const whole = await runShardScript(root, [
    '--whole-split-files',
    '--lanes',
    '1',
  ])
  const refusals = []
  for (const option of [
    ['--whole-split-files'],
    ['--list'],
    ['--shard', '1/2'],
    ['--lanes', '2'],
  ])
    refusals.push(await runShardScript(root, ['--record', ...option]))

  // Assert
  assert.equal(whole.code, 0)
  assert.match(
    whole.stdout,
    /^Split files whole: 2 tests in 1 calls on 1 lanes, \d+ s, 0 failed calls\.$/m,
  )
  assert.doesNotMatch(whole.stdout, /Shard 1\/1/)
  assert.deepEqual(
    refusals.map(({ code, stdout, stderr }) => ({ code, stdout, stderr })),
    ['--whole-split-files', '--list', '--shard', '--lanes'].map((option) => ({
      code: 1,
      stdout: '',
      stderr: `✖ --record runs every file and rewrites the timings; leave out ${option}.\n`,
    })),
  )
  assert.equal(
    await readFile(join(root, 'test-timings.json'), 'utf8'),
    timingsBefore,
  )
})

// Value: protects=the shard job's verdict on a call that was ended for its silence: it fails whatever exit code the runner gives after the SIGTERM, and the silent file is named; fails_when=the failure of a call is decided by the runner's exit code alone, so a runner that winds down with exit code 0 after the silence SIGTERM makes the hung test pass as "0 failed calls" and the job goes green; why_new=Cycle 0048 task 53 (Core, OCR B); seam=test-shard.mjs started as a process on a fixture build whose copy of runTestInvocation starts a stand-in runner (`runnerArguments`) that exits 0 at its SIGTERM; no_claim=what the real Node runner exits with after a SIGTERM (it exits 1)
test('the shard script fails the shard for a call ended for its silence even when the runner exits 0 after the SIGTERM', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'hanging.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'hanging.test.js': { totalMs: 100 } } },
  })
  // The fixture's own copy of the call starts the stand-in instead of `node --test`; the product code has no seam for it.
  await useStandInRunner(
    root,
    [
      "process.on('SIGTERM', () => process.exit(0))",
      "console.log('started')",
      'setInterval(() => {}, 1_000)',
    ].join('\n'),
  )

  // Act
  const result = await runShardScript(
    root,
    ['--shard', '1/1', '--lanes', '1', '--silence-seconds', '3'],
    30_000,
  )

  // Assert
  assert.equal(result.code, 1)
  assert.match(result.stdout, /, 1 failed calls\./)
  assert.match(
    result.stderr,
    /✖ hanging\.test\.js printed nothing for 3 s and was ended/,
  )
})

// Value: protects=the shard job from a call that ran no test and passed: a runner that died before its summary with exit code 0 counted 0 tests and passed, so the shard reported green with a call unrun; fails_when=a call with a count of 0 tests (and exit code 0) is not failed, or the line does not name the call; why_new=Cycle 0048 task 74 (native adversarial); seam=test-shard.mjs started as a process on a fixture build whose copy of runTestInvocation starts a stand-in runner that prints no summary and exits 0; no_claim=a name pattern that matches no test: Node counts the file itself as one test then ("ℹ tests 1"), so the count cannot show it; a real runner that dies, which the stand-in only models by its output
test('the shard script fails a call that counts no test even when its runner exits 0, and names the call', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'silent.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'silent.test.js': { totalMs: 100 } } },
  })
  await useStandInRunner(root, "console.log('started')")

  // Act
  const result = await runShardScript(root, ['--shard', '1/1', '--lanes', '1'])

  // Assert
  assert.equal(result.code, 1)
  assert.match(
    result.stdout,
    /Shard 1\/1: 0 tests in 1 calls .* 1 failed calls\./,
  )
  assert.match(result.stderr, /✖ silent\.test\.js ran no test/)
})

// Value: protects=the shard job's count of a call and its rule that a call which ran no test fails: a test that prints `ℹ tests 99` at column 0 must not become the call's count (the first such line won), and a runner that died before its summary after such a line must not pass as a run of 99 tests; fails_when=the count takes the first `ℹ tests N` line of the output, or any line of that form, and not the last complete summary block of the runner; why_new=Cycle 0048 task 135 (native adversarial); seam=test-shard.mjs started as a process on a fixture build, once with a real `node --test` call whose test prints the line, once with a stand-in runner that prints the line and exits 0; no_claim=a test that prints a whole fake summary block and then kills its runner
test('the shard script counts the tests of the runner’s last summary, not a line a test printed, and fails a runner that died after such a line', async (context) => {
  // Arrange
  const printing = await createFixtureExtension(context, {
    tests: {
      'printing.test.js': loggingTestSource(
        ['opens'],
        "test('prints a summary line', () => { console.log('ℹ tests 99') })",
      ),
    },
    timings: { files: { 'printing.test.js': { totalMs: 10 } } },
  })
  const died = await createFixtureExtension(context, {
    tests: { 'died.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'died.test.js': { totalMs: 10 } } },
  })
  await useStandInRunner(died, "console.log('ℹ tests 99')")

  // Act
  const counted = await runShardScript(printing, [
    '--shard',
    '1/1',
    '--lanes',
    '1',
  ])
  const failed = await runShardScript(died, ['--shard', '1/1', '--lanes', '1'])

  // Assert
  assert.equal(counted.code, 0)
  assert.match(
    counted.stdout,
    /Shard 1\/1: 2 tests in 1 calls on 1 lanes, \d+ s, 0 failed calls\./,
  )
  assert.equal(failed.code, 1)
  assert.match(
    failed.stdout,
    /Shard 1\/1: 0 tests in 1 calls .* 1 failed calls\./,
  )
  assert.match(failed.stderr, /✖ died\.test\.js ran no test/)
})

// Value: protects=the shard job from a silence limit that ends every call at once: `Infinity` and a limit above what a timer can wait (2,147,483 s) fire at once with a TimeoutOverflowWarning, so every call is ended as hung; fails_when=the option accepts a limit whose milliseconds pass 2,147,483,647 or that is not finite; why_new=Cycle 0048 task 54 (OCR B); seam=test-shard.mjs started as a process on a fixture build; no_claim=the pre-gate runner's option, which pregateTests.test.mjs covers
test('the shard script refuses a silence limit of Infinity or above what a timer can wait, and runs no test', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'a.test.js': loggingTestSource(['opens']) },
    timings: { files: { 'a.test.js': { totalMs: 10 } } },
  })

  // Act
  const refusals = []
  for (const seconds of ['Infinity', '3000000', '2147484'])
    refusals.push(
      await runShardScript(root, [
        '--shard',
        '1/1',
        '--lanes',
        '1',
        '--silence-seconds',
        seconds,
      ]),
    )

  // Assert
  assert.deepEqual(
    refusals.map(({ code, stderr }) => ({
      code,
      refusal: /✖ (--[a-z-]+ [^\n]*)/.exec(stderr)?.[1],
    })),
    Array(3).fill({
      code: 1,
      refusal:
        '--silence-seconds must be at most 2147483, the longest wait a timer allows.',
    }),
  )
  assert.deepEqual(await readExecuted(root), [])
})

// Value: protects=the shard job and the pre-gate from a silence limit below what a timer can keep: `0.0004` seconds is 0.4 ms, which `setTimeout` rounds up to 1 ms, so every call is ended as hung before its runner starts; fails_when=the option accepts any number above 0; why_new=Cycle 0048 task 69 (OCR B); seam=parseSilenceSeconds, which both scripts call for their option; no_claim=the scripts' output for the refusal, which the process tests above cover for the other refusals
test('a silence limit under one millisecond is refused with the shortest limit named, and one millisecond is accepted', () => {
  // Arrange
  const tooShort = ['0.0004', '0.000999', '1e-9']

  // Act
  const refusals = tooShort.map((text) => {
    try {
      return parseSilenceSeconds(text)
    } catch (error) {
      return error.message
    }
  })
  const accepted = parseSilenceSeconds('0.001')

  // Assert
  assert.deepEqual(
    refusals,
    Array(3).fill(
      '--silence-seconds must be at least 0.001, the shortest wait a timer keeps.',
    ),
  )
  assert.equal(accepted, 0.001)
})

// Value: protects=the Windows shard job from test-file processes that outlive a call reported as ended, from a `taskkill` that Windows finds in the working folder (a cloned repository could carry one), and the Linux and macOS jobs from a change of the SIGTERM-then-SIGKILL order that lets the runner report what it was running; fails_when=win32 gets only `child.kill()` (TerminateProcess on the runner alone), the program is started by its bare name `taskkill`, win32 has no forced step after the grace, or a POSIX system gets the forced step first; why_new=Cycle 0048 task 56 (Red Team), extended by tasks 67 and 68 (Security, OCR B, Codex); seam=planCallEnd, the answer watchCallSilence takes for process.platform and the SystemRoot variable; no_claim=any run on Windows: no Windows process is started, so that `taskkill` ends the tree there is not shown by this test
test('a silent call is ended through its whole process tree by the system taskkill.exe on Windows, with a forced step after the grace, and by SIGTERM then SIGKILL on other systems', () => {
  // Arrange
  const pid = 4242

  // Act
  const windows = planCallEnd('win32', pid, { SystemRoot: '/windows' })
  const windowsWithoutRoot = planCallEnd('win32', pid, {})
  const linux = planCallEnd('linux', pid, {})
  const macos = planCallEnd('darwin', pid, {})

  // Assert
  // The path separators differ by the system the test runs on; the folders and the file name are the contract.
  assert.deepEqual(
    {
      command: windows.terminate.command.replaceAll('\\', '/'),
      args: windows.terminate.args,
      force: windows.force,
      defaultCommand: windowsWithoutRoot.terminate.command.replaceAll(
        '\\',
        '/',
      ),
    },
    {
      command: '/windows/System32/taskkill.exe',
      args: ['/pid', '4242', '/T', '/F'],
      force: { signal: 'SIGKILL' },
      defaultCommand: 'C:/Windows/System32/taskkill.exe',
    },
  )
  const posix = {
    terminate: { signal: 'SIGTERM' },
    force: { signal: 'SIGKILL' },
  }
  assert.deepEqual([linux, macos], [posix, posix])
})

/**
 * Writes a stand-in for the system's `taskkill.exe` into `<folder>/System32/`: an executable script (found through its first line) that notes its arguments in `taskkill.log` beside it, can end the process it is told to end, and exits with the given code. Called by the tests of {@link watchCallSilence}'s Windows path, which run on a POSIX system with the platform set to `win32` and `SystemRoot` set to the returned folder.
 * @param context - The running test, whose end removes the folder.
 * @param options.endsTheProcess - Whether the stand-in ends the process of the `/pid` argument with SIGKILL, as the real `taskkill /T /F` does.
 * @param options.exitCode - The exit code of the stand-in: 0 as the real program does when it succeeded, 1 as it does for an access denied.
 * @param options.hangsFirstTime - Whether the first start of the stand-in only notes its arguments and then waits for 60 s without ending anything (a `taskkill` that hangs); the second start does what the other options say.
 * @returns `{ systemRoot, taskkillArguments }`: the folder to set as `SystemRoot`, and a function that reads the argument lines the stand-in noted.
 * @example
 * const { systemRoot, taskkillArguments } = await writeStandInTaskkill(context, { endsTheProcess: false, exitCode: 1 })
 */
async function writeStandInTaskkill(
  context,
  { endsTheProcess, exitCode, hangsFirstTime = false },
) {
  const systemRoot = await mkdtemp(join(tmpdir(), 'codebook-stand-in-root-'))
  context.after(() => rm(systemRoot, { recursive: true, force: true }))
  await mkdir(join(systemRoot, 'System32'))
  const programPath = join(systemRoot, 'System32', 'taskkill.exe')
  await writeFile(
    programPath,
    [
      `#!${process.execPath}`,
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const log = join(__dirname, '..', 'taskkill.log')",
      "const first = !require('node:fs').existsSync(log)",
      "appendFileSync(log, process.argv.slice(2).join(' ') + '\\n')",
      ...(hangsFirstTime
        ? ['if (first) { setTimeout(() => {}, 60_000); return }']
        : []),
      ...(endsTheProcess
        ? ["process.kill(Number(process.argv[3]), 'SIGKILL')"]
        : []),
      `process.exitCode = ${exitCode}`,
    ].join('\n'),
    { mode: 0o755 },
  )
  const taskkillArguments = async () =>
    (await readFile(join(systemRoot, 'taskkill.log'), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
  return { systemRoot, taskkillArguments }
}

// Value: protects=the Windows shard job from a silent call that is never ended: the system's taskkill.exe is started with the runner's pid, and when it cannot start or starts and fails (access denied) the runner is ended alone, with the forced step after the grace; fails_when=the program is not started, a taskkill that exits non-zero leaves the runner alive with no step after it (the call then waits for the job's limit), or only a program that cannot start has a fallback; why_new=Cycle 0048 tasks 68 and 85 (OCR B, Codex, Red Team, Step 7); seam=runTestInvocation in fresh processes with `process.platform` set to win32 and `SystemRoot` set to a folder with a stand-in System32/taskkill.exe, and a stand-in runner script (`runnerArguments`); no_claim=the real taskkill.exe and a Windows process tree (no Windows process is started)
test(
  'on Windows a silent call is ended by taskkill, and by the runner alone with a forced step when taskkill fails or cannot start',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const runnerForTaskkill = await writeStandInRunner(context, '')
    const runnerForFailure = await writeStandInRunner(context, '')
    const runnerForMissing = await writeStandInRunner(
      context,
      'process.exit(0)',
    )
    const ending = await writeStandInTaskkill(context, {
      endsTheProcess: true,
      exitCode: 0,
    })
    const failing = await writeStandInTaskkill(context, {
      endsTheProcess: false,
      exitCode: 1,
    })
    const windowsCall = (runner, systemRoot) =>
      runCallInFreshProcess(context, {
        silenceTimeoutMs: 2_500,
        killGraceMs: 1_500,
        runnerArguments: [runner.runnerPath],
        platform: 'win32',
        systemRoot,
      })

    // Act
    const [taskkillEnds, taskkillFails, taskkillMissing] = await Promise.all([
      windowsCall(runnerForTaskkill, ending.systemRoot),
      windowsCall(runnerForFailure, failing.systemRoot),
      windowsCall(runnerForMissing, join(tmpdir(), 'codebook-no-such-root')),
    ])

    // Assert
    const lines = (taskkillArguments) =>
      taskkillArguments.map((line) => line.replace(/\d+/, '<pid>'))
    assert.deepEqual(
      {
        endedByTaskkill: {
          timedOut: taskkillEnds.result.timedOut,
          signal: taskkillEnds.result.signal,
          // The runner never got a SIGTERM of the call itself: the stand-in program ended it.
          sigterms: await runnerForTaskkill.sigtermCount(),
          taskkill: lines(await ending.taskkillArguments()),
        },
        failedTaskkill: {
          timedOut: taskkillFails.result.timedOut,
          signal: taskkillFails.result.signal,
          // The fallback ends the runner with one SIGTERM, which it ignores; the forced step follows.
          sigterms: await runnerForFailure.sigtermCount(),
          taskkill: lines(await failing.taskkillArguments()),
        },
        missingTaskkill: {
          timedOut: taskkillMissing.result.timedOut,
          code: taskkillMissing.result.code,
          sigterms: await runnerForMissing.sigtermCount(),
        },
      },
      {
        endedByTaskkill: {
          timedOut: true,
          signal: 'SIGKILL',
          sigterms: 0,
          taskkill: ['/pid <pid> /T /F'],
        },
        failedTaskkill: {
          timedOut: true,
          signal: 'SIGKILL',
          sigterms: 1,
          taskkill: ['/pid <pid> /T /F'],
        },
        missingTaskkill: { timedOut: true, code: 0, sigterms: 1 },
      },
    )
  },
)

// Value: protects=the Windows shard job from a `taskkill` that hangs: it is stopped after half the grace and started again, so the runner's whole tree is still ended, instead of the forced step ending the runner alone and leaving the test-file processes it started; fails_when=a taskkill that does not end is waited for until the forced step (`child.kill('SIGKILL')`, TerminateProcess on the runner alone), so the program is started once and the tree survives; why_new=Cycle 0048 task 134 (Codex adversarial, native adversarial: a taskkill that times out leaves the forced step to end the runner alone); seam=runTestInvocation in a fresh process with `process.platform` set to win32, a stand-in System32/taskkill.exe that hangs at its first start and ends the runner at its second, and a stand-in runner script; no_claim=the real taskkill.exe and a Windows process tree (no Windows process is started)
test(
  'on Windows a taskkill that hangs is stopped and started again, so the runner is still ended through its tree',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const runner = await writeStandInRunner(context, '')
    const taskkill = await writeStandInTaskkill(context, {
      endsTheProcess: true,
      exitCode: 0,
      hangsFirstTime: true,
    })

    // Act
    const { result } = await runCallInFreshProcess(context, {
      silenceTimeoutMs: 2_500,
      killGraceMs: 8_000,
      runnerArguments: [runner.runnerPath],
      platform: 'win32',
      systemRoot: taskkill.systemRoot,
    })

    // Assert
    assert.deepEqual(
      {
        timedOut: result.timedOut,
        signal: result.signal,
        sigterms: await runner.sigtermCount(),
        taskkill: (await taskkill.taskkillArguments()).map((line) =>
          line.replace(/\d+/, '<pid>'),
        ),
      },
      {
        timedOut: true,
        signal: 'SIGKILL',
        sigterms: 0,
        // The first start hung and was stopped at 4 s (half the grace); the second one ended the runner.
        taskkill: ['/pid <pid> /T /F', '/pid <pid> /T /F'],
      },
    )
  },
)

// Value: protects=the Windows shard job from a `taskkill` that hangs on both of its starts: each start is stopped after half the grace, the program is started twice and no more, and then the runner is ended alone, so a call is never left running for want of a taskkill that answers; fails_when=a third start is made, or no fallback follows the second hang, or the second hang is waited for without a bound; why_new=the test above hangs the first start only, so the second start's own hang (the last attempt, which falls back) has no test; Cycle 0048 task 152 gave each start 3 s (half of a 6 s grace) so a loaded runner does not stop the stand-in before it notes its start; seam=none; no_claim=the real taskkill.exe on Windows; a stand-in program that never ends and a stand-in child that notes its kill stand in for them
test(
  'a taskkill that hangs on both starts is started twice and then the runner is ended alone',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'codebook-hanging-taskkill-'))
    context.after(() => rm(folder, { recursive: true, force: true }))
    const programPath = join(folder, 'taskkill.exe')
    const logPath = join(folder, 'taskkill.log')
    await writeFile(
      programPath,
      [
        `#!${process.execPath}`,
        "require('node:fs').appendFileSync(process.argv[2], 'started\\n')",
        'setTimeout(() => {}, 60_000)',
      ].join('\n'),
      { mode: 0o755 },
    )
    const kills = []
    const runner = {
      exitCode: null,
      signalCode: null,
      kill: (...signal) => kills.push(signal),
    }

    // Act
    // Each start gets 3 s (half of the 6 s grace): a loaded machine needs far less than that to start the stand-in and let it note its start.
    takeEndStep(runner, { command: programPath, args: [logPath] }, 6_000)
    const startedAt = Date.now()
    // gstack-timing-ok: a poll with a generous bound, not a fixed wait: the runner is ended alone after the second start was stopped (about 6 s after the call); 30 s only ends the poll of a run that never gets there.
    while (kills.length === 0 && Date.now() - startedAt < 30_000)
      await delay(50)
    // gstack-timing-ok: a third start would come within one more half grace (3 s) after the second one was stopped; the wait is that half grace and 0.5 s, and a load only delays a start, so a third start under load is still seen after the wait or not at all, and a missed one does not fail a correct implementation.
    await delay(3_500)

    // Assert
    const starts = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean)
    assert.deepEqual(
      { starts, kills },
      { starts: ['started', 'started'], kills: [[]] },
    )
  },
)

// Value: protects=the shard script and the pre-gate runner from an end step that crashes them: a `taskkill` that the system refuses to start at once (Node throws from `spawn`, with no `error` event, for ENOMEM, as for any start it refuses before the program exists) ends the runner alone, as a `taskkill` that cannot start does, and nothing is thrown into the timer that took the step; fails_when=the throw of `spawn` escapes `takeEndStep` (the silence end's timer, or the signal handler, then ends the script with a stack trace and the call's tree runs on); why_new=Cycle 0048 task 216 (fixer C, task 204's class: a start the system refuses at once is thrown, not emitted); seam=a stand-in runner object and a command with a NUL byte, which Node's spawn refuses at once for every system, as it refuses ENOMEM, which no test can make on demand; no_claim=a real ENOMEM, and the real taskkill.exe
test('a taskkill that the system refuses to start at once ends the runner alone and throws nothing', () => {
  // Arrange
  const kills = []
  const runner = {
    exitCode: null,
    signalCode: null,
    kill: (...signal) => kills.push(signal),
  }

  // Act
  const thrown = (() => {
    try {
      takeEndStep(
        runner,
        { command: 'C:\\Windows\\System32\\task\u0000kill.exe', args: [] },
        6_000,
      )
      return undefined
    } catch (error) {
      return error.code
    }
  })()

  // Assert
  assert.deepEqual({ thrown, kills }, { thrown: undefined, kills: [[]] })
})

// Value: protects=the Windows shard process from what a call ended by `taskkill` could leave behind: after the call settles no SIGINT, SIGTERM or SIGHUP handler and no timer (the grace's kill timer, the silence timer) is left, whether the stand-in `taskkill` ends the runner, fails or hangs at its first start, or cannot start at all (no `taskkill.exe` under `SystemRoot`); fails_when=`stop()` of the silence watch drops `releaseSignalEnd()` (three handlers stay) or `clearTimeout(killTimer)` (the kill timer of the grace, pending when the runner has ended early, holds the process for the rest of the grace), also after the forced step or the fallback, or the start of a `taskkill` that cannot start leaves its time bound running (spawn's own `timeout` timer, which Node clears only at an `exit` that a failed start never emits: one timer is left); why_new=Cycle 0048 task 208 (state machines: the Windows ends of a call had assertions for the way it ended, none for its end state), and task 217 (fixer C: the failed start's timer); seam=runTestInvocation in a fresh process per case with `process.platform` set to win32, `SystemRoot` set to a folder with a stand-in System32/taskkill.exe and a stand-in runner script; mutant=`clearTimeout(killTimer)` removed from `stop()` of watchCallSilence.mjs fails the cases whose runner ends before the grace (taskkill ends it, taskkill hangs once), `releaseSignalEnd()` removed fails every case, and spawn's `timeout` put back in place of takeEndStep's own timer fails the case of a `taskkill` that cannot start; no_claim=the real taskkill.exe and a Windows process tree (no Windows process is started)
test(
  'on Windows a call ended by taskkill leaves no signal handler and no timer, also when taskkill fails, hangs or cannot start',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const ending = await writeStandInTaskkill(context, {
      endsTheProcess: true,
      exitCode: 0,
    })
    const failing = await writeStandInTaskkill(context, {
      endsTheProcess: false,
      exitCode: 1,
    })
    const hanging = await writeStandInTaskkill(context, {
      endsTheProcess: true,
      exitCode: 0,
      hangsFirstTime: true,
    })
    const ignoresSigterm = await writeStandInRunner(context, '')
    // A `taskkill` that cannot start falls back to ending the runner alone; a runner that exits at that SIGTERM closes the call long before half of its 8 s grace, while the failed start's own time bound would still run.
    const exitsAtSigterm = await writeStandInRunner(context, 'process.exit(0)')
    const withoutTaskkill = await mkdtemp(
      join(tmpdir(), 'codebook-no-taskkill-root-'),
    )
    context.after(() => rm(withoutTaskkill, { recursive: true, force: true }))
    const windowsCall = (runner, systemRoot, killGraceMs) =>
      runCallInFreshProcess(context, {
        silenceTimeoutMs: 2_500,
        killGraceMs,
        runnerArguments: [runner.runnerPath],
        platform: 'win32',
        systemRoot,
        settleMs: 500,
      })

    // Act
    const [endsRunner, fails, hangs, cannotStart] = await Promise.all([
      windowsCall(ignoresSigterm, ending.systemRoot, 8_000),
      windowsCall(ignoresSigterm, failing.systemRoot, 1_500),
      windowsCall(ignoresSigterm, hanging.systemRoot, 8_000),
      windowsCall(exitsAtSigterm, withoutTaskkill, 8_000),
    ])

    // Assert
    const noHandlerNoTimer = {
      timedOut: true,
      handlersLeft: { SIGINT: 0, SIGTERM: 0, SIGHUP: 0 },
      timersLeft: 0,
    }
    const endState = ({ result, handlersLeft, timersLeft }) => ({
      timedOut: result.timedOut,
      handlersLeft,
      timersLeft,
    })
    assert.deepEqual([endsRunner, fails, hangs, cannotStart].map(endState), [
      noHandlerNoTimer,
      noHandlerNoTimer,
      noHandlerNoTimer,
      noHandlerNoTimer,
    ])
  },
)

// Value: protects=the shard process from a call that is ended although it ended by itself, or that leaves something behind: a runner that prints and exits 0 answers `timedOut: false`, no signal and code 0, starts no `taskkill` on the Windows path, and leaves no SIGINT, SIGTERM or SIGHUP handler and no timer (the silence timer of 30 s would hold the process); fails_when=`stop()` drops `silenceTimer.stop()` (one timer stays), `releaseSignalEnd()` (three handlers stay), or the call is ended for its silence after it exited (`timedOut` true, a signal or a `taskkill` started); why_new=Cycle 0048 task 208 (state machines: no test showed that a call that exits by itself is not ended and leaves nothing); seam=runTestInvocation in a fresh process per case, on the platform of the test and with `process.platform` set to win32 beside a stand-in System32/taskkill.exe that notes its arguments, with a stand-in runner script that prints a summary and exits 0; mutant=`silenceTimer.stop()` removed from `stop()` of watchCallSilence.mjs fails both cases (timersLeft 1), `releaseSignalEnd()` removed fails both (three handlers); no_claim=a runner that exits within the silence limit with a failure code (the shard script's own tests)
test('a call whose runner exits by itself is not ended and leaves no signal handler and no timer, on POSIX and on the Windows path', async (context) => {
  // Arrange
  const runnerPath = await writeScript(
    context,
    "console.log('ℹ tests 1\\nℹ pass 1\\nℹ fail 0')",
  )
  const taskkill = await writeStandInTaskkill(context, {
    endsTheProcess: true,
    exitCode: 0,
  })
  const call = (extra) =>
    runCallInFreshProcess(context, {
      silenceTimeoutMs: 30_000,
      runnerArguments: [runnerPath],
      settleMs: 500,
      ...extra,
    })

  // Act
  const onThisSystem = await call({})
  const onTheWindowsPath = await call({
    platform: 'win32',
    systemRoot: taskkill.systemRoot,
  })

  // Assert
  const endState = ({ result, handlersLeft, timersLeft }) => ({
    timedOut: result.timedOut,
    signal: result.signal,
    code: result.code,
    handlersLeft,
    timersLeft,
  })
  const passedAndLeftNothing = {
    timedOut: false,
    signal: null,
    code: 0,
    handlersLeft: { SIGINT: 0, SIGTERM: 0, SIGHUP: 0 },
    timersLeft: 0,
  }
  assert.deepEqual(
    {
      onThisSystem: endState(onThisSystem),
      onTheWindowsPath: endState(onTheWindowsPath),
      taskkillStarts: await taskkill.taskkillArguments(),
    },
    {
      onThisSystem: passedAndLeftNothing,
      onTheWindowsPath: passedAndLeftNothing,
      taskkillStarts: [],
    },
  )
})

/** Tells whether a process exists: `process.kill(pid, 0)` throws `ESRCH` for a process that is gone. @example processExists(4242) // => false */
function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

/** Waits until none of the processes exists or the wait is over; a killed process is seen gone a moment after the kill. @example await waitUntilNoneExists([4242, 4243], 10_000) // => [] (the pids that still exist) */
async function waitUntilNoneExists(pids, waitMs) {
  const until = Date.now() + waitMs
  while (pids.some(processExists) && Date.now() < until) await delay(50)
  return pids.filter(processExists)
}

/** Reads the process ids a fixture noted, one per line, in the file; none when the file is not there. @example await readPids(join(root, 'pids.log')) // => [4242] */
async function readPids(path) {
  return (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(Number)
}

/** Waits until a fixture has noted at least `count` process ids, and answers them; fewer when the wait is over. @example await waitForPids(join(root, 'pids.log'), 1, 20_000) // => [4242] */
async function waitForPids(path, count, waitMs) {
  const until = Date.now() + waitMs
  let pids = await readPids(path)
  while (pids.length < count && Date.now() < until) {
    await delay(50)
    pids = await readPids(path)
  }
  return pids
}

/**
 * Ends every process a test started that still runs when the test ends, also when the code under test was wrong, so a red run leaves nothing behind. The processes are collected while the test runs, from the fixture's file of noted pids and from the tree under this process (a test of a file runs one at a time, so what runs under this process belongs to the test), because the fixture's folder may be removed before this clean-up runs and a runner that lost its parent can no longer be found from it.
 * @param context - The running test.
 * @param pidsPath - The file in which the fixture notes process ids, one per line, if it has one.
 * @example
 * killNotedProcessesAfter(context, join(root, 'pids.log'))
 */
function killNotedProcessesAfter(context, pidsPath) {
  const found = new Set()
  const look = async () => {
    for (const pid of pidsPath === undefined ? [] : await readPids(pidsPath))
      found.add(pid)
    for (const pid of listProcessIdsUnder(process.pid)) found.add(pid)
  }
  // gstack-timing-ok: a sampling interval of the clean-up, not a wait of the test; a process that starts and ends between two samples has ended by itself.
  const timer = setInterval(() => look().catch(() => {}), 200)
  context.after(async () => {
    clearInterval(timer)
    await look().catch(() => {})
    killProcessIds([...found])
    // What was found must be gone, or the test left a process behind.
    assert.deepEqual(
      await endProcesses([...found]),
      [],
      'processes of the test outlived it',
    )
  })
}

/** Starts a process that starts a grandchild, both waiting, and answers their ids; both are ended when the test ends. @example const { childPid, grandchildPid } = await startTwoProcesses(context) */
async function startTwoProcesses(context, command = process.execPath) {
  const child = spawn(
    command,
    [
      '-e',
      [
        "const grandchild = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })",
        'console.log(grandchild.pid)',
        'setInterval(() => {}, 1_000)',
      ].join('\n'),
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  killNotedProcessesAfter(context)
  // A test may end the child alone, which leaves the grandchild with another parent, outside the tree this process is searched for: both ids are named, the grandchild's once it is known.
  let grandchildPid
  endProcessesAfter(context, () => [child.pid, grandchildPid])
  grandchildPid = await new Promise((resolve) =>
    child.stdout.once('data', (chunk) => resolve(Number(String(chunk)))),
  )
  return { childPid: child.pid, grandchildPid }
}

// Value: protects=the end of a call's whole process tree on POSIX: the ids under a process are read from the system's process table (`/proc` on Linux, `ps` elsewhere), so a test file and what it started are found before the runner's end hides them; fails_when=only the children are listed (a process that a test file started is left running), a system without `/proc` gets no answer, or an unreadable table gives an error instead of an empty answer (the call must then fall back to the runner alone); why_new=Cycle 0048 task 148 (native adversarial: a silent call ended the runner alone); seam=listProcessIdsUnder on a real tree (a child that starts a grandchild) read natively, through `ps` (platform `darwin`) and with the platform `win32`, which has no table; no_claim=Windows trees (`taskkill /T /F` ends them)
test(
  'the process ids under a process are its children and their children, from the native table and from ps, and none when the table cannot be read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { childPid, grandchildPid } = await startTwoProcesses(context)

    // Act
    const native = listProcessIdsUnder(childPid)
    const viaPs = listProcessIdsUnder(childPid, { platform: 'darwin' })
    const unreadable = listProcessIdsUnder(childPid, { platform: 'win32' })
    const ofTheGrandchild = listProcessIdsUnder(grandchildPid)
    const underThisProcess = listProcessIdsUnder(process.pid)
    const parentOfGrandchild = readProcessTable({ platform: 'darwin' })?.get(
      grandchildPid,
    )

    // Assert
    assert.deepEqual(
      {
        native,
        viaPs,
        unreadable,
        ofTheGrandchild,
        thisProcessHoldsBoth:
          underThisProcess.includes(childPid) &&
          underThisProcess.includes(grandchildPid),
        parentOfGrandchild,
      },
      {
        native: [grandchildPid],
        viaPs: [grandchildPid],
        unreadable: [],
        ofTheGrandchild: [],
        thisProcessHoldsBoth: true,
        parentOfGrandchild: childPid,
      },
    )
  },
)

// Value: protects=the recording's wait after an abort and the end of a call's tree on systems that read the table with `ps` (macOS, other POSIX systems): the `ps` this process starts to read the table is a child of this process for as long as it runs, and the table lists it, so a process with no child of its own would always be told it has one, and the wait would last its whole grace and kill a pid that is already gone; fails_when=the table keeps the `ps` that read it, so the processes under a process that has no child are not empty on the `ps` path; why_new=Cycle 0048 task 175 (native adversarial: `[282605]` on darwin, `[]` on the Linux path); seam=listProcessIdsUnder with the platform `darwin` (the `ps` path, which exists on Linux too) in a fresh helper process that has no child of its own, because a test process may have children of its own; no_claim=the `/proc` reader, which runs in this process and starts no helper, and the output format of a `ps` of another system
test(
  'a process with no child of its own has no process under it on the ps path, whose own ps is not counted',
  { skip: process.platform === 'win32' },
  () => {
    // Arrange
    const helperSource = [
      `import { listProcessIdsUnder } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/listProcessIdsUnder.mjs')).href)}`,
      `import { readProcessTable } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/readProcessTable.mjs')).href)}`,
      'const table = readProcessTable({ platform: "darwin" })',
      'const childrenInTable = [...table].filter(([, parentId]) => parentId === process.pid).map(([pid]) => pid)',
      'console.log(JSON.stringify({ viaPs: listProcessIdsUnder(process.pid, { platform: "darwin" }), childrenInTable, ownPidListed: table.has(process.pid) }))',
    ].join('\n')

    // Act
    const helper = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', helperSource],
      { encoding: 'utf8', timeout: 30_000 },
    )

    // Assert
    assert.deepEqual(JSON.parse(helper.stdout), {
      viaPs: [],
      childrenInTable: [],
      ownPidListed: true,
    })
  },
)

// Value: protects=the Linux table reader from a program name that holds spaces and parentheses (the second field of `/proc/<pid>/stat` is that name in parentheses): the parent id is counted from the last `)`, so the children of such a process are found; fails_when=the line is split on spaces from its start, so a process named `a) 1 2 (b` reads a wrong parent and its grandchild is lost; why_new=Cycle 0048 task 148 (the format of the stat file is the reason for the "after the last )" rule); seam=listProcessIdsUnder with a copy of the Node program under the name `a) 1 2 (b`; no_claim=systems without `/proc`
test(
  'the children of a process whose program name holds spaces and parentheses are found on Linux',
  { skip: process.platform !== 'linux' },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'codebook-odd-name-'))
    context.after(() => rm(folder, { recursive: true, force: true }))
    const oddProgram = join(folder, 'a) 1 2 (b')
    await symlink(process.execPath, oddProgram)
    const { childPid, grandchildPid } = await startTwoProcesses(
      context,
      oddProgram,
    )

    // Act
    const found = listProcessIdsUnder(childPid)

    // Assert
    assert.deepEqual(found, [grandchildPid])
  },
)

// Value: protects=the event loop of a script that ends a call's tree: every look of an end walks the process table, and the silence end, the signal handlers and the recording's abort wait while it runs; the map of children is built in time linear in the table, so a process with tens of thousands of children is walked in milliseconds; fails_when=the map copies a parent's list for each child it adds (quadratic in the children of one process: 30,000 children took 3.7 s per look, 40,000 take about 6.6 s here); why_new=Cycle 0048 task 203 (Red Team: listProcessIdsUnder.mjs:21); seam=listProcessIdsUnder with the `table` option: a root and 40,000 children, no process started; no_claim=the time of reading the real table, and a table of deep chains (the walk of those is linear in the queue)
test('the process ids under a process with 40,000 children are listed in milliseconds, all of them', async () => {
  // Arrange
  const rootPid = 1
  const childCount = 40_000
  const table = new Map([[rootPid, 0]])
  for (let pid = 2; pid <= childCount + 1; pid += 1) table.set(pid, rootPid)

  // Act
  const startedAt = performance.now()
  const found = listProcessIdsUnder(rootPid, { table })
  const elapsedMs = performance.now() - startedAt

  // Assert
  // gstack-timing-ok: the bound is the contract (a linear walk of this table takes about 10 ms here, the quadratic map about 6.6 s); 2 s leaves the linear walk a margin of 200 times on a loaded machine and the quadratic map still fails it at a third of its time.
  assert.equal(elapsedMs < 2_000, true)
  assert.deepEqual(
    { count: found.length, first: found[0], last: found.at(-1) },
    { count: 40_000, first: 2, last: 40_001 },
  )
})

// Value: protects=this process and its parents from the kill of a tree: ids a look found are ended with SIGKILL, but the process that kills and the process that started it are never hit, whatever the list holds; fails_when=the guard is missing, so a list that holds the caller's own pid or its parent's ends the script (or the test run) that is ending a tree; why_new=Cycle 0048 task 148 (the brief: kill only pids found under the child, never this process or its parents); seam=killProcessIds in a helper process that is the child of a middle process, given its own pid, its parent's pid and a victim's pid; no_claim=a pid that was reused by another program since the look
test(
  'ending process ids ends the others and never the process that ends them or the one that started it',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { grandchildPid: victimPid } = await startTwoProcesses(context)
    const helperSource = [
      `import { killProcessIds } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/killProcessIds.mjs')).href)}`,
      'killProcessIds([process.pid, process.ppid, Number(process.argv[1])])',
      "console.log('alive')",
    ].join('\n')
    const middleSource = [
      "const { spawnSync } = require('node:child_process')",
      `const helper = spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(helperSource)}, String(${victimPid})], { encoding: 'utf8' })`,
      'console.log(JSON.stringify({ status: helper.status, output: helper.stdout.trim() }))',
    ].join('\n')

    // Act
    const middle = spawnSync(process.execPath, ['-e', middleSource], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    const victimsLeft = await waitUntilNoneExists([victimPid], 10_000)

    // Assert
    assert.deepEqual(
      { middle: JSON.parse(middle.stdout), victimsLeft },
      { middle: { status: 0, output: 'alive' }, victimsLeft: [] },
    )
  },
)

/** Reads the state letter of one process from the system's own `ps` (`S` sleeping, `T` stopped, `Z` zombie), or `undefined` when no such process is listed. @example stateOfProcess(4242) // => 'T' */
function stateOfProcess(pid) {
  const answer = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8',
  })
  return answer.stdout.trim()[0]
}

/** Waits until a process shows the wanted state letter in the system's `ps` or the wait is over, and answers the last state read. @example await waitForStateOfProcess(4242, 'T', 5_000) // => 'T' */
async function waitForStateOfProcess(pid, wantedState, waitMs) {
  const until = Date.now() + waitMs
  while (stateOfProcess(pid) !== wantedState && Date.now() < until)
    await delay(25)
  return stateOfProcess(pid)
}

// Value: protects=the wait for a stop: the scripts that end a tree ask the table whether a process that got SIGSTOP has stopped (a process inside a fork when the signal comes finishes the fork first, and the child of that fork is made after the signal was sent), so the state reader tells a sleeping process from a stopped one and from one that is gone, on the native path and through `ps`, and answers nothing where there is no table; fails_when=the reader answers a stopped process as sleeping (a look never confirms), a process that ended and was reaped as still listed (the stop of a dead process is waited for), or the `ps` path reads another column; why_new=Cycle 0048 task 200 (Codex adversarial: killProcessIds.mjs:35 and trackProcessTree.mjs:31, SIGSTOP is delivered asynchronously); seam=readProcessStates on a real `sleep` started by the test, with the platform of the host, `darwin` (the `ps` path, which exists on Linux too) and `win32`; no_claim=the state letters of systems other than Linux and macOS
test(
  'a process reads as sleeping, then as stopped after SIGSTOP, then as gone once it ended, natively and through ps, and Windows has no states to read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const readings = {}

    // Act
    for (const [path, platform] of [
      ['native', process.platform],
      ['viaPs', 'darwin'],
    ]) {
      const child = spawn('sleep', ['300.0455'], { stdio: 'ignore' })
      context.after(() => child.kill('SIGKILL'))
      const closed = new Promise((resolve) => child.once('close', resolve))
      await waitForStateOfProcess(child.pid, 'S', 10_000)
      const sleeping = readProcessStates([child.pid], { platform }).get(
        child.pid,
      )
      child.kill('SIGSTOP')
      await waitForStateOfProcess(child.pid, 'T', 10_000)
      const stopped = readProcessStates([child.pid], { platform }).get(
        child.pid,
      )
      child.kill('SIGKILL')
      await closed
      const stillListed = readProcessStates([child.pid], { platform }).has(
        child.pid,
      )
      readings[path] = { sleeping, stopped, stillListed }
    }
    readings.windows = readProcessStates([process.pid], { platform: 'win32' })

    // Assert
    const expected = { sleeping: 'S', stopped: 'T', stillListed: false }
    assert.deepEqual(readings, {
      native: expected,
      viaPs: expected,
      windows: undefined,
    })
  },
)

/**
 * Runs a helper process in which the modules of the scripts can be given stand-ins for the modules they import, through a resolve hook (`registerHooks` of `node:module`), never through a seam in the code; answers the helper's last line of output as JSON. The helper's source has `standInModules` (the loaded stand-ins, in the order given), `utils(name)` (imports a module of `scripts/utils`) and `process.argv[2..]` (the `args`). The helper is bound by a time limit.
 * @param context - The running test, whose end removes the helper's folder.
 * @param options.standIns - `{ specifier, parentFile, source }` for each stand-in: the module whose import of `specifier` (a file named `parentFile`) is answered by a module with this source.
 * @param options.main - The helper's source after the set-up.
 * @param options.args - Arguments for `process.argv`.
 * @param options.env - The helper's environment.
 * @returns `{ status, output }`: the exit code and the last line of output, parsed.
 * @example
 * const { output } = await runHelperModule(context, { main: "console.log(JSON.stringify({ ok: true }))" })
 */
async function runHelperModule(
  context,
  { standIns = [], main, args = [], env = process.env },
) {
  // The stand-ins are named by the folder's real path: Node loads a module under its real path (on macOS the temporary folder's /var is /private/var), and a hook that answered with the other spelling would load a second copy whose counters the helper never reads.
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-helper-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  const hooks = []
  for (const [index, standIn] of standIns.entries()) {
    const path = join(folder, `stand-in-${index}.mjs`)
    await writeFile(path, standIn.source)
    hooks.push({
      specifier: standIn.specifier,
      parentFile: standIn.parentFile,
      url: pathToFileURL(path).href,
    })
  }
  const helperPath = join(folder, 'helper.mjs')
  await writeFile(
    helperPath,
    [
      "import { registerHooks } from 'node:module'",
      `const hooks = ${JSON.stringify(hooks)}`,
      'registerHooks({',
      '  resolve(specifier, context, nextResolve) {',
      '    const hook = hooks.find((candidate) => candidate.specifier === specifier && context.parentURL?.endsWith(candidate.parentFile))',
      '    return hook ? { url: hook.url, shortCircuit: true } : nextResolve(specifier, context)',
      '  },',
      '})',
      'const standInModules = await Promise.all(hooks.map((hook) => import(hook.url)))',
      `const utils = (name) => import(${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/')).href)} + name)`,
      main,
    ].join('\n'),
  )
  const helper = spawn(process.execPath, [helperPath, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 60_000,
  })
  let output = ''
  helper.stdout.on('data', (chunk) => (output += chunk))
  const status = await new Promise((resolve) => helper.once('close', resolve))
  return { status, output: JSON.parse(output.trim().split('\n').at(-1)) }
}

// Value: protects=the end of a tree on a system whose `ps` has no state column: where the table can be read and a state cannot, a look counts as it did before the states were read (the end is not held for a stop it cannot see); fails_when=an unreadable state counts as running (every look fails to confirm and the end makes all its looks) or the reader throws; why_new=Cycle 0048 task 200 (Codex adversarial: killProcessIds.mjs:35 and trackProcessTree.mjs:31); seam=readProcessStates and haveProcessesStopped in a helper process whose PATH starts with a stand-in `ps` that fails as a `ps` without the column does, on the platform `darwin`; no_claim=the message of a real `ps` of another system
test(
  'where ps has no state column the states cannot be read and the stop counts as it did before the states were read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'codebook-fake-ps-'))
    context.after(() => rm(folder, { recursive: true, force: true }))
    const fakePs = join(folder, 'ps')
    await writeFile(
      fakePs,
      '#!/bin/sh\necho "ps: stat: keyword not found" >&2\nexit 1\n',
      { mode: 0o755 },
    )

    // Act
    const { output } = await runHelperModule(context, {
      env: { ...process.env, PATH: `${folder}:${process.env.PATH}` },
      main: [
        "const { readProcessStates } = await utils('readProcessStates.mjs')",
        "const { haveProcessesStopped } = await utils('haveProcessesStopped.mjs')",
        "const states = readProcessStates([process.pid], { platform: 'darwin' })",
        "console.log(JSON.stringify({ unreadable: states === undefined, counted: haveProcessesStopped([process.pid], { platform: 'darwin' }) }))",
      ].join('\n'),
    })

    // Assert
    assert.deepEqual(output, { unreadable: true, counted: true })
  },
)

/** Starts a `sleep` of the given duration, which ends with the test, and answers its id. @example const pid = startSleep(context, '300.0456') */
function startSleep(context, seconds) {
  const sleeper = spawn('sleep', [seconds], { stdio: 'ignore' })
  context.after(() => sleeper.kill('SIGKILL'))
  return sleeper.pid
}

/** The stand-in state reader of the tests of the wait for a stop: a process reads as running for the first three reads, as stopped from the fourth on, and the reads are counted. */
const SLOW_TO_STOP_READER_SOURCE = [
  'let reads = 0',
  'export function readProcessStates(pids) {',
  '  reads += 1',
  "  return new Map(pids.map((pid) => [pid, reads <= 3 ? 'R' : 'T']))",
  '}',
  'export const readsMade = () => reads',
].join('\n')

/** The hook that gives {@link SLOW_TO_STOP_READER_SOURCE} to the check that reads the states. */
const SLOW_TO_STOP_READER = {
  specifier: './readProcessStates.mjs',
  parentFile: 'haveProcessesStopped.mjs',
  source: SLOW_TO_STOP_READER_SOURCE,
}

// Value: protects=the end of the processes found under a tree against a process that has been sent SIGSTOP and is still on its way to the stop (it finishes a fork it is making, and the child of that fork is made after the signal was sent): the end looks again until the stopped process reports its stop, two looks after that confirm the tree, and only then the processes are killed; fails_when=the look is counted as confirming without the process reporting its stop (the mutant that drops the check of `haveProcessesStopped` in `stopTreesUnder` makes no read; the mutant that reads and ignores the answer makes two), so the child of a fork that finishes late is in no look and outlives the end; why_new=Cycle 0048 task 200 (Codex adversarial: killProcessIds.mjs:35, SIGSTOP is delivered asynchronously); seam=killProcessIds in a helper process whose state reader (a resolve hook) answers `R` for its first three reads and `T` after, ending a `sleep` of the test; no_claim=a real fork that finishes late (the kernel does not let a test hold one in the middle), the table of another system
test(
  'the end of a process keeps looking until the stopped process reports its stop, then confirms with two looks and kills it',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const sleeperPid = startSleep(context, '300.0457')

    // Act
    const { output } = await runHelperModule(context, {
      standIns: [SLOW_TO_STOP_READER],
      args: [String(sleeperPid)],
      main: [
        "const { killProcessIds } = await utils('killProcessIds.mjs')",
        'killProcessIds([Number(process.argv[2])])',
        'console.log(JSON.stringify({ reads: standInModules[0].readsMade() }))',
      ].join('\n'),
    })
    const left = await waitUntilNoneExists([sleeperPid], 10_000)

    // Assert
    // Three reads of a process that has not stopped, then the two reads of the looks that confirm.
    assert.deepEqual({ ...output, left }, { reads: 5, left: [] })
  },
)

// Value: protects=the stop of a root before its tree is read (the end of a child, the forced step of a silent call): the root has been sent SIGSTOP and may still be on its way to the stop, so the looks wait for it to report the stop and two looks after that confirm the tree; fails_when=`stopAndLook` looks twice at once, without the root reporting its stop (the mutant that drops the check makes no read), so the child of a fork the root finishes late is in no look and outlives the end; why_new=Cycle 0048 task 200 (Codex adversarial: trackProcessTree.mjs:31, SIGSTOP is delivered asynchronously); seam=endProcessTree in a helper process whose state reader (a resolve hook) answers `R` for its first three reads and `T` after, ending a real Node child that waits; no_claim=a real fork that finishes late (the kernel does not let a test hold one in the middle)
test(
  'the end of a child keeps looking until the stopped child reports its stop, then confirms with two looks and kills it',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    killNotedProcessesAfter(context)

    // Act
    const { output } = await runHelperModule(context, {
      standIns: [SLOW_TO_STOP_READER],
      main: [
        "const { spawn } = await import('node:child_process')",
        "const { endProcessTree } = await utils('endProcessTree.mjs')",
        "const root = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })",
        'await endProcessTree(root)',
        "await new Promise((resolve) => root.once('close', resolve))",
        'console.log(JSON.stringify({ reads: standInModules[0].readsMade(), signal: root.signalCode }))',
      ].join('\n'),
    })

    // Assert
    assert.deepEqual(output, { reads: 5, signal: 'SIGKILL' })
  },
)

// Value: protects=the end of a tree against a process that refused the stop (a process of another user, or one that ended just now): a stop that was not delivered will never be reported, so it is not waited for and the looks are the two they were before the states were read; fails_when=a process the stop did not reach is waited for, so each of the twenty looks is made and the end holds the event loop for them; why_new=Cycle 0048 task 200 (the branch of the new wait where `kill` refuses the signal); seam=killProcessIds and trackProcessTree.stopAndLook in a helper process whose `process.kill` refuses SIGSTOP with EPERM and whose state reader (a resolve hook) counts its reads; no_claim=which processes a system refuses a signal to
test(
  'a process that refused the stop is not waited for, in the end of a process and in the stop of a root',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const sleeperPid = startSleep(context, '300.0458')

    // Act
    const { output } = await runHelperModule(context, {
      standIns: [SLOW_TO_STOP_READER],
      args: [String(sleeperPid)],
      main: [
        'const realKill = process.kill',
        "process.kill = (pid, signal) => { if (signal === 'SIGSTOP') throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); return realKill.call(process, pid, signal) }",
        "const { killProcessIds } = await utils('killProcessIds.mjs')",
        "const { trackProcessTree } = await utils('trackProcessTree.mjs')",
        'killProcessIds([Number(process.argv[2])])',
        'trackProcessTree(Number(process.argv[2])).stopAndLook({ pid: Number(process.argv[2]), kill: () => false })',
        'console.log(JSON.stringify({ reads: standInModules[0].readsMade() }))',
      ].join('\n'),
    })
    const left = await waitUntilNoneExists([sleeperPid], 10_000)

    // Assert
    assert.deepEqual({ ...output, left }, { reads: 0, left: [] })
  },
)

/** The duration of the `sleep`s of the tests of the bound of looks. */
const BOUNDED_LOOKS_SLEEP_SECONDS = '300.0459'

/** The stand-in `listProcessIdsUnder` of the test of the bound of looks: the n-th look finds the first n of the sleeps after the first (the pids are the helper's first argument as JSON), so every look finds one more process and a tree never settles; the looks are counted. */
const ALWAYS_ONE_MORE_LISTER_SOURCE = [
  'const pids = JSON.parse(process.argv[2])',
  'let looks = 0',
  'export function listProcessIdsUnder() {',
  '  looks += 1',
  '  return pids.slice(1, looks + 1)',
  '}',
  'export const looksMade = () => looks',
].join('\n')

// Value: protects=the bound of the looks of an end: a tree that grows faster than it is stopped must not hold the end (the looks are synchronous and block the event loop), so after twenty looks the end kills what it found, though the tree never settled, and what the twenty looks did not reach is not ended; fails_when=the bound is dropped or raised (the end makes 21 or more looks), a process found is not stopped or not killed, or a process never found is touched; why_new=Cycle 0048 task 201 (testing, state machines, Codex adversarial: the bound of twenty looks had no test and no sentence said what it leaves); seam=killProcessIds in a helper process whose `listProcessIdsUnder` (a resolve hook) finds one more of 25 `sleep`s of the test at each look; the test ends the ones the end never found by their ids; no_claim=the number twenty itself (it is MAX_STOP_LOOKS; a change of the bound changes this expected value with it)
test(
  'the end of a tree that never settles makes exactly twenty looks, kills what it found and leaves the rest running',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const sleeperPids = Array.from({ length: 25 }, () =>
      startSleep(context, BOUNDED_LOOKS_SLEEP_SECONDS),
    )

    // Act
    const { output } = await runHelperModule(context, {
      standIns: [
        {
          specifier: './listProcessIdsUnder.mjs',
          parentFile: 'killProcessIds.mjs',
          source: ALWAYS_ONE_MORE_LISTER_SOURCE,
        },
      ],
      args: [JSON.stringify(sleeperPids)],
      main: [
        "const { killProcessIds } = await utils('killProcessIds.mjs')",
        'killProcessIds([JSON.parse(process.argv[2])[0]])',
        'console.log(JSON.stringify({ looks: standInModules[0].looksMade() }))',
      ].join('\n'),
    })
    // The first 21 (the one given and the twenty the looks found) are killed; a killed child is seen gone a moment after the kill.
    await waitUntilNoneExists(sleeperPids.slice(0, 21), 10_000)
    const leftOver = sleeperPids.filter(
      (pid) => stateOfProcess(pid) !== undefined && stateOfProcess(pid) !== 'Z',
    )
    const stoppedLeftOver = leftOver.filter(
      (pid) => stateOfProcess(pid) === 'T',
    )

    // Assert
    assert.deepEqual(
      { ...output, notFound: leftOver, stoppedAmongThem: stoppedLeftOver },
      { looks: 20, notFound: sleeperPids.slice(21), stoppedAmongThem: [] },
    )
  },
)

// Value: protects=the end of process ids on a system whose process table cannot be read (Windows, no `/proc` and no `ps`): the pids are killed as they are, and nothing else is signalled: a stop is one more signal to a pid that may belong to another program, and a walk without a table has no tree to read; fails_when=the end stops the ids or walks a tree without a table (any signal other than the kill, or the child's own child ended or stopped); why_new=Cycle 0048 task 201 (testing, state machines: the branch with no process table had no test); seam=killProcessIds with the platform `win32` in a helper process that records every signal it sends, ending a Node child that has a child of its own; no_claim=what Windows does with the ids (taskkill /T /F ends the trees there)
test(
  'ending process ids where no process table can be read kills the child alone and sends nothing to its own child',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { childPid, grandchildPid } = await startTwoProcesses(context)

    // Act
    const { output } = await runHelperModule(context, {
      args: [String(childPid)],
      main: [
        'const signals = []',
        'const realKill = process.kill',
        'process.kill = (pid, signal) => { signals.push({ pid, signal }); return realKill.call(process, pid, signal) }',
        "const { killProcessIds } = await utils('killProcessIds.mjs')",
        "killProcessIds([Number(process.argv[2])], { platform: 'win32' })",
        'console.log(JSON.stringify({ signals }))',
      ].join('\n'),
    })
    const childLeft = await waitUntilNoneExists([childPid], 10_000)

    // Assert
    assert.deepEqual(
      {
        ...output,
        childLeft,
        grandchildRuns: processExists(grandchildPid),
        grandchildState: stateOfProcess(grandchildPid),
      },
      {
        signals: [{ pid: childPid, signal: 'SIGKILL' }],
        childLeft: [],
        grandchildRuns: true,
        grandchildState: 'S',
      },
    )
  },
)

// Value: protects=every process above the script from the kill of a tree: ids a look found are ended with SIGKILL, but the process that kills, its parent and the parent's parent are never hit, whatever the list holds; fails_when=the walk up the process table stops at the first parent (already protected), so a list that holds the grandparent's pid ends the script that started the script that is ending a tree; why_new=Cycle 0048 task 169 (Step 7 of the third /ship: the guard test above names the caller's own pid and its parent's only, while the docstring promises "this process or one of its parents"; red at `fc442dce`, where the walk stopped at the parent, already protected); seam=killProcessIds in a helper process whose parent is a middle process and whose grandparent is an outer process, given the outer process's pid; no_claim=a pid that was reused by another program since the look, and ancestors above the grandparent
test(
  'ending process ids never ends the grandparent of the process that ends them',
  { skip: process.platform === 'win32' },
  async () => {
    // Arrange
    const helperSource = [
      `import { killProcessIds } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/killProcessIds.mjs')).href)}`,
      'killProcessIds([Number(process.argv[1])])',
      "console.log('alive')",
    ].join('\n')
    const middleSource = [
      "const { spawnSync } = require('node:child_process')",
      `const helper = spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(helperSource)}, process.argv[1]], { encoding: 'utf8' })`,
      'console.log(JSON.stringify({ status: helper.status, output: helper.stdout.trim() }))',
    ].join('\n')
    const outerSource = [
      "const { spawnSync } = require('node:child_process')",
      `const middle = spawnSync(process.execPath, ['-e', ${JSON.stringify(middleSource)}, String(process.pid)], { encoding: 'utf8' })`,
      'console.log(middle.stdout.trim())',
    ].join('\n')

    // Act
    const outer = spawnSync(process.execPath, ['-e', outerSource], {
      encoding: 'utf8',
      timeout: 30_000,
    })

    // Assert
    assert.deepEqual(
      {
        outerSignal: outer.signal,
        outerStatus: outer.status,
        helper: outer.stdout.trim(),
      },
      {
        outerSignal: null,
        outerStatus: 0,
        helper: '{"status":0,"output":"alive"}',
      },
    )
  },
)

/** The duration the busy stand-in root gives every `sleep` it starts: no other program of the machine runs `sleep` with it, so every such process in the table is one the test started. */
const MARKED_SLEEP_SECONDS = '300.0123'

/** Lists the processes (`{ pid, stat }`) whose command is a `sleep` of the given duration, from the system's own `ps`; a zombie shows as `[sleep] <defunct>` and is not listed. @example markedSleepProcesses('300.0123') // => [{ pid: 4301, stat: 'S' }] */
function markedSleepProcesses(seconds) {
  const marked = new RegExp(
    `^\\s*(\\d+)\\s+(\\S+)\\s+sleep ${seconds.replace('.', '\\.')}$`,
  )
  return execFileSync('ps', ['-A', '-o', 'pid=,stat=,args='], {
    encoding: 'utf8',
  })
    .split('\n')
    .flatMap((line) => {
      const match = marked.exec(line)
      return match ? [{ pid: Number(match[1]), stat: match[2] }] : []
    })
}

/** Lists the ids of the processes whose command is a `sleep` of the given duration (the busy stand-in root's by default). @example markedSleepPids() // => [4301, 4302] */
function markedSleepPids(seconds = MARKED_SLEEP_SECONDS) {
  return markedSleepProcesses(seconds).map(({ pid }) => pid)
}

/** Waits until no marked `sleep` runs or the wait is over, and answers the ids that still run. @example await waitUntilNoMarkedSleepRuns(5_000) // => [] */
async function waitUntilNoMarkedSleepRuns(waitMs) {
  const until = Date.now() + waitMs
  while (markedSleepPids().length > 0 && Date.now() < until) await delay(50)
  return markedSleepPids()
}

// Value: protects=the end of a child's tree on POSIX against a child that keeps starting processes while it is ended (the runner starts test files all the time): none of the processes it started in that moment outlives the end; fails_when=the tree is read, the child is killed and the tree is read again, so a process the child started between the first look and its end is found by neither look (a killed child has no children: they are given to `init`) and runs on with no parent; why_new=Cycle 0048 task 189 (Red Team: endProcessTree.mjs read the tree, killed the child and read again, and its comment said the second look finds what the child started in between); seam=endProcessTree with a stand-in root that starts a `sleep` of the marked duration every millisecond, up to 400, and is ended once it has started 5; the clean-up ends every marked process by its id; no_claim=Windows (taskkill /T /F ends the tree there), and a child that starts processes faster than the stop and the looks can follow (the loop of looks has a bound)
test(
  'the end of a child that keeps starting processes leaves none of them running',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    context.after(() => killProcessIds(markedSleepPids()))
    const child = spawn(
      process.execPath,
      [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          'let started = 0',
          'const timer = setInterval(() => {',
          `  spawn('sleep', [${JSON.stringify(MARKED_SLEEP_SECONDS)}], { stdio: 'ignore' })`,
          '  started += 1',
          "  if (started === 5) console.log('started 5')",
          '  if (started === 400) clearInterval(timer)',
          '}, 1)',
        ].join('\n'),
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    context.after(() => child.kill('SIGKILL'))
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    assert.equal(await waitForOutput(() => output, 'started 5', 20_000), true)

    // Act
    await endProcessTree(child)
    await new Promise((resolve) => child.once('close', resolve))
    // A killed process is seen gone a moment after the kill.
    const left = await waitUntilNoMarkedSleepRuns(5_000)

    // Assert
    assert.deepEqual(left, [])
  },
)

/** The duration the busy middle process of the test of a tree under a running root gives every `sleep` it starts. */
const UNDER_ROOT_SLEEP_SECONDS = '300.0789'

// Value: protects=the recording's end of what runs under the script (the root is not stopped first: only the ids listed under it are ended): a process under the root that keeps starting processes while the end runs leaves none of them running or stopped, because {@link killProcessIds} stops each process, reads what it started and stops that too before any kill; fails_when=the listed ids are killed without the loop of stops and looks (the mutant that kills the listed pids at once leaves the sleeps the middle process started between the listing and its kill); why_new=Cycle 0048 task 202 (state machines: task 189's tests stop a root that starts the processes itself, so a `killProcessIds` without its loop of looks passed them); seam=killProcessIds(listProcessIdsUnder(root.pid)) with a root that started a middle process, which starts four `sleep`s of a marked duration at each millisecond, up to 600 (the mutant that kills the listed pids at once left two to four of them in six runs); the clean-up ends the root and every marked process by its id; no_claim=Windows (taskkill /T /F ends trees there), and a middle process that starts processes faster than the stops and the looks can follow (the bound of looks)
test(
  'ending the ids listed under a root leaves none of the sleeps its busy middle process kept starting, running or stopped',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    context.after(() =>
      killProcessIds(markedSleepPids(UNDER_ROOT_SLEEP_SECONDS)),
    )
    const middleSource = [
      "const { spawn } = require('node:child_process')",
      'let started = 0',
      'const timer = setInterval(() => {',
      // Four at each beat, so that more are made in the moment between the listing and the kill of a mutant.
      '  for (let burst = 0; burst < 4; burst += 1)',
      `    spawn('sleep', [${JSON.stringify(UNDER_ROOT_SLEEP_SECONDS)}], { stdio: 'ignore' })`,
      '  started += 4',
      '  if (started >= 600) clearInterval(timer)',
      '}, 1)',
    ].join('\n')
    const root = spawn(
      process.execPath,
      [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          `spawn(process.execPath, ['-e', ${JSON.stringify(middleSource)}], { stdio: 'ignore' })`,
          'setInterval(() => {}, 1_000)',
        ].join('\n'),
      ],
      { stdio: 'ignore' },
    )
    context.after(() => root.kill('SIGKILL'))
    killNotedProcessesAfter(context)
    const until = Date.now() + 20_000
    while (
      markedSleepProcesses(UNDER_ROOT_SLEEP_SECONDS).length < 5 &&
      Date.now() < until
    )
      await delay(5)

    // Act
    killProcessIds(listProcessIdsUnder(root.pid))
    // A killed process is seen gone a moment after the kill.
    const untilGone = Date.now() + 5_000
    while (
      markedSleepProcesses(UNDER_ROOT_SLEEP_SECONDS).length > 0 &&
      Date.now() < untilGone
    )
      // gstack-timing-ok: a poll of the outcome with a generous bound, not a fixed wait: a process the end killed is gone a moment after its SIGKILL, and the 5 s only ends the poll of a run in which a sleep outlived the end, which the assertion then names; a load only delays the poll.
      await delay(50)
    const left = markedSleepProcesses(UNDER_ROOT_SLEEP_SECONDS)

    // Assert
    assert.deepEqual(left, [])
  },
)

// Value: protects=the processes that hold the pid of a child that has already exited: an end of such a child signals nothing and reads no tree, since its pid can belong to another program by then; fails_when=`endProcessTree` drops the check that the child still runs (`childStillRuns`), so it stops and kills the process now at that pid and everything under it; why_new=Cycle 0048 task 194 (Step 7 of the third /ship: every test of endProcessTree ends a child that still runs); seam=endProcessTree given a child that reports an exit (`exitCode: 0`) whose pid is a live process with a child of its own, standing in for a pid given to another program; no_claim=a real reuse of the pid by another program (a live process of the test stands in for it)
test(
  'the end of a child that has already exited signals nothing and leaves the processes at its pid alone',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { childPid, grandchildPid } = await startTwoProcesses(context)
    const signalsSent = []
    const exitedChild = {
      pid: childPid,
      exitCode: 0,
      signalCode: null,
      kill: (signal) => {
        signalsSent.push(signal)
        return true
      },
    }

    // Act
    await endProcessTree(exitedChild, { platform: process.platform })
    // gstack-timing-ok: an end that wrongly reached the pid would have killed its child at once; half a second lets that kill be seen before the check.
    await delay(500)

    // Assert
    assert.deepEqual(
      {
        signalsSent,
        processAtThePidRuns: processExists(childPid),
        itsChildRuns: processExists(grandchildPid),
      },
      { signalsSent: [], processAtThePidRuns: true, itsChildRuns: true },
    )
  },
)

// Value: protects=the forced step of a silent call on POSIX against a runner that keeps starting processes (the real runner starts a test file after another) and ignores SIGTERM: none of the processes it started in the moment of the forced step outlives the call; fails_when=the runner's tree is read and the runner is killed with nothing stopped, so a process it starts between the last look and its kill is found by no look (a killed runner has no children: they are given to `init`) and runs on with no parent; why_new=Cycle 0048 task 189 (Red Team: watchCallSilence's forced step reads the tree and kills the runner in the same order as endProcessTree did); seam=runTestInvocation with a stand-in runner that ignores SIGTERM and starts a `sleep` of the marked duration every millisecond, a 2.5 s silence limit and a 1.5 s grace; the clean-up ends every marked process by its id; no_claim=Windows (taskkill /T /F ends the tree there)
test(
  'a call ended for its silence leaves none of the processes its runner kept starting until the forced step',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    context.after(() => killProcessIds(markedSleepPids()))
    const directory = await mkdtemp(join(tmpdir(), 'codebook-busy-runner-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const runnerPath = join(directory, 'runner.cjs')
    await writeFile(
      runnerPath,
      [
        "const { spawn } = require('node:child_process')",
        "process.on('SIGTERM', () => {})",
        "console.log('started')",
        'let started = 0',
        'const timer = setInterval(() => {',
        `  spawn('sleep', [${JSON.stringify(MARKED_SLEEP_SECONDS)}], { stdio: 'ignore' })`,
        '  started += 1',
        '  if (started === 5_000) clearInterval(timer)',
        '}, 1)',
      ].join('\n'),
    )

    // Act
    // gstack-timing-ok: the 2.5 s limit is the contract that ends the call (it also leaves the stand-in time to start), and the 1.5 s grace follows it; the stand-in starts a process every millisecond for much longer than that.
    const result = await runTestInvocation({ files: [] }, tmpdir(), {
      silenceTimeoutMs: 2_500,
      killGraceMs: 1_500,
      runnerArguments: [runnerPath],
    })
    const left = await waitUntilNoMarkedSleepRuns(5_000)

    // Assert
    assert.deepEqual(
      { timedOut: result.timedOut, signal: result.signal, processesLeft: left },
      { timedOut: true, signal: 'SIGKILL', processesLeft: [] },
    )
  },
)

// Value: protects=the shard and pre-gate jobs from a test file that ignores SIGTERM and hangs: the call is ended with its whole process tree and no process of it is left, where the SIGTERM reached the runner and its file kept running; fails_when=the end of a silent call signals the runner alone (on POSIX the runner passes SIGTERM on and the file's process ignores it, and the forced SIGKILL reaches only the runner), so the file's process runs on after the call was reported as ended; why_new=Cycle 0048 task 148 (native adversarial: the call ended at its limit and the file's process was still running); seam=runTestInvocation with the real `node --test` runner and a test file that records its pid, ignores SIGTERM and hangs, a 4 s silence limit and a 1.5 s grace; no_claim=Windows (taskkill ends the tree there) and the default limits
test(
  'a call ended for its silence leaves no process of a test file that ignores SIGTERM and hangs',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-stubborn-file-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const pidsPath = join(directory, 'pids.log')
    killNotedProcessesAfter(context, pidsPath)
    await writeFile(
      join(directory, 'stubborn.test.js'),
      [
        "const { appendFileSync } = require('node:fs')",
        "const { join } = require('node:path')",
        "const { test } = require('node:test')",
        "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
        "process.on('SIGTERM', () => {})",
        "test('finishes first', () => {})",
        "test('never ends', () => new Promise(() => setInterval(() => {}, 1_000)))",
      ].join('\n'),
    )

    // Act
    // The call is raced with a bound of its own: a call that is not ended would otherwise wait for a test file that never ends.
    // gstack-timing-ok: the 4 s limit is the contract that ends the call (it is also the time the first test has to print after the spawn); the 1.5 s grace follows it; 40 s only ends the wait for a call that is never ended.
    const outcome = await Promise.race([
      runTestInvocation({ files: ['stubborn.test.js'] }, directory, {
        silenceTimeoutMs: 4_000,
        killGraceMs: 1_500,
      }),
      delay(40_000, 'the call was not ended'),
    ])
    const stubbornPids = await readPids(pidsPath)
    const left = await waitUntilNoneExists(stubbornPids, 10_000)

    // Assert
    assert.deepEqual(
      {
        timedOut: outcome.timedOut,
        recordedPids: stubbornPids.length,
        processesLeft: left,
      },
      { timedOut: true, recordedPids: 1, processesLeft: [] },
    )
  },
)

/**
 * Writes a stand-in for the `node --test` runner that starts a child process which ignores SIGTERM and notes its id in `child.pids`, either at its start or in its SIGTERM handler, and then stays alive or exits at the SIGTERM. The real runner cannot show the cases of a process that is started after the first look at the tree, or that outlives a runner that has exited.
 * Called by the tests of {@link watchCallSilence}'s end of the tree.
 * @param context - The running test, whose end removes the folder and ends the children.
 * @param options.startsChildAt - `start` for a child started when the runner starts, `sigterm` for one started when the runner gets its SIGTERM (after the first look at the tree).
 * @param options.exitsAtSigterm - Whether the runner exits at its SIGTERM (leaving the child without a parent) or ignores it.
 * @returns `{ runnerPath, childPidsPath }`: the script to pass as `runnerArguments`, and the file that holds the id of the child.
 * @example
 * const { runnerPath, childPidsPath } = await writeStubbornChildRunner(context, { startsChildAt: 'start', exitsAtSigterm: true })
 */
async function writeStubbornChildRunner(
  context,
  { startsChildAt, exitsAtSigterm },
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-stubborn-runner-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const runnerPath = join(directory, 'runner.cjs')
  const childPidsPath = join(directory, 'child.pids')
  killNotedProcessesAfter(context, childPidsPath)
  await writeFile(
    runnerPath,
    [
      "const { spawn } = require('node:child_process')",
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      'const startChild = () => {',
      "  const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)\"], { stdio: 'ignore' })",
      "  appendFileSync(join(__dirname, 'child.pids'), `${child.pid}\\n`)",
      '}',
      `if (${JSON.stringify(startsChildAt)} === 'start') startChild()`,
      "process.on('SIGTERM', () => {",
      `  if (${JSON.stringify(startsChildAt)} === 'sigterm') startChild()`,
      "  console.log('winding down')",
      `  if (${exitsAtSigterm}) process.exit(0)`,
      '})',
      "console.log('started')",
      'setInterval(() => {}, 1_000)',
    ].join('\n'),
  )
  return { runnerPath, childPidsPath }
}

// Value: protects=the shard and pre-gate jobs from the processes a runner leaves when it exits at the silence SIGTERM: they lose their parent then, so the tree is read before the signal and its processes are killed as soon as the runner has exited; fails_when=the tree is read after the runner's end (nothing is found) or never, so the process the runner started keeps running with no parent; why_new=Cycle 0048 task 148 (the brief: the tree is read before the first signal, because the runner's processes lose their parent when it exits); seam=runTestInvocation with a stand-in runner that starts a SIGTERM-ignoring child at its start and exits at its SIGTERM, a 2.5 s limit and a 10 s grace the exit comes long before; no_claim=what the real runner does with its files at SIGTERM
test(
  'a call whose runner exits at the silence SIGTERM leaves no process the runner started',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { runnerPath, childPidsPath } = await writeStubbornChildRunner(
      context,
      { startsChildAt: 'start', exitsAtSigterm: true },
    )

    // Act
    const result = await runTestInvocation({ files: [] }, tmpdir(), {
      silenceTimeoutMs: 2_500,
      killGraceMs: 10_000,
      runnerArguments: [runnerPath],
    })
    const left = await waitUntilNoneExists(
      await readPids(childPidsPath),
      10_000,
    )

    // Assert
    assert.deepEqual(
      { timedOut: result.timedOut, code: result.code, processesLeft: left },
      { timedOut: true, code: 0, processesLeft: [] },
    )
  },
)

// Value: protects=the shard and pre-gate jobs from a process that a runner starts after the first look at its tree (its SIGTERM handler starts one) and then stays alive: the tree is read again before the forced step, so that process is found and killed with the runner; fails_when=the tree is read only once, before the SIGTERM, so a process started afterwards survives the runner's SIGKILL; why_new=Cycle 0048 task 148 (the brief: also those started under them after the first look); seam=runTestInvocation with a stand-in runner that ignores SIGTERM, starts a SIGTERM-ignoring child in its handler, a 2.5 s limit and a 2 s grace; no_claim=what the real runner does at SIGTERM
test(
  'a call ended for its silence also kills a process that was started after the first look at its tree',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { runnerPath, childPidsPath } = await writeStubbornChildRunner(
      context,
      { startsChildAt: 'sigterm', exitsAtSigterm: false },
    )

    // Act
    const result = await runTestInvocation({ files: [] }, tmpdir(), {
      silenceTimeoutMs: 2_500,
      killGraceMs: 2_000,
      runnerArguments: [runnerPath],
    })
    const left = await waitUntilNoneExists(
      await readPids(childPidsPath),
      10_000,
    )

    // Assert
    assert.deepEqual(
      { timedOut: result.timedOut, signal: result.signal, processesLeft: left },
      { timedOut: true, signal: 'SIGKILL', processesLeft: [] },
    )
  },
)

/** How many listeners this process has for each signal that {@link endChildrenOnSignal} handles. @example signalHandlerCounts() // => [0, 0, 0] */
function signalHandlerCounts() {
  return ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) =>
    process.listenerCount(signal),
  )
}

/** How many `Timeout` timers this process holds now, for a test that compares the count before and after a call. @example activeTimerCount() // => 0 */
function activeTimerCount() {
  return process
    .getActiveResourcesInfo()
    .filter((resource) => resource === 'Timeout').length
}

/**
 * The ways a call of {@link runTestInvocation} ends, one per entry: `name` words the way, `prepare(context)` lays out what the call needs (a fixture file, a stand-in runner, and the clean-up that samples processes with a timer of its own) and answers a function that makes the call in this process and answers when it has ended (a rejected call counts as ended too). The timers are counted around that function alone, so the test's own sampling timer is not taken for the call's.
 * Called by the test below, which compares the signal handlers before and after each way.
 */
const CALL_ENDS = [
  {
    name: 'that exits by itself',
    async prepare(context) {
      const directory = await mkdtemp(join(tmpdir(), 'codebook-passing-file-'))
      context.after(() => rm(directory, { recursive: true, force: true }))
      await writeFile(
        join(directory, 'passing.test.js'),
        "require('node:test').test('passes', () => {})",
      )
      return () => runTestInvocation({ files: ['passing.test.js'] }, directory)
    },
  },
  {
    name: 'whose runner exits at the silence SIGTERM',
    async prepare(context) {
      const { runnerPath } = await writeStandInRunner(
        context,
        'process.exit(0)',
      )
      return () =>
        runTestInvocation({ files: [] }, tmpdir(), {
          silenceTimeoutMs: 2_500,
          killGraceMs: 10_000,
          runnerArguments: [runnerPath],
        })
    },
  },
  {
    name: 'whose runner ignores the silence SIGTERM and is killed after the grace',
    async prepare(context) {
      const { runnerPath } = await writeStandInRunner(context, '')
      return () =>
        runTestInvocation({ files: [] }, tmpdir(), {
          silenceTimeoutMs: 2_500,
          killGraceMs: 2_000,
          runnerArguments: [runnerPath],
        })
    },
  },
  {
    name: 'whose runner prints while it winds down after the silence SIGTERM',
    async prepare(context) {
      const { runnerPath } = await writeStandInRunner(
        context,
        'setTimeout(() => process.exit(0), 4_000)',
      )
      return () =>
        runTestInvocation({ files: [] }, tmpdir(), {
          silenceTimeoutMs: 2_500,
          killGraceMs: 10_000,
          runnerArguments: [runnerPath],
        })
    },
  },
  {
    name: 'whose runner starts a process after the first look at its tree',
    async prepare(context) {
      const { runnerPath } = await writeStubbornChildRunner(context, {
        startsChildAt: 'sigterm',
        exitsAtSigterm: false,
      })
      return () =>
        runTestInvocation({ files: [] }, tmpdir(), {
          silenceTimeoutMs: 2_500,
          killGraceMs: 2_000,
          runnerArguments: [runnerPath],
        })
    },
  },
  {
    name: 'whose runner cannot be started',
    prepare() {
      return async () => {
        const realExecPath = process.execPath
        // The spawn of a path that is no program fails with ENOENT (as in the timer test above); the path is put back at once.
        process.execPath = join(tmpdir(), 'codebook-no-such-node-program')
        try {
          return await runTestInvocation({ files: [] }, tmpdir(), {
            silenceTimeoutMs: 30_000,
          }).catch((error) => ({ rejectionCode: error.code }))
        } finally {
          process.execPath = realExecPath
        }
      }
    },
  },
]

for (const { name, prepare } of CALL_ENDS) {
  // Value: protects=the signal handling of the shard script after a call has ended: a call leaves none of the SIGINT, SIGTERM and SIGHUP handlers of {@link endChildrenOnSignal} behind, so the next signal ends the script as Node does by default, and no ended call keeps its end registered; and none of its timers (Cycle 0048 task 208 compares them too); fails_when=`stop()` of the silence watch no longer releases the call's end (`releaseSignalEnd()` dropped), so one more handler of each signal stays after every call, or only after the ways of ending that skip it, or drops `clearTimeout(killTimer)` / `silenceTimer.stop()` / `clearInterval(lookTimer)`, so a timer of the call outlives it; why_new=Cycle 0048 task 188 (state machines: no test showed that a call leaves no signal handler once it ends, by itself, at its silence, in the forced step, while it winds down, with a process started after the first look, or when it cannot start); seam=runTestInvocation in this process, with the real runner and with stand-in runners (`runnerArguments`), comparing the listener counts of the three signals before and after each call; mutant=`releaseSignalEnd()` removed from `stop()` of watchCallSilence.mjs fails every one of these tests (the first call that leaves its end registered leaves the handlers, and every later way starts with them); no_claim=the Windows end by `taskkill` (`process.platform` decides it in watchCallSilence.mjs, and it is not reachable here): `stop()` releases the end on every platform, which this test shows on POSIX only
  test(
    `a call ${name} leaves no SIGINT, SIGTERM or SIGHUP handler behind`,
    { skip: process.platform === 'win32' },
    async (context) => {
      // Arrange
      const makeCall = await prepare(context)
      const handlersBefore = signalHandlerCounts()
      const timersBefore = activeTimerCount()

      // Act
      await makeCall()
      // gstack-timing-ok: lets a program that the call started to end it (ps, taskkill) clear its own time limit, which counts as a timer until the program has exited; the timers of the call itself last 2.5 s (silence) to 10 s (grace) or are an interval, so they are still pending after this wait.
      await delay(500)

      // Assert
      // Both counts are zero: a call whose end stays registered leaves the handlers for every later call too, so the later ways fail as well.
      // The timers are the call's own (the silence timer, the grace's kill timer, the look timer of its tree): none of them may be left once the call has ended.
      assert.deepEqual(
        {
          before: handlersBefore,
          after: signalHandlerCounts(),
          timersLeft: activeTimerCount() - timersBefore,
        },
        { before: [0, 0, 0], after: [0, 0, 0], timersLeft: 0 },
      )
    },
  )
}

/** Starts the fixture's shard script and answers the child and a promise of how it ends, for a test that signals the script while it runs; the script is killed when the test ends. @example const { child, ended } = startShardScript(context, root, ['--record']) */
function startShardScript(context, root, args) {
  const child = spawn(
    process.execPath,
    [join(root, 'scripts/test-shard.mjs'), ...args],
    {
      cwd: root,
      stdio: 'ignore',
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name !== 'NODE_TEST_CONTEXT' && name !== 'NO_COLOR',
        ),
      ),
    },
  )
  killNotedProcessesAfter(context)
  context.after(() => child.kill('SIGKILL'))
  const ended = new Promise((resolve) =>
    child.on('close', (code, signal) => resolve({ code, signal })),
  )
  return { child, ended }
}

/** The source of a fixture test file that notes its process id in `pids.log` beside it and then hangs; `ignoresSigterm` makes it ignore SIGTERM. @example hangingFileNotingItsPid({ ignoresSigterm: true }) */
function hangingFileNotingItsPid({ ignoresSigterm }) {
  return [
    "const { appendFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    "const { test } = require('node:test')",
    "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
    ...(ignoresSigterm ? ["process.on('SIGTERM', () => {})"] : []),
    "test('never ends', () => new Promise(() => setInterval(() => {}, 1_000)))",
  ].join('\n')
}

// Value: protects=the shard job from a script that is ended by a signal while a call runs (a cancelled job, a closed terminal): every process of the call goes with it, and the script exits with 128 plus the signal's number; fails_when=the script has no handler, so the `node --test` runner and its test file keep running (the file ignores SIGTERM here), or the handler exits with another code; why_new=Cycle 0048 task 150 (Red Team, Codex adversarial: the test runs have no signal handler; a SIGTERM to the runner alone leaves `node --test` running); seam=test-shard.mjs started as a process on a fixture build whose test file hangs and ignores SIGTERM, sent SIGTERM to its pid alone; no_claim=SIGINT and SIGHUP (the pre-gate runner's tests cover each number)
test(
  'the shard script that gets SIGTERM during a call ends the call’s whole tree and exits with 143',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await createFixtureExtension(context, {
      tests: {
        'stubborn.test.js': hangingFileNotingItsPid({ ignoresSigterm: true }),
      },
      timings: { files: { 'stubborn.test.js': { totalMs: 100 } } },
    })
    killNotedProcessesAfter(context, join(root, 'dist/tests/pids.log'))
    const { child, ended } = startShardScript(context, root, [
      '--shard',
      '1/1',
      '--lanes',
      '1',
    ])
    await waitForPids(join(root, 'dist/tests/pids.log'), 1, 30_000)
    const treeBefore = listProcessIdsUnder(child.pid)

    // Act
    child.kill('SIGTERM')
    const result = await ended
    const left = await waitUntilNoneExists(treeBefore, 10_000)

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        signal: result.signal,
        treeHadRunnerAndFile: treeBefore.length >= 2,
        processesLeft: left,
      },
      {
        code: 143,
        signal: null,
        treeHadRunnerAndFile: true,
        processesLeft: [],
      },
    )
  },
)

// Value: protects=the timings recording from a script that is ended by a signal: the file processes of the run go with it and the script exits with 128 plus the signal's number; fails_when=the recording has no handler, so the runner's file processes (one ignores SIGTERM here) keep running; why_new=Cycle 0048 task 150 (the class: every process the test scripts start ends with its tree); seam=test-shard.mjs --record started as a process on a fixture build whose test file hangs, sent SIGHUP to its pid alone; no_claim=the other signals
test(
  'the timings recording that gets SIGHUP ends the file processes of its run and exits with 129',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await createFixtureExtension(context, {
      tests: {
        'stubborn.test.js': hangingFileNotingItsPid({ ignoresSigterm: true }),
      },
    })
    killNotedProcessesAfter(context, join(root, 'dist/tests/pids.log'))
    const { child, ended } = startShardScript(context, root, ['--record'])
    const [filePid] = await waitForPids(
      join(root, 'dist/tests/pids.log'),
      1,
      30_000,
    )

    // Act
    child.kill('SIGHUP')
    const result = await ended
    const left = await waitUntilNoneExists([filePid], 10_000)

    // Assert
    assert.deepEqual(
      { code: result.code, signal: result.signal, processesLeft: left },
      { code: 129, signal: null, processesLeft: [] },
    )
  },
)

// Value: protects=the timings recording from a signal that comes while it waits for the file processes of an aborted run: the file that ignored the abort's SIGTERM is ended with the rest, and the script exits with 128 plus the signal's number; fails_when=the recording's handlers are gone before that wait, so the signal ends the script by Node's default and the file's process keeps running after it; why_new=Cycle 0048 task 167 (Step 8 of the third /ship: the handlers were removed in the `finally`, before the wait of up to 5 s); seam=collectTestRun in a helper process with a 1 s test limit and a 30 s grace, on a fixture file whose test hangs and which notes the abort's SIGTERM, sent SIGTERM to the helper alone one second after that note; no_claim=SIGINT and SIGHUP in that wait (the same handlers), and Windows, where a Node process ends the processes it started when it exits
test(
  'the timings recording that gets SIGTERM while it waits for the file processes of an aborted run ends them and exits with 143',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-recording-wait-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const pidsPath = join(directory, 'pids.log')
    const sigtermPath = join(directory, 'sigterm.log')
    killNotedProcessesAfter(context, pidsPath)
    await writeFile(
      join(directory, 'stubborn.test.js'),
      [
        "const { appendFileSync } = require('node:fs')",
        "const { join } = require('node:path')",
        "const { test } = require('node:test')",
        "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
        "process.on('SIGTERM', () => appendFileSync(join(__dirname, 'sigterm.log'), `${process.pid}\\n`))",
        "test('never ends', () => new Promise(() => setInterval(() => {}, 1_000)))",
      ].join('\n'),
    )
    // The recording runs as a script file: run() starts the test files with the flags of its own process, and `--input-type` would make them fail.
    const helperPath = join(directory, 'record.mjs')
    await writeFile(
      helperPath,
      [
        `import { collectTestRun } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/collectTestRun.mjs')).href)}`,
        `await collectTestRun({ files: [${JSON.stringify(join(directory, 'stubborn.test.js'))}], concurrency: 1, testTimeoutMs: 1_000, killGraceMs: 30_000 })`,
        "console.log('the recording ended by itself')",
      ].join('\n'),
    )
    const helper = spawn(process.execPath, [helperPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name !== 'NODE_TEST_CONTEXT',
        ),
      ),
    })
    context.after(() => helper.kill('SIGKILL'))
    let output = ''
    helper.stdout.on('data', (chunk) => (output += chunk))
    const ended = new Promise((resolve) =>
      helper.on('close', (code, signal) => resolve({ code, signal })),
    )
    const [filePid] = await waitForPids(pidsPath, 1, 30_000)
    const [abortSeenBy] = await waitForPids(sigtermPath, 1, 30_000)
    // gstack-timing-ok: the abort's SIGTERM has reached the file, so the run's events end at once; one second lets the recording reach its wait for the file processes, which lasts the 30 s grace, so the signal lands inside that wait under any load short of a stall of half a minute.
    await delay(1_000)

    // Act
    helper.kill('SIGTERM')
    const result = await ended
    const left = await waitUntilNoneExists([filePid], 10_000)

    // Assert
    assert.deepEqual(
      {
        abortReachedTheFile: filePid !== undefined && abortSeenBy === filePid,
        code: result.code,
        signal: result.signal,
        endedByItself: output.includes('the recording ended by itself'),
        processesLeft: left,
      },
      {
        abortReachedTheFile: true,
        code: 143,
        signal: null,
        endedByItself: false,
        processesLeft: [],
      },
    )
  },
)

/** Runs the recording on a fixture build of one test file and answers what it printed and which of the file's processes still ran after it ended; the file notes its pid in `pids.log`. @example const { result, left } = await recordFixtureFile(context, 'a.test.js', source) */
async function recordFixtureFile(context, file, source) {
  const root = await createFixtureExtension(context, {
    tests: { [file]: source },
  })
  const pidsPath = join(root, 'dist/tests/pids.log')
  killNotedProcessesAfter(context, pidsPath)
  const startedAt = Date.now()
  const result = await runShardScript(
    root,
    ['--record', '--silence-seconds', '3'],
    45_000,
  )
  const elapsedMs = Date.now() - startedAt
  const left = await waitUntilNoneExists(await readPids(pidsPath), 10_000)
  const timings = await readFile(join(root, 'test-timings.json'), 'utf8').catch(
    () => 'no file',
  )
  return { result, left, elapsedMs, timings }
}

// Value: protects=the timings recording from a `before` hook that does not end: the runner fails the hook's tests as `hookFailed` (for its time) and the file's process keeps running, so the recording used to wait for the job's end; it now ends with the hook's test named and no process left; fails_when=only a test the runner failed for its time ends the recording, so a hung hook is waited for until the job is cancelled, or the file's process is left running; why_new=Cycle 0048 task 149 (native adversarial: still running 15 s after a 1 s limit); Cycle 0048 task 166 pins the refusal as the one line `✖ <sentence>` on stderr, with no stack frame and no `Error:` prefix; seam=test-shard.mjs --record on a fixture build whose file has a `before` hook that holds a timer, with a 3 s limit; no_claim=an `after` hook (the same failure type)
test(
  'the timings recording ends a before hook that does not end, names its test and leaves no process',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const source = [
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const { before, test } = require('node:test')",
      "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
      'before(() => new Promise(() => setInterval(() => {}, 1_000)))',
      "test('first', () => {})",
    ].join('\n')

    // Act
    const { result, left, elapsedMs, timings } = await recordFixtureFile(
      context,
      'hook.test.js',
      source,
    )

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        sentence:
          /^✖ hook\.test\.js: a hook of "first" did not end within 3 s and was ended; timings were not recorded\.\n$/.test(
            result.stderr,
          ),
        // gstack-timing-ok: the 3 s limit ends the hook; the recording must end long before the 45 s bound of the script, which a recording that waits for the file would reach.
        endedInTime: elapsedMs < 30_000,
        processesLeft: left,
        timings,
      },
      {
        code: 1,
        sentence: true,
        endedInTime: true,
        processesLeft: [],
        timings: 'no file',
      },
    )
  },
)

// Value: protects=the timings recording of a file whose `before` hook throws: the runner fails the hook's test as `hookFailed` with the thrown error as its cause, and the recording refuses it as a failed test, not as a hook that did not end; fails_when=`failedForTime` takes every `hookFailed` for a hook the runner ended for its time, so a hook that threw aborts the run and the refusal says it did not end within the limit; why_new=Cycle 0048 task 192 (Step 7 of the third /ship: the hook test above gives `hookFailed` the runner's timeout cause only; no test gave it an error); seam=test-shard.mjs --record on a fixture build whose file has a `before` hook that throws, with a 3 s limit; no_claim=other causes of `hookFailed` on a Node release later than 24.21 (one fixture on the runner in use)
test(
  'the timings recording of a file whose before hook throws is refused as failed tests, not as a hook that did not end',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const source = [
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const { before, test } = require('node:test')",
      "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
      "before(() => { throw new Error('the setup broke') })",
      "test('first', () => {})",
    ].join('\n')

    // Act
    const { result, left, timings } = await recordFixtureFile(
      context,
      'throwing-hook.test.js',
      source,
    )

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        stderr: result.stderr,
        processesLeft: left,
        timings,
      },
      {
        code: 1,
        stderr:
          '✖ 1 test failed; timings were not recorded: throwing-hook.test.js › first.\n',
        processesLeft: [],
        timings: 'no file',
      },
    )
  },
)

// Value: protects=the timings recording from a file whose process does not exit after its tests passed (a timer left at the top level): the file sends nothing more, so the recording used to wait for it for ever; it now ends after the limit and 5 s more with the file named and no process left; fails_when=the recording ends only at a failed test, so a file that passed its tests and holds the process open holds the recording, or the refusal names the limit alone as the time the run sent nothing; why_new=Cycle 0048 task 149 (native adversarial: a file process that does not exit sends nothing more); Cycle 0048 task 166 pins the refusal as the one line `✖ <sentence>` on stderr, with no stack frame and no `Error:` prefix; Cycle 0048 task 168 (Step 8 of the third /ship: the sentence said 3 s where the run had sent nothing for 8 s); seam=test-shard.mjs --record on a fixture build whose file passes its test and leaves a timer, with a 3 s limit (the run's silence bound is that and 5 s more); no_claim=why the margin is 5 s (the runner's own timeout event comes first within it)
test(
  'the timings recording ends a run that sends nothing for the limit plus 5 s, names the file that did not end, with that time, and leaves no process',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const source = [
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const { test } = require('node:test')",
      "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
      "test('passes', () => {})",
      'setInterval(() => {}, 1_000)',
    ].join('\n')

    // Act
    const { result, left, elapsedMs, timings } = await recordFixtureFile(
      context,
      'lingering.test.js',
      source,
    )

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        sentence:
          /^✖ The run sent nothing for 8 s and was ended; lingering\.test\.js started and did not end; timings were not recorded\.\n$/.test(
            result.stderr,
          ),
        // gstack-timing-ok: the run's silence bound is the 3 s limit and 5 s of margin; the recording must end long before the 45 s bound of the script.
        endedInTime: elapsedMs < 30_000,
        processesLeft: left,
        timings,
      },
      {
        code: 1,
        sentence: true,
        endedInTime: true,
        processesLeft: [],
        timings: 'no file',
      },
    )
  },
)

// Value: protects=the reader of a recording that was ended for its silence while other files had ended: the refusal names only the files that started and did not end, so the file to look at is the one named; fails_when=a file is not taken off the running files at its own summary or completion (`followFile`), so a file that passed and ended is named beside the one that holds the run open; why_new=Cycle 0048 task 193 (Step 7 of the third /ship: the silence tests above run one file a recording, so the files that ended are never in a sentence); seam=test-shard.mjs --record on a fixture build of a file that passes and ends (it sorts first) and a file that passes and leaves a timer, with a 3 s limit; no_claim=the runner's event order for many files at once (two files run here)
test(
  'the timings recording of a run that sends nothing names only the file that did not end, not a file that ended before',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await createFixtureExtension(context, {
      tests: {
        // It sorts before the other file, so it starts first and ends even where the recording runs one file at a time.
        'early.test.js': [
          "const { test } = require('node:test')",
          "test('passes', () => {})",
        ].join('\n'),
        'lingering.test.js': [
          "const { appendFileSync } = require('node:fs')",
          "const { join } = require('node:path')",
          "const { test } = require('node:test')",
          "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
          "test('passes', () => {})",
          'setInterval(() => {}, 1_000)',
        ].join('\n'),
      },
    })
    const pidsPath = join(root, 'dist/tests/pids.log')
    killNotedProcessesAfter(context, pidsPath)

    // Act
    const result = await runShardScript(
      root,
      ['--record', '--silence-seconds', '3'],
      45_000,
    )
    const left = await waitUntilNoneExists(await readPids(pidsPath), 10_000)

    // Assert
    assert.deepEqual(
      { code: result.code, stderr: result.stderr, processesLeft: left },
      {
        code: 1,
        stderr:
          '✖ The run sent nothing for 8 s and was ended; lingering.test.js started and did not end; timings were not recorded.\n',
        processesLeft: [],
      },
    )
  },
)

// Value: protects=the timings recording with the longest silence limit the option accepts: the run's silence bound is the limit plus 5 s capped at what a timer can wait, so the recording of a passing run is not ended at once by a timer that Node fires immediately (`--silence-seconds 2147483` plus 5 s passed the timer's limit of 2,147,483,647 ms: it printed TimeoutOverflowWarning and ended a run as silent that had just started); fails_when=the bound is the limit plus the margin without a cap, so the recording of one passing test is refused with `✖ The run sent nothing for 2147488 s` and a TimeoutOverflowWarning on stderr; why_new=Cycle 0048 task 177 (native adversarial: the probe `--record --silence-seconds 2147483` exited 1); seam=test-shard.mjs --record --silence-seconds 2147483 started as a process on a fixture build of one passing test; no_claim=the refusal's wording for a silent run at that limit (the sentence's own test below)
test('the timings recording with the longest silence limit the option accepts records a passing test and prints no timer warning', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'passing.test.js': loggingTestSource(['opens']) },
  })

  // Act
  const result = await runShardScript(
    root,
    ['--record', '--silence-seconds', '2147483'],
    30_000,
  )

  // Assert
  assert.deepEqual(
    { code: result.code, stdout: result.stdout, stderr: result.stderr },
    { code: 0, stdout: 'Recorded 1 tests in test-timings.json.\n', stderr: '' },
  )
})

// Value: protects=the reader of a recording that was ended for its silence: the sentence names the silence bound the timer had, in seconds as a person writes them, from the milliseconds {@link collectTestRun} answers; fails_when=the sentence adds the margin itself (so it names a bound the timer did not have once the bound is capped), or prints binary-fraction noise (`5.007000000000001 s`); why_new=Cycle 0048 task 177 (the bound is capped at what a timer can wait, and the refusal names the capped bound); seam=describeUnendedRecording with hard-coded stalls; no_claim=the stall's value for a real run (the recording tests above and below cover it through test-shard.mjs)
test('the refusal of a run that sent nothing names the silence bound in seconds, without binary-fraction noise, also for the timer limit', () => {
  // Arrange
  const sentenceOf = (silentMs) =>
    describeUnendedRecording(
      {
        timedOutTests: [],
        hookTimedOutTests: [],
        stall: { files: ['a.test.js'], silentMs },
      },
      3,
    )

  // Act
  const sentences = [8_000, 5_007, 5_007.000000000001, 2_147_483_647].map(
    sentenceOf,
  )

  // Assert
  assert.deepEqual(sentences, [
    'The run sent nothing for 8 s and was ended; a.test.js started and did not end; timings were not recorded.',
    'The run sent nothing for 5.007 s and was ended; a.test.js started and did not end; timings were not recorded.',
    'The run sent nothing for 5.007 s and was ended; a.test.js started and did not end; timings were not recorded.',
    'The run sent nothing for 2147483.647 s and was ended; a.test.js started and did not end; timings were not recorded.',
  ])
})

// Value: protects=the reader of a recording that was ended for its silence while no file was running (a runner that stopped between files): the refusal still says what ended and that no file was running, in one sentence, instead of naming no file; fails_when=the sentence of a stall with no started file loses that clause, joins an empty list into `started and did not end`, or answers nothing; why_new=Cycle 0048 task 174 (Step 7 of the third /ship: no test reached this branch; task 177 moved the sentence into describeUnendedRecording, which takes a stall without a run); seam=describeUnendedRecording with a hard-coded stall; no_claim=a real run that goes silent with no file running, which only a runner that hangs between files produces
test('the refusal of a run that sent nothing while no file was running says so in one sentence', () => {
  // Arrange
  const recording = {
    timedOutTests: [],
    hookTimedOutTests: [],
    stall: { files: [], silentMs: 125_000 },
  }

  // Act
  const sentence = describeUnendedRecording(recording, 120)

  // Assert
  assert.equal(
    sentence,
    'The run sent nothing for 125 s and was ended; no file was running; timings were not recorded.',
  )
})

// Value: protects=the timings recording from a hung test whose file ignores SIGTERM: the runner's abort sends SIGTERM to the file, which keeps running; the recording waits for the file within the grace and then kills every process under it with SIGKILL; fails_when=the recording ends at the abort and leaves the file's process (it was running 15 s after the recording ended), or the kill is missing after the grace; why_new=Cycle 0048 task 149 (after an abort, a test file that ignores SIGTERM keeps running); Cycle 0048 task 166 pins the refusal as the one line `✖ <sentence>` on stderr, with no stack frame and no `Error:` prefix; seam=test-shard.mjs --record on a fixture build whose test ignores SIGTERM and hangs, with a 3 s limit and the 5 s grace; no_claim=a file that ends at SIGTERM (the recording above covers the hung test's sentence)
test(
  'the timings recording ends a hung test whose file ignores SIGTERM, names the test and leaves no process',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Act
    const { result, left, elapsedMs, timings } = await recordFixtureFile(
      context,
      'stubborn.test.js',
      hangingFileNotingItsPid({ ignoresSigterm: true }),
    )

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        sentence:
          /^✖ stubborn\.test\.js: "never ends" did not end within 3 s and was ended; timings were not recorded\.\n$/.test(
            result.stderr,
          ),
        // gstack-timing-ok: the 3 s limit and the 5 s grace end the recording; it must end long before the 45 s bound of the script.
        endedInTime: elapsedMs < 30_000,
        processesLeft: left,
        timings,
      },
      {
        code: 1,
        sentence: true,
        endedInTime: true,
        processesLeft: [],
        timings: 'no file',
      },
    )
  },
)

/** Runs {@link collectTestRun} on one fixture file in a helper process of its own (a script file: `run()` starts the test files with the flags of its process, and `--input-type` would make them fail) and answers what the helper printed after the call returned: how it ended, the number of SIGINT, SIGTERM and SIGHUP handlers, and the process ids under the helper. @example await collectInHelper(directory, 'passing.test.js') // => { outcome: 'passed', SIGINT: 0, SIGTERM: 0, SIGHUP: 0, under: [] } */
async function collectInHelper(directory, file) {
  const helperPath = join(directory, `record-${file}.mjs`)
  await writeFile(
    helperPath,
    [
      `import { collectTestRun } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/collectTestRun.mjs')).href)}`,
      `import { listProcessIdsUnder } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/listProcessIdsUnder.mjs')).href)}`,
      `import { readProcessStates } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/readProcessStates.mjs')).href)}`,
      // gstack-timing-ok: the limit of a test (and of a hook) is the contract of the hung cases: they must end by it, 1 s after their start, and well before the silence bound below (6 s later), which a loaded runner needs for the events that follow the start.
      // gstack-timing-ok: the silence bound is 1 s + 6 s = 7 s: far above the 2 s a loaded runner needs to start a file (the fixtures busy-wait 2 s at their start) and send its first event, so only the silent case, whose file sends nothing after its tests, ends by it.
      `const run = await collectTestRun({ files: [${JSON.stringify(join(directory, file))}], concurrency: 1, testTimeoutMs: 1_000, stallMarginMs: 6_000, killGraceMs: 2_000 })`,
      "const outcome = run.stall ? 'silent' : run.hookTimedOutTests.length > 0 ? 'hook-hung' : run.timedOutTests.length > 0 ? 'test-hung' : 'passed'",
      // A file process killed at the end of the call runs nothing, but stays in the table as a zombie (Z) until this process reaps it a moment later (macOS lists it at once); only a process that still runs counts.
      'const found = listProcessIdsUnder(process.pid)',
      'const states = readProcessStates(found)',
      "const running = found.filter((pid) => states?.get(pid) !== 'Z')",
      "console.log(JSON.stringify({ outcome, SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM'), SIGHUP: process.listenerCount('SIGHUP'), under: running }))",
    ].join('\n'),
  )
  const helper = spawn(process.execPath, [helperPath], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== 'NODE_TEST_CONTEXT',
      ),
    ),
  })
  let output = ''
  helper.stdout.on('data', (chunk) => (output += chunk))
  // A call that never returns (its file ignores SIGTERM and nothing kills it) is answered as such after 60 s, and the helper is ended; the longest honest call (a start-up stall, the 7 s silence bound, the 2 s grace) takes about a fifth of that.
  const deadline = setTimeout(() => helper.kill('SIGKILL'), 60_000)
  await new Promise((resolve) => helper.on('close', resolve))
  clearTimeout(deadline)
  const lastLine = output.trim().split('\n').at(-1)
  return lastLine
    ? JSON.parse(lastLine)
    : { outcome: 'the call did not return' }
}

// Value: protects=the process that runs the timings recording from a signal handler or a file process that outlives the call: once {@link collectTestRun} returns, no SIGINT, SIGTERM or SIGHUP handler is left (a handler would keep a later signal from ending the script by Node's default) and no process runs under it, for a passing run, a test that did not end, a `before` hook that did not end and a silent run (a file that passed its tests and keeps its process), the three ended runs with a file that ignores SIGTERM; fails_when=the outer `finally` drops `releaseSignalEnd()` (three handlers are left), or the SIGKILL after the grace is dropped (the file that ignores SIGTERM is still running); why_new=Cycle 0048 task 187 (State machines: no test showed the end state of the call, only the signal during its wait); seam=collectTestRun in a helper process per fixture file, with a 1 s limit, 6 s of margin (a silence bound of 7 s, far above the 2 s busy-wait at the start of every fixture file that stands for a loaded runner) and a 2 s grace, the helper printing its listener counts and listProcessIdsUnder(process.pid) after the call returned; no_claim=a signal during the call (the two recording tests of signals), Windows, where the table answers nothing
test(
  'the timings recording leaves no signal handler and no file process once it returns, for a passing run, a test or a hook that did not end, and a silent run',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-recording-end-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    killNotedProcessesAfter(context, join(directory, 'pids.log'))
    const notePid = [
      "const { appendFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const { before, test } = require('node:test')",
      "appendFileSync(join(__dirname, 'pids.log'), `${process.pid}\\n`)",
      // gstack-timing-ok: a busy-wait of 2 s at the start of every file stands for a loaded runner that needs seconds to start a file and send its first event; the silence bound must not read it as a silent run.
      'for (const until = Date.now() + 2_000; Date.now() < until; );',
    ]
    const ignoresSigterm = "process.on('SIGTERM', () => {})"
    const sources = {
      'passing.test.js': [...notePid, "test('passes', () => {})"],
      'hung-test.test.js': [
        ...notePid,
        ignoresSigterm,
        "test('never ends', () => new Promise(() => setInterval(() => {}, 1_000)))",
      ],
      'hung-hook.test.js': [
        ...notePid,
        ignoresSigterm,
        'before(() => new Promise(() => setInterval(() => {}, 1_000)))',
        "test('first', () => {})",
      ],
      'silent.test.js': [
        ...notePid,
        ignoresSigterm,
        "test('passes', () => {})",
        'setInterval(() => {}, 1_000)',
      ],
    }
    for (const [file, lines] of Object.entries(sources))
      await writeFile(join(directory, file), lines.join('\n'))

    // Act
    const ends = await Promise.all(
      Object.keys(sources).map((file) => collectInHelper(directory, file)),
    )

    // Assert
    const noHandlerNoProcess = { SIGINT: 0, SIGTERM: 0, SIGHUP: 0, under: [] }
    assert.deepEqual(ends, [
      { outcome: 'passed', ...noHandlerNoProcess },
      { outcome: 'test-hung', ...noHandlerNoProcess },
      { outcome: 'hook-hung', ...noHandlerNoProcess },
      { outcome: 'silent', ...noHandlerNoProcess },
    ])
  },
)

/**
 * Runs {@link collectTestRun} in a helper process of its own whose `node:test` is a stand-in module, and answers how the call ended and what it left behind. A resolve hook in the helper gives `collectTestRun.mjs` the stand-in (`registerHooks` of `node:module`, matched on the specifier and the importing module), so the code under test has no seam for it; `node:test` stays Node's own everywhere else.
 * Called by the tests of the recording's failure paths, which the real `run()` cannot reach through its options.
 * @param context - The running test: the folder of the stand-in and the helper is removed when it ends, and every process the stand-in noted in `pids.log` or started under the test process is ended.
 * @param standInSource - The source of the stand-in module (ESM) that exports `run`; it may note a process id with `appendFileSync(process.env.STAND_IN_PIDS_PATH, …)` and read `process.env.STAND_IN_SLEEP_SECONDS`.
 * @returns `{ error, SIGINT, SIGTERM, SIGHUP, timers, under, noted, notedByTheTest }`: the message the call rejected with (`undefined` when it did not reject), the listener counts, the active `Timeout` count, the ids under the helper, whether each noted process id still ran in the helper after the call settled and a short wait, and the ids the stand-in noted.
 * @throws When the helper printed no result (it crashed or was ended at 60 s), with its exit code, signal and error output.
 * @example
 * const ended = await collectWithStandInRun(context, 'export const run = () => { throw new Error("options refused") }')
 * // => { error: 'options refused', SIGINT: 0, SIGTERM: 0, SIGHUP: 0, timers: 0, under: [], noted: {}, notedByTheTest: [] }
 */
async function collectWithStandInRun(context, standInSource) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-stand-in-run-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const pidsPath = join(directory, 'pids.log')
  killNotedProcessesAfter(context, pidsPath)
  const standInPath = join(directory, 'stand-in-test.mjs')
  await writeFile(standInPath, standInSource)
  const collectUrl = pathToFileURL(
    join(scriptsDirectory, 'utils/collectTestRun.mjs'),
  ).href
  const helperPath = join(directory, 'collect-with-stand-in.mjs')
  await writeFile(
    helperPath,
    [
      "import { readFileSync } from 'node:fs'",
      "import { registerHooks } from 'node:module'",
      "import { setTimeout as delay } from 'node:timers/promises'",
      `import { listProcessIdsUnder } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/listProcessIdsUnder.mjs')).href)}`,
      'registerHooks({',
      '  resolve(specifier, context, nextResolve) {',
      `    if (specifier === 'node:test' && context.parentURL === ${JSON.stringify(collectUrl)})`,
      `      return { url: ${JSON.stringify(pathToFileURL(standInPath).href)}, shortCircuit: true }`,
      '    return nextResolve(specifier, context)',
      '  },',
      '})',
      `const { collectTestRun } = await import(${JSON.stringify(collectUrl)})`,
      'let error',
      "await collectTestRun({ files: ['/fixture/stand-in.test.js'], concurrency: 1, testTimeoutMs: 1_000, killGraceMs: 2_000 }).catch((rejection) => { error = rejection.message })",
      // A killed child is reaped by this process a moment after the kill; the timers are counted after this wait, so a stall timer (1.5 s) that was left is still there.
      'await delay(300)',
      'const exists = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }',
      "const notedIds = (() => { try { return readFileSync(process.env.STAND_IN_PIDS_PATH, 'utf8').split('\\n').filter(Boolean).map(Number) } catch { return [] } })()",
      "console.log(JSON.stringify({ error, SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM'), SIGHUP: process.listenerCount('SIGHUP'), timers: process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length, under: listProcessIdsUnder(process.pid), noted: Object.fromEntries(notedIds.map((pid) => [pid, exists(pid)])), notedByTheTest: notedIds }))",
    ].join('\n'),
  )
  return await new Promise((resolve, reject) => {
    const helper = spawn(process.execPath, [helperPath], {
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT',
          ),
        ),
        STAND_IN_PIDS_PATH: pidsPath,
        STAND_IN_SLEEP_SECONDS: String(
          86_400 + Math.floor(Math.random() * 10_000),
        ),
      },
    })
    let stdout = ''
    let stderr = ''
    helper.stdout.on('data', (chunk) => (stdout += chunk))
    helper.stderr.on('data', (chunk) => (stderr += chunk))
    helper.on('error', reject)
    helper.on('close', (code, signal) => {
      // A helper that crashed or printed nothing must fail the test with what it did, not with a JSON error from inside this handler.
      try {
        resolve(JSON.parse(stdout.trim().split('\n').at(-1)))
      } catch {
        reject(
          new Error(
            `The stand-in helper printed no result (exit code ${code}, signal ${signal}). Output: ${JSON.stringify(stdout)}. Error output: ${JSON.stringify(stderr)}`,
          ),
        )
      }
    })
  })
}

// Value: protects=the process that runs the timings recording from a call whose `run()` refuses its options and throws: the call rejects with the refusal and leaves no stall timer and no SIGINT, SIGTERM or SIGHUP handler behind (a handler would keep a later signal from ending the script by Node's default, and the timer would hold the process for the limit); fails_when=`run()` is called after the stall timer and the signal handlers start and outside the `try` whose `finally` releases them, so a throw leaves one timer and three handlers; why_new=Cycle 0048 task 206 (OCR C: the parent's probe of d9f0919b left one SIGTERM handler and one timer); seam=collectTestRun in a helper process whose `node:test` is a stand-in module (a resolve hook, no seam in the code) with a `run` that throws `options refused`; no_claim=that Node's real `run()` throws for any of these options (task 173: it does not today)
test('the timings recording that is refused by run() rejects with the refusal and leaves no stall timer and no signal handler', async (context) => {
  // Arrange
  const standIn = 'export function run() { throw new Error("options refused") }'

  // Act
  const ended = await collectWithStandInRun(context, standIn)

  // Assert
  assert.deepEqual(ended, {
    error: 'options refused',
    SIGINT: 0,
    SIGTERM: 0,
    SIGHUP: 0,
    timers: 0,
    under: [],
    noted: {},
    notedByTheTest: [],
  })
})

// Value: protects=the process that runs the timings recording from an event stream that throws after a file started (task 173: the stream cannot throw through run()'s options today, so this is the catch's own contract): the call ends every process under it, removes the signal handlers and the timers, and passes the stream's error on; fails_when=the catch drops endProcessesUnderThisOne() (the process that stands for the file keeps running) or the outer `finally` drops releaseSignalEnd() (three handlers stay); why_new=Cycle 0048 task 207 (State machines: no test reached the catch of a run whose event stream throws); seam=collectTestRun in a helper process whose `node:test` is a stand-in module (a resolve hook, no seam in the code) with a `run` whose stream yields the `test:dequeue` of a file, starts `sleep` with a unique duration under the helper (its id noted) and throws `stream refused`; no_claim=that Node's run() can reject (task 173's evidence stands); Windows, where the table answers nothing
test(
  'the timings recording whose event stream throws ends the file process, removes the signal handlers and timers, and passes the error on',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const standIn = [
      "import { spawn } from 'node:child_process'",
      "import { appendFileSync } from 'node:fs'",
      'export function run() {',
      '  return (async function* () {',
      // The process that stands for the file's process, found by the recording through the process table.
      "    const fileProcess = spawn('sleep', [process.env.STAND_IN_SLEEP_SECONDS], { stdio: 'ignore' })",
      '    appendFileSync(process.env.STAND_IN_PIDS_PATH, `${fileProcess.pid}\\n`)',
      "    yield { type: 'test:dequeue', data: { file: '/fixture/stand-in.test.js', name: '/fixture/stand-in.test.js', nesting: 0 } }",
      "    throw new Error('stream refused')",
      '  })()',
      '}',
    ].join('\n')

    // Act
    const ended = await collectWithStandInRun(context, standIn)

    // Assert
    const [fileProcessId] = ended.notedByTheTest
    assert.deepEqual(
      {
        error: ended.error,
        SIGINT: ended.SIGINT,
        SIGTERM: ended.SIGTERM,
        SIGHUP: ended.SIGHUP,
        timers: ended.timers,
        under: ended.under,
        notedProcesses: ended.notedByTheTest.length,
        fileProcessRunsInTheHelper: ended.noted[fileProcessId],
        fileProcessRunsForTheTest: processExists(fileProcessId),
      },
      {
        error: 'stream refused',
        SIGINT: 0,
        SIGTERM: 0,
        SIGHUP: 0,
        timers: 0,
        under: [],
        notedProcesses: 1,
        fileProcessRunsInTheHelper: false,
        fileProcessRunsForTheTest: false,
      },
    )
  },
)

// Value: protects=the shard script's count of a call and the pre-gate's combined summary: only the last complete block of `ℹ tests`, `ℹ pass` and `ℹ fail` lines at column 0 is the runner's own; a block that a printed line breaks in the middle, a block without `ℹ tests` and a block the runner died in count nothing, and the lines that follow a complete block join it; fails_when=a line between two summary lines does not end the block, so a test that prints `ℹ tests 5`, `ℹ pass 5`, a line of its own and `ℹ fail 0` is counted as the runner's summary; why_new=testShards and pregateTests read the last block of a whole run, not these breaks inside one block; seam=none; no_claim=what Node prints for a real run; the outputs are hard-coded strings
test('the last summary block is read only when it is whole, and a line a test printed between two summary lines ends the block', () => {
  // Arrange
  const brokenByPrintedLine = 'ℹ tests 5\nℹ pass 5\nprinted by a test\nℹ fail 0'
  const withoutTests = 'ℹ pass 5\nℹ fail 0'
  const died = 'ℹ tests 2\nℹ pass 2\nℹ fail 0\n✔ next\nℹ tests 99\nℹ pass 99'
  const withDuration =
    'ℹ tests 2\nℹ suites 1\nℹ pass 1\nℹ fail 1\nℹ duration_ms 12.5'

  // Act
  const answers = [brokenByPrintedLine, withoutTests, died, withDuration].map(
    readRunSummary,
  )

  // Assert
  assert.deepEqual(answers, [
    undefined,
    undefined,
    { tests: 2, pass: 2, fail: 0 },
    { tests: 2, suites: 1, pass: 1, fail: 1, duration_ms: 12.5 },
  ])
})

// Value: protects=the bounded reader of the summary: a summary line is short, so a count of more than 15 digits (or a fraction of more than 20 digits) is no summary line and breaks the block, which lets the output keeper drop a long line unread and still agree with the whole-output reading; fails_when=a line of 16 digits is read as a count again, so the keeper's reading of a long line and this reading differ; why_new=Cycle 0048 task 153 (the keeper holds only lines of up to 100 characters); seam=none; no_claim=a count a real runner prints; the outputs are hard-coded strings
test('a summary line with a count of 16 digits is no summary line and breaks the block, and 15 digits still count', () => {
  // Arrange
  const tooLong = 'ℹ tests 2\nℹ pass 1\nℹ fail 9999999999999999'
  const longestCount = 'ℹ tests 2\nℹ pass 1\nℹ fail 999999999999999'

  // Act
  const answers = [tooLong, longestCount].map(readRunSummary)

  // Assert
  assert.deepEqual(answers, [
    undefined,
    { tests: 2, pass: 1, fail: 999999999999999 },
  ])
})

/** Writes a script that prints text and then ends, into a fresh folder, for the tests that need a runner with a known amount of output. @example const path = await writeScript(context, "console.log('hello')") */
async function writeScript(context, source) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-printing-script-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'script.cjs')
  await writeFile(path, source)
  return path
}

// Value: protects=the memory of the shard script: a call that prints far more than the bound keeps the end of its output (the failing tests and the summary come last) with a note of what was left out, never every byte; fails_when=runTestInvocation keeps the whole output of a call, so a test that prints without end makes the runner run out of memory; why_new=Cycle 0048 task 134 (Codex adversarial, native adversarial); seam=runTestInvocation with a stand-in runner script that prints 20 000 numbered lines and a summary, and a bound of 2 000 characters; no_claim=the bound of the shard script itself (TEST_OUTPUT_KEEP_CHARS), whose size is a constant
test('a call that prints more than the output bound keeps the end of its output and a note of what was left out', async (context) => {
  // Arrange
  const runnerPath = await writeScript(
    context,
    [
      'for (let line = 1; line <= 20_000; line += 1) console.log(`printed line ${line}`)',
      "console.log('ℹ tests 3\\nℹ pass 3\\nℹ fail 0')",
    ].join('\n'),
  )

  // Act
  const result = await runTestInvocation({ files: [] }, tmpdir(), {
    runnerArguments: [runnerPath],
    outputKeepChars: 2_000,
  })

  // Assert
  const lines = result.output.split('\n')
  assert.equal(result.code, 0)
  assert.equal(result.output.length < 2_400, true)
  assert.match(
    lines[0],
    /^\[… \d+ characters of earlier output left out; at most the last 2000 are kept\]$/,
  )
  assert.equal(result.output.includes('printed line 1\n'), false)
  assert.deepEqual(lines.slice(-4), ['ℹ tests 3', 'ℹ pass 3', 'ℹ fail 0', ''])
  assert.equal(lines.at(-5), 'printed line 20000')
})

// Value: protects=the shard script's count of a call whose stderr writes in the middle of a summary line of stdout (a pipe cuts lines anywhere): the call that passed still counts its tests; fails_when=the output keeper holds one unfinished line for both streams, so the chunk of stderr splices the summary line and the script fails a passing call as one that ran no test; why_new=Cycle 0048 task 205 (native adversarial: one unfinished line for stdout and stderr together); seam=runTestInvocation with a stand-in runner script that writes `ℹ tests 2\nℹ pa` to stdout, a line to stderr and `ss 2\nℹ fail 0` to stdout, 150 ms apart so that each is a chunk of its own; no_claim=the chunk sizes of a real runner
test('a call whose stderr writes in the middle of a summary line of stdout still counts the tests of its summary', async (context) => {
  // Arrange
  const runnerPath = await writeScript(
    context,
    [
      "process.stdout.write('ℹ tests 2\\nℹ pa')",
      "setTimeout(() => process.stderr.write('warning: a test wrote to stderr\\n'), 150)",
      "setTimeout(() => process.stdout.write('ss 2\\nℹ fail 0\\n'), 300)",
    ].join('\n'),
  )

  // Act
  const result = await runTestInvocation({ files: [] }, tmpdir(), {
    runnerArguments: [runnerPath],
  })

  // Assert
  assert.equal(result.code, 0)
  assert.deepEqual(readRunSummary(result.output), {
    tests: 2,
    pass: 2,
    fail: 0,
  })
})

// Value: protects=the timings recording from a test that never ends: the recording ends with that test named and failed, and writes no timings file; fails_when=`--record` runs with no limit, so one hung test holds the recording until the job is cancelled; why_new=Cycle 0048 task 57 (Red Team: task 25's limit covered one entry point of three); Cycle 0048 task 166 pins the refusal as the one line `✖ <sentence>` on stderr, with no stack frame and no `Error:` prefix; seam=test-shard.mjs --record started as a process on a fixture build with a 3 s limit; no_claim=the default limit (120 s) and the timings of a recording that passes
test('the timings recording ends a test that never ends, names it and writes no timings file', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: {
      'hanging.test.js': [
        "const { test } = require('node:test')",
        "test('finishes first', () => {})",
        "test('never ends', () => new Promise(() => setInterval(() => {}, 1_000)))",
      ].join('\n'),
    },
  })

  // Act
  const result = await runShardScript(
    root,
    ['--record', '--silence-seconds', '3'],
    30_000,
  )

  // Assert
  assert.equal(result.code, 1)
  assert.equal(
    result.stderr,
    '✖ hanging.test.js: "never ends" did not end within 3 s and was ended; timings were not recorded.\n',
  )
  assert.equal(
    await readFile(join(root, 'test-timings.json'), 'utf8').catch(
      () => 'no file',
    ),
    'no file',
  )
})

// Value: protects=the shard plan's input: a passing recording writes `test-timings.json` with every file, its `totalMs`, and the named tests of a file slow enough to split, and says how many tests it recorded; fails_when=the recording writes nothing, leaves a file out, keeps per-test durations of a quick file or none for a slow one, or counts wrongly; why_new=Cycle 0048 task 86 (Step 7: only the hang of the recording was tested); seam=test-shard.mjs --record started as a process on a fixture build, with the fixture's copy of SPLIT_TEST_FILE_MS lowered to 200 ms so that a file of two 300 ms tests is a slow file; no_claim=the 8 s limit of the product, which buildTestTimings' own test covers
test('the timings recording writes every file with its total and the named tests of a slow file, and counts the tests it recorded', async (context) => {
  // Arrange
  const sleepTest = (name) =>
    `test(${JSON.stringify(name)}, () => new Promise((resolve) => setTimeout(resolve, 300)))`
  const root = await createFixtureExtension(context, {
    tests: {
      'quick.test.js': loggingTestSource(['opens']),
      'slow.test.js': [
        "const { test } = require('node:test')",
        sleepTest('waits for the first deadline'),
        sleepTest('waits for the second deadline'),
      ].join('\n'),
    },
  })
  const constantsPath = join(root, 'scripts/utils/testShardConstants.mjs')
  const constants = await readFile(constantsPath, 'utf8')
  const lowered = constants.replace(
    'SPLIT_TEST_FILE_MS = 8_000',
    'SPLIT_TEST_FILE_MS = 200',
  )
  assert.notEqual(lowered, constants)
  await writeFile(constantsPath, lowered)

  // Act
  const result = await runShardScript(root, ['--record'], 30_000)

  // Assert
  const timings = JSON.parse(
    await readFile(join(root, 'test-timings.json'), 'utf8'),
  )
  const slow = timings.files['slow.test.js']
  assert.deepEqual(
    {
      code: result.code,
      stdout: result.stdout,
      files: Object.keys(timings.files),
      quickKeys: Object.keys(timings.files['quick.test.js']),
      slowKeys: Object.keys(slow),
      slowTests: Object.keys(slow.tests),
    },
    {
      code: 0,
      stdout: 'Recorded 3 tests in test-timings.json.\n',
      files: ['quick.test.js', 'slow.test.js'],
      quickKeys: ['totalMs'],
      slowKeys: ['totalMs', 'tests'],
      slowTests: [
        'waits for the first deadline',
        'waits for the second deadline',
      ],
    },
  )
  // gstack-timing-ok: a timer never fires early (the 50 ms below its 300 ms is for the timer's rounding), so each test lasted at least 250 ms whatever the load, and the file total is the sum of its two tests, 500 ms or more; the bounds assert no upper time
  assert.deepEqual(
    [
      slow.tests['waits for the first deadline'] >= 250,
      slow.tests['waits for the second deadline'] >= 250,
      slow.totalMs >= 500,
    ],
    [true, true, true],
  )
})

// Value: protects=the shard plan from timings of a failing run: the recording is refused with the number of failed tests and writes no timings file; fails_when=a failing test is recorded as if it had passed (its time is that of a failure), or the file is written before the refusal; why_new=Cycle 0048 task 86 (Step 7: only the hang of the recording was tested); Cycle 0048 task 166 pins the refusal as the one line `✖ <sentence>` on stderr, with no stack frame and no `Error:` prefix; seam=test-shard.mjs --record started as a process on a fixture build with one failing test; no_claim=a hung test, which the recording's hang test above covers
test('the timings recording is refused with the number of failed tests and writes no timings file', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: {
      'failing.test.js': [
        "const { test } = require('node:test')",
        "test('passes', () => {})",
        "test('breaks', () => { throw new Error('broken') })",
      ].join('\n'),
    },
  })

  // Act
  const result = await runShardScript(root, ['--record'], 30_000)

  // Assert
  assert.equal(result.code, 1)
  assert.equal(
    result.stderr,
    '✖ 1 test failed; timings were not recorded: failing.test.js › breaks.\n',
  )
  assert.equal(
    await readFile(join(root, 'test-timings.json'), 'utf8').catch(
      () => 'no file',
    ),
    'no file',
  )
})

/** Writes `contents` as a timings file in a fresh folder and answers the refusal of {@link readTestTimings} (or `undefined` when the file is accepted). @example await refusalOf(context, '{"files":{"a.test.js":{"totalMs":"x"}}}') // => '/tmp/…/test-timings.json has an entry …' */
async function refusalOf(context, contents) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-timings-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const timingsPath = join(directory, 'test-timings.json')
  await writeFile(timingsPath, contents)
  return await readTestTimings(timingsPath).then(
    () => undefined,
    (error) => error.message.replace(timingsPath, '<file>'),
  )
}

// Value: protects=the shard plan from a timings file whose entries are not `{ totalMs, tests? }` (a string, a negative number, a test with a text for its duration): such an entry used to reach the planner, which sums it into NaN and balances the lanes wrongly; fails_when=readTestTimings checks only that `files` is an object; why_new=Cycle 0048 task 62 (CodeRabbit); seam=readTestTimings on files in a temporary folder; no_claim=the planner's use of a valid file, which the planner tests cover
test('a timings file with an entry that is no { totalMs, tests? } of finite durations is refused with the entry named and the way to record it again', async (context) => {
  // Arrange
  const entries = {
    textDuration: '{"files":{"a.test.js":{"totalMs":"invalid"}}}',
    noObjectEntry: '{"files":{"a.test.js":12}}',
    nullEntry: '{"files":{"a.test.js":null}}',
    negativeDuration: '{"files":{"a.test.js":{"totalMs":-1}}}',
    missingDuration: '{"files":{"a.test.js":{"tests":{}}}}',
    textTestDuration:
      '{"files":{"a.test.js":{"totalMs":5,"tests":{"opens":"slow"}}}}',
    negativeTestDuration:
      '{"files":{"a.test.js":{"totalMs":5,"tests":{"opens":-3}}}}',
    listOfTests: '{"files":{"a.test.js":{"totalMs":5,"tests":[1]}}}',
  }

  // Act
  const refusals = []
  for (const contents of Object.values(entries))
    refusals.push(await refusalOf(context, contents))
  const accepted = await refusalOf(
    context,
    '{"files":{"a.test.js":{"totalMs":0},"b.test.js":{"totalMs":9000,"tests":{"opens":4500,"closes":4500}}}}',
  )

  // Assert
  const expectedRefusal =
    '<file> has an entry for "a.test.js" that is not { totalMs, tests? } with finite durations of 0 or more. Build, then record it again with `pnpm --dir extension test:shard --record`.'
  assert.deepEqual(refusals, Array(8).fill(expectedRefusal))
  assert.equal(accepted, undefined)
})

// Value: protects=the shard jobs of CI from a committed `extension/test-timings.json` that the reader refuses (a hand edit, a merge that broke the JSON, a duration that is no finite number): every shard reads that file first and ends at its refusal, and no other test read it; fails_when=the committed file is not `{ files: { [file]: { totalMs, tests? } } }` of finite durations (the reader refuses it), or the reader accepts a copy of it with one duration changed into text; why_new=Cycle 0048 task 191 (Red Team: .gstack/pregate.json gave the file no lane, and each test of the reader and of the plan used a fixture); seam=readTestTimings on the repository's own file by its path from this test file, and on a copy in a temporary folder whose first duration is made text; no_claim=the durations (a recording's scale), and that the entries match the current test files: the planner runs a file the timings do not know (UNKNOWN_TEST_FILE_MS) and plans nothing for an entry of a removed file
test('the committed extension/test-timings.json is accepted by the timings reader, and the same file with a duration made text is refused', async (context) => {
  // Arrange
  const committedPath = join(scriptsDirectory, '../test-timings.json')
  const committed = JSON.parse(await readFile(committedPath, 'utf8'))
  const [firstFile] = Object.keys(committed.files)
  const damaged = {
    files: {
      ...committed.files,
      [firstFile]: { ...committed.files[firstFile], totalMs: 'slow' },
    },
  }

  // Act
  const committedRefusal = await readTestTimings(committedPath).then(
    () => undefined,
    (error) => error.message,
  )
  const damagedRefusal = await refusalOf(context, JSON.stringify(damaged))

  // Assert
  assert.deepEqual(
    {
      committedRefusal,
      damagedRefusal: damagedRefusal?.startsWith(
        `<file> has an entry for ${JSON.stringify(firstFile)} that is not { totalMs, tests? }`,
      ),
    },
    { committedRefusal: undefined, damagedRefusal: true },
  )
})

// Value: protects=the reader of a recording that fails for a reason that is no refusal (here the timings file cannot be written because a folder stands at its path): the failure keeps its error name and its stack, so a defect of the script or of the checkout is not worded as a refusal of the caller; fails_when=the recording's catch turns every error into the one line `✖ <message>`, so a bug in the recording looks like a sentence of the script and its frames are lost; why_new=Cycle 0048 task 166 (a failure that is no refusal keeps its stack) pinned the refusal's one line only, not this other half of the same catch; seam=test-shard.mjs --record started as a process on a fixture build whose test passes and whose `test-timings.json` is a folder; no_claim=which errors other than a write error can reach the catch
test('the timings recording keeps the error name and the stack of a failure that is no refusal, and does not word it as a one-line refusal', async (context) => {
  // Arrange
  const root = await createFixtureExtension(context, {
    tests: { 'passing.test.js': loggingTestSource(['opens']) },
  })
  await mkdir(join(root, 'test-timings.json'))

  // Act
  const result = await runShardScript(root, ['--record'], 30_000)

  // Assert
  assert.deepEqual(
    {
      code: result.code,
      namesTheError: result.stderr.includes('EISDIR'),
      keepsStackFrames: /\n\s+at .*test-shard\.mjs/.test(result.stderr),
      isOneLineRefusal: result.stderr.startsWith('✖'),
      stdout: result.stdout,
    },
    {
      code: 1,
      namesTheError: true,
      keepsStackFrames: true,
      isOneLineRefusal: false,
      stdout: '',
    },
  )
})

// Value: protects=the shard job with several lanes from a script that is ended by a signal: every lane's call is ended with its whole tree, not only one of them, and the script exits with 143; fails_when=the signal handler ends one registered child only (the first or the last one), so the other lane's runner and its test file, which ignores SIGTERM, keep running after the script exited; why_new=the SIGTERM test above runs one lane with one call, so a handler that ends a single child passes it; seam=test-shard.mjs started as a process on a fixture build of two hanging files that ignore SIGTERM, with --lanes 2, sent SIGTERM to its pid alone; no_claim=SIGINT and SIGHUP, and the recording (its own test)
test(
  'the shard script that gets SIGTERM during two lanes ends the whole tree of both lanes and exits with 143',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await createFixtureExtension(context, {
      tests: {
        'first.test.js': hangingFileNotingItsPid({ ignoresSigterm: true }),
        'second.test.js': hangingFileNotingItsPid({ ignoresSigterm: true }),
      },
      timings: {
        files: {
          'first.test.js': { totalMs: 100 },
          'second.test.js': { totalMs: 100 },
        },
      },
    })
    const pidsPath = join(root, 'dist/tests/pids.log')
    killNotedProcessesAfter(context, pidsPath)
    const { child, ended } = startShardScript(context, root, [
      '--shard',
      '1/1',
      '--lanes',
      '2',
    ])
    const filePids = await waitForPids(pidsPath, 2, 30_000)
    const treeBefore = listProcessIdsUnder(child.pid)

    // Act
    child.kill('SIGTERM')
    const result = await ended
    const left = await waitUntilNoneExists(treeBefore, 10_000)

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        signal: result.signal,
        bothFilesRunning: filePids.length,
        treeHeldBothFiles: filePids.every((pid) => treeBefore.includes(pid)),
        processesLeft: left,
      },
      {
        code: 143,
        signal: null,
        bothFilesRunning: 2,
        treeHeldBothFiles: true,
        processesLeft: [],
      },
    )
  },
)

/** Reads the output of a started script until it holds `text` or the wait is over. @example await waitForOutput(() => output, 'ready', 10_000) // => true */
async function waitForOutput(readOutput, text, waitMs) {
  const until = Date.now() + waitMs
  while (!readOutput().includes(text) && Date.now() < until) await delay(25)
  return readOutput().includes(text)
}

// Value: protects=the scripts from a second signal while their children are being ended (Ctrl-C pressed twice, a terminal closed during a cancel): each registered end runs once, an end that throws does not stop the others or the exit, and the exit code is that of the first signal; fails_when=a second signal starts every end again (a tree read and killed twice, a second `taskkill` pair on Windows), a throwing end escapes the handler as an uncaught error with code 1, or the code follows the later signal; why_new=the signal tests run one signal to a script with one end that works; seam=endChildrenOnSignal in a process of its own with two ends (one waits for a release over stdin, one throws) and a SIGINT followed by a SIGTERM; no_claim=what the ends do to real children, which the shard and pre-gate signal tests cover
test(
  'a second signal while the ends are under way starts no end again, an end that throws does not stop the others, and the exit code is the first signal’s',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const moduleUrl = pathToFileURL(
      join(scriptsDirectory, 'utils/endChildrenOnSignal.mjs'),
    ).href
    const source = [
      `import { endChildrenOnSignal } from ${JSON.stringify(moduleUrl)}`,
      'let endsStarted = 0',
      'let release',
      "endChildrenOnSignal(() => { endsStarted += 1; console.log('waiting end started'); return new Promise((resolve) => { release = resolve }) })",
      "endChildrenOnSignal(() => { throw new Error('this child cannot be ended') })",
      "process.on('SIGTERM', () => console.log('second signal seen'))",
      "process.on('exit', () => console.log(`ends started: ${endsStarted}`))",
      "process.stdin.on('data', () => release())",
      "console.log('ready')",
    ].join('\n')
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    context.after(() => child.kill('SIGKILL'))
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (errors += chunk))
    const ended = new Promise((resolve) =>
      child.on('close', (code, signal) => resolve({ code, signal })),
    )
    assert.equal(await waitForOutput(() => output, 'ready', 20_000), true)

    // Act
    child.kill('SIGINT')
    assert.equal(
      await waitForOutput(() => output, 'waiting end started', 20_000),
      true,
    )
    child.kill('SIGTERM')
    assert.equal(
      await waitForOutput(() => output, 'second signal seen', 20_000),
      true,
    )
    child.stdin.write('release\n')
    const result = await ended

    // Assert
    assert.deepEqual(
      {
        code: result.code,
        signal: result.signal,
        endsStarted: /ends started: (\d+)/.exec(output)?.[1],
        errors,
      },
      { code: 130, signal: null, endsStarted: '1', errors: '' },
    )
  },
)

/**
 * Starts a helper process that runs the given module source with {@link endChildrenOnSignal} imported, and answers what it prints, what it writes to stderr and a promise of how it ends; the helper is killed when the test ends. A test of the module runs it in a process of its own, because the module holds its state for the whole process and the signal it handles ends that process.
 * Called by the tests of {@link endChildrenOnSignal}'s releases and late children.
 * @param context - The running test.
 * @param source - The helper's source, after its imports: `endChildrenOnSignal`, `endProcessTree`, `spawn` and `setTimeout as delay` are imported.
 * @returns `{ child, readOutput, readErrors, ended }`: the process, functions that read what it printed so far, and a promise of `{ code, signal }`.
 * @example
 * const { child, readOutput, ended } = startSignalHelper(context, "console.log('ready')")
 */
function startSignalHelper(context, source) {
  const moduleUrl = (name) =>
    JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils', name)).href)
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        `import { endChildrenOnSignal } from ${moduleUrl('endChildrenOnSignal.mjs')}`,
        `import { endProcessTree } from ${moduleUrl('endProcessTree.mjs')}`,
        "import { spawn } from 'node:child_process'",
        "import { setTimeout as delay } from 'node:timers/promises'",
        source,
      ].join('\n'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  context.after(() => child.kill('SIGKILL'))
  let output = ''
  let errors = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (errors += chunk))
  const ended = new Promise((resolve) =>
    child.on('close', (code, signal) => resolve({ code, signal })),
  )
  return {
    child,
    readOutput: () => output,
    readErrors: () => errors,
    ended,
  }
}

/** The signal handlers a helper counts: `[SIGINT, SIGTERM, SIGHUP]` listener counts, as source that a helper defines as `counts()`. */
const HANDLER_COUNTS_SOURCE =
  "const counts = () => ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => process.listenerCount(signal))"

// Value: protects=the handler counts of a script after a child is released twice (a `close` and an `error` of one child both release it): the second release changes nothing, throws nothing, and leaves the handlers as the first one left them, so a child registered afterwards gets the module's handlers once and is ended by a SIGTERM; fails_when=a release counts instead of removing its own end (the second release drops a count that belongs to no child, so the next registration finds the count already at zero and installs no handler, or twice), or a second release throws; why_new=Cycle 0048 task 186 (state machines: no test for a release called twice); seam=endChildrenOnSignal in a helper process of its own that releases its only child twice, counts the listeners, registers a new child and gets a SIGTERM; mutant=a release that does `registered -= 1` and installs the handlers only when `registered === 0` fails this test; no_claim=what the ends do to real children (the shard and pre-gate signal tests)
test(
  'a child released twice leaves no handler behind, and a child registered afterwards is ended by SIGTERM with exit 143',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { child, readOutput, readErrors, ended } = startSignalHelper(
      context,
      [
        HANDLER_COUNTS_SOURCE,
        'const none = counts()',
        'const release = endChildrenOnSignal(() => {})',
        'release()',
        'let secondReleaseThrew = false',
        'try { release() } catch { secondReleaseThrew = true }',
        'const afterTwice = counts()',
        "endChildrenOnSignal(() => { console.log('later child ended') })",
        'console.log(JSON.stringify({ none, afterTwice, secondReleaseThrew, withLaterChild: counts() }))',
        'setInterval(() => {}, 1_000)',
      ].join('\n'),
    )
    assert.equal(
      await waitForOutput(readOutput, 'withLaterChild', 20_000),
      true,
    )

    // Act
    child.kill('SIGTERM')
    const result = await ended

    // Assert
    assert.deepEqual(
      {
        counts: JSON.parse(readOutput().split('\n')[0]),
        laterChildEnded: readOutput().includes('later child ended'),
        code: result.code,
        signal: result.signal,
        errors: readErrors(),
      },
      {
        counts: {
          none: [0, 0, 0],
          afterTwice: [0, 0, 0],
          secondReleaseThrew: false,
          withLaterChild: [1, 1, 1],
        },
        laterChildEnded: true,
        code: 143,
        signal: null,
        errors: '',
      },
    )
  },
)

// Value: protects=a script with two children when one closes: the handlers stay for the other, and a SIGTERM that comes later ends the other child and exits with 143; fails_when=a release removes the handlers while a child is still registered (`liveEnds.size === 0` read as `<= 1`), so the other child is no longer ended and the script is ended by Node's default, with no exit code; why_new=Cycle 0048 task 186 (state machines: no test for releasing one of several children); seam=endChildrenOnSignal in a helper process of its own with two ends, one released, then a SIGTERM; mutant=`liveEnds.size === 0` changed to `liveEnds.size <= 1` in the release fails this test; no_claim=the order the ends run in
test(
  'a script whose first child has closed still ends its second child on SIGTERM and exits with 143',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { child, readOutput, readErrors, ended } = startSignalHelper(
      context,
      [
        HANDLER_COUNTS_SOURCE,
        "const releaseFirst = endChildrenOnSignal(() => { console.log('first child ended') })",
        "endChildrenOnSignal(() => { console.log('second child ended') })",
        'releaseFirst()',
        'console.log(JSON.stringify({ afterFirstRelease: counts() }))',
        'setInterval(() => {}, 1_000)',
      ].join('\n'),
    )
    assert.equal(
      await waitForOutput(readOutput, 'afterFirstRelease', 20_000),
      true,
    )

    // Act
    child.kill('SIGTERM')
    const result = await ended

    // Assert
    assert.deepEqual(
      {
        output: readOutput().split('\n').filter(Boolean),
        code: result.code,
        signal: result.signal,
        errors: readErrors(),
      },
      {
        output: ['{"afterFirstRelease":[1,1,1]}', 'second child ended'],
        code: 143,
        signal: null,
        errors: '',
      },
    )
  },
)

// Value: protects=the exit code of a script whose last child closes while a signal is handled (the end resolves, the child closes, the caller releases): the handlers stay until the exit, so a second signal after that release is still taken by the handler and the exit keeps the first signal's code; fails_when=a release with no child left removes the handlers although a signal is being handled (`&& !isEnding` dropped), so the second signal ends the script by Node's default with no code, or the exit code follows the second signal; why_new=Cycle 0048 task 186 (state machines: no test for a release while a signal is handled); seam=endChildrenOnSignal in a helper process of its own whose only end waits for a line on stdin, a SIGTERM, the release of that child, a SIGINT and then the end's release; mutant=`&& !isEnding` removed from the release fails this test; no_claim=Windows, where a child closes together with its exit
test(
  'a child released while a signal is handled keeps the handlers, so a second signal still exits with the first signal’s code',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { child, readOutput, readErrors, ended } = startSignalHelper(
      context,
      [
        HANDLER_COUNTS_SOURCE,
        'let finishEnd',
        "const release = endChildrenOnSignal(() => new Promise((resolve) => { finishEnd = resolve; console.log('end started') }))",
        "process.stdin.on('data', (chunk) => {",
        "  if (String(chunk).includes('release')) { release(); console.log(JSON.stringify({ afterRelease: counts() })) }",
        "  if (String(chunk).includes('finish')) finishEnd()",
        '})',
        "console.log('ready')",
        'setInterval(() => {}, 1_000)',
      ].join('\n'),
    )
    assert.equal(await waitForOutput(readOutput, 'ready', 20_000), true)
    child.kill('SIGTERM')
    assert.equal(await waitForOutput(readOutput, 'end started', 20_000), true)

    // Act
    child.stdin.write('release\n')
    assert.equal(await waitForOutput(readOutput, 'afterRelease', 20_000), true)
    child.kill('SIGINT')
    // gstack-timing-ok: a signal that no handler takes ends the helper within milliseconds; the wait only gives the SIGINT time to arrive before the end is finished, and a helper that is already gone is seen in `ended`.
    await delay(500)
    child.stdin.write('finish\n')
    const result = await ended

    // Assert
    assert.deepEqual(
      {
        afterRelease: JSON.parse(
          readOutput()
            .split('\n')
            .find((line) => line.includes('afterRelease')),
        ),
        code: result.code,
        signal: result.signal,
        errors: readErrors(),
      },
      {
        afterRelease: { afterRelease: [1, 1, 1] },
        code: 143,
        signal: null,
        errors: '',
      },
    )
  },
)

// Value: protects=a script that registers a child after a signal began to end it (a lane that starts its next call, a build that closes into the next step while the handler still waits): that child is ended at once and the exit waits for its end, so no process outlives the script; fails_when=a child registered while the first ends run is added to the set but never ended (the handler took its list once), so the child runs on after the script exited with 143; why_new=Cycle 0048 task 176 (state machines: the state matrix's cell "child registered after the first signal"); seam=endChildrenOnSignal and endProcessTree in a helper process of its own with a slow first end (it waits for a line on stdin), a SIGTERM, then a real child (a Node process that hangs) registered from a second SIGTERM listener whose end waits 0.7 s more after the child's end; no_claim=Windows, where the end is `taskkill`
test(
  'a child registered after SIGTERM began to end the script is ended at once and waited for before the exit',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { child, readOutput, readErrors, ended } = startSignalHelper(
      context,
      [
        'let finishFirstEnd',
        'endChildrenOnSignal(() => new Promise((resolve) => { finishFirstEnd = resolve }))',
        "process.stdin.on('data', () => finishFirstEnd())",
        "process.on('SIGTERM', () => {",
        "  const late = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })",
        "  const release = endChildrenOnSignal(async () => { await endProcessTree(late); await delay(700); console.log('late end done') })",
        '  console.log(JSON.stringify({ latePid: late.pid, releaseReturns: typeof release }))',
        '})',
        "console.log('ready')",
        'setInterval(() => {}, 1_000)',
      ].join('\n'),
    )
    // The late child is named by the helper's output; it is ended with the test whatever the waits below find.
    endProcessesAfter(context, () => {
      const line = readOutput()
        .split('\n')
        .find((candidate) => candidate.includes('latePid'))
      // The helper may still be writing the line when the test ends: a truncated line names no process.
      try {
        return line === undefined ? [] : [JSON.parse(line).latePid]
      } catch {
        return []
      }
    })
    assert.equal(await waitForOutput(readOutput, 'ready', 20_000), true)
    child.kill('SIGTERM')
    assert.equal(await waitForOutput(readOutput, 'latePid', 20_000), true)
    const { latePid } = JSON.parse(
      readOutput()
        .split('\n')
        .find((line) => line.includes('latePid')),
    )
    const goneWhileFirstEndWaits = await waitUntilNoneExists([latePid], 10_000)

    // Act
    child.stdin.write('finish\n')
    const result = await ended

    // Assert
    assert.deepEqual(
      {
        lateChildGoneWhileTheFirstEndWaited: goneWhileFirstEndWaits,
        lateEndDoneBeforeTheExit: readOutput().includes('late end done'),
        code: result.code,
        signal: result.signal,
        errors: readErrors(),
      },
      {
        lateChildGoneWhileTheFirstEndWaited: [],
        lateEndDoneBeforeTheExit: true,
        code: 143,
        signal: null,
        errors: '',
      },
    )
  },
)

// Value: protects=the exit code of a script that a signal ends while a child registered late cannot be ended: an end that throws, started after the first signal while the handler waits for the first ends, settles as a rejection the exit does not mind, and the script exits with 128 plus the signal's number; fails_when=the late end's rejection has no handler until the first ends settle, so Node treats it as unhandled and ends the script with code 1 and a stack on stderr; why_new=Cycle 0048 task 196 (Step 8 of the third /ship: the tests above throw in an end of the first batch only); seam=endChildrenOnSignal in a process of its own: a first end that waits for a line on stdin, SIGTERM, then an end registered that throws; no_claim=which end of the scripts could throw (none does today: endProcessTree catches the signals it sends)
test(
  'an end registered after the first signal that throws does not end the script before its exit with the signal’s code',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const moduleUrl = pathToFileURL(
      join(scriptsDirectory, 'utils/endChildrenOnSignal.mjs'),
    ).href
    const source = [
      `import { endChildrenOnSignal } from ${JSON.stringify(moduleUrl)}`,
      'let release',
      "endChildrenOnSignal(() => new Promise((resolve) => { release = resolve; console.log('first end waits') }))",
      "process.on('SIGTERM', () => { endChildrenOnSignal(() => { throw new Error('this late child cannot be ended') }); console.log('late end registered') })",
      "process.stdin.on('data', () => release())",
      "console.log('ready')",
    ].join('\n')
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    context.after(() => child.kill('SIGKILL'))
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (errors += chunk))
    const ended = new Promise((resolve) =>
      child.on('close', (code, signal) => resolve({ code, signal })),
    )
    assert.equal(await waitForOutput(() => output, 'ready', 20_000), true)

    // Act
    child.kill('SIGTERM')
    assert.equal(
      await waitForOutput(() => output, 'late end registered', 20_000),
      true,
    )
    // gstack-timing-ok: the late end's rejection, if nothing handled it, would end the script within a few event-loop turns; a quarter of a second lets that be seen before the first end is released.
    await delay(250)
    child.stdin.write('release\n')
    const result = await ended

    // Assert
    assert.deepEqual(
      { code: result.code, signal: result.signal, errors },
      { code: 143, signal: null, errors: '' },
    )
  },
)

// Value: protects=the shard script from a lane that starts its next call after a signal began to end the script: a call that closes while the handler still waits for another end (on Windows a call closes with its exit while the handler waits for its `taskkill`) answers nothing, so no lane goes on to start a call that nothing would end before the exit; fails_when=the close handler of the call answers whatever the state, so the caller goes on while the script is being ended; why_new=Cycle 0048 task 176 (OCR C, state machines: task 171's guard was read by the build only); seam=runTestInvocation in a helper process of its own with an extra end that resolves 1.5 s later (it keeps the handler waiting, as `taskkill` does on Windows), a call of a test file that notes its pid and hangs, and a SIGTERM to itself once the pid is noted; no_claim=Windows (the race is made on POSIX by the slow extra end)
test(
  'a call that closes while a signal ends the script answers nothing, and the script exits with 143 with no process of the call left',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-closing-call-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const pidsPath = join(directory, 'pids.log')
    killNotedProcessesAfter(context, pidsPath)
    await writeFile(
      join(directory, 'hanging.test.js'),
      hangingFileNotingItsPid({ ignoresSigterm: false }),
    )
    const { readOutput, readErrors, ended } = startSignalHelper(
      context,
      [
        `import { existsSync } from 'node:fs'`,
        `import { listProcessIdsUnder } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/listProcessIdsUnder.mjs')).href)}`,
        `import { runTestInvocation } from ${JSON.stringify(pathToFileURL(join(scriptsDirectory, 'utils/runTestInvocation.mjs')).href)}`,
        // The extra end keeps the handler waiting after the call's own end is done.
        'endChildrenOnSignal(() => delay(1_500))',
        `const call = runTestInvocation({ files: ['hanging.test.js'] }, ${JSON.stringify(directory)}, { silenceTimeoutMs: 60_000 })`,
        "call.then(() => console.log('the call answered'), () => console.log('the call answered'))",
        'const poll = setInterval(() => {',
        `  if (!existsSync(${JSON.stringify(pidsPath)})) return`,
        '  clearInterval(poll)',
        '  console.log(JSON.stringify({ tree: listProcessIdsUnder(process.pid) }))',
        "  process.kill(process.pid, 'SIGTERM')",
        '}, 50)',
      ].join('\n'),
    )

    // Act
    const result = await ended
    const { tree } = JSON.parse(
      readOutput()
        .split('\n')
        .find((line) => line.startsWith('{"tree"')),
    )
    const left = await waitUntilNoneExists(tree, 10_000)

    // Assert
    assert.deepEqual(
      {
        callAnswered: readOutput().includes('the call answered'),
        treeHeldRunnerAndFile: tree.length >= 2,
        processesLeft: left,
        code: result.code,
        signal: result.signal,
        errors: readErrors(),
      },
      {
        callAnswered: false,
        treeHeldRunnerAndFile: true,
        processesLeft: [],
        code: 143,
        signal: null,
        errors: '',
      },
    )
  },
)

// Value: protects=the reader of a refused recording: the sentence names the failed tests (file and test), so the reader need not rerun the suite to find them (F60); fails_when=the sentence only counts them, names a passing test, keeps a line break of a test name, or lists more than ten; why_new=Cycle 0050 F60 (the EN20 recording refused with "2 tests failed" and no name); seam=describeFailedRecording with hard-coded results; no_claim=a real failing run, which the recording test above covers
test('the failed-recording sentence names each failed test on one line, at most ten, and counts the rest', () => {
  // Arrange
  const passing = { file: 'a.test.js', name: 'passes', failed: false }
  const two = [
    passing,
    { file: 'a.test.js', name: 'breaks', failed: true },
    { file: 'b.test.js', name: 'two\nlines', failed: true },
  ]
  const twelve = Array.from({ length: 12 }, (_, index) => ({
    file: 'c.test.js',
    name: `t${index}`,
    failed: true,
  }))

  // Act
  const sentences = [
    describeFailedRecording([passing]),
    describeFailedRecording(two),
    describeFailedRecording(twelve),
  ]

  // Assert
  assert.deepEqual(sentences, [
    undefined,
    '2 tests failed; timings were not recorded: a.test.js › breaks; b.test.js › two lines.',
    '12 tests failed; timings were not recorded: c.test.js › t0; c.test.js › t1; c.test.js › t2; c.test.js › t3; c.test.js › t4; c.test.js › t5; c.test.js › t6; c.test.js › t7; c.test.js › t8; c.test.js › t9; and 2 more.',
  ])
})

// Value: protects=the reader of a refused recording with one failed test: the count reads as English, "1 test failed" (F212); fails_when=one failed test is counted as "1 tests"; why_new=Cycle 0050 F212 (found by the re-execution of F60's red run); seam=describeFailedRecording with hard-coded results; no_claim=the names, which the test above covers
test('a refused recording with one failed test counts it as “1 test failed”', () => {
  // Arrange
  const one = [{ file: 'a.test.js', name: 'breaks', failed: true }]

  // Act
  const sentence = describeFailedRecording(one)

  // Assert
  assert.equal(
    sentence,
    '1 test failed; timings were not recorded: a.test.js › breaks.',
  )
})
