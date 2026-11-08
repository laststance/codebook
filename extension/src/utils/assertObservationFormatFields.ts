import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  API_ROUTE_STUDY_VERSION,
  EXPO_WEB_API_SERVER_STUDY_VERSION,
  VITE_API_SERVER_STUDY_VERSION,
  MODULE_EVALUATION_STUDY_VERSION,
  NEXT_LIBRARY_STUDY_VERSION,
  OPERATIONS_CONFIG_VERSION,
  ROUTE_HANDLER_STUDY_VERSION,
} from '../constants'

import { afterOperationOf } from './afterOperationOf'
import type { configuredStops } from './configuredStops'
import { isRepositoryPathInFolder } from './isRepositoryPathInFolder'
import {
  isApiRouteObservation,
  isApiServerStudyFormat,
  isModuleEvaluationObservation,
  isRouteHandlerObservation,
  usesServerRenderEvidence,
} from './studyFormatOfConfiguration'

type Observation = ConfiguredStudy['observations'][number]

/**
 * Checks one format 8 observation against its declared stop: the three required fields, the execution that fits the stop's participant, and the attribution fields that only a server render carries.
 * @param observation - The observation.
 * @param position - Its position in the study, which is the order the run paused it.
 * @param stops - The declared stops.
 * @param seenStops - The declared indexes earlier observations used; this call adds its own.
 * @throws When a field is missing or contradicts the stop, or a stop is observed twice.
 * @example assertFormat8Observation(observation, 0, stops, new Set())
 */
function assertFormat8Observation(
  observation: Observation,
  position: number,
  stops: ReturnType<typeof configuredStops>,
  seenStops: Set<number>,
): void {
  const { declaredIndex, executionIndex, execution } = observation
  if (
    declaredIndex === undefined ||
    executionIndex === undefined ||
    execution === undefined
  )
    throw new Error(
      'Configured observation of format 8 lacks execution, declaredIndex or executionIndex.',
    )
  const stop = stops[declaredIndex]
  if (observation.routeHandler !== undefined && execution !== 'route-handler')
    throw new Error('Only a route-handler observation has a routeHandler.')
  if (observation.apiRoute !== undefined && execution !== 'api-route')
    throw new Error('Only an API-route observation has an apiRoute.')
  if (!stop || seenStops.has(declaredIndex))
    throw new Error(
      'Configured observation names a stop that is not declared or already observed.',
    )
  seenStops.add(declaredIndex)
  if (executionIndex !== position)
    throw new Error('Configured observation executionIndex is out of order.')
  if ((execution === 'browser') !== (stop.participant === 'browser'))
    throw new Error('Configured observation execution differs from its stop.')
  const group = afterOperationOf(stop) ?? 1
  if (execution === 'route-handler')
    assertRouteHandlerObservation(observation, group)
  else if (execution === 'api-route')
    assertApiRouteObservation(observation, group)
  else assertAttributionFitsGroup(observation, group)
}

/**
 * Checks a route-handler observation (format 13) against the group of its stop: it is observed after operation k >= 1 (a route handler runs for a request an operation sent, never for the page load), names its request in `routeHandler`, and has no module scope.
 * @param observation - The observation, whose `execution` is `route-handler`.
 * @param group - The stop's `afterOperation`.
 * @throws When the attribution, the operation index, `routeHandler` or `scope` contradicts that.
 * @example assertRouteHandlerObservation({ execution: 'route-handler', attribution: 'after-operation', operationIndex: 2, routeHandler }, 2)
 */
function assertRouteHandlerObservation(
  observation: Observation,
  group: number,
): void {
  const { attribution, operationIndex, routeHandler, scope } = observation
  if (attribution !== 'after-operation' || group === 0)
    throw new Error(
      'A route-handler observation is attributed after an operation.',
    )
  if (operationIndex !== group)
    throw new Error(
      'Configured observation operationIndex differs from its stop.',
    )
  if (routeHandler === undefined || scope !== undefined)
    throw new Error(
      'A route-handler observation needs a routeHandler and has no scope.',
    )
}

/**
 * Checks an API-route observation (format 14) against the group of its stop: it is observed after operation k >= 1 (a Pages API route runs for a request an operation sent, never for the page load), names its request in `apiRoute` and no `routeHandler`, and has no module scope.
 * @param observation - The observation, whose `execution` is `api-route`.
 * @param group - The stop's `afterOperation`.
 * @throws When the attribution, the operation index, `apiRoute`, `routeHandler` or `scope` contradicts that.
 * @example assertApiRouteObservation({ execution: 'api-route', attribution: 'after-operation', operationIndex: 2, apiRoute }, 2)
 */
