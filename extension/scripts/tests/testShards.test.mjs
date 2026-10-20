import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildTestTimings } from '../utils/buildTestTimings.mjs'
import { parseSilenceSeconds } from '../utils/parseSilenceSeconds.mjs'
import { planCallEnd } from '../utils/planCallEnd.mjs'
import { planTestShards } from '../utils/planTestShards.mjs'
import { readTestTimings } from '../utils/readTestTimings.mjs'
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
 * @param afterSigterm - Source of the SIGTERM handler's last statement: `setTimeout(() => process.exit(0), 4_000)` to end late, or `` to stay alive.
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
      // A kill that came with the SIGTERM would end the call at about 2.5 s; 4 s leaves 0.5 s below the 4.5 s of limit and grace. The upper bound is far below the stand-in's endless life and the 120 s default.
      killedAfterTheGrace:
        result.elapsedMs >= 4_000 && result.elapsedMs < 20_000,
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
        refusal: /Error: (--[a-z-]+ [^\n]*)/.exec(stderr)?.[1],
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
      refusal: /Error: (--[a-z-]+ [^\n]*)/.exec(stderr)?.[1],
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
 * @returns `{ systemRoot, taskkillArguments }`: the folder to set as `SystemRoot`, and a function that reads the argument lines the stand-in noted.
 * @example
 * const { systemRoot, taskkillArguments } = await writeStandInTaskkill(context, { endsTheProcess: false, exitCode: 1 })
 */
async function writeStandInTaskkill(context, { endsTheProcess, exitCode }) {
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
      "appendFileSync(join(__dirname, '..', 'taskkill.log'), process.argv.slice(2).join(' ') + '\\n')",
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

// Value: protects=the timings recording from a test that never ends: the recording ends with that test named and failed, and writes no timings file; fails_when=`--record` runs with no limit, so one hung test holds the recording until the job is cancelled; why_new=Cycle 0048 task 57 (Red Team: task 25's limit covered one entry point of three); seam=test-shard.mjs --record started as a process on a fixture build with a 3 s limit; no_claim=the default limit (120 s) and the timings of a recording that passes
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
  assert.match(
    result.stderr,
    /hanging\.test\.js: "never ends" did not end within 3 s/,
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
