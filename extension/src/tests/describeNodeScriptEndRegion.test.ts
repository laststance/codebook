import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeScriptEndHeadline } from '../utils/describeNodeScriptEndRegion'

// Value: protects=the replay's end line names how each kind of script end happened (exit code, signal, stop, each of the four limits) in the learner's words; fails_when=a limit is worded as another limit, a signal end loses its signal name or a terminal control survives in it, a stopped end reads as an exit; why_new=the replay tests only open exited ends, so the other kinds and limit words were unchecked; seam=none; no_claim=where the line is drawn in the pane
test('the end headline names the exit code, the signal, the stop and each limit of a script run', () => {
  // Arrange
  const ends = [
    { kind: 'exited', exitCode: 3 },
    { kind: 'exited', exitCode: null },
    { kind: 'signal', signal: 'SIGKILL\u001b[31m' },
    { kind: 'stopped' },
    { kind: 'limit', limit: 'running-time' },
    { kind: 'limit', limit: 'run-deadline' },
    { kind: 'limit', limit: 'pause-hold' },
    { kind: 'limit', limit: 'exit-deadline' },
  ] as const

  // Act
  const headlines = ends.map((end) => describeScriptEndHeadline(end))

  // Assert
  assert.deepEqual(headlines, [
    'Exited with code 3',
    'Exited (exit code unknown)',
    'Ended by signal SIGKILL',
    'Stopped by Codebook',
    'Ended at the running-time limit',
    'Ended at the run deadline',
    'Ended at the pause hold',
    'Ended at the exit deadline',
  ])
})
