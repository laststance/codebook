import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import { inspectNodeTestVariables } from '../utils/inspectNodeTestVariables'

test('a Node pause keeps declared nested facts without retaining unrelated local values', async () => {
  // Arrange
  const references = new Map<number, DebugProtocol.Variable[]>([
    [
      1,
      [
        {
          name: 'listener',
          value: '() => undefined',
          type: 'Function',
          variablesReference: 0,
        },
        {
          name: 'secret',
          value: 'private-token',
          type: 'string',
          variablesReference: 0,
        },
        {
          name: 'state',
          value: 'Object',
          type: 'Object',
          variablesReference: 2,
        },
      ],
    ],
    [2, [{ name: 'count', value: '3', type: 'number', variablesReference: 0 }]],
  ])
  const session = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => ({ variables: references.get(arguments_.variablesReference) ?? [] }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [{ name: 'Local', variablesReference: 1, expensive: false }]
  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [
      { path: 'listener', mode: 'value', required: true },
      { path: 'state.count', mode: 'value', required: true },
    ],
    AbortSignal.timeout(1_000),
  )
  // Assert
  assert.deepEqual(result.facts, [
    {
      path: 'listener',
      mode: 'value',
      display: '() => undefined',
      type: 'Function',
    },
    { path: 'state.count', mode: 'value', display: '3', type: 'number' },
  ])
  assert.deepEqual(
    result.variables.map((variable) => variable.name),
    ['listener', 'count'],
  )
  assert.equal(JSON.stringify(result).includes('private-token'), false)
})

test('a Node pause does not inspect global variables when the declared local fact exists', async () => {
  // Arrange
  const references: number[] = []
  const session = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      references.push(arguments_.variablesReference)
      return {
        variables:
          arguments_.variablesReference === 1
            ? [
                {
                  name: 'listener',
                  value: 'ready',
                  type: 'string',
                  variablesReference: 0,
                },
              ]
            : [
                {
                  name: 'secret',
                  value: 'private-token',
                  variablesReference: 0,
                },
              ],
      }
    },
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [
    { name: 'Local', variablesReference: 1, expensive: false },
    { name: 'Global', variablesReference: 2, expensive: true },
  ]
  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [{ path: 'listener', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )
  // Assert
  assert.deepEqual(references, [1])
  assert.deepEqual(result.facts, [
    { path: 'listener', mode: 'value', display: 'ready', type: 'string' },
  ])
})

