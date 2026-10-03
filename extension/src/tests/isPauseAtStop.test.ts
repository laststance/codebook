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

/** The stop on line 23 under a sealed map that also puts generated line 33 on line 24 and generated line 34 on line 25. */
const stopWithLaterLines: PauseStopTarget = {
  ...stopOnLine23,
  verifier: {
    originalLine: (location) =>
      ({ 32: 23, 33: 24, 34: 25 })[location.lineNumber],
  },
}

// Value: protects=a pause at the place the debugger bound a stop to being that stop's pause, and nothing else being it once the binding is known; fails_when=a known bound line is ignored for the declared one, or the declared line still counts beside it; why_new=a binding can now sit on a later line than declared (Cycle 0043, ER3); seam=none
test('once a stop’s binding is known, a pause is at that stop only on the bound line', () => {
  // Arrange: declared on line 23, bound on line 24.
  const boundOnLine24: PauseStopTarget = {
    ...stopWithLaterLines,
    bound: { line: 24 },
    acceptsBoundLine: () => true,
  }
  // Act
  const answers = [
    isPauseAtStop(pauseAt('9', 33, 4), boundOnLine24),
    isPauseAtStop(pauseAt('9', 32, 4), boundOnLine24),
    isPauseAtStop(pauseAt('9', 34, 4), boundOnLine24),
  ]
  // Assert
  assert.deepEqual(answers, [true, false, false])
})

// Value: protects=a server stop whose binding is read only at its pause being found at once on the one line that binding may move to; fails_when=an unknown binding admits the declared line only, so the moved pause waits out the adoption bound, or admits lines the stop's rule refuses; why_new=a binding can now sit on a later line than declared (Cycle 0043, ER3, ER5); seam=none
test('while a stop’s binding is unknown, a pause is at that stop on its declared line and on a line the stop accepts as its binding', () => {
  // Arrange: the stop's rule accepts line 24 and refuses line 25.
  const asked: number[] = []
  const unbound: PauseStopTarget = {
    ...stopWithLaterLines,
    acceptsBoundLine: (line) => {
      asked.push(line)
      return line === 24
    },
  }
  // Act
  const answers = [
    isPauseAtStop(pauseAt('9', 32, 4), unbound),
    isPauseAtStop(pauseAt('9', 33, 4), unbound),
    isPauseAtStop(pauseAt('9', 34, 4), unbound),
    isPauseAtStop(pauseAt('9', 33, 4), stopWithLaterLines),
  ]
  // Assert: the declared line needs no rule, and a stop without a rule accepts no other line.
  assert.deepEqual(answers, [true, true, false, false])
  assert.deepEqual(asked, [24, 25])
})
