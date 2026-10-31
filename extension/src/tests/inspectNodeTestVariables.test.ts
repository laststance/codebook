import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import { ACTIVE_TIMEOUT_MS } from '../runtimeSupport/constants'
import { inspectNodeTestVariables } from '../utils/inspectNodeTestVariables'
import { sourceImportBindings } from '../utils/sourceImportBindings'

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
    sourceImportBindings(''),
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
    sourceImportBindings(''),
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
    sourceImportBindings(''),
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
    sourceImportBindings(''),
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
            name: '__vi_import_0__',
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
    sourceImportBindings(
      "import { expect } from 'vitest'\nimport { revalidatePath } from 'next/cache'",
    ),
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
            name: '__vite_ssr_import_0__',
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
    sourceImportBindings("import { ITEMS_PER_PAGE } from './data'"),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(result.facts, [
    { path: 'ITEMS_PER_PAGE', mode: 'value', display: '6', type: 'number' },
  ])
})

// Value: protects=an imported name is read from its own declaration's module binding, never from another imported module that exports the same name: the fact shows the value the source actually imports; fails_when=every module binding's export of the name is a candidate, so a second module's export makes the fact unavailable or, when the right binding is out of scope, answers for it (Cycle 0052 tasks 5, 96); why_new=hosted CodeRabbit review of 267e5bce (Major, inspectNodeTestVariables.ts:245-253); seam=a fake debug session whose two module bindings both export formatCurrency, and the stopped source's import declarations; no_claim=Vite's numbering itself (sourceImportBindings tests)
test('a Node pause reads an imported name from its own import declaration module, not from another module exporting the same name', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_0__',
            value: 'Module',
            variablesReference: 6,
          },
          {
            name: '__vite_ssr_import_1__',
            value: 'Module',
            variablesReference: 7,
          },
        ],
      ],
      [
        6,
        [
          {
            name: 'formatDate',
            value: 'ƒ formatDate(date)',
            variablesReference: 0,
          },
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
    sourceImportBindings(
      "import { formatDate } from './dates'\nimport { formatCurrency } from './utils'",
    ),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        {
          path: 'formatCurrency',
          mode: 'value',
          display: 'ƒ formatCurrency(cents)',
        },
      ],
      unavailable: [],
    },
  )
})

// Value: protects=an imported name whose own module binding the stop's scopes do not hold stays unavailable, even when another module binding in scope exports the same name; fails_when=the other binding's export answers for it and a wrong value is saved as a required fact (Cycle 0052 task 96); why_new=hosted CodeRabbit review of 267e5bce (Major); seam=a fake debug session whose only module binding in scope belongs to another declaration and exports the name too; no_claim=which scopes V8 shows at a stop
test('a Node pause leaves an imported name unavailable when its own module binding is out of scope, though another binding exports it', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_0__',
            value: 'Module',
            variablesReference: 6,
          },
        ],
      ],
      [
        6,
        [
          {
            name: 'formatDate',
            value: 'ƒ formatDate(date)',
            variablesReference: 0,
          },
          {
            name: 'formatCurrency',
            value: 'ƒ formatCurrency(amount)',
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
    sourceImportBindings(
      "import { formatDate } from './dates'\nimport { formatCurrency } from './utils'",
    ),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:formatCurrency'] },
  )
})

// Value: protects=an import the TypeScript compiler dropped (one used only as a type, without `import type`) shifts Vite's numbering of the later declarations; the shift is caught and the name stays unavailable instead of reading the next module's export; fails_when=the numbering is trusted without checking that each earlier binding holds its own declaration's exports, so `db` is read from another module (Cycle 0052 task 96); why_new=hosted CodeRabbit review of 267e5bce (Major); seam=a fake debug session whose bindings are numbered as if the first import had been dropped; no_claim=which imports a given compiler drops
test('a Node pause leaves an imported name unavailable when a dropped earlier import shifted the module numbering', async () => {
  // Arrange: next/server was dropped, so binding 0 is @/db and binding 1 is another module that exports db too.
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_0__',
            value: 'Module',
            variablesReference: 6,
          },
          {
            name: '__vite_ssr_import_1__',
            value: 'Module',
            variablesReference: 7,
          },
        ],
      ],
      [6, [{ name: 'db', value: 'Object', variablesReference: 0 }]],
      [7, [{ name: 'db', value: 'OtherDatabase', variablesReference: 0 }]],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'db', mode: 'value', required: true }],
    sourceImportBindings(
      "import { NextRequest } from 'next/server'\nimport { db } from '@/db'",
    ),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:db'] },
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
            name: '__vite_ssr_import_0__',
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
    sourceImportBindings("import { status } from './status'"),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(result.facts, [
    { path: 'status', mode: 'value', display: "'paid'", type: 'string' },
  ])
})

