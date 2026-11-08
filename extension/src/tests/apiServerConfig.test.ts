import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  liveRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

const API_SERVER = {
  packageRoot: 'apps/api',
  entry: 'src/server.ts',
  port: 4100,
}

/** A server stop in the API's own folder, declared after operation 1. */
const API_STOP = {
  participant: 'server',
  source: {
    path: 'apps/api/src/handler.ts',
    hash: 'b'.repeat(64),
    line: 12,
    column: 3,
  },
  anchorIndex: 0,
  inspections: [{ path: 'input', mode: 'value', required: true }],
  afterOperation: 1,
}

/**
 * A valid version 3 expo-web-dev configuration with an `apiServer`, one browser stop in the app and one server stop in the API; the caller replaces fields.
 * @example configuration({ packageRoot: 'apps/other' }).packageRoot // => 'apps/other'
 */
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
      path: 'apps/app/src/hooks/use-action.ts',
      hash: 'a'.repeat(64),
      line: 56,
      column: 5,
    },
    packageRoot: 'apps/app',
    apiServer: API_SERVER,
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#email' }],
    after: [{ kind: 'text', selector: '#status', equals: 'sent' }],
    operations: [{ kind: 'click', title: 'Press', selector: '#press' }],
    inspections: [{ path: 'state', mode: 'value', required: true }],
    additionalStops: [API_STOP],
    ...extra,
  }
}

/** The issues the live schema gives an input as `path: message` lines, or `accepted`. */
function issuesOf(input: unknown): string {
  const result = liveRepositoryConfigSchema.safeParse(input)
  return result.success
    ? 'accepted'
    : result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')
}

// Value: protects=AC1 a version 3 expo-web-dev configuration with apiServer, a browser stop in the app and a server stop in the API validates and keeps its exact shape (no loader or packageRoot default added); fails_when=apiServer is refused, a default is added to the retained configuration, or the server stop is refused; no_claim=that the API starts or the folders exist (the run checks)
test('accepts apiServer on a version 3 expo-web-dev configuration and keeps its declared shape', () => {
  // Arrange
  const input = configuration()
  // Act
  const parsed = operationsRepositoryConfigSchema.parse(input)
  // Assert
  assert.equal(issuesOf(input), 'accepted')
  assert.deepEqual(parsed.apiServer, API_SERVER)
  assert.equal('loader' in (parsed.apiServer ?? {}), false)
})

// Value: protects=AC1 every other adapter and the older versions refuse apiServer exactly as an unknown key; fails_when=apiServer is accepted under vite-dev, react-scripts-dev, next-dev-webpack or version 1, or refused with another message; no_claim=the node-server profile, which has its own schema
test('refuses apiServer as an unknown key on every adapter but expo-web-dev and on version 1', () => {
  // Arrange
  const otherAdapters = ['vite-dev', 'react-scripts-dev', 'next-dev-webpack']
  const candidates = [
    ...otherAdapters.map((adapter) =>
      configuration({ adapter, additionalStops: undefined }),
    ),
    {
      ...createConfiguredStudy().configuration,
      apiServer: API_SERVER,
    },
  ]
  // Act
  const results = candidates.map((candidate) =>
    liveRepositoryConfigSchema.safeParse(candidate),
  )
  // Assert
  for (const result of results) {
    assert.equal(result.success, false)
    assert.match(
      result.error?.message ?? '',
      /Unrecognized key: \\"apiServer\\"/,
    )
  }
})

// Value: protects=AC1 the API folder and the app folder may not contain one another (either way, or the repository root), so a stop's participant follows from its folder; fails_when=a nested API folder, an app inside the API folder or a root app is accepted; no_claim=that the folders are real packages
test('refuses an apiServer folder that contains or sits inside the app folder', () => {
  // Arrange
  const apiInsideApp = configuration({
    apiServer: { ...API_SERVER, packageRoot: 'apps/app/api' },
  })
  const appInsideApi = configuration({ packageRoot: 'apps/api/web' })
  const rootApp = configuration({ packageRoot: undefined })
  const sharedPrefix = configuration({
    packageRoot: 'apps/api2',
    source: {
      path: 'apps/api2/src/a.ts',
      hash: 'a'.repeat(64),
      line: 1,
      column: 1,
    },
  })
  // Act
  const issues = [apiInsideApp, appInsideApi, rootApp].map(issuesOf)
  // Assert
  for (const issue of issues)
    assert.match(
      issue,
      /^apiServer\.packageRoot: apiServer\.packageRoot "apps\/(?:app\/api|api)" and the app's packageRoot "[^"]+" must not contain one another/m,
    )
  // A shared name prefix (apps/api2 beside apps/api) is no containment.
  assert.equal(issuesOf(sharedPrefix), 'accepted')
})

// Value: protects=AC1 with apiServer a server stop must lie in the API folder and a browser stop in the app folder, each refused at that stop's source.path; fails_when=a server stop in the app or a browser stop in the API passes; no_claim=the files exist
test('refuses a server stop outside the API folder and a browser stop outside the app folder', () => {
  // Arrange
  const serverStopInApp = configuration({
    additionalStops: [
      {
        ...API_STOP,
        source: { ...API_STOP.source, path: 'apps/app/src/handler.ts' },
      },
    ],
  })
  const browserStopInApi = configuration({
    source: { ...API_STOP.source, path: 'apps/api/src/page.ts' },
  })
  // Act
  const issues = [serverStopInApp, browserStopInApi].map(issuesOf)
  // Assert
  assert.match(
    issues[0]!,
    /^additionalStops\.0\.source\.path: A server stop must lie inside apiServer\.packageRoot "apps\/api"/,
  )
  assert.match(
    issues[1]!,
    /^source\.path: With apiServer, a browser stop must lie inside the app's packageRoot "apps\/app"/,
  )
})

