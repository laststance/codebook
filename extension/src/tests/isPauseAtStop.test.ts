import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Protocol } from 'devtools-protocol'

import { isPauseAtStop, type PauseStopTarget } from '../utils/isPauseAtStop'

/** Builds a pause whose top frame is at a generated place. @example pauseAt('9', 32, 4) */
const pauseAt = (
  scriptId: string,
  lineNumber: number,
  columnNumber: number,
): Protocol.Debugger.PausedEvent => ({
  reason: 'other',
  callFrames: [
    {
      callFrameId: 'frame',
      functionName: 'getUser',
      location: { scriptId, lineNumber, columnNumber },
      url: '',
      scopeChain: [],
      this: { type: 'undefined' },
    },
  ],
})

/** A stop declared on line 23 of module `9`, whose sealed map puts generated line 32 on line 23, generated line 27 on line 18 and nothing before generated line 20. */
const stopOnLine23: PauseStopTarget = {
  script: { scriptId: '9' },
  source: { line: 23 },
  verifier: {
    originalLine: (location) =>
      location.lineNumber === 32
        ? 23
        : location.lineNumber === 27
          ? 18
          : undefined,
  },
}

// Value: protects=a live run telling its declared stop's pause from the pause the debug adapter makes for itself in the same module; fails_when=a pause on another line of the stop's module, in another script or at an unmapped place is taken for the declared stop, or the declared line at another column is not; why_new=the utility is new (Cycle 0042 ER1); seam=none
test('a pause is at a declared stop only in that stop’s module and on its declared line, at any column', () => {
  // Arrange
  const onDeclaredLine = pauseAt('9', 32, 4),
    onDeclaredLineAtAnotherColumn = pauseAt('9', 32, 60),
    onAnotherLine = pauseAt('9', 27, 23),
    inAnotherScript = pauseAt('70', 32, 4),
    beforeTheFirstMapping = pauseAt('9', 3, 0)
  // Act
  const answers = [
    isPauseAtStop(onDeclaredLine, stopOnLine23),
    isPauseAtStop(onDeclaredLineAtAnotherColumn, stopOnLine23),
    isPauseAtStop(onAnotherLine, stopOnLine23),
    isPauseAtStop(inAnotherScript, stopOnLine23),
    isPauseAtStop(beforeTheFirstMapping, stopOnLine23),
  ]
  // Assert
  assert.deepEqual(answers, [true, true, false, false, false])
})

// Value: protects=a pause that arrives when no stop is expected, before the stop's module is parsed or with an empty stack being held instead of throwing inside the pause handler or being taken for a stop; fails_when=a missing stop, a missing script or a missing frame answers true or throws; why_new=the utility is new (Cycle 0042 ER1); seam=none
test('a pause is at no stop when none is expected, when the stop’s module is not parsed yet and when its stack is empty', () => {
  // Arrange
  const onDeclaredLine = pauseAt('9', 32, 4)
  const stopBeforeItsModuleIsParsed: PauseStopTarget = {
    ...stopOnLine23,
    script: undefined,
  }
  const withoutStack: Protocol.Debugger.PausedEvent = {
    reason: 'other',
    callFrames: [],
  }
  // Act
  const answers = [
    isPauseAtStop(onDeclaredLine, undefined),
    isPauseAtStop(onDeclaredLine, stopBeforeItsModuleIsParsed),
    isPauseAtStop(withoutStack, stopOnLine23),
  ]
  // Assert
  assert.deepEqual(answers, [false, false, false])
})