// Value: protects=a declared path that passes through a getter the debugger shows as lazy ("(...)") is walked on: the lazy step is expanded once and the next segment is read from its value; fails_when=only the first and last step expand a lazy value, so a path such as mock.calls.length stops at the "(...)" placeholder and the required fact is unavailable (Cycle 0052 task 5); why_new=the unmocked-module test expands one lazy value at the end of a root, none in the middle of a path; seam=a fake debug session answering a lazy middle step with its one resolved child; no_claim=which getters the native debugger marks lazy (N52 live)
test('a Node pause reads a required value behind a lazy getter in the middle of its path', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [
        1,
        [
          {
            name: 'revalidatePath',
            value: 'ƒ (...args)',
            variablesReference: 3,
          },
        ],
      ],
      [
        3,
        [
          {
            name: 'mock',
            value: '(...)',
            variablesReference: 30,
            presentationHint: { lazy: true },
          },
        ],
      ],
      [30, [{ name: 'mock', value: 'Object', variablesReference: 31 }]],
      [
        31,
        [
          {
            name: 'callCount',
            value: '2',
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
    [{ path: 'revalidatePath.mock.callCount', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        {
          path: 'revalidatePath.mock.callCount',
          mode: 'value',
          display: '2',
          type: 'number',
        },
      ],
      unavailable: [],
    },
  )
})

// Value: protects=a Node stop whose required value sits behind a lazy getter the debugger cannot expand (the getter throws in the test process, or the adapter refuses the request): the fact reads unavailable and the stop keeps its other facts; fails_when=the rejected expansion escapes the inspector, so the whole advance fails and the live run ends instead of the agent hearing which fact is missing; why_new=pt3 /ship review (Red Team): the lazy expansion added for imported names runs getters and its rejection was not caught; seam=a fake debug session that rejects the expansion of one reference; no_claim=how the native adapter answers a throwing getter (it may answer with the error as a value instead)
test('a Node pause reports a required value behind a lazy getter the debugger cannot expand as unavailable and keeps its other facts', async () => {
  // Arrange
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 30)
        throw new Error('Cannot access the getter before initialization')
      const table = new Map<number, DebugProtocol.Variable[]>([
        [
          1,
          [
            {
              name: 'status',
              value: "'paid'",
              type: 'string',
              variablesReference: 0,
            },
            {
              name: 'config',
              value: 'Object',
              variablesReference: 3,
            },
          ],
        ],
        [
          3,
          [
            {
              name: 'limit',
              value: '(...)',
              variablesReference: 30,
              presentationHint: { lazy: true },
            },
          ],
        ],
      ])
      return { variables: table.get(arguments_.variablesReference) ?? [] }
    },
  }

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [
      { path: 'config.limit', mode: 'value', required: true },
      { path: 'status', mode: 'value', required: true },
    ],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        { path: 'status', mode: 'value', display: "'paid'", type: 'string' },
      ],
      unavailable: ['value:config.limit'],
    },
  )
})

// Value: protects=an imported name whose module binding two of the stop's scopes both list: it is one import, so the fact is read, not left unavailable as ambiguous; fails_when=each scope's listing of the same binding counts as another module exporting the name, so a required fact such as db.insert.mock.calls reads unavailable; why_new=pt3 /ship review (Red Team): bindings were collected per scope without telling a repeated listing from a second module; seam=a fake debug session in which the Block and Closure scopes list the same __vi_import_0__ binding; no_claim=which native scope layouts repeat a binding
test('a Node pause reads an imported name once when two scopes list the same module binding', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vi_import_0__',
            value: 'Proxy(Object)',
            variablesReference: 40,
          },
        ],
      ],
      [
        5,
        [
          {
            name: '__vi_import_0__',
            value: 'Proxy(Object)',
            variablesReference: 41,
          },
        ],
      ],
      [40, [{ name: 'db', value: 'Object', variablesReference: 50 }]],
      [41, [{ name: 'db', value: 'Object', variablesReference: 50 }]],
      [
        50,
        [
          {
            name: 'inserted',
            value: '0',
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
    [
      { name: 'Local', variablesReference: 1, expensive: false },
      { name: 'Block', variablesReference: 2, expensive: false },
      { name: 'Closure', variablesReference: 5, expensive: false },
    ],
    [{ path: 'db.inserted', mode: 'value', required: true }],
    sourceImportBindings("import { db } from '@/db'"),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        { path: 'db.inserted', mode: 'value', display: '0', type: 'number' },
      ],
      unavailable: [],
    },
  )
})

// Value: protects=a Node stop whose lazy expansion gets a malformed answer from the debugger: the pass fails as before, rather than reading the fact as merely unavailable and keeping a stop on a broken session; fails_when=the lazy expansion swallows every failure (a timeout, a cancellation, a malformed answer), so a broken debugger reads as a missing fact and the agent is told to continue; why_new=pt3 /ship review pass 2 (Red Team): the first catch took every failure for a throwing getter; seam=a fake debug session that answers the lazy reference without a variable list; no_claim=a timeout, which takes the active timeout to reach
test('a Node pause whose lazy expansion gets a malformed debugger answer fails instead of reporting the fact unavailable', async () => {
  // Arrange
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) =>
      arguments_.variablesReference === 30
        ? {}
        : {
            variables:
              arguments_.variablesReference === 1
                ? [
                    {
                      name: 'limit',
                      value: '(...)',
                      variablesReference: 30,
                      presentationHint: { lazy: true },
                    },
                  ]
                : [],
          },
  }

  // Act
  const outcome = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'limit', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(outcome, 'Error: Native debugger supplied no variable list.')
})