// Value: protects=AC1 a server stop at afterOperation 0 is refused with a sentence that names the way out (the operation whose request reaches the API); fails_when=an entry-load API stop is accepted; no_claim=entry-load API stops of a later API
test('refuses an API server stop at afterOperation 0', () => {
  // Arrange
  const input = configuration({
    additionalStops: [{ ...API_STOP, afterOperation: 0 }],
    afterOperation: 0,
    participant: 'server',
    source: API_STOP.source,
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(
    issues,
    /^afterOperation: afterOperation 0 is declared at configuration\.afterOperation, but an API server stop needs an operation: entry-load API stops are not supported/m,
  )
  assert.match(
    issues,
    /^additionalStops\.0\.afterOperation: afterOperation 0 is declared at configuration\.additionalStops\.0\.afterOperation/m,
  )
})

// Value: protects=AC1 a TypeScript entry with loader node is refused at apiServer.loader like the node-server rule, a JavaScript entry with node is accepted; fails_when=the loader rule is skipped for apiServer; no_claim=that tsx is installed
test('refuses a TypeScript apiServer entry declared with the node loader', () => {
  // Arrange
  const typescript = configuration({
    apiServer: { ...API_SERVER, loader: 'node' },
  })
  const javascript = configuration({
    apiServer: { ...API_SERVER, entry: 'dist/server.js', loader: 'node' },
  })
  // Act
  const results = [typescript, javascript].map(issuesOf)
  // Assert
  assert.match(
    results[0]!,
    /^apiServer\.loader: expected "tsx" for a TypeScript entry/m,
  )
  assert.equal(results[1], 'accepted')
})

// Value: protects=AC1 and DX-1 a server participant under expo-web-dev without apiServer is refused with a sentence that names apiServer (API 1.37) as the way out, while vite-dev keeps its plain refusal; fails_when=the sentence loses the way out, or vite-dev gains it; no_claim=the +api route refusal text
test('a server participant without apiServer is refused with the way out named, and vite-dev keeps its plain refusal', () => {
  // Arrange
  const expo = configuration({
    apiServer: undefined,
    participant: 'server',
    source: API_STOP.source,
    additionalStops: undefined,
  })
  const vite = configuration({
    adapter: 'vite-dev',
    apiServer: undefined,
    participant: 'server',
    source: API_STOP.source,
    additionalStops: undefined,
  })
  // Act
  const results = [expo, vite].map(issuesOf)
  // Assert
  assert.match(
    results[0]!,
    /^participant: adapter "expo-web-dev" supports browser stops only; participant "server" is declared at configuration\.participant\. To pause in the app's own Node API, declare apiServer \(API 1\.37\)\.$/m,
  )
  assert.equal(
    results[1],
    'participant: adapter "vite-dev" supports browser stops only; participant "server" is declared at configuration.participant.',
  )
})

// Value: protects=AC1 a stop in an Expo Router +api file is still refused when apiServer is declared; fails_when=apiServer relaxes the +api refusal; no_claim=the API folder rule
test('a stop in an Expo Router API route is still refused with apiServer declared', () => {
  // Arrange
  const input = configuration({
    source: { ...API_STOP.source, path: 'apps/app/src/app/hello+api.ts' },
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(
    issues,
    /^source\.path: adapter "expo-web-dev" supports browser stops only; apps\/app\/src\/app\/hello\+api\.ts is an Expo Router API route/m,
  )
})

// Value: protects=AC1 apiServer.port is held to the node-server port bounds (integer, 1024 to 65535); fails_when=a privileged, fractional or out-of-range port is accepted; no_claim=that the port is free
test('refuses an apiServer port outside the node-server bounds', () => {
  // Arrange
  const ports = [80, 1023, 65536, 4100.5]
  // Act
  const results = ports.map((port) => {
    const result = operationsRepositoryConfigSchema.safeParse(
      configuration({ apiServer: { ...API_SERVER, port } }),
    )
    return result.success ? 'accepted' : JSON.stringify(result.error.issues)
  })
  // Assert
  for (const result of results)
    assert.match(
      result,
      /"path":\["apiServer","port"\].*expected an integer from 1024 to 65535|expected an integer from 1024 to 65535.*"path":\["apiServer","port"\]/,
    )
  assert.equal(
    issuesOf(configuration({ apiServer: { ...API_SERVER, port: 1024 } })),
    'accepted',
  )
})

// Value: protects=AC1 and AC4 a saved study configuration that declares apiServer validates (format 19), and the retained schema of formats 3 to 8 refuses it; fails_when=the format 19 variant is missing from the study union or the retained schema accepts apiServer; no_claim=the format number selection (studyFormat19 tests)
test('the study configuration schema keeps apiServer and the retained formats 3 to 8 refuse it', () => {
  // Arrange
  const input = configuration()
  // Act
  const study = studyConfigurationSchema.safeParse(input)
  const retained = retainedRepositoryConfigSchema.safeParse(input)
  // Assert
  assert.equal(study.success, true)
  assert.equal(retained.success, false)
})