function assertApiRouteObservation(
  observation: Observation,
  group: number,
): void {
  const { attribution, operationIndex, apiRoute, routeHandler, scope } =
    observation
  if (attribution !== 'after-operation' || group === 0)
    throw new Error(
      'An API-route observation is attributed after an operation.',
    )
  if (operationIndex !== group)
    throw new Error(
      'Configured observation operationIndex differs from its stop.',
    )
  if (
    apiRoute === undefined ||
    routeHandler !== undefined ||
    scope !== undefined
  )
    throw new Error(
      'An API-route observation needs an apiRoute and has no routeHandler or scope.',
    )
}

/**
 * Ties a format 8 observation's execution and attribution to the group of its stop: an entry-render stop (`afterOperation: 0`) is a page-load render, so only it reads `entry-load` and it carries no operation; a later stop's render is attributed to its own operation.
 * @param observation - The observation, whose `execution`, `declaredIndex` and `executionIndex` exist.
 * @param group - The stop's `afterOperation`.
 * @throws When the execution, the attribution or the operation index contradicts the group.
 * @example assertAttributionFitsGroup({ execution: 'server-render', attribution: 'entry-load' }, 0)
 */
function assertAttributionFitsGroup(
  observation: Observation,
  group: number,
): void {
  const { attribution, operationIndex, execution, scope } = observation
  if (attribution !== undefined && execution !== 'server-render')
    throw new Error('Only a server render observation has an attribution.')
  if (scope !== undefined && execution !== 'server-render')
    throw new Error('Only a server render observation has a scope.')
  if (execution !== 'server-render') {
    if (group === 0)
      throw new Error('Configured entry-render observation is not a render.')
    if (operationIndex !== undefined)
      throw new Error(
        'Configured observation operationIndex belongs to a server render only.',
      )
    return
  }
  if (attribution === undefined)
    throw new Error('A server render observation needs an attribution.')
  // Codebook's own preparation request runs before any operation, so only an entry-render stop can pause in it.
  if (
    (attribution === 'entry-load' || attribution === 'preparation') !==
      (group === 0) &&
    attribution !== 'unconfirmed'
  )
    throw new Error('Configured observation attribution differs from its stop.')
  // The operation is the stop's own; a page-load render has none.
  if (operationIndex !== (group === 0 ? undefined : group))
    throw new Error(
      'Configured observation operationIndex differs from its stop.',
    )
}

/**
 * Checks the `apiRequest` fact of a format 19 or 20 study (and its absence everywhere else): every server observation of such a study carries one, whose operation equals its stop's `afterOperation`, and whose source lies inside `apiServer.packageRoot`; a browser observation, and any observation of another format, carries none.
 * Called by {@link assertObservationFormatFields} for the studies that follow the format 8 rules.
 * @param study - The saved study, without its images.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @throws When `apiRequest` sits where its format or participant does not keep it, is missing, names another operation than its stop's, the source lies outside the API folder, or the fields only one of formats 19 and 20 keeps are wrong.
 * @example assertApiRequestFacts(study, configuredStops(study.configuration))
 */
function assertApiRequestFacts(
  study: Omit<ConfiguredStudy, 'captures'>,
  stops: ReturnType<typeof configuredStops>,
): void {
  const keepsApiRequest = isApiServerStudyFormat(study.version)
  const apiServer =
    study.configuration.version === OPERATIONS_CONFIG_VERSION
      ? study.configuration.apiServer
      : undefined
  for (const observation of study.observations) {
    if (!keepsApiRequest && observation.apiRequest !== undefined)
      throw new Error('Only a study of format 19 or 20 keeps an apiRequest.')
    if (study.version === EXPO_WEB_API_SERVER_STUDY_VERSION)
      assertFormat19Observation(observation, stops, apiServer)
    if (study.version === VITE_API_SERVER_STUDY_VERSION)
      assertFormat20Observation(observation, stops, apiServer)
  }
}

/**
 * Checks the part of an `apiRequest` fact every format that keeps one shares: a browser observation carries no `apiRequest`; a server observation carries one whose operation is its stop's own, and its stop lies inside `apiServer.packageRoot`.
 * Called by {@link assertFormat19Observation} and {@link assertFormat20Observation}, so the two formats cannot drift apart.
 * @param observation - The observation.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @param apiServer - The configuration's `apiServer` declaration, if any.
 * @param format - The study format number, used in the refusal sentences.
 * @returns The server observation's fact, or `undefined` for a browser observation.
 * @throws When the fact is missing, misplaced, names another operation than its stop's, or the stop lies outside the API folder.
 * @example assertApiRequestFactShape(observation, stops, { packageRoot: 'apps/api' }, 19)
 */
