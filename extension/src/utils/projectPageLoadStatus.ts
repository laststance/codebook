import type { RuntimeView } from '../runtime'

import { afterOperationOf } from './afterOperationOf'
import { configuredStops } from './configuredStops'
import {
  describePageLoadStatus,
  type PageLoadStatusInput,
} from './describePageLoadStatus'

/** The snapshot fields a server-render pause adds (lane L3's run fields); absent on a run that never paused a render. */
type RenderFields = {
  execution?: unknown
  operationIndex?: unknown
  declaredIndex?: unknown
}

/** Reads a snapshot's server-render fields. @example renderFieldsOf(snapshot).execution // => 'server-render' */
function renderFieldsOf(snapshot: object | undefined): RenderFields {
  return snapshot ?? {}
}

/**
 * Words the entry-load phase of a run's view: the status item's and the run resource's `Page load · …` text (task 3a).
 * Called by {@link StudyWorkspace} for the status item and by {@link StudyService} for the run resource.
 * @param view - The run's view; a view without server-render pauses yields `undefined`.
 * @returns The words from {@link describePageLoadStatus}, or `undefined` while today's texts apply.
 * @example projectPageLoadStatus(view) // => 'Page load · paused in server render'
 */
export function projectPageLoadStatus(
  view:
    | Pick<
        RuntimeView,
        'status' | 'operations' | 'participants' | 'snapshots' | 'definition'
      >
    | undefined,
): string | undefined {
  if (!view) return undefined
  const renders = view.snapshots.filter(
    (snapshot) => renderFieldsOf(snapshot).execution === 'server-render',
  )
  if (!renders.length) return undefined
  const server = view.participants.server
  const heldFields = renderFieldsOf(
    server?.phase === 'paused' ? server.snapshot : undefined,
  )
  const isHeldRender = heldFields.execution === 'server-render'
  const group =
    typeof heldFields.operationIndex === 'number'
      ? heldFields.operationIndex
      : 0
  const stops = configuredStops(view.definition.configuration)
  const input: PageLoadStatusInput = {
    runState: view.status,
    hasOperations: Boolean(view.operations?.length),
    enteredPageLoad: renders.some(
      (snapshot) => renderFieldsOf(snapshot).operationIndex === undefined,
    ),
    operationStarted: Boolean(
      view.operations?.some((operation) => operation.state !== 'not-run'),
    ),
    ...(isHeldRender && {
      held: {
        isServerRender: true,
        group,
        paused: Math.max(
          1,
          new Set(
            renders
              .filter(
                (snapshot) =>
                  (renderFieldsOf(snapshot).operationIndex ?? 0) === group,
              )
              .map((snapshot) => renderFieldsOf(snapshot).declaredIndex),
          ).size,
        ),
        declared: stops.filter(
          (stop) =>
            stop.participant === 'server' &&
            (afterOperationOf(stop) ?? 0) === group,
        ).length,
      },
    }),
  }
  return describePageLoadStatus(input)
}