// Value: protects=a Node stop cancelled while a lazy value is being expanded: the pass ends with the cancellation instead of returning the fact as unavailable; fails_when=the lazy expansion swallows the cancellation and the pass returns partial facts for a run that was stopped; why_new=pt3 /ship review pass 2 (testing): the cancellation path of the lazy expansion had no test; seam=a fake debug session whose answer to the lazy reference never comes, and the run's abort controller, aborted by the test; no_claim=the native debugger's own cancellation
test('a Node pause cancelled while a lazy value is expanded ends with the cancellation', async () => {
  // Arrange
  const controller = new AbortController()
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 30) {
        controller.abort()
        return new Promise(() => {})
      }
      return Promise.resolve({
        variables:
          arguments_.variablesReference === 1
            ? [
                {
                  name: 'limit',
                  value: '(...)',
                  variablesReference: 30,
                  presentationHint: { lazy: true },
                },
              ]
            : [],
      })
    },
  }

  // Act
  const outcome = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'limit', mode: 'value', required: true }],
    sourceImportBindings(''),
    controller.signal,
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(outcome, 'Error: Cancelled owned Node debugger variables')
})

// Value: protects=JavaScript shadowing at a Node stop: a scope variable whose lazy value the debugger cannot read still shadows a same-named import, so the fact reads unavailable instead of taking the imported module's value; fails_when=an unreadable scope variable counts as absent and the walk falls through to the import, recording another module's value under the local name; why_new=pt3 /ship review pass 2 (Red Team); seam=a fake debug session with a refused lazy local and a module binding exporting the same name; no_claim=how often a local getter throws natively
test('a Node pause leaves a required local whose lazy value cannot be read unavailable instead of reading an import of the same name', async () => {
  // Arrange
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 30)
        throw new Error('Cannot access the getter before initialization')
      const table = new Map<number, DebugProtocol.Variable[]>([
        [
          1,
          [
            {
              name: 'status',
              value: '(...)',
              variablesReference: 30,
              presentationHint: { lazy: true },
            },
          ],
        ],
        [
          2,
          [
            {
              name: '__vite_ssr_import_0__',
              value: 'Module',
              variablesReference: 40,
            },
          ],
        ],
        [
          40,
          [
            {
              name: 'status',
              value: "'imported'",
              type: 'string',
              variablesReference: 0,
            },
          ],
        ],
      ])
      return { variables: table.get(arguments_.variablesReference) ?? [] }
    },
  }

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'status', mode: 'value', required: true }],
    sourceImportBindings("import { status } from './status'"),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:status'] },
  )
})

// Value: protects=the debugger's load at a Node stop: two module bindings that reach one shared reference, read together, ask the debugger for that reference once; fails_when=the pass caches only finished answers, so bindings read together send duplicate variables requests for the same reference; why_new=pt3 /ship review pass 2 (performance): the bindings became concurrent reads; seam=a fake debug session that counts the requests per reference; no_claim=the adapter's own request handling
test('a Node pause asks the debugger once for a reference two module bindings reach together', async () => {
  // Arrange
  const requests = new Map<number, number>()
  const table = new Map<number, DebugProtocol.Variable[]>([
    [1, []],
    [
      2,
      [
        {
          name: '__vi_import_0__',
          value: 'Proxy(Object)',
          variablesReference: 40,
        },
        {
          name: '__vi_import_1__',
          value: 'Proxy(Object)',
          variablesReference: 41,
        },
      ],
    ],
    [40, [{ name: '[[Target]]', value: 'Object', variablesReference: 60 }]],
    [41, [{ name: '[[Target]]', value: 'Object', variablesReference: 60 }]],
    [
      60,
      [{ name: 'shared', value: '1', type: 'number', variablesReference: 0 }],
    ],
  ])
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      const reference = arguments_.variablesReference
      requests.set(reference, (requests.get(reference) ?? 0) + 1)
      return { variables: table.get(reference) ?? [] }
    },
  }

  // Act
  await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'again', mode: 'value', required: false }],
    sourceImportBindings(
      "import { shared } from './a'\nimport { shared as again } from './b'",
    ),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.equal(requests.get(60), 1)
})

