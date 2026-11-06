import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import { API_ROUTE_FILE, apiRouteRunHarness } from './utils/apiRouteRunHarness'
import type { RouteHandlerRunHarness } from './utils/routeHandlerRunHarness'

/**
 * Runs a harness run's preparation and returns what it rejected with.
 * @param harness - The run's harness.
 * @returns The rejection, or `undefined` when the preparation passed.
 * @example const failure = await preparationFailure(harness)
 */
function preparationFailure(harness: RouteHandlerRunHarness): Promise<unknown> {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

/**
 * Reads what the refusal says and whether anything was started.
 * @param harness - The run's harness after its preparation was refused.
 * @param failure - What the preparation rejected with.
 * @example refusalFacts(harness, failure)
 */
function refusalFacts(harness: RouteHandlerRunHarness, failure: unknown) {
  assert.ok(failure instanceof StudyError, String(failure))
  return {
    code: failure.code,
    details: { ...failure.details },
    developmentServers: harness.developmentServerLaunches(),
    serverDebuggers: harness.serverLaunches.length,
    browsers: harness.launchConfigurations.length,
    inputs: harness.inputsSeen(),
  }
}

/** The facts of a refusal of the API-route stop in {@link API_ROUTE_FILE} before anything started. */
function refusedBefore(reason: string) {
  return {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason,
      stopIndex: 0,
      file: API_ROUTE_FILE,
      sideEffects: 'none',
    },
    developmentServers: 0,
    serverDebuggers: 0,
    browsers: 0,
    inputs: 0,
  }
}

// Value: protects=AC 4 an API-route stop declared afterOperation 0 is refused before any process with the reason and the field to change; fails_when=next dev starts, the run ends RUNTIME_FAILED, or the old NEXT_SERVER_ONLY_STOP refusal returns; no_claim=the wording of the recovery (help tests)
test('an API-route stop declared afterOperation 0 is refused before next dev starts', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context, { stopOperations: [0] })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(
    refusalFacts(harness, failure),
    refusedBefore('api-route-before-operation'),
  )
})

// Value: protects=E-4 an API-route stop in a version 2 configuration (which has no afterOperation) is refused with the same reason, whose recovery moves it to version 3; fails_when=the run starts the server or takes the version 2 refusal of the data functions; no_claim=the wording of the recovery
test('an API-route stop in a version 2 configuration is refused before next dev starts', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context, {
    extra: { operations: undefined },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(
    refusalFacts(harness, failure),
    refusedBefore('api-route-before-operation'),
  )
})

// Value: protects=AC 4 an API route that declares the edge runtime in its exported config, after a nested api object, cannot be paused and is refused before any process; fails_when=the run starts the server and fails at run time; no_claim=a runtime set by a constant or a re-export (armed, documented as not reached)
test('an API route that declares the edge runtime in its config is refused before next dev starts', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context, {
    extra: {
      fixture: {
        source:
          'export const config = { api: { bodyParser: false }, runtime: \'edge\' }\nvar nextTheme = "dark";\nvar between = 1;\n',
        citationEndLine: 2,
        declaredLine: 2,
      },
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(
    refusalFacts(harness, failure),
    refusedBefore('api-route-edge-runtime'),
  )
})

// Value: protects=AC 3 a server stop in _document still takes NEXT_SERVER_ONLY_STOP before any process, and an API-route stop no longer does; fails_when=_document is armed as an API route or the lexical refusal is dropped; no_claim=the wording of the refusal (pagesServerStopRefusal tests)
test('a server stop in _document is still refused with NEXT_SERVER_ONLY_STOP before next dev starts', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context, {
    extra: { sourcePath: 'src/pages/_document.tsx' },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalFacts(harness, failure), {
    code: 'NEXT_SERVER_ONLY_STOP',
    details: { router: 'pages', sideEffects: 'none' },
    developmentServers: 0,
    serverDebuggers: 0,
    browsers: 0,
    inputs: 0,
  })
})