function assertApiRequestFactShape(
  observation: Observation,
  stops: ReturnType<typeof configuredStops>,
  apiServer: { packageRoot: string } | undefined,
  format: number,
): NonNullable<Observation['apiRequest']> | undefined {
  const { apiRequest } = observation
  if (observation.participant === 'browser') {
    if (apiRequest !== undefined)
      throw new Error('A browser observation has no apiRequest.')
    return undefined
  }
  const stop = stops[observation.declaredIndex ?? -1]
  if (apiRequest === undefined || apiServer === undefined)
    throw new Error(
      `A format ${format} server observation needs an apiRequest.`,
    )
  // The fact names the operation whose request reached the API, which is the stop's own.
  if (
    apiRequest.state === 'attributed' &&
    apiRequest.operation !== afterOperationOf(stop ?? {})
  )
    throw new Error('Configured apiRequest operation differs from its stop.')
  // The stop's file is the observation's source: the observation is matched to its stop by declaredIndex.
  if (
    stop === undefined ||
    !isRepositoryPathInFolder(apiServer.packageRoot, stop.source.path)
  )
    throw new Error(
      `A format ${format} server observation lies outside apiServer.packageRoot.`,
    )
  return apiRequest
}

/**
 * Checks one observation of a format 19 study: the shared shape of {@link assertApiRequestFactShape}, and none of the `route`, `proxyPath` and `watched` fields that only format 20 keeps.
 * Called by {@link assertApiRequestFacts}.
 * @param observation - The observation.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @param apiServer - The configuration's `apiServer` declaration, if any.
 * @throws When the fact is missing, misplaced, names another operation than its stop's, the stop lies outside the API folder, or a format 20 field is present.
 * @example assertFormat19Observation(observation, stops, { packageRoot: 'apps/api', entry: 'src/server.ts', port: 4100 })
 */
function assertFormat19Observation(
  observation: Observation,
  stops: ReturnType<typeof configuredStops>,
  apiServer: { packageRoot: string } | undefined,
): void {
  const apiRequest = assertApiRequestFactShape(
    observation,
    stops,
    apiServer,
    EXPO_WEB_API_SERVER_STUDY_VERSION,
  )
  // Expo's facts stay byte-identical to Cycle 0099: the proxy fields belong to format 20.
  if (
    apiRequest !== undefined &&
    ('route' in apiRequest ||
      'proxyPath' in apiRequest ||
      'watched' in apiRequest)
  )
    throw new Error(
      'A format 19 apiRequest has no route, proxyPath or watched; only format 20 keeps them.',
    )
}

/**
 * Checks one observation of a format 20 study: the shared shape of {@link assertApiRequestFactShape}, and the proxy fields of a `vite-dev` run. An attributed fact names its `route`; `proxyPath` is present exactly when the route is `dev-server-proxy` and then is one of the declared `apiServer.proxyPaths` (membership only: the stored path is masked and may not continue an unmasked prefix); an unattributed fact names what it `watched`.
 * Called by {@link assertApiRequestFacts}.
 * @param observation - The observation.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @param apiServer - The configuration's `apiServer` declaration, if any.
 * @throws When the shared shape fails or a proxy field is missing, misplaced or not a declared prefix.
 * @example assertFormat20Observation(observation, stops, { packageRoot: 'server', proxyPaths: ['/api'] })
 */
function assertFormat20Observation(
  observation: Observation,
  stops: ReturnType<typeof configuredStops>,
  apiServer: { packageRoot: string; proxyPaths?: string[] } | undefined,
): void {
  const apiRequest = assertApiRequestFactShape(
    observation,
    stops,
    apiServer,
    VITE_API_SERVER_STUDY_VERSION,
  )
  if (apiRequest === undefined) return
  // An unattributed fact says which ports and prefixes it watched.
  if (apiRequest.state === 'unattributed') {
    if (apiRequest.watched === undefined)
      throw new Error('A format 20 unattributed apiRequest needs watched.')
    return
  }
  if (apiRequest.route === undefined)
    throw new Error('A format 20 attributed apiRequest needs a route.')
  // `proxyPath` belongs to the proxy route alone.
  if (
    (apiRequest.route === 'dev-server-proxy') !==
    (apiRequest.proxyPath !== undefined)
  )
    throw new Error(
      'A format 20 apiRequest has a proxyPath exactly when its route is dev-server-proxy.',
    )
  // Membership only: the stored path is masked, so it need not continue an unmasked prefix.
  if (
    apiRequest.proxyPath !== undefined &&
    !(apiServer?.proxyPaths ?? []).includes(apiRequest.proxyPath)
  )
    throw new Error(
      'A format 20 apiRequest proxyPath is not one of apiServer.proxyPaths.',
    )
}

