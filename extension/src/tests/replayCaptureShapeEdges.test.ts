import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { maskSavedDebugSnapshot } from '../utils/maskSavedDebugSnapshot'

// The values below are made up: only the shape or the name around them marks them as credentials.
const SESSION_VALUE = ['JSESSION', 'VALUE', 'opaque', '4b7c20de'].join('-')
const ENVIRONMENT_VALUE = ['ENV', 'SECRET', 'VALUE', 'opaque', '19ad'].join('-')

type DapVariable = {
  name: string
  value: string
  type?: string
  variablesReference: number
}

/**
 * Builds the `request` a debug adapter would answer for one paused frame whose locals scope is reference 1.
 *
 * @param tree - The variables each reference lists; a reference missing here lists nothing.
 * @returns The request function for {@link captureReplayDebugSnapshot} and the references it was asked to expand.
 */
function pausedFrame(tree: Record<number, DapVariable[]>) {
  const expandedReferences: number[] = []
  return {
    expandedReferences,
    request(
      command: 'scopes' | 'variables',
      arguments_: Record<string, number>,
    ) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            {
              name: 'Local: handler',
              presentationHint: 'locals',
              variablesReference: 1,
            },
          ],
        })
      const reference = arguments_.variablesReference ?? 0
      expandedReferences.push(reference)
      return Promise.resolve({ variables: tree[reference] ?? [] })
    },
  }
}

/** Captures the paused frame depth-first (depth 5) or top-level first, the two paths the editors use. */
async function capture(
  frame: ReturnType<typeof pausedFrame>,
  path: 'depth-first' | 'top-level-first',
): Promise<ReplayDebugSnapshot> {
  return captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 0, name: 'handler', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 },
    assertCurrent() {},
    request: frame.request,
    limits: {
      timeoutMs: 1_500,
      maxFrames: 8,
      maxVariables: 64,
      maxDepth: 5,
      ...(path === 'top-level-first' && { topLevelFirst: true as const }),
    },
  })
}

/** Fails when any scripted secret appears anywhere in the saved snapshot. */
function assertSnapshotHoldsNone(
  snapshot: ReplayDebugSnapshot,
  secrets: readonly string[],
): void {
  const saved = JSON.stringify(snapshot)
  for (const secret of secrets)
    assert.equal(saved.includes(secret), false, `the snapshot holds ${secret}`)
}

/** Finds a top-level local of the saved frame by name. */
function savedLocal(snapshot: ReplayDebugSnapshot, name: string) {
  const found = snapshot.frames[0]!.scopes[0]!.variables.map(
    (index) => snapshot.variables[index]!,
  ).find((variable) => variable.name === name)
  assert.ok(found, `no saved local ${name}`)
  return found
}

/** The members of an environment object as an adapter lists them. */
const ENVIRONMENT_MEMBERS: DapVariable[] = [
  {
    name: 'PATH',
    value: "'/usr/bin'",
    type: 'string',
    variablesReference: 0,
  },
  {
    name: 'FEATURE_FLAG',
    value: `'${ENVIRONMENT_VALUE}'`,
    type: 'string',
    variablesReference: 0,
  },
  {
    name: 'NODE_ENV',
    value: "'development'",
    type: 'string',
    variablesReference: 0,
  },
  {
    name: '__proto__',
    value: 'Object',
    type: 'Object',
    variablesReference: 0,
  },
]

