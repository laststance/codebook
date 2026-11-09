import type { TestContext } from 'node:test'

import { REPOSITORY_RUN_TIMEOUT_MS } from '../../constants'
import type { RepositoryOperation } from '../../repositoryConfigSchemas'
import type { RuntimeControl } from '../../runtime'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'

/** The route file the harness declares its stop in. */
export const ROUTE_FILE = 'app/api/todos/route.ts'
/** The origin the stand-in application listens on. */
export const APP_ORIGIN = 'http://localhost:4321'

/** The operation the harness page accepts: the click that sends the request. */
export const ADD: RepositoryOperation = {
  kind: 'click',
  title: 'Add',
  selector: 'button[type=submit]',
}

/** The harness of a run that declares route-handler stops ({@link routeHandlerRunHarness}). */
export type RouteHandlerRunHarness = Awaited<
  ReturnType<typeof routeHandlerRunHarness>
>

/**
 * Builds the control the service gives a run; the whole-run deadline is far away so a test moves only the clock it means to.
 * @param context - The test, whose end aborts the run.
 * @example controlOf(context).runId // => 'service-run-71'
 */
function controlOf(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + REPOSITORY_RUN_TIMEOUT_MS,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-71',
  }
}

/**
 * Opens a prepared version 3 run whose server stops are in an App Router route handler (`app/api/todos/route.ts`), one click operation, and the route handler's script answering as Next's does.
 * Why it exists: every route-handler integration test starts the same way; the options add what differs (the stops' operations, a browser stop beside them).
 * @param context - The test.
 * @param options - `stopOperations` names the `afterOperation` of each stop in declared order (default one stop after operation 1); `stopParticipants` replaces the participants (default all `server`); `stopHolds` the `hold` of each stop; `extra` further harness options.
 * @returns The harness with the run prepared and no operation sent yet.
 * @example const harness = await routeHandlerRunHarness(context)
 */
export async function routeHandlerRunHarness(
  context: TestContext,
  options: {
    stopOperations?: number[]
    stopParticipants?: ('server' | 'browser')[]
    /** The `hold` each stop declares, the first stop first; a missing entry declares nothing. */
    stopHolds?: Array<'explain' | 'record' | undefined>
    operations?: RepositoryOperation[]
    additionalStops?: Parameters<typeof configuredRuntimeHarness>[2]
    extra?: Partial<Parameters<typeof configuredRuntimeHarness>[3]>
  } = {},
) {
  const stopOperations = options.stopOperations ?? [1]
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    options.additionalStops ?? [],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/api/todos' },
      entryPath: '/',
      realSourceRoot: true,
      sourcePath: ROUTE_FILE,
      operations: {
        operations: options.operations ?? [ADD],
        stopOperations,
        stopParticipants:
          options.stopParticipants ?? stopOperations.map(() => 'server'),
        ...(options.stopHolds ? { stopHolds: options.stopHolds } : {}),
      },
      ...options.extra,
    },
  )
  return harness
}

/**
 * Sends operation k and waits until its input reached the page, the state in which the page's request may be sent.
 * @param harness - The prepared run's harness.
 * @param index - The operation (1-based).
 * @example await sendOperation(harness, 1)
 */
export async function sendOperation(
  harness: RouteHandlerRunHarness,
  index: number,
): Promise<void> {
  harness.run.action(`op-${index}`, 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === index, 'the input was sent')
}

/**
 * Reports the page's own request to the route handler, as the browser's `Network` event does.
 * @param harness - The run's harness.
 * @param requestId - The request's id.
 * @param method - The HTTP method.
 * @param pathname - The request pathname, with its query for an API-route request.
 * @param wallTime - The event's `wallTime` in seconds since the epoch; absent as an older event.
 * @example sendRequest(harness, '9', 'POST', '/api/todos')
 */
export function sendRequest(
  harness: RouteHandlerRunHarness,
  requestId: string,
  method: string,
  pathname: string,
  wallTime?: number,
): void {
  harness.pageRequest.start(
    requestId,
    `${APP_ORIGIN}${pathname}`,
    'Fetch',
    'main',
    method,
    wallTime,
  )
}

/**
 * Sends the hit of the route file's breakpoint with the stack E1 recorded: the script carries its own source map so the run can seal it at the pause.
 * @param harness - The run's harness.
 * @param extra - Further fields of the hit (`handlerName`, `route`, `hitBreakpoints`).
 * @returns The number of the hit.
 * @example routeHandlerHit(harness, { handlerName: 'POST' })
 */
export function routeHandlerHit(
  harness: RouteHandlerRunHarness,
  extra: Parameters<
    NonNullable<RouteHandlerRunHarness['server']>['hit']
  >[0] = {},
  order?: Parameters<NonNullable<RouteHandlerRunHarness['server']>['hit']>[1],
  mappings = ';AAAA',
): number {
  const server = harness.server!
  server.setScriptText(
    'server',
    server.instanceText(mappings, server.sealedUrl),
  )
  return server.hit(
    { stack: 'route-handler', generated: { line: 1, column: 0 }, ...extra },
    order,
  )
}

/** Waits for the server's published pause. @example const snapshot = await publishedPause(harness) */
export function publishedPause(harness: RouteHandlerRunHarness) {
  return waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published route-handler pause',
  )
}

/** Lists the journal event types of a run, in order. @example journalTypes(harness) // ['run.session', …] */
export function journalTypes(harness: RouteHandlerRunHarness): string[] {
  return harness.run.view().events.map((event) => event.type)
}
