import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { maskSavedDebugSnapshot } from '../utils/maskSavedDebugSnapshot'

// The values below are made up: only their position in a long identifier-like run marks them as content a class name must not carry.
const VALUE_CONTENT = ['JSESSION', 'VALUE', 'opaque', '4b7c20de'].join('')
const LONG_RUN = `${VALUE_CONTENT}${'x'.repeat(20_000)}`

type DapVariable = {
  name: string
  value: string
  type?: string
  variablesReference: number
}

/**
 * Captures one paused frame whose locals scope lists the given variables, with a debugger that reports no member below any of them.
 * @param locals - The variables the adapter lists in the locals scope.
 * @returns The saved snapshot.
 */
async function captureLocals(
  locals: DapVariable[],
): Promise<ReplayDebugSnapshot> {
  return captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 0, name: 'handler', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 },
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes'
          ? {
              scopes: [
                {
                  name: 'Local: handler',
                  presentationHint: 'locals',
                  variablesReference: 1,
                },
              ],
            }
          : { variables: locals },
      )
    },
    limits: { timeoutMs: 1_500, maxFrames: 8, maxVariables: 64, maxDepth: 5 },
  })
}

// protects=the capture of a raw value above the scan bound that reports no type; fails_when=the class name falls back to the whole identifier-like run, so thousands of characters of the unscanned value are saved; no_claim=a value at or under the bound, which the other capture tests cover
test('a replay snapshot saves a 20,000-letter value without a debugger type as Object, not as its leading letters', async () => {
  // Arrange
  const locals: DapVariable[] = [
    { name: 'blob', value: LONG_RUN, variablesReference: 0 },
  ]

  // Act
  const snapshot = await captureLocals(locals)

  // Assert
  assert.equal(snapshot.variables[0]!.value, 'Object')
  assert.equal(JSON.stringify(snapshot).includes(VALUE_CONTENT), false)
})

// protects=the capture of a withheld variable that reports no type; fails_when=previewData or an env alias with a long identifier-like value is saved as that whole run instead of a plausible class name; no_claim=the members of the withheld variable, which are never read
test('a replay snapshot saves a withheld previewData without a debugger type as Object, not as its leading letters', async () => {
  // Arrange
  const locals: DapVariable[] = [
    { name: 'previewData', value: LONG_RUN, variablesReference: 0 },
  ]

  // Act
  const snapshot = await captureLocals(locals)

  // Assert
  assert.equal(snapshot.variables[0]!.value, 'Object')
  assert.equal(JSON.stringify(snapshot).includes(VALUE_CONTENT), false)
})

// protects=the class name a capture still keeps; fails_when=a real class name is lost to the bound, so a Socket or a typed value no longer reads as its class; no_claim=the list of collapsed classes
test('a replay snapshot keeps a plausible class name taken from the value preview or the debugger type', async () => {
  // Arrange
  const locals: DapVariable[] = [
    {
      name: 'connection',
      value: `Socket {connecting: false, note: '${'n'.repeat(20_000)}'}`,
      variablesReference: 0,
    },
    {
      name: 'blob',
      value: 'y'.repeat(20_000),
      type: 'Uint8Array',
      variablesReference: 0,
    },
  ]

  // Act
  const snapshot = await captureLocals(locals)

  // Assert
  assert.deepEqual(
    snapshot.variables.map((variable) => variable.value),
    ['Socket', 'Uint8Array'],
  )
})

// protects=the saved-snapshot mask for a withheld or credential-shaped parent saved by an older version; fails_when=a long identifier-like run in the saved preview is served as the class name; no_claim=values under the class-name bound
test('a saved withheld variable with a long identifier-like preview is served as Object', () => {
  // Arrange
  const longRun = `${VALUE_CONTENT}${'x'.repeat(3_000)}`
  const snapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: 1,
        column: 1,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'previewData', value: longRun, children: [] }],
    limitations: [],
  }

  // Act
  const masked = maskSavedDebugSnapshot(snapshot)

  // Assert
  assert.equal(masked.variables[0]!.value, 'Object')
  assert.equal(JSON.stringify(masked).includes(VALUE_CONTENT), false)
})
