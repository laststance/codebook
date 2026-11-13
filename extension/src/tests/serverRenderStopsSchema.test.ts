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

/** Supplies an additional browser stop at the entry load. @example browserEntryStop().afterOperation // 0 */
function browserEntryStop(): Record<string, unknown> {
  return {
    participant: 'browser',
    source: { path: 'app/ui/a.tsx', hash: 'b'.repeat(64), line: 3, column: 1 },
    anchorIndex: 0,
    inspections: [{ path: 'a', mode: 'value', required: true }],
    afterOperation: 0,
  }
}

// protects=a Next run can pause client code that runs while the entry page loads; fails_when=a browser stop at afterOperation 0 under next-dev-webpack is refused (the #325 E2 refusal); no_claim=the run pauses there (run tests)
test('afterOperation 0 on a browser stop is accepted under next-dev-webpack', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.participant = 'browser'
  })
  // Assert
  assert.deepEqual(issues, [])
})

// protects=an additional browser stop after the server stop may also pause the entry load; fails_when=an additionalStops browser stop at 0 is refused under next-dev-webpack; no_claim=none beyond protects
test('afterOperation 0 on an additional browser stop after a server stop is accepted under next-dev-webpack', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.additionalStops = [browserEntryStop()]
  })
  // Assert
  assert.deepEqual(issues, [])
})

// protects=only next-dev-webpack pauses browser code at the entry load, other adapters keep a refusal naming the adapter; fails_when=vite-dev accepts a browser stop at 0 or the refusal omits the adapter or the field; no_claim=none beyond protects
test('afterOperation 0 on a browser stop under another adapter is refused and names the adapter and the field', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.adapter = 'vite-dev'
    configuration.participant = 'browser'
    configuration.operations = [clickOperation]
  })
  // Assert
  assert.deepEqual(issues, [
    'afterOperation: afterOperation 0 (the entry load) is declared at configuration.afterOperation on a browser stop under adapter "vite-dev", but only adapter "next-dev-webpack" supports a browser stop at the entry load; declare afterOperation 1 or more for a browser stop.',
  ])
})

// protects=the server response precedes the client code it renders, so a server stop cannot follow a browser stop at 0; fails_when=a server stop declared after a browser stop at 0 is accepted or the refusal omits the field; no_claim=none beyond protects
test('a server stop at afterOperation 0 after a browser stop at 0 is refused and names the field', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.participant = 'browser'
    configuration.additionalStops = [
      { ...browserEntryStop(), participant: 'server' },
    ]
  })
  // Assert
  assert.deepEqual(issues, [
    'additionalStops.0.afterOperation: afterOperation 0 at configuration.additionalStops.0.afterOperation is a server stop declared after a browser stop at afterOperation 0; declare every server stop of the entry load before its browser stops: the server response precedes the client code it renders.',
  ])
})

// protects=a browser stop at the entry load still has no request to record against; fails_when=hold "record" on a browser stop at 0 is accepted or loses its field name; no_claim=none beyond protects
test('hold record on a browser stop at afterOperation 0 is refused and names the field', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.participant = 'browser'
    configuration.hold = 'record'
  })
  // Assert
  assert.equal(issues.length, 1)
  assert.match(
    issues[0]!,
    /^hold: hold "record" is declared at configuration\.hold/,
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

// protects=the refusal for a browser stop with omitted operations does not offer afterOperation 0, which a browser stop cannot use; fails_when=the advice for a browser stop still says to use afterOperation 0 on every server stop; no_claim=none beyond protects
test('omitted operations with a browser stop after operation 1 advises declaring the operations only', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.participant = 'browser'
    configuration.afterOperation = 1
  })
  // Assert
  assert.deepEqual(issues, [
    'afterOperation: afterOperation 1 is declared at configuration.afterOperation, but operations is omitted; declare the operations.',
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
