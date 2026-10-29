import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'

const SOURCE = {
  name: 'popup/popup.js',
  text: 'const created = await chrome.bookmarks.create({ parentId, title })',
  hash: sha256(
    'const created = await chrome.bookmarks.create({ parentId, title })',
  ),
  line: 1114,
}
const STACK: DebugProtocol.StackTraceResponse['body'] = {
  stackFrames: [{ id: 7, name: 'confirmNewFolder', line: 1114, column: 5 }],
  totalFrames: 1,
}
/** The variables reference of the page's `this`, an element with many members. */
const THIS_HANDLE = 900

/**
 * Answers the capture's DAP requests for a page stop: a Block scope whose `this` is a host object with 80 members, then a Local scope with `title`.
 * Why: a page's `this` (a DOM element or the window) is what used up the whole variable budget before the locals in the Cycle 0061 pt2 Cursor dry run.
 * @param command - The DAP command the capture sends.
 * @param arguments_ - Its arguments.
 * @returns The adapter's answer.
 * @example pageStopAnswer('scopes', { frameId: 7 }) // => { scopes: [Block, Local] }
 */
function pageStopAnswer(
  command: 'scopes' | 'variables',
  arguments_: Record<string, number>,
): Promise<unknown> {
  if (command === 'scopes')
    return Promise.resolve({
      scopes: [
        { name: 'Block', presentationHint: 'locals', variablesReference: 100 },
        { name: 'Local', presentationHint: 'locals', variablesReference: 200 },
      ],
    })
  const handle = arguments_.variablesReference
  if (handle === 100)
    return Promise.resolve({
      variables: [
        {
          name: 'this',
          value: 'button#new-folder-ok',
          variablesReference: THIS_HANDLE,
        },
      ],
    })
  if (handle === 200)
    return Promise.resolve({
      variables: [
        { name: 'title', value: "'Codebook Folder'", variablesReference: 0 },
      ],
    })
  if (handle === THIS_HANDLE)
    return Promise.resolve({
      variables: Array.from({ length: 80 }, (_unused, index) => ({
        name: `member${index}`,
        value: 'null',
        variablesReference: 0,
      })),
    })
  return Promise.resolve({ variables: [] })
}

/** The captured value of one top-level variable by name, or `undefined` when it was not captured. */
function capturedValue(
  snapshot: Awaited<ReturnType<typeof captureReplayDebugSnapshot>>,
  name: string,
): string | undefined {
  const indexes =
    snapshot.frames[0]?.scopes.flatMap((scope) => scope.variables) ?? []
  return indexes
    .map((index) => snapshot.variables[index]!)
    .find((variable) => variable.name === name)?.value
}

// protects=a page stop keeps its locals when its `this` is a large host object (Cycle 0061 pt2: in Cursor the popup stop lost `title` to the variable budget); fails_when=the capture expands `this` before it saves the next scope's locals, so `title` reads as not captured; no_claim=the real js-debug scope order
test('a top-level-first capture keeps every local of the stopped frame before it expands a large this', async () => {
  // Arrange, Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: STACK,
    verifiedSource: SOURCE,
    assertCurrent() {},
    request: pageStopAnswer,
    limits: {
      timeoutMs: 1_500,
      maxFrames: 8,
      maxVariables: 64,
      maxDepth: 2,
      topLevelFirst: true,
    },
  })
  // Assert
  assert.equal(capturedValue(snapshot, 'title'), "'Codebook Folder'")
  assert.equal(capturedValue(snapshot, 'this'), 'button#new-folder-ok')
  assert.equal(snapshot.variables.length, 64)
})

// protects=the other profiles' capture order is unchanged (their saved replays keep today's depth-first snapshot); fails_when=the default capture also saves top-level variables first; no_claim=which order is better for them
test('the default capture still expands each value before the next scope, as the other profiles save it', async () => {
  // Arrange, Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: STACK,
    verifiedSource: SOURCE,
    assertCurrent() {},
    request: pageStopAnswer,
    limits: { timeoutMs: 1_500, maxFrames: 8, maxVariables: 64, maxDepth: 2 },
  })
  // Assert
  assert.equal(capturedValue(snapshot, 'title'), undefined)
  assert.equal(
    snapshot.frames[0]?.scopes[1]?.unavailable,
    'Historical variable count limit reached.',
  )
})
