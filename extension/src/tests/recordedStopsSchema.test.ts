import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  crossRuntimeRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
  repositoryConfigSchema,
} from '../repositoryConfigSchemas'

const BOOK = {
  bookId: 'interface',
  revision: 1,
  nodeId: 'dashboard-cards',
  anchorIndex: 0,
}
const SOURCE = {
  path: 'app/lib/data.ts',
  hash: 'a'.repeat(64),
  line: 91,
  column: 3,
}
const INSPECTIONS = [{ path: 'data', mode: 'value', required: true }]
const CONDITIONS = [{ kind: 'visible', selector: 'main' }]

/** Supplies a version 3 configuration with one browser stop after operation 1 and one additional server stop after operation 1. @example versionThree().afterOperation // 1 */
function versionThree(): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'next-dev-webpack',
    book: BOOK,
    source: SOURCE,
    participant: 'browser',
    afterOperation: 1,
    before: CONDITIONS,
    after: CONDITIONS,
    operations: [{ kind: 'click', title: 'Open', selector: '#open' }],
    inspections: INSPECTIONS,
    additionalStops: [
      {
        participant: 'server',
        source: { ...SOURCE, line: 92 },
        anchorIndex: 0,
        inspections: INSPECTIONS,
        afterOperation: 1,
      },
    ],
  }
}

/** Parses a version 3 configuration with one change and lists every issue as `path: message`. @example issuesOf((c) => { c.hold = 'record' }) // [] */
function issuesOf(change: (configuration: Record<string, unknown>) => void) {
  const input = versionThree()
  change(input)
  const result = operationsRepositoryConfigSchema.safeParse(input)
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      )
}

/** Returns the `additionalStops[0]` object of a configuration under change. @example additionalStop(configuration).hold = 'record' */
function additionalStop(
  configuration: Record<string, unknown>,
): Record<string, unknown> {
  return (configuration.additionalStops as Record<string, unknown>[])[0]!
}

// Value: protects=a version 3 configuration accepts hold "record" and "explain" on the top-level stop and on an additionalStops entry; fails_when=either value or either place is refused; no_claim=the run's behavior (recordedStops.test.ts)
test('a version 3 configuration accepts hold record and explain on the top-level stop and on an additional stop', () => {
  // Arrange, Act
  const recordedFirst = issuesOf((configuration) => {
    configuration.hold = 'record'
    additionalStop(configuration).hold = 'explain'
  })
  const explainedFirst = issuesOf((configuration) => {
    configuration.hold = 'explain'
    additionalStop(configuration).hold = 'record'
  })
  // Assert
  assert.deepEqual([recordedFirst, explainedFirst], [[], []])
})

// Value: protects=hold takes only explain or record, and record is refused on a stop with afterOperation 0 with the hold field's path (top-level and additional); fails_when=another value is accepted, or an entry-load stop may be recorded, or the refusal does not name the field; no_claim=none beyond protects
test('hold refuses other values and record on an afterOperation 0 stop, naming the hold field', () => {
  // Arrange, Act
  const otherValue = issuesOf((configuration) => {
    configuration.hold = 'pause'
  })
  const topLevelEntryLoad = issuesOf((configuration) => {
    configuration.participant = 'server'
    configuration.afterOperation = 0
    configuration.hold = 'record'
    additionalStop(configuration).afterOperation = 1
  })
  const additionalEntryLoad = issuesOf((configuration) => {
    configuration.participant = 'server'
    configuration.afterOperation = 0
    additionalStop(configuration).afterOperation = 0
    additionalStop(configuration).hold = 'record'
  })
  // Assert
  assert.equal(otherValue.length, 1)
  assert.match(otherValue[0]!, /^hold: /)
  assert.deepEqual(topLevelEntryLoad, [
    'hold: hold "record" is declared at configuration.hold, but its stop has afterOperation 0 (the entry render); a recorded stop needs an operation whose request the page waits on: declare afterOperation 1 or more, or omit hold.',
  ])
  assert.deepEqual(additionalEntryLoad, [
    'additionalStops.0.hold: hold "record" is declared at configuration.additionalStops.0.hold, but its stop has afterOperation 0 (the entry render); a recorded stop needs an operation whose request the page waits on: declare afterOperation 1 or more, or omit hold.',
  ])
})

// Value: protects=versions 1 and 2 keep their strict schema, so hold is refused there as an unknown field; fails_when=hold is accepted in a version 1 or 2 configuration; no_claim=none beyond protects
test('hold in a version 1 or version 2 configuration is refused as an unknown field', () => {
  // Arrange
  const versionOne = {
    version: 1,
    adapter: 'next-dev-webpack',
    book: BOOK,
    source: SOURCE,
    action: {
      title: 'Open',
      selector: '#open',
      before: CONDITIONS,
      after: CONDITIONS,
    },
    inspections: INSPECTIONS,
    hold: 'record',
  }
  const versionTwo = {
    ...versionOne,
    version: 2,
    participant: 'browser',
  }
  // Act
  const one = repositoryConfigSchema.safeParse(versionOne)
  const two = crossRuntimeRepositoryConfigSchema.safeParse(versionTwo)
  // Assert
  assert.equal(one.success, false)
  assert.equal(two.success, false)
  assert.match(one.error?.issues[0]?.message ?? '', /Unrecognized key.*"hold"/)
  assert.match(two.error?.issues[0]?.message ?? '', /Unrecognized key.*"hold"/)
})