// protects=the Java session cookie held by a plainly named local; fails_when={name: 'JSESSIONID', value} or the pair JSESSIONID=… is saved with its value in a child, a parent preview or a string local; no_claim=a cookie with a non-secret name and no other shape
test('a replay snapshot never saves a JSESSIONID cookie record or pair', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'jar',
        value: "{name: 'JSESSIONID', value: '" + SESSION_VALUE + "'}",
        type: 'Object',
        variablesReference: 2,
      },
      {
        name: 'raw',
        value: `'JSESSIONID=${SESSION_VALUE}'`,
        type: 'string',
        variablesReference: 0,
      },
    ],
    2: [
      {
        name: 'name',
        value: "'JSESSIONID'",
        type: 'string',
        variablesReference: 0,
      },
      {
        name: 'value',
        value: `'${SESSION_VALUE}'`,
        type: 'string',
        variablesReference: 0,
      },
    ],
  })
  // Act
  const snapshot = await capture(frame, 'depth-first')
  // Assert
  assertSnapshotHoldsNone(snapshot, [SESSION_VALUE])
  assert.equal(savedLocal(snapshot, 'raw').value, '[masked]')
  assert.equal(savedLocal(snapshot, 'jar').value, 'Object')
})

// protects=readable word lists in the capture; fails_when=['pass', 'fail', 'skip'] loses 'fail' in the saved children or in the parent preview, or a list of header names loses the element after Authorization; no_claim=a flat rawHeaders list, which the other capture test covers
test('a replay snapshot keeps a list of words readable', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'outcomes',
        value: "Array(3) ['pass', 'fail', 'skip']",
        type: 'Array',
        variablesReference: 2,
      },
      {
        name: 'allowed',
        value: "Array(3) ['Content-Type', 'Authorization', 'X-Trace-Id']",
        type: 'Array',
        variablesReference: 3,
      },
    ],
    2: [
      { name: '0', value: "'pass'", type: 'string', variablesReference: 0 },
      { name: '1', value: "'fail'", type: 'string', variablesReference: 0 },
      { name: '2', value: "'skip'", type: 'string', variablesReference: 0 },
    ],
    3: [
      {
        name: '0',
        value: "'Content-Type'",
        type: 'string',
        variablesReference: 0,
      },
      {
        name: '1',
        value: "'Authorization'",
        type: 'string',
        variablesReference: 0,
      },
      {
        name: '2',
        value: "'X-Trace-Id'",
        type: 'string',
        variablesReference: 0,
      },
    ],
  })
  // Act
  const snapshot = await capture(frame, 'depth-first')
  // Assert
  assert.deepEqual(
    snapshot.variables.map((variable) => variable.value),
    [
      "Array(3) ['pass', 'fail', 'skip']",
      "'pass'",
      "'fail'",
      "'skip'",
      "Array(3) ['Content-Type', 'Authorization', 'X-Trace-Id']",
      "'Content-Type'",
      "'Authorization'",
      "'X-Trace-Id'",
    ],
  )
})

// protects=a Set-Cookie header whose value is an array of strings (Node's headers object, a raw header list); fails_when=the array after Set-Cookie is expanded or its elements are saved; no_claim=an array after a header that is no credential header
test('a replay snapshot masks the array that follows Set-Cookie in a flat header list and never expands it', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'rawHeaders',
        value: `Array(4) ['Host', 'x', 'Set-Cookie', Array(1) ['JSESSIONID=${SESSION_VALUE}']]`,
        type: 'Array',
        variablesReference: 2,
      },
    ],
    2: [
      { name: '0', value: "'Host'", type: 'string', variablesReference: 0 },
      { name: '1', value: "'x'", type: 'string', variablesReference: 0 },
      {
        name: '2',
        value: "'Set-Cookie'",
        type: 'string',
        variablesReference: 0,
      },
      {
        name: '3',
        value: `Array(1) ['JSESSIONID=${SESSION_VALUE}']`,
        type: 'Array',
        variablesReference: 3,
      },
    ],
    3: [
      {
        name: '0',
        value: `'JSESSIONID=${SESSION_VALUE}'`,
        type: 'string',
        variablesReference: 0,
      },
    ],
  })
  // Act
  const snapshot = await capture(frame, 'depth-first')
  // Assert
  assertSnapshotHoldsNone(snapshot, [SESSION_VALUE])
  assert.deepEqual(
    snapshot.variables.map((variable) => variable.value),
    ['Array', "'Host'", "'x'", "'Set-Cookie'", '[masked]'],
  )
  assert.equal(frame.expandedReferences.includes(3), false)
})

