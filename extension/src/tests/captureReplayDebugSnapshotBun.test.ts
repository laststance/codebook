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
    bunClosures: true as const,
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

// Value: protects=a Bun stop whose closure classification read fails still saves the frame's block scope and the caller frames, records why no closure was saved, and claims no closure; fails_when=one failed `variables` request during classification marks the whole stopped frame unavailable and drops values the default policy could save (Cycle 0152 review finding), or the failure is silent; seam=DAP answers with a block scope before the closures and a refused variables request; no_claim=which adapter failures happen in practice
test('a failed closure classification keeps the block scope, saves no closure and says why', async () => {
  // Arrange
  const refusingClassification = (
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ): Promise<unknown> => {
    if (command === 'scopes' && arguments_.frameId === 1)
      return Promise.resolve({
        scopes: [
          { name: 'Block', presentationHint: 'locals', variablesReference: 10 },
          {
            name: 'Closure',
            presentationHint: 'arguments',
            variablesReference: 11,
          },
          {
            name: 'Closure',
            presentationHint: 'arguments',
            variablesReference: 14,
          },
          { name: 'Script', variablesReference: 15 },
        ],
      })
    if (command === 'variables' && arguments_.variablesReference === 10)
      return Promise.resolve({
        variables: [{ name: 'item', value: "'book'", variablesReference: 0 }],
      })
    if (command === 'variables' && arguments_.variablesReference === 11)
      return Promise.reject(new Error('adapter refused variables'))
    return bunStopAnswer(command, arguments_)
  }
  const input = {
    stack: STACK,
    verifiedSource: SOURCE,
    request: refusingClassification,
    assertCurrent: () => undefined,
    bunClosures: true as const,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), ['item'])
  assert.equal(snapshot.frames[0]?.unavailable, undefined)
  assert.deepEqual(savedNames(snapshot, 1), [])
  assert.deepEqual(snapshot.limitations, [
    "The stopped frame's closure scopes could not be classified (adapter refused variables), so none of them was saved.",
  ])
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

// Value: protects=a Bun stop whose closure classification fails with a 5,000-character adapter error still yields a valid snapshot that keeps the block scope, with a limitation that is a whole sentence within the saved text limit; fails_when=the sentence's cause alone is cut so prefix plus cause plus suffix exceeds the limit and the snapshot schema rejects the stop (Cycle 0152 review finding); seam=a refused variables request with a long message; no_claim=what real adapters write
test('a 5,000-character classification error keeps the block scope and a bounded limitation', async () => {
  // Arrange
  const refusingClassification = (
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ): Promise<unknown> => {
    if (command === 'scopes' && arguments_.frameId === 1)
      return Promise.resolve({
        scopes: [
          { name: 'Block', presentationHint: 'locals', variablesReference: 10 },
          {
            name: 'Closure',
            presentationHint: 'arguments',
            variablesReference: 11,
          },
          {
            name: 'Closure',
            presentationHint: 'arguments',
            variablesReference: 14,
          },
          { name: 'Script', variablesReference: 15 },
        ],
      })
    if (command === 'variables' && arguments_.variablesReference === 10)
      return Promise.resolve({
        variables: [{ name: 'item', value: "'book'", variablesReference: 0 }],
      })
    if (command === 'variables' && arguments_.variablesReference === 11)
      return Promise.reject(new Error('x'.repeat(5_000)))
    return bunStopAnswer(command, arguments_)
  }
  const input = {
    stack: STACK,
    verifiedSource: SOURCE,
    request: refusingClassification,
    assertCurrent: () => undefined,
    bunClosures: true as const,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), ['item'])
  assert.equal(snapshot.limitations.length, 1)
  assert.equal(snapshot.limitations[0]!.length, 4_096)
  assert.equal(
    snapshot.limitations[0]!.startsWith(
      "The stopped frame's closure scopes could not be classified (xxx",
    ),
    true,
  )
  assert.equal(
    snapshot.limitations[0]!.endsWith(
      '… [truncated]), so none of them was saved.',
    ),
    true,
  )
})

// Value: protects=an anonymous handler made by an anonymous factory saves its own values and never the factory's closure (a tenant name) in a captured Bun replay; fails_when=the factory closure reaches the saved history; seam=source text of a factory plus DAP answers for [handler, factory, module] closures; no_claim=adapters other than js-debug
test('a captured Bun replay of a handler in an anonymous factory saves no factory closure value', async () => {
  // Arrange
  const source = [
    "import { Elysia } from 'elysia'",
    'const makeRoutes = (tenantName) => {',
    '  return ({ query }) => {',
    '    const name = query.name',
    '    return name',
    '  }',
    '}',
  ].join('\n')
  const answers: Record<number, DebugProtocol.Variable[]> = {
    11: [{ name: 'name', value: "'x'", variablesReference: 0 }],
    12: [{ name: 'query', value: '{}', variablesReference: 0 }],
    13: [{ name: 'tenantName', value: "'acme'", variablesReference: 0 }],
    14: [{ name: 'makeRoutes', value: 'ƒ', variablesReference: 0 }],
  }
  const request = (
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ): Promise<unknown> => {
    if (command === 'scopes')
      return Promise.resolve({
        scopes: [11, 12, 13, 14].map((variablesReference) => ({
          name: 'Closure',
          presentationHint: 'arguments',
          variablesReference,
        })),
      })
    return Promise.resolve({
      variables: answers[arguments_.variablesReference ?? -1] ?? [],
    })
  }
  const input = {
    stack: {
      stackFrames: [{ id: 1, name: '<anonymous>', line: 5, column: 5 }],
      totalFrames: 1,
    },
    verifiedSource: {
      name: 'src/index.ts',
      text: source,
      hash: sha256(source),
      line: 5,
    },
    request,
    assertCurrent: () => undefined,
    bunClosures: true as const,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot(input)
  // Assert
  assert.deepEqual(savedNames(snapshot, 0), ['name', 'query'])
})
