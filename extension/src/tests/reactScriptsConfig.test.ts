import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONFIGURED_PROFILE } from '../configuredProfile'
import {
  OPERATIONS_REPOSITORY_BROWSER_ADAPTERS,
  REPOSITORY_BROWSER_ADAPTERS,
} from '../constants'
import {
  crossRuntimeRepositoryConfigSchema,
  liveRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
  repositoryConfigSchema,
} from '../repositoryConfigSchemas'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

/** A valid version 3 react-scripts-dev configuration; the caller adds or changes fields. */
function configuration(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'react-scripts-dev',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'counter',
      anchorIndex: 0,
    },
    source: {
      path: 'examples/counter/src/features/counter/Counter.js',
      hash: 'a'.repeat(64),
      line: 19,
      column: 5,
    },
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#increment' }],
    after: [{ kind: 'text', selector: '#value', equals: '1' }],
    operations: [{ kind: 'click', title: 'Increment', selector: '#increment' }],
    inspections: [{ path: 'state.value', mode: 'value', required: true }],
    ...extra,
  }
}

// Value: protects=a version 3 react-scripts-dev configuration is accepted with packageRoot absent, "." and nested, and absent stays absent; fails_when=the adapter value is refused, packageRoot becomes required, or an absent field gains a default; why_new=Cycle 0083 adds the third adapter to version 3; seam=the live schema; no_claim=that the folder is a react-scripts app (resolved at the start)
test('a version 3 react-scripts-dev configuration is accepted with packageRoot absent, "." or nested', () => {
  // Arrange
  const spellings = [
    {},
    { packageRoot: '.' },
    { packageRoot: 'examples/counter' },
  ]
  // Act
  const results = spellings.map((extra) =>
    liveRepositoryConfigSchema.safeParse(configuration(extra)),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [true, true, true],
  )
  const parsed = operationsRepositoryConfigSchema.parse(configuration())
  assert.equal('packageRoot' in parsed, false)
})

// Value: protects=decision D7: versions 1 and 2 refuse the react-scripts-dev adapter; fails_when=either older shape accepts the third adapter, which an older Codebook reading the saved configuration could not run; why_new=the adapter exists in version 3 only; seam=the version 1 and 2 schemas with real study configurations; no_claim=the wording of the refusal
test('versions 1 and 2 refuse the react-scripts-dev adapter', () => {
  // Arrange
  const versionOne = {
    ...createConfiguredStudy().configuration,
    adapter: 'react-scripts-dev',
  }
  const versionTwo = {
    ...createCrossRuntimeStudy().configuration,
    adapter: 'react-scripts-dev',
  }
  // Act
  const results = [
    repositoryConfigSchema.safeParse(versionOne),
    crossRuntimeRepositoryConfigSchema.safeParse(versionTwo),
    liveRepositoryConfigSchema.safeParse(versionOne),
    liveRepositoryConfigSchema.safeParse(versionTwo),
  ]
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false, false, false],
  )
})

// Value: protects=react-scripts-dev seals and debugs browser modules only: a server participant is refused for the run and for an additional stop, with the adapter named; fails_when=a server participant is accepted under the adapter; why_new=D4 browser stops in the app's own source only; seam=the live schema; no_claim=the Vite refusal text (own tests)
test('a server participant is refused under react-scripts-dev', () => {
  // Arrange
  const runLevel = configuration({ participant: 'server' })
  const additional = configuration({
    additionalStops: [
      {
        participant: 'server',
        source: {
          path: 'examples/counter/src/index.js',
          hash: 'b'.repeat(64),
          line: 3,
          column: 1,
        },
        anchorIndex: 0,
        inspections: [{ path: 'state', mode: 'value', required: true }],
        afterOperation: 1,
      },
    ],
  })
  // Act
  const messages = [runLevel, additional].map((input) => {
    const result = liveRepositoryConfigSchema.safeParse(input)
    return result.success ? 'accepted' : JSON.stringify(result.error.issues)
  })
  // Assert
  for (const message of messages) {
    assert.notEqual(message, 'accepted')
    assert.match(
      message,
      /adapter \\"react-scripts-dev\\" supports browser stops only/,
    )
  }
})

// Value: protects=E2: one adapter list feeds the version 1/2 schema, the version 3 schema and the profile contract, so a fourth name added in one place shows in all; fails_when=a schema or the profile keeps its own hand-written list; why_new=the three copies drifted before; seam=the schemas' enum options and the profile constant; no_claim=what each adapter does
test('the version 1/2 schema, the version 3 schema and the profile list adapters from one tuple', () => {
  // Arrange
  const versionTwoOptions = repositoryConfigSchema.shape.adapter.options
  const versionThreeOptions =
    operationsRepositoryConfigSchema.shape.adapter.options
  // Act
  const profileAdapters = CONFIGURED_PROFILE.adapters
  // Assert
  assert.deepEqual(versionTwoOptions, [...REPOSITORY_BROWSER_ADAPTERS])
  assert.deepEqual(versionTwoOptions, ['next-dev-webpack', 'vite-dev'])
  assert.deepEqual(versionThreeOptions, [
    ...OPERATIONS_REPOSITORY_BROWSER_ADAPTERS,
  ])
  assert.deepEqual(versionThreeOptions, [
    'next-dev-webpack',
    'vite-dev',
    'react-scripts-dev',
    'expo-web-dev',
  ])
  assert.deepEqual(profileAdapters, [...versionThreeOptions])
})
