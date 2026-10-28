import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failedTestsOf } from '../ci-failures.mjs'

/** A failed shard job's log as GitHub writes it: timestamps, colour, a passing file, then Node's "failing tests" block. */
const SHARD_LOG = [
  '2026-10-27T23:35:17.3440224Z \u001b[31m✖ bookIdOfFileName.test.js, fakeClock.test.js\u001b[39m',
  '2026-10-27T23:35:17.3480765Z ✖ a wait spends no fake time while a real file read is pending (32.700235ms)',
  '2026-10-27T23:35:17.3719035Z ℹ fail 2',
  '2026-10-27T23:35:17.3720673Z \u001b[31m✖ failing tests:\u001b[39m',
  '2026-10-27T23:35:17.3720700Z ',
  '2026-10-27T23:35:17.3720800Z test at dist/tests/fakeClock.test.js:40:1',
  '2026-10-27T23:35:17.3721527Z ✖ a wait spends no fake time while a real file read is pending (32.700235ms)',
  '2026-10-27T23:35:17.3722048Z   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '2026-10-27T23:35:17.3722100Z ',
  '2026-10-27T23:35:17.3728128Z ✖ advancing the fake clock spends no fake time while a real file read is pending (38.405784ms)',
  '2026-10-27T23:35:17.3729106Z   AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:',
  '2026-10-27T23:35:20.1221616Z ℹ fail 0',
].join('\n')

// Value: protects=the list a fixer starts from: each failing test of a sharded CI job by name, once, with its first error line (Cycle 0058 retro: reading them took several `gh api` and grep calls per failure); fails_when=a shard's file-list line or a test's own `✖` line before the block is listed, a duration stays on a name, a name repeats, or the error line is missed; why_new=no script read CI failures; seam=a log text of the test; no_claim=the `gh` calls that fetch the log
test('the failing tests of a shard log are listed once each, with their first error line', () => {
  // Arrange
  const log = SHARD_LOG

  // Act
  const failures = failedTestsOf(log)

  // Assert
  assert.deepEqual(failures, [
    {
      name: 'a wait spends no fake time while a real file read is pending',
      error:
        'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
    },
    {
      name: 'advancing the fake clock spends no fake time while a real file read is pending',
      error:
        'AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:',
    },
  ])
})

// Value: protects=a failed job that failed outside the test runner (a refused health run, a build): it has no failing tests to list, so the script prints the job's last lines instead; fails_when=lines of a passing run's output are read as failures; why_new=Cycle 0058 retro; seam=a log text of the test; no_claim=the printing of the last lines
test('a log without a failing-tests block lists no failure', () => {
  // Arrange
  const log = [
    '2026-10-27T23:36:07.9588266Z Health refused: The producers differ from the reference: node is 26.12.1 here, 24.21.0 in the reference.',
    '2026-10-27T23:36:07.9616906Z [ELIFECYCLE] Command failed with exit code 2.',
  ].join('\n')

  // Act
  const failures = failedTestsOf(log)

  // Assert
  assert.deepEqual(failures, [])
})