// Value: protects=a Node stop whose lazy local the debugger never answers: the pass fails with the timeout instead of reading the fact as unavailable and keeping a stop on a stalled session; fails_when=the lazy expansion swallows the timeout like the adapter's error answer, so a hung debugger reads as a missing fact and the agent is told to continue; why_new=pt3 /ship review pass 3 (testing, state machines): the timeout path of the expansion's rethrow had no test; seam=a fake debug session that never answers the lazy reference, and node:test's mocked setTimeout advanced by the active timeout; no_claim=how long the native adapter takes
test('a Node pause whose lazy local the debugger never answers fails with the timeout instead of reporting the fact unavailable', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let markExpansionRequested!: () => void
  const expansionRequested = new Promise<void>((resolve) => {
    markExpansionRequested = resolve
  })
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 30) {
        markExpansionRequested()
        return new Promise(() => {})
      }
      return Promise.resolve({
        variables:
          arguments_.variablesReference === 1
            ? [
                {
                  name: 'limit',
                  value: '(...)',
                  variablesReference: 30,
                  presentationHint: { lazy: true },
                },
              ]
            : [],
      })
    },
  }
  const outcome = inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'limit', mode: 'value', required: true }],
    sourceImportBindings(''),
    new AbortController().signal,
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )
  await expansionRequested

  // Act
  context.mock.timers.tick(ACTIVE_TIMEOUT_MS)

  // Assert
  assert.equal(
    await outcome,
    'Error: Timed out waiting for owned Node debugger variables',
  )
})

// Value: protects=a Node stop whose imported name sits behind a getter the debugger cannot expand (an unmocked module's export that throws in the test process): the fact reads unavailable and the stop keeps its other facts; fails_when=the import's lazy expansion lets the adapter's error answer escape, so the whole advance fails and the live run ends instead of the agent hearing which fact is missing; why_new=pt3 /ship review pass 3 (state machines): the refused expansion was tested for a local and a path step only; seam=a fake debug session that rejects the expansion of the module export's reference; no_claim=how the native adapter answers a throwing getter
test('a Node pause reports a required imported name whose getter the debugger cannot expand as unavailable and keeps its other facts', async () => {
  // Arrange
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 50)
        throw new Error('ITEMS_PER_PAGE is not initialized')
      const table = new Map<number, DebugProtocol.Variable[]>([
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
              name: '__vite_ssr_import_0__',
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
      ])
      return { variables: table.get(arguments_.variablesReference) ?? [] }
    },
  }

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [
      { path: 'ITEMS_PER_PAGE', mode: 'value', required: true },
      { path: 'status', mode: 'value', required: true },
    ],
    sourceImportBindings("import { ITEMS_PER_PAGE } from './data'"),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        { path: 'status', mode: 'value', display: "'paid'", type: 'string' },
      ],
      unavailable: ['value:ITEMS_PER_PAGE'],
    },
  )
})

// Value: protects=a Node stop whose imported name's getter the debugger never answers: the pass fails with the timeout instead of reading the fact as unavailable; fails_when=the import's lazy expansion swallows the timeout, so a hung debugger reads as a missing fact; why_new=pt3 /ship review pass 3 (state machines): the timeout cell of an imported name had no test; seam=a fake debug session that never answers the module export's lazy reference, and node:test's mocked setTimeout advanced by the active timeout; no_claim=how long the native adapter takes
test('a Node pause whose imported getter the debugger never answers fails with the timeout instead of reporting the fact unavailable', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let markExpansionRequested!: () => void
  const expansionRequested = new Promise<void>((resolve) => {
    markExpansionRequested = resolve
  })
  const table = new Map<number, DebugProtocol.Variable[]>([
    [1, []],
    [
      2,
      [
        {
          name: '__vite_ssr_import_0__',
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
  ])
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 50) {
        markExpansionRequested()
        return new Promise(() => {})
      }
      return Promise.resolve({
        variables: table.get(arguments_.variablesReference) ?? [],
      })
    },
  }
  const outcome = inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'ITEMS_PER_PAGE', mode: 'value', required: true }],
    sourceImportBindings("import { ITEMS_PER_PAGE } from './data'"),
    new AbortController().signal,
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )
  await expansionRequested

  // Act
  context.mock.timers.tick(ACTIVE_TIMEOUT_MS)

  // Assert
  assert.equal(
    await outcome,
    'Error: Timed out waiting for owned Node debugger variables',
  )
})

// Value: protects=a Node stop cancelled while an imported name's getter is being expanded: the pass ends with the cancellation instead of returning the fact as unavailable; fails_when=the import's lazy expansion swallows the cancellation and the pass returns partial facts for a run that was stopped; why_new=pt3 /ship review pass 3 (state machines): the cancellation cell of an imported name had no test; seam=a fake debug session whose answer to the module export's lazy reference never comes, and the run's abort controller, aborted by the test; no_claim=the native debugger's own cancellation
test('a Node pause cancelled while an imported getter is expanded ends with the cancellation', async () => {
  // Arrange
  const controller = new AbortController()
  const table = new Map<number, DebugProtocol.Variable[]>([
    [1, []],
    [
      2,
      [
        {
          name: '__vite_ssr_import_0__',
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
  ])
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 50) {
        controller.abort()
        return new Promise(() => {})
      }
      return Promise.resolve({
        variables: table.get(arguments_.variablesReference) ?? [],
      })
    },
  }

  // Act
  const outcome = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'ITEMS_PER_PAGE', mode: 'value', required: true }],
    sourceImportBindings("import { ITEMS_PER_PAGE } from './data'"),
    controller.signal,
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(outcome, 'Error: Cancelled owned Node debugger variables')
})