// protects=an alias of process.env; fails_when=const env = process.env (or environment) saves its members' values, in either capture path; no_claim=an object named env whose members are not environment variable names
test('a replay snapshot saves a variable named env that lists environment variables as its class name only', async () => {
  // Arrange
  const tree = {
    1: [
      {
        name: 'env',
        value: 'Object',
        type: 'Object',
        variablesReference: 2,
      },
      {
        name: 'environment',
        value: 'Object',
        type: 'Object',
        variablesReference: 2,
      },
    ],
    2: ENVIRONMENT_MEMBERS,
  }
  // Act
  const depthFirst = await capture(pausedFrame(tree), 'depth-first')
  const topLevelFirst = await capture(pausedFrame(tree), 'top-level-first')
  // Assert
  for (const snapshot of [depthFirst, topLevelFirst]) {
    assertSnapshotHoldsNone(snapshot, [ENVIRONMENT_VALUE, '/usr/bin'])
    assert.equal(savedLocal(snapshot, 'env').value, 'Object')
    assert.deepEqual(savedLocal(snapshot, 'env').children, [])
    assert.equal(savedLocal(snapshot, 'environment').value, 'Object')
    // The members just read are dropped again, so only the two locals remain.
    assert.equal(snapshot.variables.length, 2)
  }
})

// protects=readable configuration objects; fails_when=an object named env whose members are ordinary words is collapsed or loses its members; no_claim=an object named env whose members are SCREAMING_SNAKE_CASE, which is the alias rule
test('a replay snapshot keeps the members of a variable named env that does not list environment variables', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'env',
        value: "Object {mode: 'test', port: 3000}",
        type: 'Object',
        variablesReference: 2,
      },
    ],
    2: [
      { name: 'mode', value: "'test'", type: 'string', variablesReference: 0 },
      { name: 'port', value: '3000', type: 'number', variablesReference: 0 },
    ],
  })
  // Act
  const snapshot = await capture(frame, 'depth-first')
  // Assert
  assert.equal(savedLocal(snapshot, 'env').children.length, 2)
  assert.deepEqual(
    snapshot.variables.map((variable) => variable.value),
    ["Object {mode: 'test', port: 3000}", "'test'", '3000'],
  )
})

// protects=studies saved before the alias rule; fails_when=a saved env alias still serves its members or its preview keys' values; no_claim=a saved env object that is not environment-like
test('a saved snapshot serves an env alias, with or without saved members, as its class name only', () => {
  // Arrange
  const source = { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 }
  const snapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: 1,
        column: 1,
        source,
        scopes: [{ name: 'Local', variables: [0, 3] }],
      },
    ],
    variables: [
      { name: 'env', value: 'Object', type: 'Object', children: [1, 2] },
      { name: 'PATH', value: "'/usr/bin'", type: 'string', children: [] },
      {
        name: 'FEATURE_FLAG',
        value: `'${ENVIRONMENT_VALUE}'`,
        type: 'string',
        children: [],
      },
      {
        name: 'environment',
        value: `Object {PATH: '/usr/bin', FEATURE_FLAG: '${ENVIRONMENT_VALUE}'}`,
        type: 'Object',
        children: [],
      },
    ],
    limitations: [],
  }
  // Act
  const masked = maskSavedDebugSnapshot(snapshot)
  // Assert
  assertSnapshotHoldsNone(masked, [ENVIRONMENT_VALUE, '/usr/bin'])
  assert.deepEqual(
    masked.variables.map((variable) => [variable.name, variable.value]),
    [
      ['env', 'Object'],
      ['environment', 'Object'],
    ],
  )
})

