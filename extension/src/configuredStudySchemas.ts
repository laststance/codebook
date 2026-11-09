import { z } from 'zod'

import { citationContextSchema } from './citationSchemas'
import {
  API_REQUEST_COUNT_LIMIT,
  API_REQUEST_METHOD_LIMIT_CHARS,
  API_REQUEST_METHOD_TOKEN_PATTERN,
  API_REQUEST_PATH_LIMIT_CHARS,
  API_REQUEST_SEVERAL_MIN_COUNT,
  BOOK_MAX_ANCHORS,
  CONFIGURED_CAPTURE_PHASES,
  CROSS_RUNTIME_CAPTURE_PHASES,
  CROSS_RUNTIME_STUDY_VERSION,
  RECORDED_LOCATION_STUDY_VERSION,
  VITE_STUDY_VERSION,
  CONFIGURED_OBSERVATION_LIMIT,
  CONFIGURED_STUDY_VERSION,
  KEY_LENGTH_LIMIT,
  MAX_EXPLANATIONS,
  OPERATIONS_STUDY_VERSION,
  PACKAGE_ROOT_STUDY_VERSION,
  PRESS_STUDY_VERSION,
  REVERSE_PROXY_STUDY_VERSION,
  MODULE_EVALUATION_STUDY_VERSION,
  ROUTE_HANDLER_STUDY_VERSION,
  API_ROUTE_STUDY_VERSION,
  EXPO_VERSION_MAX_CHARS,
  EXPO_WEB_API_SERVER_STUDY_VERSION,
  VITE_API_SERVER_STUDY_VERSION,
  EXPO_WEB_STUDY_VERSION,
  NEXT_LIBRARY_STUDY_VERSION,
  REACT_SCRIPTS_LIBRARY_STUDY_VERSION,
  REACT_SCRIPTS_STUDY_VERSION,
  VITE_LIBRARY_STUDY_VERSION,
  VITE_PACKAGE_ROOT_STUDY_VERSION,
  SERVER_RENDER_STUDY_VERSION,
  REPOSITORY_OPERATION_LIMIT,
  MAX_UI_TEXT_CHARS,
  REFERENCE_LENGTH_LIMIT,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_LITERAL_LIMIT_CHARS,
  API_PROXY_PATHS_MAX_ENTRIES,
  API_PROXY_PATH_MAX_CHARS,
  OPERATION_KINDS,
} from './constants'
import { repositoryItemSchema } from './identitySchemas'
import { savedLearningSummarySchema } from './learningSummarySchemas'
import { sourceSchema, studyIdSchema } from './legacyStudySchemas'
import { libraryRunFactsSchema } from './libraryRunFactsSchema'
import { replayDebugSnapshotSchema } from './replayDebugSchemas'
import {
  inspectionPathSchema,
  studyConfigurationSchema,
} from './repositoryConfigSchemas'
import {
  bookDocumentSchema,
  bookNodeSchema,
  repositorySourceSchema,
} from './repositorySchemas'
import { bookAnchorSchema, repositoryHashSchema } from './sourceSchemas'
import { capturedImageSchema, selectionSchema } from './studySchemas'