// Value: protects=a Node stop whose imported name's getter gets a malformed answer from the debugger: the pass fails, rather than reading the fact as merely unavailable and keeping a stop on a broken session; fails_when=the import's lazy expansion swallows the malformed answer, so a broken debugger reads as a missing fact and the agent is told to continue; why_new=pt3 /ship review pass 3 (state machines): the malformed-answer cell of an imported name had no test; seam=a fake debug session that answers the module export's lazy reference without a variable list; no_claim=which native adapters answer that way
test('a Node pause whose imported getter gets a malformed debugger answer fails instead of reporting the fact unavailable', async () => {
  // Arrange
  const table = new Map<number, DebugProtocol.Variable[]>([
    [1, []],
    [
      2,
      [
        {
          name: '__vite_ssr_import_0__',
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
  ])
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) =>
      arguments_.variablesReference === 50
        ? {}
        : { variables: table.get(arguments_.variablesReference) ?? [] },
  }

  // Act
  const outcome = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'ITEMS_PER_PAGE', mode: 'value', required: true }],
    sourceImportBindings("import { ITEMS_PER_PAGE } from './data'"),
    AbortSignal.timeout(1_000),
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(outcome, 'Error: Native debugger supplied no variable list.')
})

// Value: protects=a lazy value whose expansion the debugger refused once is asked again by a later fact of the same stop, so a refusal that does not repeat (a getter that threw only the first time) leaves only the first fact unavailable; fails_when=the pass keeps the failed request, so every later fact through that reference reads unavailable without asking the debugger; why_new=pt3 /ship review pass 3 (testing): the eviction of a failed request from the pass's request cache had no test; seam=a fake debug session that refuses the lazy reference's first expansion and answers its second, counting the requests; no_claim=whether a native getter's failure repeats
test('a Node pause asks again for a lazy value whose earlier expansion the debugger refused', async () => {
  // Arrange
  let expansions = 0
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      if (arguments_.variablesReference === 30) {
        expansions += 1
        if (expansions === 1)
          throw new Error('Cannot access the getter before initialization')
        return {
          variables: [
            {
              name: 'limit',
              value: '6',
              type: 'number',
              variablesReference: 0,
            },
          ],
        }
      }
      return {
        variables:
          arguments_.variablesReference === 1
            ? [
                {
                  name: 'limit',
                  value: '(...)',
                  variablesReference: 30,
                  presentationHint: { lazy: true },
                },
              ]
            : [],
      }
    },
  }

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [
      { path: 'limit', mode: 'value', required: true },
      { path: 'limit', mode: 'type', required: true },
    ],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    {
      facts: result.facts,
      unavailable: result.unavailable,
      expansions,
    },
    {
      facts: [
        { path: 'limit', mode: 'type', display: 'number', type: 'number' },
      ],
      unavailable: ['value:limit'],
      expansions: 2,
    },
  )
})

// Value: protects=the debugger after a failed Node stop: once one module binding's read fails the pass, the other bindings read together with it ask the debugger nothing more; fails_when=the other bindings' reads go on after the pass has failed, sending variables requests (a Proxy's [[Target]]) to a session whose stop the run is ending; why_new=pt3 /ship review pass 3 (Red Team): Promise.all rejects on the first failure while its siblings keep reading; seam=a fake debug session that answers one binding malformed and holds the other's answer until the pass has failed, recording every requested reference; no_claim=what the native adapter does with a request it gets late
test('a Node pause whose module binding read fails sends the debugger no further request for the other bindings', async () => {
  // Arrange
  const requested: number[] = []
  let releaseHeldBinding!: () => void
  const heldBinding = new Promise<void>((resolve) => {
    releaseHeldBinding = resolve
  })
  const table = new Map<number, DebugProtocol.Variable[]>([
    [1, []],
    [
      2,
      [
        {
          name: '__vi_import_0__',
          value: 'Proxy(Object)',
          variablesReference: 40,
        },
        {
          name: '__vi_import_1__',
          value: 'Proxy(Object)',
          variablesReference: 41,
        },
      ],
    ],
    [41, [{ name: '[[Target]]', value: 'Object', variablesReference: 60 }]],
    [60, [{ name: 'db', value: 'Object', variablesReference: 0 }]],
  ])
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      const reference = arguments_.variablesReference
      requested.push(reference)
      if (reference === 40) return {}
      if (reference === 41) await heldBinding
      return { variables: table.get(reference) ?? [] }
    },
  }
  const outcome = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'db', mode: 'value', required: true }],
    sourceImportBindings("import { a } from './a'\nimport { db } from '@/db'"),
    AbortSignal.timeout(1_000),
  ).then(
    () => 'read',
    (error: unknown) => String(error),
  )

  // Act: the held binding's answer arrives after the pass failed.
  releaseHeldBinding()
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.deepEqual(
    { outcome, requested },
    {
      outcome: 'Error: Native debugger supplied no variable list.',
      requested: [1, 2, 40, 41],
    },
  )
})

