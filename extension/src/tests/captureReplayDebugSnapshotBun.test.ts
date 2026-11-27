import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'

/** The trial route's handler as the Cycle 0152 probes stopped in it. */
const HANDLER_SOURCE = [
  "import { Elysia } from 'elysia'",
  "import { greet } from './greeting'",
  '',
  'const app = new Elysia()',
  "  .get('/greet', ({ query }) => {",
  "    const name = query.name ?? 'Elysia'",
  '    return greet(name)',
  '  })',
].join('\n')

const SOURCE = {
  name: 'src/index.ts',
  text: HANDLER_SOURCE,
  hash: sha256(HANDLER_SOURCE),
  line: 7,
}

/** A two-frame stack: the anonymous handler, then Elysia's compiled `handle`. */
const STACK: DebugProtocol.StackTraceResponse['body'] = {
  stackFrames: [
    { id: 1, name: '<anonymous>', line: 7, column: 5 },
    { id: 2, name: 'handle', line: 6, column: 162 },
  ],
  totalFrames: 2,
}

/** The scopes and values js-debug answered for the handler stop on Bun (probe E1-M2), plus a module scope holding a database client. */
const VARIABLES: Record<number, DebugProtocol.Variable[]> = {
  11: [{ name: 'name', value: "'Codebook'", variablesReference: 0 }],
  12: [],
  13: [{ name: 'query', value: "{name: 'Codebook'}", variablesReference: 0 }],
  14: [
    { name: 'app', value: 'Elysia {…}', variablesReference: 0 },
    { name: 'greet', value: 'ƒ greet(name)', variablesReference: 0 },
    { name: 'databaseClient', value: 'Client {…}', variablesReference: 0 },
  ],
  15: [],
  21: [{ name: 'context', value: '{…}', variablesReference: 0 }],
}

/**
 * Answers the capture's DAP requests for the Bun handler stop: four closures (the handler's three, then the module's) and Script for frame 1, one closure for the caller frame 2.
 * @param command - The DAP command.
 * @param arguments_ - Its arguments.
 * @returns The adapter's answer.
 * @example bunStopAnswer('scopes', { frameId: 1 }) // => { scopes: [Closure ×4, Script, Global] }
 */
function bunStopAnswer(
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
        {
          name: 'Closure',
          presentationHint: 'arguments',
          variablesReference: 12,
        },
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
        { name: 'Script', variablesReference: 15 },
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

// Value: protects=a saved Bun replay keeps the stopped handler's own values (name, query), which Bun reports as closures, and never the module's scope (an imported function, the app, a database client) or a caller frame's closure; fails_when=the Bun stop's history holds no local values (the replay debugger would show nothing), or the module scope or a caller's closure is copied; seam=DAP answers shaped as probe E1-M2 recorded them; no_claim=js-debug's real answers (the native check covers them)
test('a Bun stop saves the handler own closures and never the module scope or a caller closure', async () => {
  // Arrange
  const input = {
    stack: STACK,
    verifiedSource: SOURCE,
    request: bunStopAnswer,
    assertCurrent: () => undefined,
    bunClosures: { moduleBindingNames: new Set(['Elysia', 'greet', 'app']) },
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), ['name', 'query'])
  assert.deepEqual(savedNames(snapshot, 1), [])
  assert.equal(
    snapshot.variables.some((variable) => variable.name === 'databaseClient'),
    false,
  )
})

// Value: protects=a node stop's capture is unchanged by the Bun rule: without bunClosures every closure stays out, as before; fails_when=closures are copied for a node stop; seam=the same answers without the Bun input; no_claim=V8 scope shapes
test('without the Bun input the same closures are not saved', async () => {
  // Arrange
  const input = {
    stack: STACK,
    verifiedSource: SOURCE,
    request: bunStopAnswer,
    assertCurrent: () => undefined,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), [])
})