const shortText = z.string().min(1).max(REFERENCE_LENGTH_LIMIT)
export const configuredPauseSchema = z.strictObject({
  sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT),
  threadId: z.number().int().nonnegative(),
  generation: z.number().int().positive(),
})
export const configuredFactPathSchema = z.string().refine((value) => {
  const [mode, path, extra] = value.split(':')
  return (
    (mode === 'value' || mode === 'type') &&
    extra === undefined &&
    inspectionPathSchema.safeParse(path).success
  )
}, 'Use a declared value:<path> or type:<path> inspection.')
// JSON preserves this marker as observed undefined, distinct from missing facts and the literal string.
export const configuredFactValueSchema = z.union([
  z.string().max(REPOSITORY_LITERAL_LIMIT_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
  // Markers for a value that is not a bounded primitive: undefined itself, and an object or function whose members are not captured.
  z.strictObject({ type: z.enum(['undefined', 'object', 'function']) }),
])
export const configuredDescriptorSchema = z.strictObject({
  itemId: repositoryItemSchema,
  bookTitle: bookDocumentSchema.shape.title,
  nodeTitle: bookNodeSchema.shape.title,
  anchors: z.array(bookAnchorSchema).min(1).max(BOOK_MAX_ANCHORS),
  citationContext: citationContextSchema,
  sources: z.array(repositorySourceSchema).min(1).max(BOOK_MAX_ANCHORS),
})
/** Which path a request took to the API: straight to its origin, or through the dev server under a declared prefix. */
const apiRequestRouteSchema = z.enum(['api-origin', 'dev-server-proxy'])
/** A declared `apiServer.proxyPaths` prefix as an `apiRequest` fact keeps it. */
const apiRequestProxyPathSchema = z
  .string()
  .min(1)
  .max(API_PROXY_PATH_MAX_CHARS)
  .regex(
    /^\/[^?#*]*$/,
    'Use a prefix that starts with "/" and has no "*", "?" or "#".',
  )
  // A control character would reach the saved text and sentences.
  .refine((value) => !/\p{Cc}/u.test(value), {
    message: 'Use a prefix without control characters.',
  })
/**
 * What an unattributed fact of a proxy-aware run watched: ports and declared prefixes only, never host strings.
 * `devServerPort` is present only when `proxyPaths` is not empty.
 */
const apiRequestWatchedSchema = z
  .strictObject({
    apiPort: z.number().int().min(1).max(65_535),
    devServerPort: z.number().int().min(1).max(65_535).optional(),
    proxyPaths: z
      .array(apiRequestProxyPathSchema)
      .max(API_PROXY_PATHS_MAX_ENTRIES),
  })
  // A dev server port names the proxy route, so it only goes with declared prefixes.
  .refine(
    (watched) =>
      watched.devServerPort === undefined || watched.proxyPaths.length > 0,
    { message: 'devServerPort is kept only with a non-empty proxyPaths.' },
  )
export type ApiRequestWatched = z.infer<typeof apiRequestWatchedSchema>

/**
 * The request a format 19 server pause was tied to: the one page request the API was serving when it paused (`attributed`, matched by time), or the reason no single request could be named (`unattributed`: none or several candidates).
 * Why it exists: a server stop in the app's own API pauses during a request the page sent, and the replay must say which request, or say that none could be named, without claiming a request it did not observe.
 * Read by {@link configuredObservationSchema}; the cross-field rules (operation equals the stop's `afterOperation`, format 19 server observations only) are checked by `assertObservationFormatFields`. Built by the run's request attribution.
 * @example
 * apiRequestFactSchema.parse({ state: 'attributed', method: 'POST', path: '/api/orders', operation: 2, basis: 'time-window', sentence: '…' })
 */
const apiRequestFactSchema = z.union([
  z.strictObject({
    state: z.literal('attributed'),
    method: z
      .string()
      .max(API_REQUEST_METHOD_LIMIT_CHARS)
      .regex(
        API_REQUEST_METHOD_TOKEN_PATTERN,
        'Use an upper-case HTTP method token.',
      ),
    path: z
      .string()
      .max(API_REQUEST_PATH_LIMIT_CHARS)
      .regex(
        /^\/[^?#]*$/,
        'Use a request path that starts with "/" and has no query or fragment.',
      )
      // Control characters never belong in a request path.
      .regex(
        /^[^\u0000-\u001F\u007F]*$/,
        'Use a request path without control characters.',
      ),
    operation: z.number().int().min(1).max(REPOSITORY_OPERATION_LIMIT),
    basis: z.literal('time-window'),
    sentence: z.string().min(1).max(MAX_UI_TEXT_CHARS),
    // Proxy-aware (`vite-dev`) runs only; which format admits them is checked by `assertObservationFormatFields`.
    route: apiRequestRouteSchema.optional(),
    proxyPath: apiRequestProxyPathSchema.optional(),
  }),
  z
    .strictObject({
      state: z.literal('unattributed'),
      reason: z.enum(['none', 'several']),
      count: z.number().int().nonnegative().max(API_REQUEST_COUNT_LIMIT),
      sentence: z.string().min(1).max(MAX_UI_TEXT_CHARS),
      watched: apiRequestWatchedSchema.optional(),
    })
    // `none` counts no candidate; `several` counts at least two (one candidate is attributed).
    .refine(
      (fact) =>
        fact.reason === 'none'
          ? fact.count === 0
          : fact.count >= API_REQUEST_SEVERAL_MIN_COUNT,
      'Use count 0 for reason none and a count of at least 2 for reason several.',
    ),
])
export type ApiRequestFact = z.infer<typeof apiRequestFactSchema>
export const configuredObservationSchema = z.strictObject({
  id: shortText,
  itemId: repositoryItemSchema,
  actionId: z.literal(REPOSITORY_BROWSER_ACTION),
  capturePhase: z.enum(['paused-browser', 'paused-server']),
  snapshotUri: shortText,
  participant: z.enum(['browser', 'server']),
  // Format 8 only (checked by validateConfiguredStudyEvidence, which refuses them in format 7 and requires `execution`, `declaredIndex` and `executionIndex` in format 8): where the paused code runs, why a server render ran, and the stop's place in the declared list and in the order the run paused.
  // `route-handler` and `routeHandler` exist in format 13 only (checked by assertObservationFormatFields): a pause in an App Router route handler's function, observed after an operation.
  execution: z
    .enum([
      'browser',
      'server-action',
      'server-render',
      'route-handler',
      'api-route',
    ])
    .optional(),
  routeHandler: z
    .strictObject({
      method: shortText,
      route: shortText,
      path: shortText,
    })
    .optional(),
  // `api-route` and `apiRoute` exist in format 14 only (checked by assertObservationFormatFields): a pause in a Pages API route's handler, observed after an operation.
  apiRoute: z
    .strictObject({
      method: shortText,
      route: shortText,
      path: shortText,
    })
    .optional(),
  // `preparation` and `scope` exist in format 12 only (checked by assertObservationFormatFields): a pause in Codebook's own preparation request, and a pause inside a module's evaluation.
  attribution: z
    .enum(['entry-load', 'after-operation', 'unconfirmed', 'preparation'])
    .optional(),
  scope: z.literal('module').optional(),
  // Format 19 only (checked by assertObservationFormatFields): on every server observation of an `expo-web-dev` run that declared `apiServer`, the page request the API pause was tied to, or why none was.
  apiRequest: apiRequestFactSchema.optional(),
  operationIndex: z
    .number()
    .int()
    .min(1)
    .max(REPOSITORY_OPERATION_LIMIT)
    .optional(),
  declaredIndex: z.number().int().nonnegative().optional(),
  executionIndex: z.number().int().nonnegative().optional(),
  capturedAt: z.iso.datetime(),
  elapsedMs: z.number().finite().nonnegative(),
  pause: configuredPauseSchema,
  source: sourceSchema.extend({
    column: z.number().int().positive(),
    javascriptHash: repositoryHashSchema,
    mapHash: repositoryHashSchema,
    scriptId: shortText,
    scriptUrl: shortText,
    generated: z.strictObject({
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    }),
    // The run's receipt that its binding rule held when it committed the stop: no line between the two had a mapped position or, once the run had read the debugger's break locations, a break location between the two generated places of the request and the binding (`mappedLinesBetween` stays 0 in both cases). A saved study has no sealed map to repeat that check with; studies saved by 0.2.27 and older carry none.
    binding: z
      .strictObject({
        declaredLine: z.number().int().positive(),
        // Present only for a stop declared on a line without a mapped position: the first mapped line after it, where its breakpoint was requested and from which the rule was measured.
        requestedLine: z.number().int().positive().optional(),
        boundLine: z.number().int().positive(),
        mappedLinesBetween: z.literal(0),
      })
      .optional(),
  }),
  values: z.record(configuredFactPathSchema, configuredFactValueSchema),
  debugger: replayDebugSnapshotSchema.optional(),
  unavailableValues: z
    .array(
      z.strictObject({
        path: configuredFactPathSchema,
        reason: z.string().min(1).max(MAX_UI_TEXT_CHARS),
      }),
    )
    .max(REPOSITORY_INSPECTION_LIMIT),
  interpretations: z
    .array(
      z.strictObject({
        id: z.uuid(),
        text: z.string().max(MAX_UI_TEXT_CHARS),
        createdAt: z.iso.datetime(),
        facts: z
          .array(
            z.strictObject({
              path: configuredFactPathSchema,
              value: configuredFactValueSchema,
            }),
          )
          .min(1)
          .max(REPOSITORY_INSPECTION_LIMIT),
      }),
    )
    .max(MAX_EXPLANATIONS),
})
/**
 * One declared operation of a version 3 run as the saved study keeps it: its progress when the run ended or was last saved, and the recording-clock time its input was sent.
 * Absent `atMs` means the operation was never sent. A saved study of a stopped or failed run keeps the states it had (`done`, `failed`, `not-run`), so it replays as a partial run.
 */
const configuredOperationRecordSchema = z.strictObject({
  /** 1-based, as in `afterOperation` and every receipt. */
  index: z.number().int().min(1).max(REPOSITORY_OPERATION_LIMIT),
  kind: z.enum(OPERATION_KINDS),
  title: shortText,
  /** Milliseconds on the recording clock at which the operation's input was sent; absent for an operation that was never sent. */
  atMs: z.number().finite().nonnegative().optional(),
  state: z.enum(['not-run', 'sending', 'paused', 'done', 'failed']),
  ack: z.enum(['pending', 'yes']),
  valueCheck: z.enum(['pending', 'passed', 'failed', 'n/a']),
  effect: z.enum(['pending', 'dispatched', 'after-verified']),
})
const configuredPhaseSchema = z.enum(CROSS_RUNTIME_CAPTURE_PHASES)
export const configuredImageSchema = z.discriminatedUnion('status', [
  capturedImageSchema.options[0].extend({
    phase: configuredPhaseSchema,
    snapshotId: shortText.optional(),
  }),
  capturedImageSchema.options[1].extend({
    phase: configuredPhaseSchema,
    snapshotId: shortText.optional(),
  }),
])
export const configuredStudySchema = z.strictObject({
  version: z.union([
    z.literal(CONFIGURED_STUDY_VERSION),
    z.literal(CROSS_RUNTIME_STUDY_VERSION),
    z.literal(VITE_STUDY_VERSION),
    z.literal(RECORDED_LOCATION_STUDY_VERSION),
    z.literal(OPERATIONS_STUDY_VERSION),
    z.literal(SERVER_RENDER_STUDY_VERSION),
    z.literal(PACKAGE_ROOT_STUDY_VERSION),
    z.literal(VITE_PACKAGE_ROOT_STUDY_VERSION),
    z.literal(REACT_SCRIPTS_STUDY_VERSION),
    z.literal(MODULE_EVALUATION_STUDY_VERSION),
    z.literal(ROUTE_HANDLER_STUDY_VERSION),
    z.literal(API_ROUTE_STUDY_VERSION),
    z.literal(EXPO_WEB_STUDY_VERSION),
    z.literal(VITE_LIBRARY_STUDY_VERSION),
    z.literal(REACT_SCRIPTS_LIBRARY_STUDY_VERSION),
    z.literal(NEXT_LIBRARY_STUDY_VERSION),
    z.literal(EXPO_WEB_API_SERVER_STUDY_VERSION),
    z.literal(VITE_API_SERVER_STUDY_VERSION),
    z.literal(PRESS_STUDY_VERSION),
    z.literal(REVERSE_PROXY_STUDY_VERSION),
  ]),
  workspaceKey: repositoryHashSchema,
  id: studyIdSchema,
  instanceId: z.uuid(),
  runId: z.uuid(),
  profile: z.literal(REPOSITORY_BROWSER_PROFILE),
  createdAt: z.iso.datetime(),
  savedAt: z.iso.datetime(),
  state: shortText,
  terminal: z.boolean(),
  finalOutcome: z.enum([
    'pending-teardown',
    'demonstrated',
    'not-demonstrated',
    'partial',
  ]),
  reason: z.string().max(MAX_UI_TEXT_CHARS).optional(),
  materialSignature: repositoryHashSchema,
  // Formats 3 to 8 hold a retained configuration; formats 9, 10 and 11 hold the package-root variants (format 9 Next, format 10 Vite, format 11 react-scripts). The pairing is checked by validateConfiguredStudyEvidence.
  configuration: studyConfigurationSchema,
  configurationHash: repositoryHashSchema,
  descriptor: configuredDescriptorSchema.optional(),
  // The Vite version a `vite-dev` run started on (read from the resolved `vite/package.json`); a Next study has none.
  viteVersion: z.string().min(1).max(64).optional(),
  // The Expo SDK version an `expo-web-dev` run started on (read from the resolved `expo/package.json`, format 15 only); other studies have none.
  expoVersion: z.string().min(1).max(EXPO_VERSION_MAX_CHARS).optional(),
  // The library facts of a `vite-dev`, `react-scripts-dev` or `next-dev-webpack` run that declared `library` (formats 16, 17 and 18 only, checked by validateConfiguredStudyEvidence); every other study has none.
  library: libraryRunFactsSchema.optional(),
  operation: z
    .strictObject({
      id: z.uuid(),
      key: z.string().min(1).max(KEY_LENGTH_LIMIT),
      inputDispatched: z.boolean(),
      inputAcknowledged: z.boolean(),
      continuedPause: configuredPauseSchema.optional(),
      afterVerified: z.boolean(),
    })
    .optional(),
  // Present on a study saved from a version 3 configuration: every declared operation in order, with the final state of each.
  operations: z
    .array(configuredOperationRecordSchema)
    .min(1)
    .max(REPOSITORY_OPERATION_LIMIT)
    .optional(),
  learningSummary: savedLearningSummarySchema.optional(),
  // Format 8 only: present (and false) when the configuration has a server stop, so the replay can say the first execution of the page was not observed.
  firstExecutionObserved: z.literal(false).optional(),
  observations: z
    .array(configuredObservationSchema)
    .max(CONFIGURED_OBSERVATION_LIMIT),
  captures: z
    .array(configuredImageSchema)
    .max(CONFIGURED_CAPTURE_PHASES.length - 1 + CONFIGURED_OBSERVATION_LIMIT),
  // Chronological stops alone do not prove a cross-runtime causal link.
  links: z.array(z.never()).max(0),
})
export const configuredStudyMetadataSchema = configuredStudySchema
  .pick({
    version: true,
    workspaceKey: true,
    id: true,
    profile: true,
    createdAt: true,
    savedAt: true,
    state: true,
    terminal: true,
    finalOutcome: true,
    materialSignature: true,
  })
  .extend({
    archive: z.strictObject({
      byteLength: z.number().int().positive(),
      modifiedMs: z.number().nonnegative(),
      hash: repositoryHashSchema,
    }),
  })
export const configuredSelectionSchema = z.strictObject({
  ...selectionSchema.shape,
  studyId: studyIdSchema.optional(),
  profile: z.literal(REPOSITORY_BROWSER_PROFILE),
  itemId: repositoryItemSchema,
})
export const configuredDefinitionSchema = configuredStudySchema
  .pick({ configuration: true, configurationHash: true, descriptor: true })
  .extend({ descriptor: configuredDescriptorSchema })
export type ConfiguredOperationRecord = z.infer<
  typeof configuredOperationRecordSchema
>
export type ConfiguredStudy = z.infer<typeof configuredStudySchema>
export type ConfiguredObservation = z.infer<typeof configuredObservationSchema>
export type ConfiguredDescriptor = z.infer<typeof configuredDescriptorSchema>
export type ConfiguredFactValue = z.infer<typeof configuredFactValueSchema>
export type ConfiguredDefinition = z.infer<typeof configuredDefinitionSchema>
