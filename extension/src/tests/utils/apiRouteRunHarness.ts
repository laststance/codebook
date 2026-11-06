import type { TestContext } from 'node:test'

import { REPOSITORY_RUN_TIMEOUT_MS } from '../../constants'
import type { RepositoryOperation } from '../../repositoryConfigSchemas'
import type { RuntimeControl } from '../../runtime'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'
import { ADD, type RouteHandlerRunHarness } from './routeHandlerRunHarness'
import type { ServerHit } from './serverRenderParticipant'

/** The Pages API route file the harness declares its stop in. */
export const API_ROUTE_FILE = 'src/pages/api/data.ts'

/** Builds the control the service gives a run; the whole-run deadline is far away so a test moves only the clock it means to. @example apiRouteControl(context).runId // => 'service-run-88' */
function apiRouteControl(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + REPOSITORY_RUN_TIMEOUT_MS,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-88',
  }
}

/**
 * Opens a prepared version 3 Pages run whose server stops are in a Pages API route (`src/pages/api/data.ts`), one click operation, and the route's script answering as Next's `(api-node)` layer does.
 * Why it exists: every API-route integration test starts the same way; the options add what differs (the stops' operations, a browser stop beside them). The harness answers E1's and E1b's recorded shapes, never a guess.
 * @param context - The test.
 * @param options - `stopOperations` names the `afterOperation` of each stop (default one stop after operation 1); `stopParticipants`, `operations`, `additionalStops` and `extra` as for the route-handler harness.
 * @returns The harness with the run not yet prepared.
 * @example const harness = await apiRouteRunHarness(context)
 */
export async function apiRouteRunHarness(
  context: TestContext,
  options: {
    stopOperations?: number[]
    stopParticipants?: ('server' | 'browser')[]
    operations?: RepositoryOperation[]
    additionalStops?: Parameters<typeof configuredRuntimeHarness>[2]
    extra?: Partial<Parameters<typeof configuredRuntimeHarness>[3]>
  } = {},
): Promise<RouteHandlerRunHarness> {
  const stopOperations = options.stopOperations ?? [1]
  return configuredRuntimeHarness(
    context,
    apiRouteControl(context),
    options.additionalStops ?? [],
    {
      participant: 'server',
      serverSeal: 'api-node',
      serverRuntime: { route: null },
      entryPath: '/',
      realSourceRoot: true,
      sourcePath: API_ROUTE_FILE,
      nextPages: {},
      // The route's own module text: the Pages browser module the build harness writes carries a sourceURL of its own, which would make the server script's identity ambiguous.
      moduleJavascript: 'const nextTheme = "dark";',
      operations: {
        operations: options.operations ?? [ADD],
        stopOperations,
        stopParticipants:
          options.stopParticipants ?? stopOperations.map(() => 'server'),
      },
      ...options.extra,
    },
  )
}

/**
 * Sends the hit of the API route's breakpoint with the stack and scope E1 and E1b recorded: the script carries its own source map so the run can seal it at the pause, and the hit names the stop's own breakpoint id as js-debug does.
 * @param harness - The run's harness.
 * @param extra - Further fields of the hit (`stack`, `apiRequest`, `hitBreakpoints`).
 * @returns The number of the hit.
 * @example apiRouteHit(harness, { apiRequest: { method: 'GET', url: '/api/data?clear=1' } })
 */
export function apiRouteHit(
  harness: RouteHandlerRunHarness,
  extra: ServerHit = {},
): number {
  const server = harness.server!
  server.setScriptText('server', server.instanceText(';AAAA', server.sealedUrl))
  return server.hit({
    stack: 'api-route',
    generated: { line: 1, column: 0 },
    hitBreakpoints: ['owned-breakpoint'],
    ...extra,
  })
}
