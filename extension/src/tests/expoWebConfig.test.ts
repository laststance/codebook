import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  crossRuntimeRepositoryConfigSchema,
  liveRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
  repositoryConfigSchema,
  retainedRepositoryConfigSchema,
} from '../repositoryConfigSchemas'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

/** A valid version 3 expo-web-dev configuration; the caller adds or changes fields. */
function configuration(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'expo-web-dev',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'sign-in',
      anchorIndex: 0,
    },
    source: {
      path: 'apps/app/src/hooks/use-auth-form.ts',
      hash: 'a'.repeat(64),
      line: 56,
      column: 5,
    },
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#email' }],
    after: [{ kind: 'text', selector: '#status', equals: 'sent' }],
    operations: [{ kind: 'click', title: 'Sign in', selector: '#submit' }],
    inspections: [{ path: 'parsed.data.email', mode: 'value', required: true }],
    ...extra,
  }
}

/** The messages the live schema gives an input, or `accepted`. */
function messageOf(input: unknown): string {
  const result = liveRepositoryConfigSchema.safeParse(input)
  return result.success ? 'accepted' : JSON.stringify(result.error.issues)
}

// Value: protects=DX-1: a version 3 expo-web-dev configuration is accepted with packageRoot absent, "." and nested, and absent stays absent; fails_when=the adapter value is refused or packageRoot becomes required; why_new=Cycle 0089 adds the fourth adapter to version 3; seam=the live schema; no_claim=that the folder is an Expo app (resolved at the start)
test('a version 3 expo-web-dev configuration is accepted with packageRoot absent, "." or nested', () => {
  // Arrange
  const spellings = [{}, { packageRoot: '.' }, { packageRoot: 'apps/app' }]
  // Act
  const results = spellings.map((extra) =>
    liveRepositoryConfigSchema.safeParse(configuration(extra)),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [true, true, true],
  )
  assert.equal(
    'packageRoot' in operationsRepositoryConfigSchema.parse(configuration()),
    false,
  )
})

// Value: protects=DX-1: versions 1 and 2 refuse the expo-web-dev adapter, and a saved study of formats 3 to 8 refuses it; fails_when=an older shape accepts the adapter an older Codebook could not run; why_new=the adapter exists in version 3 and format 15 only; seam=the version 1 and 2 schemas with real study configurations; no_claim=the wording of the refusal
test('versions 1 and 2 and the retained formats refuse the expo-web-dev adapter', () => {
  // Arrange
  const versionOne = {
    ...createConfiguredStudy().configuration,
    adapter: 'expo-web-dev',
  }
  const versionTwo = {
    ...createCrossRuntimeStudy().configuration,
    adapter: 'expo-web-dev',
  }
  // Act
  const results = [
    repositoryConfigSchema.safeParse(versionOne),
    crossRuntimeRepositoryConfigSchema.safeParse(versionTwo),
    liveRepositoryConfigSchema.safeParse(versionOne),
    liveRepositoryConfigSchema.safeParse(versionTwo),
    retainedRepositoryConfigSchema.safeParse(configuration()),
  ]
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false, false, false, false],
  )
})

// Value: protects=DX-4: a server participant is refused under expo-web-dev, for the run and for an additional stop, with the adapter named, before any process starts; fails_when=a server participant is accepted; why_new=browser stops only; seam=the live schema; no_claim=the react-scripts refusal text (own tests)
test('a server participant is refused under expo-web-dev', () => {
  // Arrange
  const runLevel = configuration({ participant: 'server' })
  const additional = configuration({
    additionalStops: [
      {
        participant: 'server',
        source: {
          path: 'apps/app/src/index.ts',
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
  const messages = [runLevel, additional].map(messageOf)
  // Assert
  for (const message of messages)
    assert.match(
      message,
      /adapter \\"expo-web-dev\\" supports browser stops only/,
    )
})

// Value: protects=DX-4: a stop in an Expo Router API route file (+api.ts, +api.tsx, +api.js) is refused for the run and for an additional stop, naming the file, before any process starts, while an ordinary route file is accepted; fails_when=an API route stop is accepted, or a plain file is refused; why_new=API routes are server code; seam=the live schema; no_claim=a route handler without the +api suffix
test('a stop in an Expo Router API route is refused and an ordinary route file is accepted', () => {
  // Arrange
  const apiFiles = ['hello+api.ts', 'hello+api.tsx', 'hello+api.js']
  const apiStops = apiFiles.map((file) =>
    configuration({
      source: {
        path: `apps/app/src/app/${file}`,
        hash: 'a'.repeat(64),
        line: 3,
        column: 1,
      },
    }),
  )
  const additionalApiStop = configuration({
    additionalStops: [
      {
        participant: 'browser',
        source: {
          path: 'apps/app/src/app/hello+api.ts',
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
  const refused = [...apiStops, additionalApiStop].map(messageOf)
  const ordinary = messageOf(
    configuration({
      source: {
        path: 'apps/app/src/app/api.tsx',
        hash: 'a'.repeat(64),
        line: 3,
        column: 1,
      },
    }),
  )
  // Assert
  for (const message of refused)
    assert.match(message, /Expo Router API route \(\+api\)/)
  assert.equal(ordinary, 'accepted')
})