// Value: protects=a required fact the debugger cannot read is returned by name instead of ending the stop's capture, so the run can keep its other facts and stay paused there; fails_when=the inspector throws for it, which ended the whole live run with RUNTIME_FAILED (Cycle 0052 task 5); why_new=restates the earlier refusal test: the refusal moved to codebook_continue (O4); seam=a fake debug session whose scopes hold no variable; no_claim=the service's refusal (nodeTestService)
test('a Node pause returns a required value it cannot read by name instead of failing', async () => {
  // Arrange
  const session = {
    customRequest: async () => ({ variables: [] }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [{ name: 'Local', variablesReference: 1, expensive: false }]

  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [{ path: 'listener', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:listener'] },
  )
})

test('a Node pause keeps a declared value whose debugger type name is too long to save, omitting only that type', async () => {
  // Arrange: a deeply generic TypeScript value can report a type name longer than the saved 256-character field.
  const longTypeName = `Map<string, ${'Array<Record<string, number>>, '.repeat(12)}number>`
  const session = {
    customRequest: async () => ({
      variables: [
        {
          name: 'totals',
          value: 'Map(3)',
          type: longTypeName,
          variablesReference: 0,
        },
      ],
    }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [{ name: 'Local', variablesReference: 1, expensive: false }]

  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [{ path: 'totals', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.ok(longTypeName.length > 256)
  assert.deepEqual(result.facts, [
    { path: 'totals', mode: 'value', display: 'Map(3)' },
  ])
})

/**
 * Builds a fake debug session that answers `variables` requests from a fixed table, as the native JavaScript debugger would.
 * @param table - The children of each variables reference.
 * @returns The session's `customRequest`.
 * @example sessionAnswering(new Map([[1, [{ name: 'a', value: '1', variablesReference: 0 }]]]))
 */
function sessionAnswering(
  table: Map<number, DebugProtocol.Variable[]>,
): Pick<vscode.DebugSession, 'customRequest'> {
  return {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => ({ variables: table.get(arguments_.variablesReference) ?? [] }),
  }
}

const VITEST_SCOPES = [
  { name: 'Local', variablesReference: 1, expensive: false },
  { name: 'Block', variablesReference: 2, expensive: false },
  { name: 'Global', variablesReference: 9, expensive: false },
]

// Value: protects=a required fact whose root is a name the test imports from a module that vi.mock replaced is read through the module's binding: the root has no variable of its own (Vitest binds the whole module as __vi_import_<n>__, a Proxy whose exports sit under [[Target]]), and the walk then reads mock → calls → length as for a local mock; fails_when=the inspector finds roots by lexical name only, so revalidatePath.mock.calls.length is unavailable and the live run ended (N51-V5, Cycle 0052 task 5); why_new=the root cause recorded in #124 (a live V8 probe of nextjs-dashboard's actions.test.ts under Vitest 5.0.2); seam=a fake debug session answering with the probed shapes; no_claim=the native debugger's own naming of [[Target]] (N52 live)
test('a Node pause reads a required value of a name the test imports from a mocked module', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'set', value: 'ƒ (...args)', variablesReference: 0 }]],
      [
        2,
        [
          {
            name: '__vite_ssr_import_0__',
            value: 'Module',
            variablesReference: 3,
          },
          {
            name: '__vi_import_1__',
            value: 'Proxy(Object)',
            variablesReference: 4,
          },
        ],
      ],
      [3, [{ name: 'expect', value: '(...)', variablesReference: 0 }]],
      [
        4,
        [
          { name: '[[Handler]]', value: 'Object', variablesReference: 40 },
          { name: '[[Target]]', value: 'Object', variablesReference: 41 },
          { name: '[[IsRevoked]]', value: 'false', variablesReference: 0 },
        ],
      ],
      [
        41,
        [
          {
            name: 'revalidatePath',
            value: 'ƒ (...args)',
            type: 'function',
            variablesReference: 42,
          },
        ],
      ],
      [
        42,
        [{ name: 'mock', value: '{calls: Array(1)}', variablesReference: 43 }],
      ],
      [43, [{ name: 'calls', value: 'Array(1)', variablesReference: 44 }]],
      [
        44,
        [
          {
            name: '0',
            value: "['/dashboard/invoices']",
            variablesReference: 45,
          },
          { name: 'length', value: '1', type: 'number', variablesReference: 0 },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [
      {
        path: 'revalidatePath.mock.calls.length',
        mode: 'value',
        required: true,
      },
    ],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        {
          path: 'revalidatePath.mock.calls.length',
          mode: 'value',
          display: '1',
          type: 'number',
        },
      ],
      unavailable: [],
    },
  )
})

// Value: protects=a required fact whose root a module exports as a live binding is read: an unmocked module is a namespace whose exports are getters, which the debugger shows as lazy values, and the inspector expands the lazy value once, as the Variables view does, instead of saving its "(...)" placeholder; fails_when=the imported root is not found, or the placeholder "(...)" is saved as the value (Cycle 0052 task 5); why_new=the probe showed unmocked imports as Module namespaces with accessor exports; seam=a fake debug session answering a lazy variable with its one resolved child; no_claim=which getters the native debugger marks lazy (N52 live)
test('a Node pause reads a required value of a name the test imports from an unmocked module', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_3__',
            value: 'Module',
            variablesReference: 5,
          },
        ],
      ],
      [
        5,
        [
          {
            name: 'ITEMS_PER_PAGE',
            value: '(...)',
            variablesReference: 50,
            presentationHint: { lazy: true },
          },
        ],
      ],
      [
        50,
        [
          {
            name: 'ITEMS_PER_PAGE',
            value: '6',
            type: 'number',
            variablesReference: 0,
          },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'ITEMS_PER_PAGE', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(result.facts, [
    { path: 'ITEMS_PER_PAGE', mode: 'value', display: '6', type: 'number' },
  ])
})

// Value: protects=a name that two imported modules both export is not guessed: the fact stays unavailable rather than showing the value of the module the source may not mean; fails_when=the first binding's export is taken, so a fact can show another module's value (Cycle 0052 task 5); why_new=the module-binding lookup has no source map to tell which import a name came from; seam=a fake debug session with two bindings exporting the same name; no_claim=how often two imports share a name
test('a Node pause leaves a name that two imported modules export unavailable', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_1__',
            value: 'Object',
            variablesReference: 6,
          },
          {
            name: '__vite_ssr_import_2__',
            value: 'Object',
            variablesReference: 7,
          },
        ],
      ],
      [
        6,
        [
          {
            name: 'formatCurrency',
            value: 'ƒ formatCurrency(amount)',
            variablesReference: 0,
          },
        ],
      ],
      [
        7,
        [
          {
            name: 'formatCurrency',
            value: 'ƒ formatCurrency(cents)',
            variablesReference: 0,
          },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'formatCurrency', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:formatCurrency'] },
  )
})

// Value: protects=a local variable keeps priority over an import of the same name, as JavaScript scoping does: the fact reads the local value; fails_when=the module binding's export replaces a local variable that shadows it (Cycle 0052 task 5); why_new=the import lookup must only run when no scope variable has the name; seam=a fake debug session with a local and an import of one name; no_claim=closure scopes of other frames
test('a Node pause reads a local variable before an imported name it shadows', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [
        1,
        [
          {
            name: 'status',
            value: "'paid'",
            type: 'string',
            variablesReference: 0,
          },
        ],
      ],
      [
        2,
        [
          {
            name: '__vite_ssr_import_1__',
            value: 'Object',
            variablesReference: 6,
          },
        ],
      ],
      [
        6,
        [
          {
            name: 'status',
            value: "'imported'",
            type: 'string',
            variablesReference: 0,
          },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'status', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(result.facts, [
    { path: 'status', mode: 'value', display: "'paid'", type: 'string' },
  ])
})