// Value: protects=the diagnosis of a Node stop whose scope read the debug adapter refuses: the pass fails with the adapter's own error kept as the cause, under the same message as before; fails_when=the refusal is re-wrapped without its cause, so a log or a debugger of the extension loses the adapter's error and its stack; why_new=pt3 /ship review pass 3 (maintainability): the wrapper kept the adapter's error only as text; seam=a fake debug session that rejects the Local scope's read; no_claim=how the run words the failure (StudyService sanitizes it)
test('a Node pause whose scope read the debugger refuses fails with the adapter error as its cause', async () => {
  // Arrange
  const adapterError = new Error('Unable to find thread for evaluation')
  const session: Pick<vscode.DebugSession, 'customRequest'> = {
    customRequest: async () => {
      throw adapterError
    },
  }

  // Act
  const failure = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'status', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(failure instanceof Error)
  assert.deepEqual(
    {
      message: failure.message,
      causeIsAdapterError: failure.cause === adapterError,
    },
    {
      message:
        'Native debugger refused the variables request: Error: Unable to find thread for evaluation',
      causeIsAdapterError: true,
    },
  )
})

// Value: protects=an aliased import at a Node stop reads the module export the alias stands for, not another module's export named like the alias; fails_when=the export is matched by the local name, so `import { actual as count } from './a'` records b's `count` (99) instead of a's `actual` (7) as the fact, with nothing unavailable (Cycle 0052 task 70); why_new=pt3 /ship Step 11 (Claude adversarial, Codex adversarial and structured review), Codex's repro; seam=a fake debug session with two module bindings, and the stopped source's import declarations; no_claim=Vite's binding order
test('a Node pause reads an aliased import as the export the alias stands for, not another module export of the alias name', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_0__',
            value: 'Module',
            variablesReference: 40,
          },
          {
            name: '__vite_ssr_import_1__',
            value: 'Module',
            variablesReference: 41,
          },
        ],
      ],
      [
        40,
        [{ name: 'actual', value: '7', type: 'number', variablesReference: 0 }],
      ],
      [
        41,
        [
          { name: 'helper', value: 'ƒ helper()', variablesReference: 0 },
          { name: 'count', value: '99', type: 'number', variablesReference: 0 },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [{ path: 'count', mode: 'value', required: true }],
    sourceImportBindings(
      "import { actual as count } from './a'\nimport { helper } from './b'",
    ),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [{ path: 'count', mode: 'value', display: '7', type: 'number' }],
      unavailable: [],
    },
  )
})

// Value: protects=a name the stopped source does not import, or imports as a namespace, is never read from whichever module binding happens to export that name: the fact reads unavailable; fails_when=any module binding's export of the name answers for it, recording a module's value under a name the source does not bind to it (Cycle 0052 task 70); why_new=pt3 /ship Step 11 (Claude adversarial, Codex adversarial): the lookup did not ask the source; seam=a fake debug session whose module binding exports both names, and the stopped source's import declarations; no_claim=names bound by `require`
test('a Node pause leaves a name the source does not import, or imports as a namespace, unavailable even when a module exports it', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vite_ssr_import_0__',
            value: 'Module',
            variablesReference: 40,
          },
        ],
      ],
      [
        40,
        [
          { name: 'count', value: '99', type: 'number', variablesReference: 0 },
          { name: 'schema', value: 'Object', variablesReference: 0 },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [
      { path: 'count', mode: 'value', required: true },
      { path: 'schema', mode: 'value', required: true },
    ],
    sourceImportBindings("import * as schema from './schema'"),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:count', 'value:schema'] },
  )
})

