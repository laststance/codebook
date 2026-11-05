import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import {
  ROUTE_FILE,
  routeHandlerRunHarness,
  type RouteHandlerRunHarness,
} from './utils/routeHandlerRunHarness'

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

// Value: protects=AC 4/E-T1 a route-handler stop declared afterOperation 0 is refused before any process with the reason and the field to change; fails_when=next dev starts, the run ends RUNTIME_FAILED, or the refusal carries no reason; no_claim=the wording of the recovery (help tests)
test('a route-handler stop declared afterOperation 0 is refused before next dev starts', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [0],
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalFacts(harness, failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'route-handler-before-operation',
      stopIndex: 0,
      file: ROUTE_FILE,
      sideEffects: 'none',
    },
    developmentServers: 0,
    serverDebuggers: 0,
    browsers: 0,
    inputs: 0,
  })
})

// Value: protects=AC 4/E-T1 a route file that declares the Edge runtime cannot be paused and is refused before any process; fails_when=the run starts the server and fails at run time, or a double-quoted 'edge' is missed; no_claim=a runtime set by re-export (documented limit: not reached at run time)
test('a route file that declares the Edge runtime is refused before next dev starts', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    extra: {
      fixture: {
        source:
          'export const runtime = "edge"\nvar nextTheme = "dark";\nvar between = 1;\n',
        citationEndLine: 2,
        declaredLine: 2,
      },
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalFacts(harness, failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'route-handler-edge-runtime',
      stopIndex: 0,
      file: ROUTE_FILE,
      sideEffects: 'none',
    },
    developmentServers: 0,
    serverDebuggers: 0,
    browsers: 0,
    inputs: 0,
  })
})

// Value: protects=AC 4/E-T1 a route file in node_modules is not the app's own source and is refused before any process; fails_when=the stop reaches the seal and fails at run time; no_claim=a workspace library stop (the library freeze path, covered by the library suites)
test('a route file in node_modules is refused before next dev starts', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    extra: { sourcePath: 'node_modules/pkg/app/api/todos/route.ts' },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalFacts(harness, failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'route-handler-not-app-source',
      stopIndex: 0,
      file: 'node_modules/pkg/app/api/todos/route.ts',
      sideEffects: 'none',
    },
    developmentServers: 0,
    serverDebuggers: 0,
    browsers: 0,
    inputs: 0,
  })
})

// Value: protects=AC 3/R10 a file named route.ts outside the app tree is an ordinary server stop and takes today's path; fails_when=lib/route.ts is refused as a route handler; no_claim=how the ordinary stop is sealed (existing suites)
test('a route.ts under a lib folder is not refused as a route handler', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [0],
    extra: { sourcePath: 'lib/route.ts' },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(
    failure instanceof StudyError &&
      String(failure.details?.reason).startsWith('route-handler'),
    false,
  )
})
