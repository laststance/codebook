import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Protocol } from 'devtools-protocol'

import { isModuleEntryPause } from '../utils/isModuleEntryPause'

/** A page script of another file whose address contains the base name of the declared stop's file, `actions`. */
const OTHER_SCRIPT_URL =
  'webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts'

/** Builds a pause of that script at a zero-based generated place with these hit breakpoint ids. @example pauseAt(0, 0, ['br:2:0:0:actions']) */
const pauseAt = (
  lineNumber: number,
  columnNumber: number,
  hitBreakpoints: string[],
): Protocol.Debugger.PausedEvent => ({
  reason: 'other',
  hitBreakpoints,
  callFrames: [
    {
      callFrameId: 'frame',
      functionName: '',
      location: { scriptId: '207', lineNumber, columnNumber },
      url: '',
      scopeChain: [],
      this: { type: 'undefined' },
    },
  ],
})

// Cycle 0046 (row 288): the debug adapter's own pause at a module's first position is known by what the native journals show and the adapter's source says: the first position, one breakpoint, the id `br:2:0:0:` with the base name of a declared stop's file. Red if that pause were not known in a script of another file, so that it kept the 250 ms of a pause nobody owns.
test('a pause at a script’s first position whose one breakpoint is the debugger’s own, set by the base name of a declared stop’s file, is the debugger’s entry pause, also in a script of another file and for a name the debugger writes with a backslash', () => {
  // Arrange: stops are declared in app/lib/actions.ts and app/lib/actions.server.ts; the id of the first is the one of the native journals.
  const sourcePaths = ['app/lib/actions.ts', 'app/lib/actions.server.ts']
  // Act
  const answers = [
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:actions']),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:actions']),
      'webpack-internal:///(app-pages-browser)/app/lib/actions.ts',
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:actions\\.server']),
      'webpack-internal:///(app-pages-browser)/./app/lib/actions.server.ts',
      sourcePaths,
    ),
  ]
  // Assert
  assert.deepEqual(answers, [true, true, true])
})

// Cycle 0046 (row 288): the longer bound must not reach a pause the learner or another tool caused; red if a pause at another position, with another or a second breakpoint, with a breakpoint set by the script's address or by its script, by another name, with an id of another form, or in a script whose address does not hold the name were taken for the debugger's entry pause.
test('a pause at another position, with a breakpoint set by the script’s address or its script, with a second breakpoint, with no breakpoint, by another name, with an id of another form or in a script without that name is not the debugger’s entry pause', () => {
  // Arrange: the stop is declared in app/lib/actions.ts.
  const sourcePaths = ['app/lib/actions.ts']
  // Act
  const answers = [
    isModuleEntryPause(
      pauseAt(10, 6, ['br:2:0:0:actions']),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 5, ['br:2:0:0:actions']),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 0, [`1:0:0:${OTHER_SCRIPT_URL}`]),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(pauseAt(0, 0, ['4:0:0:207']), OTHER_SCRIPT_URL, [
      'app/lib/actions.ts',
    ]),
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:actions', '4:0:0:207']),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(pauseAt(0, 0, []), OTHER_SCRIPT_URL, sourcePaths),
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:my-actions']),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 0, ['2:0:0:actions']),
      OTHER_SCRIPT_URL,
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:actions']),
      'webpack-internal:///(app-pages-browser)/./app/ui/login-form.tsx',
      sourcePaths,
    ),
    isModuleEntryPause(
      pauseAt(0, 0, ['br:2:0:0:actions']),
      undefined,
      sourcePaths,
    ),
  ]
  // Assert
  assert.deepEqual(answers, [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ])
})
