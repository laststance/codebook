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

/** Parses a version 3 configuration with one change and returns the parsed `data`, failing the test when it is refused. @example parsedOf((c) => { c.hold = 'record' }).hold // 'record' */
function parsedOf(change: (configuration: Record<string, unknown>) => void) {
  const input = versionThree()
  change(input)
  const result = operationsRepositoryConfigSchema.safeParse(input)
  assert.equal(result.success, true)
  return result.data as unknown as Record<string, unknown> & {
    additionalStops: Record<string, unknown>[]
  }
}

// Value: protects=the parsed configuration keeps hold on the top-level stop and on additionalStops[0], and an omitted hold stays absent from the parsed output; fails_when=the parser drops or defaults hold, so a recorded stop runs held or a held stop gains a field; no_claim=the run's behavior
test('the parsed version 3 configuration keeps hold where it was declared and adds none where it was omitted', () => {
  // Arrange, Act
  const declared = parsedOf((configuration) => {
    configuration.hold = 'record'
    additionalStop(configuration).hold = 'explain'
  })
  const omitted = parsedOf(() => {})
  // Assert
  assert.equal(declared.hold, 'record')
  assert.equal(declared.additionalStops[0]!.hold, 'explain')
  assert.equal('hold' in omitted, false)
  assert.equal('hold' in omitted.additionalStops[0]!, false)
})

// Value: protects=hold "explain" is accepted on a stop with afterOperation 0 (an entry-render stop is held anyway), top-level and additional; fails_when=explain is refused together with record on an entry-render stop; no_claim=the run's behavior
test('hold explain is accepted on an afterOperation 0 stop', () => {
  // Arrange, Act
  const topLevel = issuesOf((configuration) => {
    configuration.participant = 'server'
    configuration.afterOperation = 0
    configuration.hold = 'explain'
  })
  const additional = issuesOf((configuration) => {
    configuration.participant = 'server'
    configuration.afterOperation = 0
    additionalStop(configuration).afterOperation = 0
    additionalStop(configuration).hold = 'explain'
  })
  // Assert
  assert.deepEqual([topLevel, additional], [[], []])
})

// Value: protects=a browser stop with afterOperation 0 and hold "record" reports its hold issue at the hold field (and no afterOperation issue under next-dev-webpack), top-level and additional; fails_when=the hold issue is missing for a browser stop, or names another path; no_claim=the run's behavior
test('hold record on a browser stop with afterOperation 0 reports the hold issue at the hold field', () => {
  // Arrange, Act
  const topLevel = issuesOf((configuration) => {
    configuration.afterOperation = 0
    configuration.hold = 'record'
    additionalStop(configuration).afterOperation = 1
  })
  const additional = issuesOf((configuration) => {
    // The first stop is a server entry stop, so the stops stay in order and only the browser stop is refused.
    configuration.participant = 'server'
    configuration.afterOperation = 0
    additionalStop(configuration).participant = 'browser'
    additionalStop(configuration).afterOperation = 0
    additionalStop(configuration).hold = 'record'
  })
  // Assert
  // A browser stop at the entry load is accepted under next-dev-webpack, so only the hold is refused, at its own path.
  assert.deepEqual(topLevel.map((issue) => issue.split(': ')[0]).sort(), [
    'hold',
  ])
  assert.deepEqual(additional.map((issue) => issue.split(': ')[0]).sort(), [
    'additionalStops.0.hold',
  ])
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