// Value: protects=a default import at a Node stop is read as its module's default export; fails_when=the default import's local name is looked up as an export, so `import db from '@/db'` reads unavailable, or another module's `db` export answers for it (Cycle 0052 task 70); why_new=pt3 /ship Step 11 (Claude adversarial: default imports never resolved); seam=a fake debug session whose module binding exports `default` and whose other binding exports `db`; no_claim=CommonJS interop shapes
test('a Node pause reads a default import as its module default export', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, []],
      [
        2,
        [
          {
            name: '__vi_import_0__',
            value: 'Proxy(Object)',
            variablesReference: 40,
          },
          {
            name: '__vite_ssr_import_1__',
            value: 'Module',
            variablesReference: 41,
          },
        ],
      ],
      [40, [{ name: '[[Target]]', value: 'Object', variablesReference: 50 }]],
      [50, [{ name: 'default', value: 'Object', variablesReference: 51 }]],
      [
        51,
        [
          {
            name: 'inserted',
            value: '1',
            type: 'number',
            variablesReference: 0,
          },
        ],
      ],
      [41, [{ name: 'db', value: 'Object', variablesReference: 60 }]],
      [
        60,
        [
          {
            name: 'inserted',
            value: '5',
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
    [{ path: 'db.inserted', mode: 'value', required: true }],
    sourceImportBindings(
      "import db from '@/db'\nimport { users } from '@/db/schema'",
    ),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(result.facts, [
    { path: 'db.inserted', mode: 'value', display: '1', type: 'number' },
  ])
})

// Value: protects=a lazy value whose expansion the debugger answers with no single value: the fact reads unavailable instead of saving the "(...)" placeholder as the value; fails_when=the unresolved lazy variable is returned as it is, so its "(...)" passes as a read required fact and lands in the immutable history with nothing unavailable (Cycle 0052 task 71); why_new=pt3 /ship Step 11 (Codex adversarial), Codex's repro with an empty answer; seam=a fake debug session that answers the lazy references with no variables and with two; no_claim=which adapters answer that way
test('a Node pause reports a lazy value the debugger expands to no single value as unavailable instead of saving its placeholder', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [
        1,
        [
          {
            name: 'count',
            value: '(...)',
            variablesReference: 30,
            presentationHint: { lazy: true },
          },
          {
            name: 'total',
            value: '(...)',
            variablesReference: 31,
            presentationHint: { lazy: true },
          },
        ],
      ],
      [30, []],
      [
        31,
        [
          { name: 'total', value: '1', variablesReference: 0 },
          { name: 'total', value: '2', variablesReference: 0 },
        ],
      ],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    VITEST_SCOPES,
    [
      { path: 'count', mode: 'value', required: true },
      { path: 'total', mode: 'value', required: true },
    ],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:count', 'value:total'] },
  )
})

const PROXY_STATE_SCOPES = [
  { name: 'Local', variablesReference: 1, expensive: false },
]

/**
 * Builds the children js-debug lists for a Proxy variable.
 * @param target - The variablesReference of the Proxy's `[[Target]]`.
 * @returns `[[Handler]]`, `[[Target]]` and `[[IsRevoked]]` as the adapter names them.
 * @example proxyChildren(41)
 */
function proxyChildren(target: number): DebugProtocol.Variable[] {
  return [
    { name: '[[Handler]]', value: 'Object', variablesReference: 90 },
    { name: '[[Target]]', value: 'Object', variablesReference: target },
    { name: '[[IsRevoked]]', value: 'false', variablesReference: 0 },
  ]
}

// Value: protects=a required value that only a Proxy's [[Target]] holds is recorded under the path naming that hop and the declared path stays unavailable, because the Proxy's get trap may return another value than the target holds; fails_when=the walk records the target's value as the declared state.status (the trap could answer 'error' while the target holds 'idle') or leaves the target's value out of the facts (Cycle 0067 /ship pass 1, Codex P1); why_new=F6 recorded the target's value as the declared path's fact; seam=none; no_claim=the native adapter's own naming of [[Target]] (native trial)
test('a Node pause records a value only a Proxy target holds under the hop path and names the declared path unavailable', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'state', value: 'Proxy(Object)', variablesReference: 4 }]],
      [4, proxyChildren(41)],
      [
        41,
        [
          {
            name: 'status',
            value: "'idle'",
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
    PROXY_STATE_SCOPES,
    [{ path: 'state.status', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    {
      facts: result.facts,
      variables: result.variables.map(({ name, value }) => ({ name, value })),
      unavailable: result.unavailable,
    },
    {
      facts: [
        {
          path: 'state.[[Target]].status',
          mode: 'value',
          display: "'idle'",
          type: 'string',
        },
      ],
      variables: [{ name: 'status', value: "'idle'" }],
      unavailable: ['value:state.status'],
    },
  )
})

// Value: protects=a nested path through a Proxy records every hop in the fact's path, whether the nested object is plain or itself a Proxy, and names each declared path unavailable; fails_when=a hop is left out of the recorded path, or a nested Proxy's own [[Target]] is ignored so the value is lost; why_new=the F6 required inspection value:state.error.message under the hop-path contract; seam=none; no_claim=Proxy traps beyond what expanding the variable runs
test('a Node pause records a nested value through a Proxy and a nested Proxy with every hop named in the path', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [
        1,
        [
          { name: 'state', value: 'Proxy(Object)', variablesReference: 4 },
          { name: 'draft', value: 'Proxy(Object)', variablesReference: 5 },
        ],
      ],
      [4, proxyChildren(41)],
      [41, [{ name: 'error', value: 'Error', variablesReference: 42 }]],
      [
        42,
        [
          {
            name: 'message',
            value: "'boom'",
            type: 'string',
            variablesReference: 0,
          },
        ],
      ],
      [5, proxyChildren(51)],
      [51, [{ name: 'user', value: 'Proxy(Object)', variablesReference: 6 }]],
      [6, proxyChildren(61)],
      [
        61,
        [
          {
            name: 'name',
            value: "'Ada'",
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
    PROXY_STATE_SCOPES,
    [
      { path: 'state.error.message', mode: 'value', required: true },
      { path: 'draft.user.name', mode: 'value', required: true },
    ],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        {
          path: 'state.[[Target]].error.message',
          mode: 'value',
          display: "'boom'",
          type: 'string',
        },
        {
          path: 'draft.[[Target]].user.[[Target]].name',
          mode: 'value',
          display: "'Ada'",
          type: 'string',
        },
      ],
      unavailable: ['value:state.error.message', 'value:draft.user.name'],
    },
  )
})

// Value: protects=a Proxy whose target lacks the asked segment still reports the required fact unavailable, so the fallback never invents a value; fails_when=the fallback returns the [[Target]] variable itself or another child for a missing segment; why_new=truthfulness bound of the F6 Proxy fallback; seam=none; no_claim=none
test('a Node pause reports a required value unavailable when the Proxy target lacks the segment', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'state', value: 'Proxy(Object)', variablesReference: 4 }]],
      [4, proxyChildren(41)],
      [41, [{ name: 'fetchStatus', value: "'idle'", variablesReference: 0 }]],
    ]),
  )

  // Act
  const result = await inspectNodeTestVariables(
    session,
    PROXY_STATE_SCOPES,
    [{ path: 'state.status', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:state.status'] },
  )
})

