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

// protects=a top-level-first capture spends no adapter request on a scope without a handle or after the variable budget is spent, as the default capture does (CodeRabbit pt2 round 4); fails_when=it asks the adapter for variablesReference 0 (and saves the refusal text as the scope's cause) or reads a scope after the budget; no_claim=js-debug's own answer to a zero handle
test('a top-level-first capture sends no variables request for a scope without a handle or after the budget is spent', async () => {
  // Arrange
  const requests: { command: string; handle?: number }[] = []
  const answer = (
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ): Promise<unknown> => {
    requests.push({ command, handle: arguments_.variablesReference })
    if (command === 'scopes')
      return Promise.resolve({
        scopes: [
          {
            name: 'Closure',
            presentationHint: 'locals',
            variablesReference: 0,
          },
          {
            name: 'Local',
            presentationHint: 'locals',
            variablesReference: 200,
          },
          {
            name: 'Block',
            presentationHint: 'locals',
            variablesReference: 300,
          },
        ],
      })
    if (arguments_.variablesReference === 0)
      return Promise.reject(new Error('Invalid variablesReference 0'))
    return Promise.resolve({
      variables: [
        { name: 'title', value: "'Codebook Folder'", variablesReference: 0 },
        { name: 'parentId', value: "'1'", variablesReference: 0 },
      ],
    })
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: STACK,
    verifiedSource: SOURCE,
    assertCurrent() {},
    request: answer,
    limits: {
      timeoutMs: 1_500,
      maxFrames: 8,
      maxVariables: 2,
      maxDepth: 2,
      topLevelFirst: true,
    },
  })
  // Assert
  assert.deepEqual(
    requests.filter((request) => request.command === 'variables'),
    [{ command: 'variables', handle: 200 }],
  )
  assert.deepEqual(snapshot.frames[0]?.scopes[0], {
    name: 'Closure',
    variables: [],
  })
  assert.equal(
    snapshot.frames[0]?.scopes[2]?.unavailable,
    'Historical variable count limit reached.',
  )
})

// protects=a DOM node preview that js-debug colors with ANSI SGR codes is stored as plain text (Cycle 0069 smoke: page stop 1 showed raw escape codes in Variables); fails_when=the capture saves the escape sequences of a value, so the replay prints raw codes; no_claim=js-debug's own coloring rules
test('a captured DOM node preview is saved without its terminal color codes', async () => {
  // Arrange
  const colored =
    '\u001b[34m<button \u001b[34;1mclass\u001b[2m=\u001b[33m"dialog-btn primary"\u001b[39m\u001b[22m>\u001b[0m'
  const answer = (command: 'scopes' | 'variables'): Promise<unknown> =>
    Promise.resolve(
      command === 'scopes'
        ? {
            scopes: [
              {
                name: 'Block',
                presentationHint: 'locals',
                variablesReference: 100,
              },
            ],
          }
        : {
            variables: [
              { name: 'this', value: colored, variablesReference: 0 },
            ],
          },
    )

  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: STACK,
    verifiedSource: SOURCE,
    assertCurrent() {},
    request: answer,
    limits: {
      timeoutMs: 1_500,
      maxFrames: 8,
      maxVariables: 64,
      maxDepth: 2,
      topLevelFirst: true,
    },
  })

  // Assert
  assert.equal(
    capturedValue(snapshot, 'this'),
    '<button class="dialog-btn primary">',
  )
})
