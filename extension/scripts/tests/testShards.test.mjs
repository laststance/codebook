import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

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

/** Starts the fixture's shard script and collects its exit code and both streams; a script that outlives `timeoutMs` is ended, which shows as `signal`. @example await runShardScript(root, ['--shard', '1/1', '--lanes', '1']) // => { code: 0, signal: null, stdout: '…', stderr: '' } */
function runShardScript(root, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, 'scripts/test-shard.mjs'), ...args],
      {
        cwd: root,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT',
          ),
        ),
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
    { silenceTimeoutMs: 3_000 },
  )

  // Assert
  assert.equal(result.timedOut, true)
  // gstack-timing-ok: the bound is the contract: the call ends by its 3 s silence limit, not by the 15 s the hanging test takes or the 120 s default
  assert.equal(result.elapsedMs < 10_000, true)
  assert.match(result.output, /✔ finishes first/)
})

/**
 * Writes a stand-in for `node --test` into a fresh folder: a script that notes each SIGTERM it gets in `sigterms.log` beside it, prints a line at its start and at each SIGTERM, and then does what `afterSigterm` says. The real runner ends within milliseconds of a SIGTERM, so only a stand-in can stay alive long enough to show what the caller does with a runner that prints after its SIGTERM or ignores it. Called by the tests of {@link runTestInvocation}'s silence handling.
 * @param context - The running test, whose end removes the folder.
 * @param afterSigterm - Source of the SIGTERM handler's last statement: `setTimeout(() => process.exit(0), 2200)` to end late, or `` to stay alive.
 * @returns `{ runnerPath, sigtermCount }`: the script to pass as `runnerArguments`, and a function that reads how many SIGTERMs it got.
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
  return { runnerPath, sigtermCount }
}

/** Counts the timers that keep this process alive now, to show that a call left none behind. @example activeTimerCount() // => 2 */
function activeTimerCount() {
  return process
    .getActiveResourcesInfo()
    .filter((resource) => resource === 'Timeout').length
}

// Value: protects=the runner that is slow to end after its SIGTERM and prints while it winds down: it gets one SIGTERM, not one more for each line it prints, and no kill timer is left to hold the shard process; fails_when=output after the silence SIGTERM starts the fired silence timer again, so the call gets a second SIGTERM and a second kill timer that replaces the first, whose timer then runs on after the call has ended; why_new=Cycle 0048 task 44 (CodeRabbit, OCR B); seam=runTestInvocation with a stand-in runner script (`runnerArguments`) that prints at its SIGTERM and ends 2.2 s later, and a 1.5 s silence limit that leaves room for the stand-in to start; no_claim=what the real Node runner does (it ends within milliseconds of SIGTERM)
test('a call that prints while it winds down after the silence SIGTERM gets one SIGTERM and leaves no timer behind', async (context) => {
  // Arrange
  const { runnerPath, sigtermCount } = await writeStandInRunner(
    context,
    'setTimeout(() => process.exit(0), 2_200)',
  )
  const timersBefore = activeTimerCount()

  // Act
  const result = await runTestInvocation({ files: [] }, tmpdir(), {
    silenceTimeoutMs: 1_500,
    killGraceMs: 3_000,
    runnerArguments: [runnerPath],
  })
  const timersAfter = activeTimerCount()

  // Assert
  assert.deepEqual(
    {
      timedOut: result.timedOut,
      code: result.code,
      sigterms: await sigtermCount(),
      printedWhileWindingDown: /winding down/.test(result.output),
      timersLeft: timersAfter - timersBefore,
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

// Value: protects=the caller of a call whose process cannot be started: the promise is rejected and the silence timer is stopped, so the shard process does not wait out the silence limit (120 s) with nothing to wait for; fails_when=the error handler only rejects and the silence timer runs on; why_new=Cycle 0048 task 44 (CodeRabbit, OCR B); seam=runTestInvocation with `process.execPath` set to a path that is no program, so the spawn fails with ENOENT; no_claim=which code a spawn failure carries on other systems
test('a call whose process cannot be started is rejected and leaves no silence timer running', async () => {
  // Arrange
  const realExecPath = process.execPath
  const timersBefore = activeTimerCount()
  process.execPath = join(tmpdir(), 'codebook-no-such-node-program')
  let rejection
  try {
    // Act
    await runTestInvocation({ files: [] }, tmpdir(), {
      silenceTimeoutMs: 30_000,
    }).catch((error) => {
      rejection = error
    })
  } finally {
    process.execPath = realExecPath
  }
  const timersAfter = activeTimerCount()

  // Assert
  assert.deepEqual(
    { code: rejection?.code, timersLeft: timersAfter - timersBefore },
    { code: 'ENOENT', timersLeft: 0 },
  )
})

// Value: protects=the shard job's time limit against a runner that ignores SIGTERM: it is killed once the grace has passed, and the call reports that it was ended; fails_when=the SIGKILL after the grace is missing or never armed, so the call waits for a runner that never ends; why_new=Cycle 0048 task 47 (Testing); seam=runTestInvocation with a stand-in runner script that ignores SIGTERM, a 1.5 s silence limit that leaves room for the stand-in to start and a 1 s grace passed through the options; no_claim=the 5 s default grace
test('a call that ignores the silence SIGTERM is killed once the grace has passed', async (context) => {
  // Arrange
  const { runnerPath, sigtermCount } = await writeStandInRunner(context, '')

  // Act
  const result = await runTestInvocation({ files: [] }, tmpdir(), {
    silenceTimeoutMs: 1_500,
    killGraceMs: 1_000,
    runnerArguments: [runnerPath],
  })

  // Assert
  assert.deepEqual(
    {
      timedOut: result.timedOut,
      code: result.code,
      signal: result.signal,
      sigterms: await sigtermCount(),
      // The kill waits for the grace; the bound is 5 s above the limit and the grace, far below the 120 s default and the stand-in's endless life.
      killedAfterTheGrace:
        result.elapsedMs >= 2_500 && result.elapsedMs < 7_500,
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
    ['--shard', '1/1', '--lanes', '1', '--silence-seconds', '3'],
    12_000,
  )

  // Assert
  assert.equal(result.code, 1)
  assert.match(result.stdout, /✔ finishes first/)
  assert.match(
    result.stderr,
    /✖ hanging\.test\.js printed nothing for 3 s and was ended/,
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
