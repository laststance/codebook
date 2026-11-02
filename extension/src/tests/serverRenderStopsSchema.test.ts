import assert from 'node:assert/strict'
import { test } from 'node:test'

import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'

/** Supplies an entry-render configuration: one server stop `afterOperation: 0` and no `operations`. @example entryRenderConfiguration().operations // undefined */
function entryRenderConfiguration(): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'next-dev-webpack',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'dashboard-cards',
      anchorIndex: 0,
    },
    source: {
      path: 'app/lib/data.ts',
      hash: 'a'.repeat(64),
      line: 91,
      column: 3,
    },
    participant: 'server',
    afterOperation: 0,
    entryPath: '/dashboard',
    before: [{ kind: 'visible', selector: 'main' }],
    after: [{ kind: 'visible', selector: 'main' }],
    inspections: [{ path: 'data', mode: 'value', required: true }],
  }
}

/** Parses an entry-render configuration with one change and lists every issue as `path: message`. @example issuesOf((c) => { c.operations = [] }) */
function issuesOf(change: (configuration: Record<string, unknown>) => void) {
  const input = entryRenderConfiguration()
  change(input)
  const result = operationsRepositoryConfigSchema.safeParse(input)
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      )
}

const clickOperation = { kind: 'click', title: 'Open', selector: '#open' }

// protects=a run that explains only the entry render declares no operation at all; fails_when=the schema demands an operation for a run whose stops are all afterOperation 0; no_claim=the run pauses the render (run tests)
test('a version 3 configuration with only entry-render server stops may omit operations', () => {
  // Arrange, Act
  const issues = issuesOf(() => {})
  // Assert
  assert.deepEqual(issues, [])
})

// protects=a run with operations may declare every server stop afterOperation 0 (explain the render, then drive the flow to its result); fails_when=operations next to afterOperation 0 is refused; no_claim=none beyond protects
test('a version 3 configuration with operations accepts entry-render server stops', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.operations = [clickOperation]
  })
  // Assert
  assert.deepEqual(issues, [])
})

// protects=afterOperation 0 is a server-only pause of the entry render; fails_when=a browser stop declared afterOperation 0 is accepted or the refusal does not name the field; no_claim=none beyond protects
test('afterOperation 0 on a browser stop is refused and names the field', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.participant = 'browser'
    configuration.operations = [clickOperation]
  })
  // Assert
  assert.deepEqual(issues, [
    'afterOperation: afterOperation 0 (the entry render) is declared at configuration.afterOperation, but only a server stop can pause the entry render; declare afterOperation 1 or more for a browser stop.',
  ])
})

// protects=an additional browser stop cannot pause the entry render either; fails_when=afterOperation 0 on an additional browser stop is accepted; no_claim=none beyond protects
test('afterOperation 0 on an additional browser stop is refused and names its index', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.additionalStops = [
      {
        participant: 'browser',
        source: {
          path: 'app/ui/a.tsx',
          hash: 'b'.repeat(64),
          line: 3,
          column: 1,
        },
        anchorIndex: 0,
        inspections: [{ path: 'a', mode: 'value', required: true }],
        afterOperation: 0,
      },
    ]
  })
  // Assert
  assert.equal(issues.length, 1)
  assert.match(
    issues[0]!,
    /^additionalStops\.0\.afterOperation: .*configuration\.additionalStops\.0\.afterOperation/,
  )
})

// protects=an empty operations list is not a second spelling of "no operation"; fails_when=operations: [] is accepted or its refusal does not name the field; no_claim=none beyond protects
test('an empty operations list is refused and names the field', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.operations = []
  })
  // Assert
  assert.deepEqual(issues, [
    'operations: configuration.operations is empty: omit the field for a run with no operation, or declare 1 to 8 operations.',
  ])
})

// protects=a stop that waits for an operation cannot be declared without operations; fails_when=omitted operations with afterOperation 1 is accepted; no_claim=none beyond protects
test('omitted operations with a stop after operation 1 is refused and names the field', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.afterOperation = 1
  })
  // Assert
  assert.deepEqual(issues, [
    'afterOperation: afterOperation 1 is declared at configuration.afterOperation, but operations is omitted; declare the operations, or use afterOperation 0 on every server stop.',
  ])
})

// protects=one later stop with afterOperation 1 keeps operations required even when the first stop is an entry-render stop; fails_when=omitted operations is accepted for a mixed set; no_claim=none beyond protects
test('omitted operations with a mixed set of stops names the stop that needs an operation', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.additionalStops = [
      {
        participant: 'server',
        source: {
          path: 'app/lib/data.ts',
          hash: 'a'.repeat(64),
          line: 120,
          column: 3,
        },
        anchorIndex: 0,
        inspections: [{ path: 'data', mode: 'value', required: true }],
        afterOperation: 1,
      },
    ]
  })
  // Assert
  assert.equal(issues.length, 1)
  assert.match(
    issues[0]!,
    /^additionalStops\.0\.afterOperation: afterOperation 1 is declared at configuration\.additionalStops\.0\.afterOperation, but operations is omitted/,
  )
})