// protects=the capture against a huge hostile value; fails_when=a raw value longer than four times the saved text limit is scanned by the shape rules or saved with its cookie; no_claim=values at or under the bound, which the other capture tests cover
test('a replay snapshot saves a raw value above the scan bound as its class name and never scans it', async () => {
  // Arrange
  const hugeString = `'sid=${SESSION_VALUE}; ` + 'x=y; '.repeat(40_000) + "'"
  const hugeObject = `{note: '${" 'a".repeat(40_000)}', cookie: 'sid=${SESSION_VALUE}; theme=dark'}`
  const frame = pausedFrame({
    1: [
      {
        name: 'body',
        value: hugeString,
        type: 'string',
        variablesReference: 0,
      },
      {
        name: 'payload',
        value: hugeObject,
        type: 'Object',
        variablesReference: 0,
      },
    ],
  })
  const startedAt = performance.now()
  // Act
  const snapshot = await capture(frame, 'depth-first')
  const tookMs = performance.now() - startedAt
  // Assert
  assertSnapshotHoldsNone(snapshot, [SESSION_VALUE])
  assert.equal(savedLocal(snapshot, 'body').value, 'string')
  assert.equal(savedLocal(snapshot, 'payload').value, 'Object')
  // gstack-timing-ok: the bound is the contract (a linear scan of a 120 KB value); measured times are 2–14 ms, so the 1 s bound only fails on the quadratic regression it guards.
  assert.ok(tookMs < 1_000, `the capture took ${Math.round(tookMs)} ms`)
})

// protects=a saved preview cut by the 4,096-character cap inside the element after a credential header name (Cycle 0073 pt1 /ship pass 1: `Array(8) ['Cookie', 'sid=…… [truncated]` had no closing quote, so the serve-time mask skipped it); fails_when=the saved snapshot serves the cut value of the Cookie element, from its preview or from the parent that shows it; no_claim=a preview whose element is closed, which the other masking tests cover
test('a saved snapshot serves the cut value after a Cookie name masked', () => {
  // Arrange
  const source = { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 }
  const snapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: 1,
        column: 1,
        source,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [
      {
        name: 'rawHeaders',
        value: `Array(8) ['Cookie', 'sid=${SESSION_VALUE}… [truncated]`,
        type: 'Array',
        children: [],
      },
    ],
    limitations: [],
  }
  // Act
  const masked = maskSavedDebugSnapshot(snapshot)
  // Assert
  assert.equal(JSON.stringify(masked).includes(SESSION_VALUE), false)
})

// protects=every string local longer than the saved text limit (a large JSON string, an HTML string, a SQL text), which the capture cuts with its trim mark and every later serving masks again (Cycle 0073 pt1: such a cut value was served as [masked]); fails_when=the capture or the second masking replaces a benign cut string by the mask, or drops its readable start or its trim mark; no_claim=a long string that holds a credential shape, which the other tests cover
test('a 5,000-character benign string local keeps its readable start and its trim mark when it is captured and served from a saved snapshot', async () => {
  // Arrange
  const benignStrings = {
    json: `{"items":[${'{"id":7,"name":"item"},'.repeat(300)}]}`.slice(
      0,
      5_000,
    ),
    html: `<ul class="list">${'<li class="row"><a href="/items?id=3">item</a></li>'.repeat(100)}`.slice(
      0,
      5_000,
    ),
    sql: `SELECT id, name FROM orders WHERE total > 100 ${'AND status = 1 '.repeat(400)}`.slice(
      0,
      5_000,
    ),
  }
  const frame = pausedFrame({
    1: Object.entries(benignStrings).map(([name, value]) => ({
      name,
      value: `'${value}'`,
      type: 'string',
      variablesReference: 0,
    })),
  })

  // Act
  const captured = await capture(frame, 'depth-first')
  const served = maskSavedDebugSnapshot(captured)

  // Assert
  for (const [name, value] of Object.entries(benignStrings)) {
    const savedValue = savedLocal(served, name).value
    assert.equal(savedValue.length, 4_096)
    assert.equal(savedValue.startsWith(`'${value.slice(0, 60)}`), true)
    assert.equal(savedValue.endsWith('… [truncated]'), true)
    assert.equal(savedLocal(captured, name).value, savedValue)
  }
})
