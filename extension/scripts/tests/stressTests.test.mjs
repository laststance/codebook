import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

// protects=the stress command exits 1 and names the failing test of a real `node --test` run, also when started from inside another test run; fails_when=a failing test is reported as passed, counted without its name, or the nested runner reports to the parent instead of printing; no_claim=that load makes a timing-dependent test fail (these two files are deterministic)
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
    'steady.test.mjs',
    'broken.test.mjs',
  ])
  // Assert
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
