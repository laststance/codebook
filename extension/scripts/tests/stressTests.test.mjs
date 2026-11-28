import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { renderStress, stressTests } from '../stress-tests.mjs'

const SCRIPT = fileURLToPath(new URL('../stress-tests.mjs', import.meta.url))

/** A test file whose one test passes. */
const STEADY_TEST = `import { test } from 'node:test'
test('the steady behaviour', () => {})
`
/** A test file whose one test fails every time. */
const BROKEN_TEST = `import assert from 'node:assert/strict'
import { test } from 'node:test'
test('the broken behaviour', () => {
  assert.equal(1, 2)
})
`

/** Creates a temporary folder (removed by the test context) with the named test files. @example const directory = await createTestFolder(context, { 'a.test.mjs': STEADY_TEST }) */
async function createTestFolder(context, files) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-stress-tests-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files))
    await writeFile(join(directory, name), text)
  return directory
}

/** Runs the stress script in a folder and answers its exit code and both streams. @example runStress(directory, ['a.test.mjs']) // => { code: 0, stdout: '…', stderr: '' } */
function runStress(directory, scriptArguments) {
  const result = spawnSync(process.execPath, [SCRIPT, ...scriptArguments], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

// protects=the stress report counts failed runs per file and per failed test, and a failed run that names no test is still counted; fails_when=a failure is counted for the wrong file or test, or a crash without a test name is dropped; no_claim=that a real `node --test` run prints its failed tests in the form this fake output uses (the command test below runs the real runner)
test('a stress run counts the failed runs of each file and of each failed test', async () => {
  // Arrange
  const callsPerFile = new Map()
  const run = async (file) => {
    const call = (callsPerFile.get(file) ?? 0) + 1
    callsPerFile.set(file, call)
    // The crashing file fails every run and names no test.
    if (file === 'crashes.test.js') return { code: 1, output: '' }
    // The flaky file fails only its second run, naming its test.
    if (call === 2)
      return {
        code: 1,
        output:
          '✖ saves the study (12.5ms)\n✖ failing tests:\n\ntest at flaky.test.js:3:1\n✖ saves the study (12.5ms)\n  AssertionError\n',
      }
    return { code: 0, output: '✔ saves the study (1ms)\n' }
  }
  // Act
  const result = await stressTests(['flaky.test.js', 'crashes.test.js'], {
    runs: 3,
    concurrency: 2,
    run,
  })
  // Assert
  assert.deepEqual(result, {
    files: [
      {
        file: 'flaky.test.js',
        runs: 3,
        failedRuns: 1,
        failures: { 'saves the study': 1 },
      },
      {
        file: 'crashes.test.js',
        runs: 3,
        failedRuns: 3,
        failures: { '(no test named)': 3 },
      },
    ],
    runs: 6,
    failedRuns: 4,
  })
  assert.deepEqual(renderStress(result), [
    'flaky.test.js: 3 runs, 1 failed',
    '  ✖ saves the study: 1 of 3',
    'crashes.test.js: 3 runs, 3 failed',
    '  ✖ (no test named): 3 of 3',
    'STRESS: files=2 runs=6 failed_runs=4',
  ])
})

// protects=the stress command exits 1 and names the failing test of a real `node --test` run, also when started from inside another test run, and keeps each failed run's output in the folder `--failures` names; fails_when=a failing test is reported as passed, counted without its name, the nested runner reports to the parent instead of printing, or a failed run's output is lost; no_claim=that load makes a timing-dependent test fail (these two files are deterministic)
test('the stress command exits 1 and names the test that failed', async (context) => {
  // Arrange
  const directory = await createTestFolder(context, {
    'steady.test.mjs': STEADY_TEST,
    'broken.test.mjs': BROKEN_TEST,
  })
  // Act
  const result = runStress(directory, [
    '--runs',
    '2',
    '--concurrency',
    '2',
    '--failures',
    'failed-runs',
    'steady.test.mjs',
    'broken.test.mjs',
  ])
  const keptOutputs = await readdir(join(directory, 'failed-runs'))
  const firstKeptOutput = await readFile(
    join(directory, 'failed-runs', '2-broken.test.mjs.1.log'),
    'utf8',
  )
  // Assert
  assert.deepEqual(keptOutputs.sort(), [
    '2-broken.test.mjs.1.log',
    '2-broken.test.mjs.2.log',
  ])
  assert.match(firstKeptOutput, /✖ the broken behaviour/)
  assert.deepEqual(result, {
    code: 1,
    stdout:
      'steady.test.mjs: 2 runs, 0 failed\nbroken.test.mjs: 2 runs, 2 failed\n  ✖ the broken behaviour: 2 of 2\nSTRESS: files=2 runs=4 failed_runs=2\n',
    stderr: '',
  })
})

// protects=the stress command exits 0 when every run of every file passed; fails_when=a clean stress run is reported as failed; no_claim=that the files are free of load-dependent failures beyond the runs made
test('the stress command exits 0 when every run passed', async (context) => {
  // Arrange
  const directory = await createTestFolder(context, {
    'steady.test.mjs': STEADY_TEST,
  })
  // Act
  const result = runStress(directory, ['--runs', '3', 'steady.test.mjs'])
  // Assert
  assert.deepEqual(result, {
    code: 0,
    stdout:
      'steady.test.mjs: 3 runs, 0 failed\nSTRESS: files=1 runs=3 failed_runs=0\n',
    stderr: '',
  })
})

// protects=the stress command refuses to start without a test file and says what to name; fails_when=a call without files reports a clean stress run; no_claim=none beyond protects
test('the stress command refuses a call that names no test file, with exit 2', async (context) => {
  // Arrange
  const directory = await createTestFolder(context, {})
  // Act
  const result = runStress(directory, ['--runs', '2'])
  // Assert
  assert.deepEqual(result, {
    code: 2,
    stdout: '',
    stderr:
      'Name at least one compiled test file, e.g. extension/dist/tests/learningSummary.test.js.\n',
  })
})

// protects=the bound on runs alive at once, the tool's main promise: with a concurrency of 2 never more than 2 runs are in flight, and every run is made; fails_when=the pool starts every job at once, or drops jobs; no_claim=the load a real `node --test` child puts on the machine
test('a stress run keeps at most the given number of runs alive at once', async () => {
  // Arrange
  let inFlight = 0
  let mostInFlight = 0
  let made = 0
  const run = async () => {
    inFlight++
    mostInFlight = Math.max(mostInFlight, inFlight)
    made++
    // The run ends on a later turn, so runs that the pool starts together are counted together.
    await new Promise((resolve) => setImmediate(resolve))
    inFlight--
    return { code: 0, output: '', timedOut: false }
  }

  // Act
  await stressTests(['a.test.js', 'b.test.js', 'c.test.js'], {
    runs: 4,
    concurrency: 2,
    timeoutMs: 1_000,
    run,
  })

  // Assert
  assert.deepEqual({ mostInFlight, made }, { mostInFlight: 2, made: 12 })
})

// protects=the report's "n of runs": a test name that fails twice in one run (in two suites) counts that run once, and a run ended at its time limit is counted under its own entry, not under the tests its cut-off output lists; fails_when=one run adds 2 to a name, so the report reads "2 of 1", or a hung run is reported as an ordinary failed test; no_claim=that the real runner ends a hung child (the command test below does)
test('a stress run counts a repeated test name once per run and names a run ended at its time limit', async () => {
  // Arrange
  const outputs = {
    'repeats.test.js': {
      code: 1,
      output:
        '✖ failing tests:\n\ntest at a.js:3:1\n✖ same name (1ms)\n\ntest at a.js:9:1\n✖ same name (2ms)\n',
      timedOut: false,
    },
    'hangs.test.js': {
      code: 1,
      output: '✖ failing tests:\n\ntest at b.js:3:1\n✖ an earlier test (1ms)\n',
      timedOut: true,
    },
  }

  // Act
  const result = await stressTests(['repeats.test.js', 'hangs.test.js'], {
    runs: 1,
    concurrency: 2,
    timeoutMs: 1_000,
    run: async (file) => outputs[file],
  })

  // Assert
  assert.deepEqual(renderStress(result), [
    'repeats.test.js: 1 runs, 1 failed',
    '  ✖ same name: 1 of 1',
    'hangs.test.js: 1 runs, 1 failed',
    '  ✖ (time limit): 1 of 1',
    'STRESS: files=2 runs=2 failed_runs=2',
  ])
})

// protects=a test that never ends is found: its run is ended at the time limit with every process it started, the report names the limit and the command exits 1 instead of waiting forever; fails_when=a hung run holds its slot for good and no report is printed; no_claim=which test of the file hung
test('the stress command ends a run that hangs at its time limit and reports it', async (context) => {
  // Arrange
  const directory = await createTestFolder(context, {
    'hangs.test.mjs': `import { test } from 'node:test'
test('the behaviour that never answers', () => new Promise(() => {
  setInterval(() => {}, 1_000)
}))
`,
  })

  // Act
  const result = runStress(directory, [
    '--runs',
    '1',
    '--timeout',
    '2',
    'hangs.test.mjs',
  ])

  // Assert
  assert.deepEqual(result, {
    code: 1,
    stdout:
      'hangs.test.mjs: 1 runs, 1 failed\n  ✖ (time limit): 1 of 1\nSTRESS: files=1 runs=1 failed_runs=1\n',
    stderr: '',
  })
})

// protects=the kept outputs of two test files that share a base name: each failed run has its own log, told apart by the file's place on the command line; fails_when=the second file's output overwrites the first's; no_claim=none beyond protects
test('the stress command keeps the failed runs of two files of one base name apart', async (context) => {
  // Arrange
  const directory = await createTestFolder(context, {})
  for (const folder of ['first', 'second']) {
    await mkdir(join(directory, folder))
    await writeFile(join(directory, folder, 'same.test.mjs'), BROKEN_TEST)
  }

  // Act
  const result = runStress(directory, [
    '--runs',
    '1',
    '--failures',
    'failed-runs',
    'first/same.test.mjs',
    'second/same.test.mjs',
  ])
  const keptOutputs = await readdir(join(directory, 'failed-runs'))

  // Assert
  assert.equal(result.code, 1)
  assert.deepEqual(keptOutputs.sort(), [
    '1-same.test.mjs.1.log',
    '2-same.test.mjs.1.log',
  ])
})

// protects=a refused call changes nothing: a number not written in digits and a `--failures` folder that already holds files are each refused in one line with exit 2, before any folder is made or any test run; fails_when=`--runs 1e3` starts a thousand runs, a refused call leaves an empty folder behind, or logs of an earlier call are mixed with this one's; no_claim=none beyond protects
test('the stress command refuses a number not written in digits and a failures folder that holds files, and writes nothing', async (context) => {
  // Arrange
  const directory = await createTestFolder(context, {
    'steady.test.mjs': STEADY_TEST,
  })
  await mkdir(join(directory, 'earlier-run'))
  await writeFile(join(directory, 'earlier-run', 'old.log'), 'an earlier call')

  // Act
  const notInDigits = runStress(directory, [
    '--runs',
    '1e3',
    '--failures',
    'new-folder',
    'steady.test.mjs',
  ])
  const folderInUse = runStress(directory, [
    '--failures',
    'earlier-run',
    'steady.test.mjs',
  ])
  const entries = await readdir(directory)

  // Assert
  assert.deepEqual(
    [notInDigits, folderInUse],
    [
      {
        code: 2,
        stdout: '',
        stderr:
          '--runs takes a whole number of at least 1, written in digits.\n',
      },
      {
        code: 2,
        stdout: '',
        stderr:
          '--failures takes a folder that is empty or does not exist yet; earlier-run holds 1 entries.\n',
      },
    ],
  )
  assert.deepEqual(entries.sort(), ['earlier-run', 'steady.test.mjs'])
})