/**
 * Checks the fields that exist in one study format only: format 8 observations carry `execution`, `declaredIndex` and `executionIndex` (and the study may say `firstExecutionObserved: false`), format 7 and earlier carry none of them, so a format 7 study stays the strict 0.2.72.0 shape.
 * Called by {@link validateConfiguredStudyEvidence} before it matches observations to stops.
 * @param study - The saved study, without its images.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @throws When format 7 or earlier carries a format 8 field, or a format 8 observation breaks the rules of {@link assertFormat8Observation}.
 * @example assertObservationFormatFields(study, configuredStops(study.configuration))
 */
export function assertObservationFormatFields(
  study: Omit<ConfiguredStudy, 'captures'>,
  stops: ReturnType<typeof configuredStops>,
): void {
  if (!usesServerRenderEvidence(study)) {
    const hasNewField =
      study.firstExecutionObserved !== undefined ||
      study.observations.some(
        (observation) =>
          observation.scope !== undefined ||
          observation.apiRequest !== undefined ||
          observation.routeHandler !== undefined ||
          observation.apiRoute !== undefined ||
          observation.execution !== undefined ||
          observation.attribution !== undefined ||
          observation.operationIndex !== undefined ||
          observation.declaredIndex !== undefined ||
          observation.executionIndex !== undefined,
      )
    if (hasNewField)
      throw new Error('Only a study of format 8 keeps execution fields.')
    return
  }
  assertFormatHoldsItsFields(study)
  assertApiRequestFacts(study, stops)
  const seenStops = new Set<number>()
  for (const [position, observation] of study.observations.entries())
    assertFormat8Observation(observation, position, stops, seenStops)
}

/**
 * Pairs a format 12, 13 or 14 study with the fields only it keeps (a format 18, 19 or 20 study, which may hold any of them, is exempt): format 12 is written only for a study that holds a module-evaluation or preparation observation, format 13 only for one that holds a route-handler observation (and keeps format 12's fields too), format 14 only for one that holds an API-route observation (and keeps the fields of 12 and 13).
 * Called by {@link assertObservationFormatFields}.
 * @param study - The saved study, without its images; it follows the format 8 rules.
 * @throws When a field sits in a format that does not keep it, or a format holds none of its fields.
 * @example assertFormatHoldsItsFields(study)
 */
function assertFormatHoldsItsFields(
  study: Omit<ConfiguredStudy, 'captures'>,
): void {
  const holdsModuleEvaluation = study.observations.some(
    isModuleEvaluationObservation,
  )
  const holdsRouteHandler = study.observations.some(isRouteHandlerObservation)
  const holdsApiRoute = study.observations.some(isApiRouteObservation)
  // Format 18 (`next-dev-webpack` with `library`) holds the fields of formats 12 to 14 itself and moves to none of them, so it may hold any of them or none.
  if (
    study.version === NEXT_LIBRARY_STUDY_VERSION ||
    isApiServerStudyFormat(study.version)
  )
    return
  // The scope and the preparation attribution belong to formats 12 to 14.
  if (
    holdsModuleEvaluation &&
    study.version !== MODULE_EVALUATION_STUDY_VERSION &&
    study.version !== ROUTE_HANDLER_STUDY_VERSION &&
    study.version !== API_ROUTE_STUDY_VERSION
  )
    throw new Error(
      'Only a study of format 12 keeps a module scope or a preparation attribution.',
    )
  if (
    study.version === MODULE_EVALUATION_STUDY_VERSION &&
    !holdsModuleEvaluation
  )
    throw new Error(
      'A study of format 12 holds a module-evaluation or preparation observation.',
    )
  // An API-route observation makes the study format 14, and format 14 is written only for one that holds it.
  if (holdsApiRoute !== (study.version === API_ROUTE_STUDY_VERSION))
    throw new Error(
      holdsApiRoute
        ? 'Only a study of format 14 keeps an API-route observation.'
        : 'A study of format 14 holds an API-route observation.',
    )
  // A route-handler observation makes the study format 13 (or 14 beside an API-route one); format 13 is written only for a study that holds one and none of the API route.
  if (
    holdsRouteHandler &&
    study.version !== ROUTE_HANDLER_STUDY_VERSION &&
    study.version !== API_ROUTE_STUDY_VERSION
  )
    throw new Error(
      'Only a study of format 13 keeps a route-handler observation.',
    )
  if (
    study.version === ROUTE_HANDLER_STUDY_VERSION &&
    (!holdsRouteHandler || holdsApiRoute)
  )
    throw new Error('A study of format 13 holds a route-handler observation.')
}
