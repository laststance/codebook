import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runBoundedQuery } from '../utils/runBoundedQuery'

// Value: protects=the one runner of the process listing and of the process start query hands a query no open input, so a program that reads its input to the end (PowerShell started with -Command reads it) answers instead of waiting until its time bound ends it; fails_when=the runner leaves the child's input open, so every listing and start query fails at its bound; why_new=F4/S2, Cycle 0046 /ship review: the two modules ran their queries with copies of one runner, now one shared util; seam=none (a real child process of this test)
test('a bounded query whose program reads its input to the end answers what it printed, because its input is closed', async () => {
  // Arrange: a program that prints only once its input has ended, under a bound far beyond its start.
  const program = [
    '-e',
    "process.stdin.on('end', () => process.stdout.write('input closed')); process.stdin.resume()",
  ]
  // Act
  const outcome = await runBoundedQuery(process.execPath, program, {
    timeout: 5_000,
    maxBuffer: 1_024,
    killSignal: 'SIGKILL',
    windowsHide: true,
  }).then(
    ({ stdout }) => stdout,
    (error: unknown) => String(error),
  )
  // Assert
  assert.equal(outcome, 'input closed')
})

// Value: protects=a query that never answers is ended at its time bound by the signal its options name, one no process can ignore, so the listing's and the start query's callers do not wait without end; fails_when=the runner drops the options' time bound or kill signal, so a program that ignores SIGTERM keeps running; why_new=F4/S2, Cycle 0046 /ship review (the shared runner); seam=none (a real child process of this test that ignores SIGTERM)
test(
  'a bounded query that runs past its time bound is ended with a signal it cannot ignore',
  { skip: process.platform === 'win32' && 'Windows has no SIGTERM to ignore' },
  async () => {
    // Arrange: a program that ignores SIGTERM and would run for 20 s, far beyond the 300 ms bound, before it ends by itself.
    const program = [
      '-e',
      "process.on('SIGTERM', () => {}); setTimeout(() => {}, 20_000)",
    ]
    // Act
    const failure: unknown = await runBoundedQuery(process.execPath, program, {
      timeout: 300,
      maxBuffer: 1_024,
      killSignal: 'SIGKILL',
      windowsHide: true,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    // Assert
    assert.ok(failure instanceof Error)
    assert.deepEqual(
      {
        killed: 'killed' in failure ? failure.killed : undefined,
        signal: 'signal' in failure ? failure.signal : undefined,
      },
      { killed: true, signal: 'SIGKILL' },
    )
  },
)
