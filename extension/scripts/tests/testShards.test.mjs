import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
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
import { killProcessIds } from '../utils/killProcessIds.mjs'
import { listProcessIdsUnder } from '../utils/listProcessIdsUnder.mjs'
import { parseSilenceSeconds } from '../utils/parseSilenceSeconds.mjs'
import { plainOutputEnvironment } from '../utils/plainOutputEnvironment.mjs'
import { planCallEnd } from '../utils/planCallEnd.mjs'
import { planTestShards } from '../utils/planTestShards.mjs'
import { readProcessTable } from '../utils/readProcessTable.mjs'
import { readRunSummary } from '../utils/readRunSummary.mjs'
import { readTestTimings } from '../utils/readTestTimings.mjs'
import { runTestInvocation } from '../utils/runTestInvocation.mjs'
import { takeEndStep } from '../utils/takeEndStep.mjs'

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
 * @param options - `{ silenceTimeoutMs, killGraceMs?, runnerArguments?, execPath?, platform?, systemRoot? }`: the options of the call, a path to set as `process.execPath` before the call (a path that is no program makes the spawn fail), a value to set as `process.platform` (the call then plans the end of a silent runner for that system), and a folder to set as the `SystemRoot` variable (where the call looks for `System32/taskkill.exe` when `platform` is `win32`).
 * @returns `{ result, rejectionCode, timersLeft }`: the call's `{ timedOut, code, signal, output }` or `undefined` when it was rejected, the rejection's `code`, and the timers the process held after the call minus the timers before it.
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
      'const { execPath, platform, systemRoot, ...callOptions } = JSON.parse(process.argv[2])',
      "const countTimers = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length",
      'if (execPath) process.execPath = execPath',
      "if (platform) Object.defineProperty(process, 'platform', { value: platform })",
      'if (systemRoot !== undefined) process.env.SystemRoot = systemRoot',
      'const timersBefore = countTimers()',
      'let rejectionCode',
      'const result = await runTestInvocation({ files: [] }, tmpdir(), callOptions).catch((error) => { rejectionCode = error.code })',
      'console.log(JSON.stringify({ result, rejectionCode, timersLeft: countTimers() - timersBefore }))',
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

// Value: protects=the shard job's result: a failed call must fail the job; fails_when=test-shard.mjs ends with exit code 0 although a call failed, or prints no failure line; why_new=Cycle 0048 task 27 (test guide, 2026-10-02: the script's own exit code had no test); seam=test-shard.mjs started as a process on a fixture build
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
  const grandchildPid = await new Promise((resolve) =>
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

// Value: protects=the timings recording from a file whose process does not exit after its tests passed (a timer left at the top level): the file sends nothing more, so the recording used to wait for it for ever; it now ends after the limit with the file named and no process left; fails_when=the recording ends only at a failed test, so a file that passed its tests and holds the process open holds the recording; why_new=Cycle 0048 task 149 (native adversarial: a file process that does not exit sends nothing more); Cycle 0048 task 166 pins the refusal as the one line `✖ <sentence>` on stderr, with no stack frame and no `Error:` prefix; seam=test-shard.mjs --record on a fixture build whose file passes its test and leaves a timer, with a 3 s limit (the run's silence bound is that and 5 s more); no_claim=the margin value
test(
  'the timings recording ends a run that sends nothing for the limit, names the file that did not end and leaves no process',
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
          /^✖ The run sent nothing for 3 s and was ended; lingering\.test\.js started and did not end; timings were not recorded\.\n$/.test(
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
  assert.equal(result.stderr, '✖ 1 tests failed; timings were not recorded.\n')
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
