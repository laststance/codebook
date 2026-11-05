import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeScriptEnd } from '../utils/describeNodeScriptEnd'

/** No private root to hide: the tail is the output as written. */
const NO_ROOTS = { storage: [] }

// protects=the end says Codebook sent no signal to a group it could not confirm after the script's own exit (E10); fails_when=the withheld signal is dropped from the end the chat reads; no_claim=the core's verdict itself (nodeProcessRun tests cover it)
test('the end of a script whose group was not signalled after its exit says why', () => {
  // Arrange
  const input = {
    exit: { exitCode: 0, signal: null },
    declaredStopIndices: [0],
    stopsReached: [0],
    captureBudgetExhausted: false,
    groupNotSignalled: 'replaced' as const,
    output: 'done\n',
    roots: NO_ROOTS,
  }

  // Act
  const end = describeNodeScriptEnd(input)

  // Assert
  assert.deepEqual(end, {
    kind: 'exited',
    exitCode: 0,
    stopsReached: [0],
    stopsNeverReached: [],
    groupNotSignalled: 'replaced',
    output: { tail: 'done\n', truncated: false },
  })
})

// protects=an ordinary end carries no group verdict; fails_when=groupNotSignalled appears when every signal was confirmed; no_claim=none beyond protects
test('the end of a script whose cleanup signalled normally names no withheld signal', () => {
  // Arrange
  const input = {
    exit: { exitCode: 3, signal: null },
    declaredStopIndices: [0, 1],
    stopsReached: [0],
    captureBudgetExhausted: false,
    output: '',
    roots: NO_ROOTS,
  }

  // Act
  const end = describeNodeScriptEnd(input)

  // Assert
  assert.deepEqual(end, {
    kind: 'exited',
    exitCode: 3,
    stopsReached: [0],
    stopsNeverReached: [1],
    output: { tail: '', truncated: false },
  })
})
