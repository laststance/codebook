import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import {
  BUN_SCOPES_NOT_SAVED_LIMITATION,
  REPLAY_SCOPE_NOT_CAPTURED_TEXT,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'

/** A handler made by a factory, as a Bun route stops in it. */
const HANDLER_SOURCE = [
  "import { Elysia } from 'elysia'",
  'const makeRoutes = (tenantName) => {',
  '  return ({ query }) => {',
  '    const requestId = query.id',
  '    return requestId',
  '  }',
  '}',
].join('\n')

const SOURCE = {
  name: 'src/index.ts',
  text: HANDLER_SOURCE,
  hash: sha256(HANDLER_SOURCE),
  line: 5,
}

/** A two-frame stack: the anonymous handler, then the caller `handle`. */
const STACK: DebugProtocol.StackTraceResponse['body'] = {
  stackFrames: [
    { id: 1, name: '<anonymous>', line: 5, column: 5 },
    { id: 2, name: 'handle', line: 6, column: 162 },
  ],
  totalFrames: 2,
}

/** The values behind each scope handle of the handler stop. */
const VARIABLES: Record<number, DebugProtocol.Variable[]> = {
  11: [{ name: 'requestId', value: "'r-1'", variablesReference: 0 }],
  12: [{ name: 'item', value: "'book'", variablesReference: 0 }],
  13: [{ name: 'tenantName', value: "'acme'", variablesReference: 0 }],
  14: [{ name: 'databaseClient', value: 'Client {…}', variablesReference: 0 }],
  21: [{ name: 'context', value: '{…}', variablesReference: 0 }],
}

/**
 * Answers the capture's DAP requests for the handler stop: [closure(own), Block(locals), closure(factory), closure(module), Global] for frame 1, one closure for frame 2.
 * @param command - The DAP command.
 * @param arguments_ - Its arguments.
 * @returns The adapter's answer.
 * @example handlerStopAnswer('scopes', { frameId: 1 }) // => { scopes: [Closure, Block, Closure, Closure, Global] }
 */
function handlerStopAnswer(
  command: 'scopes' | 'variables',
  arguments_: Record<string, number>,
): Promise<unknown> {
  if (command === 'scopes' && arguments_.frameId === 1)
    return Promise.resolve({
      scopes: [
        {
          name: 'Closure',
          presentationHint: 'arguments',
          variablesReference: 11,
        },
        { name: 'Block', presentationHint: 'locals', variablesReference: 12 },
        {
          name: 'Closure',
          presentationHint: 'arguments',
          variablesReference: 13,
        },
        {
          name: 'Closure',
          presentationHint: 'arguments',
          variablesReference: 14,
        },
        { name: 'Global', expensive: true, variablesReference: 16 },
      ],
    })
  if (command === 'scopes')
    return Promise.resolve({
      scopes: [
        {
          name: 'Closure (handle)',
          presentationHint: 'arguments',
          variablesReference: 21,
        },
      ],
    })
  return Promise.resolve({
    variables: VARIABLES[arguments_.variablesReference ?? -1] ?? [],
  })
}

/** Every saved top-level variable name of one frame. */
function savedNames(
  snapshot: Awaited<ReturnType<typeof captureReplayDebugSnapshot>>,
  frameIndex: number,
): string[] {
  return (snapshot.frames[frameIndex]?.scopes ?? [])
    .flatMap((scope) => scope.variables)
    .map((index) => snapshot.variables[index]!.name)
}

// Value: protects=a saved Bun replay copies no value of the stopped frame's scopes (an own closure, a block scope, a factory closure, the module scope), because Bun reports them all alike; fails_when=any scope value of a Bun stop reaches the saved history, a scope is not recorded by name as not captured, the limitation is missing or repeated, or the call stack is lost; seam=DAP answers for [closure(own), Block(locals), closure(factory), closure(module), Global]; no_claim=js-debug's real answers (the native check covers them)
test('a Bun stop saves no scope value, records each scope as not captured and keeps the call stack', async () => {
  // Arrange
  const input = {
    stack: STACK,
    verifiedSource: SOURCE,
    request: handlerStopAnswer,
    assertCurrent: () => undefined,
    savesNoScopeValues: true as const,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), [])
  assert.deepEqual(savedNames(snapshot, 1), [])
  assert.deepEqual(
    snapshot.frames[0]?.scopes.map((scope) => scope.name),
    ['Closure', 'Block', 'Closure', 'Closure', 'Global'],
  )
  assert.deepEqual(
    snapshot.frames[0]?.scopes.map((scope) => scope.unavailable),
    Array(5).fill(REPLAY_SCOPE_NOT_CAPTURED_TEXT),
  )
  assert.deepEqual(
    snapshot.frames.map((frame) => frame.name),
    ['<anonymous>', 'handle'],
  )
  assert.deepEqual(snapshot.limitations, [BUN_SCOPES_NOT_SAVED_LIMITATION])
  assert.equal(snapshot.variables.length, 0)
})

// Value: protects=a Node stop's capture is unchanged: its `locals` scope is copied and its closures are not; fails_when=the Bun rule leaks into a Node stop (locals dropped or closures copied, or the Bun limitation recorded); seam=the same answers without the Bun input; no_claim=V8 scope shapes
test('without the Bun input the block scope is saved, closures are not, and no Bun limitation is recorded', async () => {
  // Arrange
  const input = {
    stack: STACK,
    verifiedSource: SOURCE,
    request: handlerStopAnswer,
    assertCurrent: () => undefined,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), ['item'])
  assert.deepEqual(snapshot.limitations, [])
})
