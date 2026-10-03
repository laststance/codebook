import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Protocol } from 'devtools-protocol'

import { isPauseInScript } from '../utils/isPauseInScript'

/** Builds a pause whose top frame is in a script. @example pauseIn('9') */
const pauseIn = (scriptId: string): Protocol.Debugger.PausedEvent => ({
  reason: 'other',
  callFrames: [
    {
      callFrameId: 'frame',
      functionName: 'getUser',
      location: { scriptId, lineNumber: 27, columnNumber: 23 },
      url: '',
      scopeChain: [],
      this: { type: 'undefined' },
    },
  ],
})

// Value: protects=an announced pause that stayed elsewhere in a stop's module being judged by the binding checks, and a pause in any other script being left alone; fails_when=another script, a module that is not parsed yet or an empty stack answers true, or the stop's own module answers false; why_new=the utility is new (Cycle 0042 ER4); seam=none
test('a pause is in a script only when its top frame is in that script', () => {
  // Arrange
  const inTheModule = pauseIn('9'),
    inAnotherScript = pauseIn('70')
  const withoutStack: Protocol.Debugger.PausedEvent = {
    reason: 'other',
    callFrames: [],
  }
  // Act
  const answers = [
    isPauseInScript(inTheModule, { scriptId: '9' }),
    isPauseInScript(inAnotherScript, { scriptId: '9' }),
    isPauseInScript(inTheModule, undefined),
    isPauseInScript(withoutStack, { scriptId: '9' }),
  ]
  // Assert
  assert.deepEqual(answers, [true, false, false, false])
})