// Value: protects=a doubly wrapped Proxy is read through every [[Target]] level up to the depth limit and recorded under the path naming each hop; fails_when=only one [[Target]] level is tried, so the value of new Proxy(new Proxy({ status: 'ready' }, {}), {}) is lost; why_new=Codex adversarial Medium on the one-level walk; seam=none; no_claim=the native adapter's own naming of [[Target]] (native trial)
test('a Node pause reads a value under a doubly wrapped Proxy and names both hops', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'state', value: 'Proxy(Object)', variablesReference: 4 }]],
      [4, proxyChildren(41)],
      [41, proxyChildren(42)],
      [
        42,
        [
          {
            name: 'status',
            value: "'ready'",
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
    PROXY_STATE_SCOPES,
    [{ path: 'state.status', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        {
          path: 'state.[[Target]].[[Target]].status',
          mode: 'value',
          display: "'ready'",
          type: 'string',
        },
      ],
      unavailable: ['value:state.status'],
    },
  )
})

// Value: protects=a Proxy chain deeper than the depth limit leaves the value unread, so the walk never follows an unbounded chain; fails_when=the walk follows four [[Target]] levels or more; why_new=DEBUGGER_PROXY_TARGET_MAX_DEPTH bound of the hop contract; seam=none; no_claim=none
test('a Node pause leaves a value unread when it sits under more Proxy levels than the depth limit', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'state', value: 'Proxy(Object)', variablesReference: 4 }]],
      [4, proxyChildren(41)],
      [41, proxyChildren(42)],
      [42, proxyChildren(43)],
      [43, proxyChildren(44)],
      [
        44,
        [
          {
            name: 'status',
            value: "'ready'",
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
    PROXY_STATE_SCOPES,
    [{ path: 'state.status', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    { facts: [], unavailable: ['value:state.status'] },
  )
})

// Value: protects=an optional inspection that only a Proxy's target holds records the hop fact and adds nothing to the unavailable list; fails_when=the optional path is recorded as the declared path, or reported unavailable; why_new=requirement 2 of the hop contract; seam=none; no_claim=none
test('a Node pause records an optional value under the hop path without naming the declared path unavailable', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'state', value: 'Proxy(Object)', variablesReference: 4 }]],
      [4, proxyChildren(41)],
      [
        41,
        [
          {
            name: 'status',
            value: "'idle'",
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
    PROXY_STATE_SCOPES,
    [{ path: 'state.status', mode: 'value', required: false }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    { facts: result.facts, unavailable: result.unavailable },
    {
      facts: [
        {
          path: 'state.[[Target]].status',
          mode: 'value',
          display: "'idle'",
          type: 'string',
        },
      ],
      unavailable: [],
    },
  )
})

// Value: protects=a secret-named step under a Proxy's target still reads [masked] in the fact and in the kept variable; fails_when=redaction looks at the declared path only or skips hop facts, so account.password's backing value reaches the chat; why_new=the hop path must stay under the redaction contract; seam=none; no_claim=none
test('a Node pause masks a secret-named value read under a Proxy target', async () => {
  // Arrange
  const session = sessionAnswering(
    new Map<number, DebugProtocol.Variable[]>([
      [1, [{ name: 'account', value: 'Proxy(Object)', variablesReference: 4 }]],
      [4, proxyChildren(41)],
      [
        41,
        [
          {
            name: 'password',
            value: "'hunter2'",
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
    PROXY_STATE_SCOPES,
    [{ path: 'account.password', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.deepEqual(
    {
      facts: result.facts.map(({ path, display }) => ({ path, display })),
      variables: result.variables.map(({ value }) => value),
    },
    {
      facts: [{ path: 'account.[[Target]].password', display: '[masked]' }],
      variables: ['[masked]'],
    },
  )
})
