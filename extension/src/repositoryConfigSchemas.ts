import { z } from 'zod'

import { apiServerDeclarationSchema } from './apiServerDeclarationSchema'
import {
  ASK_LEARNER_SECRET,
  CONFIGURED_OBSERVATION_LIMIT,
  EXPO_WEB_API_SERVER_MINIMUM_API,
  CROSS_RUNTIME_CONFIG_VERSION,
  OPERATIONS_CONFIG_VERSION,
  OPERATIONS_REPOSITORY_BROWSER_ADAPTERS,
  REPOSITORY_BROWSER_ADAPTERS,
  REPOSITORY_OPERATION_LIMIT,
  VITE_API_SERVER_MINIMUM_API,
  SIGN_IN_PATH_LIMIT,
  BOOK_MAX_ANCHORS,
  BOOK_TITLE_LIMIT_CHARS,
  REPOSITORY_ATTRIBUTE_LIMIT_CHARS,
  REPOSITORY_CONDITION_LIMIT,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_CONFIG_VERSION,
  REPOSITORY_FORBIDDEN_INSPECTION_SEGMENTS,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_INSPECTION_PATH_LIMIT_CHARS,
  REPOSITORY_INSPECTION_SEGMENT_LIMIT,
  REPOSITORY_LITERAL_LIMIT_CHARS,
  REPOSITORY_RESERVED_INSPECTION_ROOTS,
  REPOSITORY_SELECTOR_LIMIT_CHARS,
  REPOSITORY_STORAGE_ENTRY_LIMIT,
  REPOSITORY_STORAGE_KEY_LIMIT_CHARS,
  REPOSITORY_STORAGE_LIMIT_BYTES,
  REPOSITORY_STORAGE_VALUE_LIMIT_CHARS,
  REPOSITORY_ENTRY_PATH_LIMIT_CHARS,
  REPOSITORY_INPUT_LIMIT,
  SELF_DECLARED_BINDING_HELP,
} from './constants'
import { bookIdSchema } from './identitySchemas'
import { libraryDeclarationSchema } from './libraryDeclarationSchema'
import { repositoryHashSchema, repositoryPathSchema } from './sourceSchemas'
import { isRepositoryPathInFolder } from './utils/isRepositoryPathInFolder'
import { missingValueInspectionMessage } from './utils/missingValueInspectionMessage'
import { normalizedSignInPathname } from './utils/normalizedSignInPathname'
import { proxyPathIssueOf } from './utils/proxyPathIssueOf'

/** A CSS selector as every profile declares one: 1 to the selector limit, no control characters. */
export const selectorSchema = z
  .string()
  .min(1)
  .max(REPOSITORY_SELECTOR_LIMIT_CHARS)
  .regex(/^[^\x00-\x1f\x7f]+$/)
/** A literal text value (an input's text, an expected value) up to the literal limit. */
const literalSchema = z.string().max(REPOSITORY_LITERAL_LIMIT_CHARS)
export const repositoryEntryPathSchema = z
  .string()
  .min(1)
  .max(REPOSITORY_ENTRY_PATH_LIMIT_CHARS)
  .refine((value) => {
    if (
      !value.startsWith('/') ||
      value.startsWith('//') ||
      /[\\#\u0000-\u0020\u007f]/.test(value)
    )
      return false
    try {
      const segments = value.split('?')[0]!.split('/').map(decodeURIComponent)
      return segments.every(
        (segment) =>
          segment !== '.' &&
          segment !== '..' &&
          !/[\\/\u0000-\u001f\u007f]/.test(segment),
      )
    } catch {
      return false
    }
  }, 'Use a same-origin absolute path without traversal, fragments or encoded separators.')
/**
 * One sign-in route of a version 3 configuration: a same-origin absolute path without a query, compared with the page's `location.pathname`.
 * Read by {@link operationsConfigurationShape}'s `signInPaths`; the saved-session store keeps the last declared paths for its setup.
 * @example signInPathSchema.parse('/login') // '/login'
 */
export const signInPathSchema = repositoryEntryPathSchema.refine(
  (value) => !value.includes('?'),
  'A sign-in path is compared with location.pathname: leave out the query.',
)
const reservedRoots = new Set<string>(REPOSITORY_RESERVED_INSPECTION_ROOTS)
const forbiddenSegments = new Set<string>(
  REPOSITORY_FORBIDDEN_INSPECTION_SEGMENTS,
)

// Only bounded property reads can become generated debugger expressions; no caller supplies executable code.
export const inspectionPathSchema = z
  .string()
  .min(1)
  .max(REPOSITORY_INSPECTION_PATH_LIMIT_CHARS)
  .regex(/^[A-Za-z_$][A-Za-z\d_$]*(?:\.[A-Za-z_$][A-Za-z\d_$]*)*$/)
  .refine((path) => {
    const segments = path.split('.')
    return (
      segments.length <= REPOSITORY_INSPECTION_SEGMENT_LIMIT &&
      !reservedRoots.has(segments[0]!) &&
      segments.every((segment) => !forbiddenSegments.has(segment))
    )
  }, `Use up to ${REPOSITORY_INSPECTION_SEGMENT_LIMIT} identifier segments without reserved roots or prototype access.`)
const repositoryInspectionSchema = z.strictObject({
  path: inspectionPathSchema,
  mode: z.enum(['value', 'type']),
  required: z.boolean(),
})
/** The rule every stop's inspections follow, said where an agent reads last before it declares a run: the description of each `inspections` field in the input schema of `codebook_start`, for both profiles, each followed by what that profile does with a binding the stop's own line declares. */
const INSPECTIONS_RULE =
  'Every stop needs at least one inspection with mode "value" and required true, of a primitive the stop can read (for an object, one of its members); type inspections may be added beside it, and a stop cannot consist of type inspections only.'
/** The inspection rule of a repository-browser stop, which Codebook requests after its own line when that line declares a binding the stop requires ({@link ConfiguredBrowserRun}). */
const INSPECTIONS_RULE_DESCRIPTION = `${INSPECTIONS_RULE} ${SELF_DECLARED_BINDING_HELP}`
/** The inspections of one declared repository-browser stop, described with {@link INSPECTIONS_RULE_DESCRIPTION}; every `inspections` field of that profile is this schema. */
const stopInspectionsSchema = z
  .array(repositoryInspectionSchema)
  .min(1)
  .max(REPOSITORY_INSPECTION_LIMIT)
  .describe(INSPECTIONS_RULE_DESCRIPTION)
/** The inspections of one node-test stop: the same schema, described with the rule for a stop Codebook requests where it was declared; every `inspections` field of that profile is this schema. */
export const nodeTestStopInspectionsSchema = stopInspectionsSchema.describe(
  `${INSPECTIONS_RULE} A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; require a value that already exists before that line, or declare the stop on a later line.`,
)
export const repositoryConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('visible'), selector: selectorSchema }),
  z.strictObject({
    kind: z.literal('text'),
    selector: selectorSchema,
    equals: literalSchema,
  }),
  z.strictObject({
    kind: z.literal('attribute'),
    selector: selectorSchema,
    attribute: z
      .string()
      .min(1)
      .max(REPOSITORY_ATTRIBUTE_LIMIT_CHARS)
      .regex(/^[A-Za-z_][A-Za-z\d_.:-]*$/),
    equals: literalSchema.nullable(),
  }),
])
/** Where a page failure is: a declared condition by its index, or the click target when absent. */
const conditionIndexSchema = z.number().int().nonnegative().optional()
/** How many elements a text condition's selector matched when it matched several; one element is the ordinary case and is not reported. */
const severalElementsSchema = z.number().int().min(2)
/**
 * What the owned page reports for the declared DOM condition or click target that does not hold, read by {@link ConfiguredBrowserRun} and handed to {@link configuredConditionHint}.
 * `textDifference` is a relation to the declared literal, never page text, and only a text mismatch may carry it; `matchedElements` counts the elements a text condition's selector matched when it matched several and none of them reads the expected text; `candidates` holds counts of the page's controls, never their text, and only a missing click target may carry it. Any other key or value fails the read instead of being dropped.
 */
export const configuredDomFailureSchema = z.union([
  z.strictObject({
    conditionIndex: conditionIndexSchema,
    reason: z.literal('text-mismatch'),
    textDifference: z.literal('surrounding-text').optional(),
    matchedElements: severalElementsSchema.optional(),
  }),
  z.strictObject({
    conditionIndex: conditionIndexSchema,
    reason: z.literal('click-target-missing'),
    // How many controls the page holds, as counts only; absent in a page answer that predates it.
    candidates: z
      .strictObject({
        button: z.number().int().nonnegative(),
        link: z.number().int().nonnegative(),
        field: z.number().int().nonnegative(),
      })
      .optional(),
  }),
  z.strictObject({
    conditionIndex: conditionIndexSchema,
    reason: z.enum([
      'invalid-selector',
      'selector-missing',
      'selector-not-unique',
      'not-visible',
      'attribute-mismatch',
      'click-target-not-unique',
      'click-target-not-visible',
      'click-target-disabled',
      'click-target-obscured',
    ]),
  }),
])
/**
 * What the owned page reports, with a read whose conditions hold, for each text condition that held on one of several elements its selector matched, as counts only; read by {@link ConfiguredBrowserRun}, which journals it.
 */
export const configuredTextReadingsSchema = z
  .array(
    z.strictObject({
      conditionIndex: z.number().int().nonnegative(),
      matchedElements: severalElementsSchema,
      readingElements: z.number().int().positive(),
    }),
  )
  .max(REPOSITORY_CONDITION_LIMIT)
const conditionsSchema = z
  .array(repositoryConditionSchema)
  .min(1)
  .max(REPOSITORY_CONDITION_LIMIT)
const storageSchema = z
  .array(
    z.strictObject({
      key: z.string().min(1).max(REPOSITORY_STORAGE_KEY_LIMIT_CHARS),
      value: z.string().max(REPOSITORY_STORAGE_VALUE_LIMIT_CHARS),
    }),
  )
  .max(REPOSITORY_STORAGE_ENTRY_LIMIT)
  .superRefine((entries, context) => {
    // Duplicate keys make initialization order part of intent and are rejected rather than overwritten.
    if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
      context.addIssue({
        code: 'custom',
        message: 'Initial storage keys must be unique.',
      })
    if (
      Buffer.byteLength(JSON.stringify(entries)) >
      REPOSITORY_STORAGE_LIMIT_BYTES
    )
      context.addIssue({
        code: 'custom',
        message: `Initial storage exceeds ${REPOSITORY_STORAGE_LIMIT_BYTES} bytes.`,
      })
  })

export const repositoryBookSelectionSchema = z.strictObject({
  bookId: bookIdSchema,
  revision: z.number().int().positive(),
  nodeId: bookIdSchema,
  anchorIndex: z
    .number()
    .int()
    .nonnegative()
    .max(BOOK_MAX_ANCHORS - 1),
})
export const repositorySourceStopSchema = z.strictObject({
  path: repositoryPathSchema,
  hash: repositoryHashSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
})

/** Text inserted into elements before an action: up to the input limit, each selector once. Shared by repository-browser's `initialInputs` and a chrome-extension click's `inputs`. */
export const repositoryInputsSchema = z
  .array(z.strictObject({ selector: selectorSchema, text: literalSchema }))
  .max(REPOSITORY_INPUT_LIMIT)
  .refine(
    (inputs) =>
      new Set(inputs.map((input) => input.selector)).size === inputs.length,
    'Input selectors must be distinct.',
  )

const repositoryConfigurationShape = z.strictObject({
  version: z.literal(REPOSITORY_CONFIG_VERSION),
  adapter: z.enum(REPOSITORY_BROWSER_ADAPTERS),
  book: repositoryBookSelectionSchema,
  source: repositorySourceStopSchema,
  action: z.strictObject({
    title: z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS),
    selector: selectorSchema,
    before: conditionsSchema,
    after: conditionsSchema,
  }),
  inspections: stopInspectionsSchema,
  additionalStops: z
    .array(
      z.strictObject({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
        inspections: stopInspectionsSchema,
      }),
    )
    .max(CONFIGURED_OBSERVATION_LIMIT - 1)
    .optional(),
  entryPath: repositoryEntryPathSchema.optional(),
  initialInputs: repositoryInputsSchema.optional(),
  initialStorage: storageSchema.optional(),
})

const crossRuntimeConfigurationShape = repositoryConfigurationShape.extend({
  version: z.literal(CROSS_RUNTIME_CONFIG_VERSION),
  participant: z.enum(['browser', 'server']),
  additionalStops: z
    .array(
      z.strictObject({
        participant: z.enum(['browser', 'server']),
        source: repositoryConfigurationShape.shape.source,
        anchorIndex: repositoryConfigurationShape.shape.book.shape.anchorIndex,
        inspections: repositoryConfigurationShape.shape.inspections,
      }),
    )
    .max(CONFIGURED_OBSERVATION_LIMIT - 1)
    .optional(),
})

/** The optional conditions that prove one operation took effect; the run-level `after` takes this place for the last operation that declares none. */
const operationAfterSchema = { after: conditionsSchema.optional() }
/** The title every operation carries: 1 to the book title limit, distinct within a run. */
const operationTitleSchema = z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS)
/**
 * One declared operation of a version 3 run: `text` into a text-like or number input (its `text`, or `secret: "ask-learner"` for a secret control, never both), `choose` an option of a native single `<select>`, or `click` a unique visible enabled target.
 * Read by {@link operationsConfigurationShape}; {@link ConfiguredBrowserRun} sends each one through its own `repository-operation` action.
 */
const repositoryOperationSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('text'),
      title: operationTitleSchema,
      selector: selectorSchema,
      text: literalSchema.optional(),
      secret: z.literal(ASK_LEARNER_SECRET).optional(),
      ...operationAfterSchema,
    })
    .refine(
      (operation) =>
        (operation.text === undefined) !== (operation.secret === undefined),
      'A text operation declares exactly one of text and secret: "ask-learner".',
    ),
  z.strictObject({
    kind: z.literal('choose'),
    title: operationTitleSchema,
    selector: selectorSchema,
    value: literalSchema,
    ...operationAfterSchema,
  }),
  z.strictObject({
    kind: z.literal('click'),
    title: operationTitleSchema,
    selector: selectorSchema,
    ...operationAfterSchema,
  }),
])
/** The stop-to-operation link every stop of a version 3 run declares: the 1-based operation after whose input the stop is armed, or 0 for the entry render (server stops only; {@link validateOperations} refuses 0 on a browser stop). */
const afterOperationSchema = z
  .number()
  .int()
  .min(0)
  .max(REPOSITORY_OPERATION_LIMIT)

/**
 * The version 3 configuration: version 2's fields without `initialInputs` and `action`, the run-level `before` and `after`, 1 to 8 ordered `operations`, and an `afterOperation` on every stop. Only version 3 may name the third adapter, `react-scripts-dev` (browser stops only).
 * Called through {@link operationsRepositoryConfigSchema}, which adds the cross-field rules.
 */
const operationsConfigurationShape = z.strictObject({
  version: z.literal(OPERATIONS_CONFIG_VERSION),
  adapter: z.enum(OPERATIONS_REPOSITORY_BROWSER_ADAPTERS),
  book: repositoryBookSelectionSchema,
  source: repositorySourceStopSchema,
  participant: z.enum(['browser', 'server']),
  afterOperation: afterOperationSchema,
  before: conditionsSchema,
  after: conditionsSchema,
  // Omitted only when every stop is an entry-render stop (`afterOperation: 0`); an empty list is refused so the two spellings never mean the same.
  operations: z
    .array(repositoryOperationSchema)
    .min(
      1,
      `configuration.operations is empty: omit the field for a run with no operation, or declare 1 to ${REPOSITORY_OPERATION_LIMIT} operations.`,
    )
    .max(REPOSITORY_OPERATION_LIMIT)
    .optional(),
  inspections: stopInspectionsSchema,
  additionalStops: z
    .array(
      z.strictObject({
        participant: z.enum(['browser', 'server']),
        source: repositorySourceStopSchema,
        anchorIndex: repositoryBookSelectionSchema.shape.anchorIndex,
        inspections: stopInspectionsSchema,
        afterOperation: afterOperationSchema,
      }),
    )
    .max(CONFIGURED_OBSERVATION_LIMIT - 1)
    .optional(),
  entryPath: repositoryEntryPathSchema.optional(),
  initialStorage: storageSchema.optional(),
  signInPaths: z
    .array(signInPathSchema)
    .min(1)
    .max(SIGN_IN_PATH_LIMIT)
    .optional(),
  session: z.literal('fresh').optional(),
  // Optional, not defaulted: a configuration without it keeps its exact parsed shape; absent and "." both mean the repository root.
  packageRoot: z
    .union([z.literal('.'), repositoryPathSchema])
    .optional()
    .describe(
      'next-dev-webpack, vite-dev, react-scripts-dev and expo-web-dev: the app\'s folder, relative to the opened repository root (for example "examples/react/nextjs" or "examples/react/basic"). Omit it, or declare ".", for an app at the repository root. Stop files and book citations stay repository-relative and must lie inside this folder.',
    ),
  // vite-dev (MCP API 1.34), react-scripts-dev (1.35) and next-dev-webpack (1.36), together with a nested packageRoot: other adapters refuse the key as unknown in validateOperations, and the service refuses a root run with the reason library-needs-package-root.
  library: libraryDeclarationSchema.optional(),
  // expo-web-dev (MCP API 1.37) and vite-dev (1.38): the app's own Node API server; other adapters refuse the key as unknown in validateOperations.
  apiServer: apiServerDeclarationSchema.optional(),
})

/**
 * Refuses a repeated sign-in path (after one trailing slash is removed) and a sign-in path that is the entry path.
 * Called by {@link validateOperations}.
 * @param configuration - A parsed version 3 configuration.
 * @param context - The refinement context that receives one issue per violation.
 * @example validateSignInPaths({ entryPath: '/login', signInPaths: ['/login'], … }, context) // adds an issue at ['signInPaths', 0]
 */
function validateSignInPaths(
  configuration: z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  const entryPathname = normalizedSignInPathname(
    (configuration.entryPath ?? '/').split('?')[0]!,
  )
  const signInPaths = new Set<string>()
  for (const [index, signInPath] of (
    configuration.signInPaths ?? []
  ).entries()) {
    const normalized = normalizedSignInPathname(signInPath)
    // A repeated path (after one trailing slash is removed) adds nothing and hides a typo.
    if (signInPaths.has(normalized))
      context.addIssue({
        code: 'custom',
        path: ['signInPaths', index],
        message: `Sign-in paths must be distinct; "${signInPath}" is declared twice.`,
      })
    // The entry page cannot be a sign-in path: the run would answer SIGN_IN_REQUIRED on its first load.
    if (normalized === entryPathname)
      context.addIssue({
        code: 'custom',
        path: ['signInPaths', index],
        message:
          'The entry path is a sign-in path: the run would always answer SIGN_IN_REQUIRED. Leave signInPaths out to explain the sign-in page itself.',
      })
    signInPaths.add(normalized)
  }
}

/**
 * Lists every declared stop of a version 3 configuration with the configuration path of its source file and of its `afterOperation`, in declared order.
 * Called by {@link validateApiServer}.
 * @param configuration - A parsed version 3 configuration.
 * @returns One entry per stop: participant, source file, `afterOperation` and the two configuration paths.
 * @example declaredStopLocations(configuration)[0]?.sourcePath // => ['source', 'path']
 */
function declaredStopLocations(
  configuration: z.infer<typeof operationsConfigurationShape>,
) {
  return [
    {
      participant: configuration.participant,
      file: configuration.source.path,
      afterOperation: configuration.afterOperation,
      sourcePath: ['source', 'path'],
      afterOperationPath: ['afterOperation'],
    },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      participant: stop.participant,
      file: stop.source.path,
      afterOperation: stop.afterOperation,
      sourcePath: ['additionalStops', index, 'source', 'path'],
      afterOperationPath: ['additionalStops', index, 'afterOperation'],
    })),
  ]
}

/**
 * Refuses the `apiServer` rules a field schema cannot state: under `vite-dev` (API 1.38) the API folder may lie inside the app's folder but never equal it or contain it, and `library` is not declared beside it; under `expo-web-dev` (API 1.37) the two folders must not contain one another. `proxyPaths` follows {@link validateProxyPaths}; the stop rules are {@link validateApiServerStops}.
 * Called by {@link validateOperations} for an `expo-web-dev` or `vite-dev` configuration; does nothing without `apiServer`. The check is lexical: symbolic links are resolved when the run starts.
 * @param configuration - A parsed version 3 configuration.
 * @param context - The refinement context that receives one issue per violation, each naming its field.
 * @example validateApiServer({ adapter: 'expo-web-dev', packageRoot: 'apps/app', apiServer: { packageRoot: 'apps/app/api', … }, … }, context) // adds an issue at ['apiServer', 'packageRoot']
 */
function validateApiServer(
  configuration: z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  const { apiServer } = configuration
  if (apiServer === undefined) return
  const appRoot = configuration.packageRoot ?? '.'
  if (configuration.adapter === 'vite-dev') {
    if (configuration.library !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['apiServer'],
        message:
          'apiServer and library cannot be declared on one vite-dev run; declare the library run or the API run, not both.',
      })
    // The API may sit inside the app's folder (an app at the root with the API in a subfolder); equal folders and an app inside the API's folder leave a stop with no single owner.
    if (isRepositoryPathInFolder(apiServer.packageRoot, appRoot))
      context.addIssue({
        code: 'custom',
        path: ['apiServer', 'packageRoot'],
        message: `apiServer.packageRoot "${apiServer.packageRoot}" equals or contains the app's packageRoot "${appRoot}"; declare the API's folder inside the app's folder or beside it, never around it.`,
      })
  } else if (
    // The participant of a stop follows from its folder, so neither folder may contain the other.
    isRepositoryPathInFolder(appRoot, apiServer.packageRoot) ||
    isRepositoryPathInFolder(apiServer.packageRoot, appRoot)
  )
    context.addIssue({
      code: 'custom',
      path: ['apiServer', 'packageRoot'],
      message: `apiServer.packageRoot "${apiServer.packageRoot}" and the app's packageRoot "${appRoot}" must not contain one another; declare the API's own package folder outside the app's folder.`,
    })
  validateProxyPaths(configuration.adapter, apiServer.proxyPaths, context)
  validateApiServerStops(configuration, context)
}

/**
 * Refuses `apiServer.proxyPaths` under any adapter but `vite-dev` (Metro does not proxy), and applies the {@link proxyPathIssueOf} rules under `vite-dev`.
 * Called by {@link validateApiServer}.
 * @param adapter - The configuration's adapter.
 * @param proxyPaths - The declared prefixes, or `undefined` when omitted.
 * @param context - The refinement context that receives one issue per violation, each naming `apiServer.proxyPaths[i]` or the list.
 * @example validateProxyPaths('expo-web-dev', ['/api'], context) // adds an issue at ['apiServer', 'proxyPaths']
 */
function validateProxyPaths(
  adapter: string,
  proxyPaths: readonly string[] | undefined,
  context: z.RefinementCtx,
): void {
  if (proxyPaths === undefined) return
  if (adapter !== 'vite-dev') {
    context.addIssue({
      code: 'custom',
      path: ['apiServer', 'proxyPaths'],
      message:
        "apiServer.proxyPaths is accepted on vite-dev only: Metro does not proxy, and an Expo page calls the API's own origin.",
    })
    return
  }
  for (const { index, message } of proxyPathIssueOf(proxyPaths))
    context.addIssue({
      code: 'custom',
      path:
        index === undefined
          ? ['apiServer', 'proxyPaths']
          : ['apiServer', 'proxyPaths', index],
      message,
    })
}

/**
 * Refuses a browser stop that lies outside the app's folder, or (under `vite-dev`, where the app's folder may contain the API's) inside the API's folder; both refusals name the `participant` to declare for a stop in the API folder.
 * Called by {@link validateApiServerStops} for each browser stop.
 * @param configuration - A parsed version 3 configuration that declares `apiServer`.
 * @param file - The stop's source file, repository-relative.
 * @param sourcePath - The configuration path of the stop's `source.path`, where the issue lands.
 * @param isInsideApi - Whether `file` lies inside `apiServer.packageRoot`.
 * @param context - The refinement context that receives the issue.
 * @example validateBrowserStopFolder(configuration, 'server/src/page.ts', ['source', 'path'], true, context) // adds an issue at ['source', 'path'] (vite-dev)
 */
function validateBrowserStopFolder(
  configuration: z.infer<typeof operationsConfigurationShape>,
  file: string,
  sourcePath: (string | number)[],
  isInsideApi: boolean,
  context: z.RefinementCtx,
): void {
  const apiRoot = configuration.apiServer?.packageRoot ?? '.'
  const appRoot = configuration.packageRoot ?? '.'
  const field = `configuration.${sourcePath.join('.')}`
  const participantAdvice =
    ' Declare participant "server" for a stop in the API folder.'
  if (!isRepositoryPathInFolder(appRoot, file))
    context.addIssue({
      code: 'custom',
      path: sourcePath,
      message: `With apiServer, a browser stop must lie inside the app's packageRoot "${appRoot}"; ${file} is declared at ${field}.${isInsideApi ? participantAdvice : ''}`,
    })
  // The Vite app may contain the API folder, so the app-folder rule above cannot tell the two apart.
  else if (configuration.adapter === 'vite-dev' && isInsideApi)
    context.addIssue({
      code: 'custom',
      path: sourcePath,
      message: `With apiServer, a browser stop must lie outside apiServer.packageRoot "${apiRoot}"; ${file} is declared at ${field}.${participantAdvice}`,
    })
}

/**
 * Refuses the stop rules of a configuration that declares `apiServer`: a server stop must lie inside the API folder, a browser stop inside the app's folder (and under `vite-dev` outside the API folder), and a server stop needs an operation to follow (`afterOperation` 1 or more). A wrong-folder refusal names the `participant` to declare.
 * Called by {@link validateApiServer}.
 * @param configuration - A parsed version 3 configuration that declares `apiServer`.
 * @param context - The refinement context that receives one issue per violation.
 * @example validateApiServerStops(configuration, context) // adds an issue at ['additionalStops', 0, 'source', 'path'] for a server stop outside the API folder
 */
function validateApiServerStops(
  configuration: z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  const { apiServer } = configuration
  if (apiServer === undefined) return
  for (const stop of declaredStopLocations(configuration)) {
    const field = `configuration.${stop.sourcePath.join('.')}`
    const isInsideApi = isRepositoryPathInFolder(
      apiServer.packageRoot,
      stop.file,
    )
    if (stop.participant === 'server' && !isInsideApi)
      context.addIssue({
        code: 'custom',
        path: stop.sourcePath,
        message: `A server stop must lie inside apiServer.packageRoot "${apiServer.packageRoot}"; ${stop.file} is declared at ${field}. Declare participant "browser" for a stop outside the API folder.`,
      })
    if (stop.participant === 'browser')
      validateBrowserStopFolder(
        configuration,
        stop.file,
        stop.sourcePath,
        isInsideApi,
        context,
      )
    if (stop.participant === 'server' && stop.afterOperation === 0)
      context.addIssue({
        code: 'custom',
        path: stop.afterOperationPath,
        message: `afterOperation 0 is declared at configuration.${stop.afterOperationPath.join('.')}, but an API server stop needs an operation: entry-load API stops are not supported (API ${apiServerMinimumApiOf(configuration.adapter)}); declare the operation whose request reaches the API and afterOperation 1 or more.`,
      })
  }
}

/**
 * Refuses the version 3 rules a field schema cannot state: distinct operation titles, distinct sign-in paths none of which is the entry path, and an `afterOperation` on every stop that names a declared operation and never decreases along the declared stop order.
 * Called by {@link operationsRepositoryConfigSchema}.
 * @param configuration - A parsed version 3 configuration.
 * @param context - The refinement context that receives one issue per violation.
 * @example validateOperations(configuration, context) // adds an issue at ['operations', 1, 'title'] for a repeated title
 */
function validateOperations(
  configuration: z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  // Only a vite-dev, react-scripts-dev or next-dev-webpack configuration declares `library`; every other adapter refuses it exactly as an unknown key of the strict shape.
  if (
    configuration.library !== undefined &&
    configuration.adapter !== 'vite-dev' &&
    configuration.adapter !== 'react-scripts-dev' &&
    configuration.adapter !== 'next-dev-webpack'
  )
    context.addIssue({
      code: 'unrecognized_keys',
      keys: ['library'],
      path: [],
    })
  // Only an expo-web-dev (API 1.37) or vite-dev (API 1.38) configuration declares `apiServer`; every other adapter refuses it exactly as an unknown key of the strict shape.
  if (
    configuration.apiServer !== undefined &&
    configuration.adapter !== 'expo-web-dev' &&
    configuration.adapter !== 'vite-dev'
  )
    context.addIssue({
      code: 'unrecognized_keys',
      keys: ['apiServer'],
      path: [],
    })
  else validateApiServer(configuration, context)
  const titles = new Set<string>()
  for (const [index, operation] of (configuration.operations ?? []).entries()) {
    // A repeated title makes two operations indistinguishable in the run resource and the replay.
    if (titles.has(operation.title))
      context.addIssue({
        code: 'custom',
        path: ['operations', index, 'title'],
        message: `Operation titles must be distinct; "${operation.title}" is declared twice.`,
      })
    titles.add(operation.title)
  }
  validateSignInPaths(configuration, context)
  validateStopAfterOperations(configuration, context)
}

/**
 * Words the refusal of a stop that waits for an operation while `operations` is omitted, with the way out its participant has.
 * Called by {@link validateStopAfterOperations}.
 * @param value - The stop's `afterOperation` (1 or more).
 * @param field - The dotted configuration path of that field.
 * @param participant - The stop's participant; only a server stop may use afterOperation 0.
 * @returns The refusal sentence; a browser stop is told to declare the operations only.
 * @example describeOmittedOperationsRefusal(1, 'configuration.afterOperation', 'browser') // '… but operations is omitted; declare the operations.'
 */
function describeOmittedOperationsRefusal(
  value: number,
  field: string,
  participant: 'browser' | 'server',
): string {
  const advice =
    participant === 'server'
      ? 'declare the operations, or use afterOperation 0 on every server stop.'
      : 'declare the operations.'
  return `afterOperation ${value} is declared at ${field}, but operations is omitted; ${advice}`
}

/**
 * Refuses the `afterOperation` rules of a version 3 configuration: 0 (the entry render) only on a server stop, a value no greater than the declared operation count, omitted `operations` only when every stop is 0, and a value that never decreases along the declared stop order.
 * Called by {@link validateOperations}.
 * @param configuration - A parsed version 3 configuration.
 * @param context - The refinement context that receives one issue per violation, each naming its field.
 * @example validateStopAfterOperations({ participant: 'browser', afterOperation: 0, … }, context) // adds an issue at ['afterOperation']
 */
function validateStopAfterOperations(
  configuration: z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  const declared = [
    {
      path: ['afterOperation'],
      value: configuration.afterOperation,
      participant: configuration.participant,
    },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      path: ['additionalStops', index, 'afterOperation'],
      value: stop.afterOperation,
      participant: stop.participant,
    })),
  ]
  const operationCount = configuration.operations?.length ?? 0
  let previous = 0
  for (const { path, value, participant } of declared) {
    const field = `configuration.${path.join('.')}`
    // The entry render is a server render: a browser stop has no pause to wait for before the page loads.
    if (value === 0 && participant !== 'server')
      context.addIssue({
        code: 'custom',
        path,
        message: `afterOperation 0 (the entry render) is declared at ${field}, but only a server stop can pause the entry render; declare afterOperation 1 or more for a browser stop.`,
      })
    else if (value > operationCount)
      context.addIssue({
        code: 'custom',
        path,
        message:
          configuration.operations === undefined
            ? describeOmittedOperationsRefusal(value, field, participant)
            : `afterOperation ${value} is declared at ${field}, but the run declares ${operationCount} operations.`,
      })
    // A later stop cannot belong to an earlier operation than the stop before it: the stops are taken in declared order.
    if (value < previous)
      context.addIssue({
        code: 'custom',
        path,
        message: `afterOperation ${value} at ${field} is lower than the ${previous} of the stop before it; declare the stops in the order of their operations.`,
      })
    previous = Math.max(previous, value)
  }
}

/** The adapters that seal and debug browser modules only, so a server participant is refused under them. */
const BROWSER_ONLY_ADAPTERS: ReadonlySet<string> = new Set([
  'vite-dev',
  'react-scripts-dev',
  'expo-web-dev',
])

/** The file names of an Expo Router API route (`+api` with any extension Expo Router resolves: ts, tsx, js, jsx, mjs, cjs, mts, cts): server code, which `expo-web-dev` never observes. */
const EXPO_API_ROUTE_FILE = /\+api\.(?:[cm]?[jt]s|[jt]sx)$/

/**
 * Names the API that first accepts `apiServer` under an adapter.
 * Called by {@link apiServerWayOutOf} and {@link validateApiServerStops}.
 * @param adapter - `expo-web-dev` or any other adapter that declares `apiServer`.
 * @returns "1.37" for `expo-web-dev`, "1.38" otherwise (`vite-dev`).
 * @example apiServerMinimumApiOf('vite-dev') // => '1.38'
 */
function apiServerMinimumApiOf(adapter: string): string {
  return adapter === 'expo-web-dev'
    ? EXPO_WEB_API_SERVER_MINIMUM_API
    : VITE_API_SERVER_MINIMUM_API
}

/**
 * Words the way out of a server participant refusal: the adapters that can start the app's own API name `apiServer` and the API that first accepts it.
 * Called by {@link refuseBrowserOnlyServerParticipants}.
 * @param adapter - The configuration's adapter.
 * @returns A sentence starting with a space, or an empty string for an adapter with no API server.
 * @example apiServerWayOutOf('vite-dev') // => " To pause in the app's own Node API, declare apiServer (API 1.38)."
 */
function apiServerWayOutOf(adapter: string): string {
  if (adapter !== 'expo-web-dev' && adapter !== 'vite-dev') return ''
  return ` To pause in the app's own Node API, declare apiServer (API ${apiServerMinimumApiOf(adapter)}).`
}

/**
 * Refuses a server participant under `adapter: "vite-dev"`, `"react-scripts-dev"` or `"expo-web-dev"`, which seal and debug browser modules only, and a stop in an Expo Router API route (`+api.ts`) under `"expo-web-dev"`, which is server code.
 * Called by {@link validateInspections} for both configuration versions, so the public schema, not a later start, rejects it.
 * @param configuration - A parsed configuration of either version.
 * @param context - The refinement context that receives one issue per server participant.
 * @example refuseBrowserOnlyServerParticipants({ adapter: 'vite-dev', participant: 'server', … }, context) // adds an issue at ['participant']
 */
function refuseBrowserOnlyServerParticipants(
  configuration:
    | z.infer<typeof repositoryConfigurationShape>
    | z.infer<typeof crossRuntimeConfigurationShape>
    | z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  if (
    !BROWSER_ONLY_ADAPTERS.has(configuration.adapter) ||
    !('participant' in configuration)
  )
    return
  const declared = [
    { path: ['participant'], participant: configuration.participant },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      path: ['additionalStops', index, 'participant'],
      participant: stop.participant,
    })),
  ]
  // An expo-web-dev (API 1.37) or vite-dev (API 1.38) run that declares apiServer starts the app's own Node API, so a server stop is accepted there.
  const hasApiServer =
    (configuration.adapter === 'expo-web-dev' ||
      configuration.adapter === 'vite-dev') &&
    'apiServer' in configuration &&
    configuration.apiServer !== undefined
  for (const { path, participant } of declared)
    if (participant === 'server' && !hasApiServer)
      context.addIssue({
        code: 'custom',
        path,
        message: `adapter "${configuration.adapter}" supports browser stops only; participant "server" is declared at configuration.${path.join('.')}.${apiServerWayOutOf(
          configuration.adapter,
        )}`,
      })
  refuseExpoApiRouteStops(configuration, context)
}

/**
 * Refuses a stop declared in an Expo Router API route file under `adapter: "expo-web-dev"`, before any process starts.
 * Called by {@link refuseBrowserOnlyServerParticipants}; an API route is a server participant even when the stop says `browser`.
 * @param configuration - A parsed configuration of any version.
 * @param context - The refinement context that receives one issue per API-route stop.
 * @example refuseExpoApiRouteStops({ adapter: 'expo-web-dev', source: { path: 'apps/app/src/app/hello+api.ts', … }, … }, context) // adds an issue at ['source', 'path']
 */
function refuseExpoApiRouteStops(
  configuration: Parameters<typeof refuseBrowserOnlyServerParticipants>[0],
  context: z.RefinementCtx,
): void {
  if (configuration.adapter !== 'expo-web-dev') return
  const declared = [
    { path: ['source', 'path'], file: configuration.source.path },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      path: ['additionalStops', index, 'source', 'path'],
      file: stop.source.path,
    })),
  ]
  for (const { path, file } of declared)
    if (EXPO_API_ROUTE_FILE.test(file))
      context.addIssue({
        code: 'custom',
        path,
        message: `adapter "expo-web-dev" supports browser stops only; ${file} is an Expo Router API route (+api), server code, declared at configuration.${path.join('.')}.`,
      })
}

/**
 * Drops a `packageRoot` of "." from a parsed version 3 configuration, so absent and "." are one configuration for the idempotency key, the run and the saved study.
 * Called by {@link StudyService.start} on the parsed start before its signature is taken.
 * @param configuration - Any parsed retained repository configuration.
 * @returns The same object when nothing is dropped, else a copy without `packageRoot`.
 * @example dropDefaultPackageRoot({ version: 3, packageRoot: '.', … }) // => { version: 3, … }
 */
export function dropDefaultPackageRoot<
  Configuration extends { version: number },
>(configuration: Configuration): Configuration {
  if (!('packageRoot' in configuration) || configuration.packageRoot !== '.')
    return configuration
  const { packageRoot: _default, ...rest } = configuration as Configuration & {
    packageRoot: string
  }
  return rest as unknown as Configuration
}

/** Applies shared bounded fact requirements to both retained intent versions without changing their serialized fields. @example validateInspections(configuration, context) */
function validateInspections(
  configuration:
    | z.infer<typeof repositoryConfigurationShape>
    | z.infer<typeof crossRuntimeConfigurationShape>
    | z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  refuseBrowserOnlyServerParticipants(configuration, context)
  // Each ordered stop must independently declare useful, unambiguous facts.
  for (const [index, inspections] of [
    configuration.inspections,
    ...(configuration.additionalStops ?? []).map((stop) => stop.inspections),
  ].entries()) {
    const path = index
      ? ['additionalStops', index - 1, 'inspections']
      : ['inspections']
    // A type-only stop cannot supply the useful actual value required by the configured learning contract; the refusal names the stop and what it declares.
    const missingValueInspection = missingValueInspectionMessage(
      inspections,
      index
        ? `configuration.additionalStops[${index - 1}].inspections`
        : 'configuration.inspections',
    )
    if (missingValueInspection)
      context.addIssue({
        code: 'custom',
        path,
        message: missingValueInspection,
      })
    if (
      new Set(
        inspections.map(
          (inspection) => `${inspection.mode}:${inspection.path}`,
        ),
      ).size !== inspections.length
    )
      context.addIssue({
        code: 'custom',
        path,
        message: 'Inspection mode/path pairs must be unique.',
      })
  }
  if (
    Buffer.byteLength(JSON.stringify(configuration)) >
    REPOSITORY_CONFIG_LIMIT_BYTES
  )
    context.addIssue({
      code: 'custom',
      message: `Repository configuration exceeds ${REPOSITORY_CONFIG_LIMIT_BYTES} bytes.`,
    })
}

// Preserve version 1 bytes while live entry and retained history share the versioned union.
export const repositoryConfigSchema =
  repositoryConfigurationShape.superRefine(validateInspections)
export const crossRuntimeRepositoryConfigSchema =
  crossRuntimeConfigurationShape.superRefine(validateInspections)
/** The version 3 configuration (ordered operations); `codebook_start` accepts it for the `repository-browser` profile and the saved study retains it. */
export const operationsRepositoryConfigSchema =
  operationsConfigurationShape.superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
/**
 * The configuration `codebook_start` accepts for the `repository-browser` profile: versions 1 to 3, where version 3 may declare `packageRoot` (`next-dev-webpack`, `vite-dev` and `react-scripts-dev`; versions 1 and 2 have no such field and refuse it as an unknown key).
 * Why it exists: the start, its idempotency intent, the help's `configurationSchema` and the source preparation must admit a nested Next app, while a saved study of formats 3 to 8 must not ({@link retainedRepositoryConfigSchema}).
 * Read by the start schemas in `schemas.ts`, the help resource and {@link prepareRepositoryStudy}.
 * @example liveRepositoryConfigSchema.parse({ version: 3, adapter: 'next-dev-webpack', packageRoot: 'examples/app', ... }) // accepted
 */
export const liveRepositoryConfigSchema = z.union([
  repositoryConfigSchema,
  crossRuntimeRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
])
/**
 * The configuration of a study of formats 3 to 8: versions 1 to 3 as before, and none of them may carry a `packageRoot` (the field exists only in format 9, see {@link packageRootRepositoryConfigSchema}).
 * The explicit refusal keeps formats 3 to 8 closed although the live version 3 shape ({@link liveRepositoryConfigSchema}) has an optional `packageRoot`.
 */
export const retainedRepositoryConfigSchema = liveRepositoryConfigSchema
  .refine(
    (configuration) => !('packageRoot' in configuration),
    'Only a study of format 9 keeps a packageRoot.',
  )
  // A `react-scripts-dev` run is saved as format 11 only (Cycle 0083, DX-10), with or without a packageRoot.
  .refine(
    (configuration) => configuration.adapter !== 'react-scripts-dev',
    'Only a study of format 11 keeps a react-scripts-dev configuration.',
  )
  // An `expo-web-dev` run is saved as format 15 only (Cycle 0089, DX-16), with or without a packageRoot.
  .refine(
    (configuration) => configuration.adapter !== 'expo-web-dev',
    'Only a study of format 15 keeps an expo-web-dev configuration.',
  )
  // A run that declares `library` is saved as format 16 (`vite-dev`), 17 (`react-scripts-dev`) or 18 (`next-dev-webpack`) only.
  .refine(
    // An explicit `library: undefined` declares nothing, so it stays the older format.
    (configuration) =>
      !('library' in configuration) || configuration.library === undefined,
    'Only a study of format 16, 17 or 18 keeps a library.',
  )
/**
 * Says whether a retained configuration declares no library (an explicit `library: undefined` declares nothing).
 * Called by the refinements of the retained variants that predate the library formats.
 * @param configuration - A parsed version 3 configuration.
 * @returns `true` when `library` is absent or undefined.
 * @example declaresNoLibrary({ library: undefined }) // => true
 */
function declaresNoLibrary(configuration: { library?: unknown }): boolean {
  return !('library' in configuration) || configuration.library === undefined
}

/**
 * Runs the inspection and operation rules every retained version 3 variant shares.
 * Called as the `superRefine` of the format 10 and format 11 variants.
 * @param configuration - A parsed version 3 configuration.
 * @param context - The refinement context that receives the issues.
 * @example validateRetainedStudyConfiguration(configuration, context) // adds issues for a broken inspection
 */
function validateRetainedStudyConfiguration(
  configuration: z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  validateInspections(configuration, context)
  validateOperations(configuration, context)
}
/**
 * The configuration a format 9 study retains: the version 3 `next-dev-webpack` shape with a required `packageRoot` other than `"."`.
 * Read by {@link studyConfigurationSchema}; a run whose package root is `"."` saves the formats 7 or 8 it always did, without the field.
 */
const packageRootRepositoryConfigSchema = operationsConfigurationShape
  .extend({
    adapter: z.literal('next-dev-webpack'),
    packageRoot: repositoryPathSchema.refine(
      (value) => value !== '.',
      'A format 9 study names a package folder other than ".".',
    ),
  })
  .superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
  // A Next run that declares `library` is saved as format 18 only (API 1.36); the shape above would otherwise accept the key.
  .refine(declaresNoLibrary, 'Only a study of format 18 keeps a library.')
/**
 * The configuration a format 10 study retains: the version 3 `vite-dev` shape with a required `packageRoot` other than `"."`.
 * Why it exists: 0.2.77.0 validates a format 9 configuration with {@link packageRootRepositoryConfigSchema}, which accepts `next-dev-webpack` only, so a nested Vite run needs its own format to be listed as saved by a newer Codebook. Validated like the format 9 variant (inspections, operations; {@link validateInspections} also refuses a server participant under `vite-dev`).
 * Read by {@link studyConfigurationSchema}; a Vite run whose package root is `"."` saves the format it always did, without the field.
 */
const vitePackageRootRepositoryConfigSchema = operationsConfigurationShape
  .extend({
    adapter: z.literal('vite-dev'),
    packageRoot: repositoryPathSchema.refine(
      (value) => value !== '.',
      'A format 10 study names a package folder other than ".".',
    ),
  })
  .superRefine(validateRetainedStudyConfiguration)
  // A run that declares `library` is saved as format 16 (`vite-dev`), 17 (`react-scripts-dev`) or 18 (`next-dev-webpack`) only.
  .refine(
    declaresNoLibrary,
    'Only a study of format 16, 17 or 18 keeps a library.',
  )
/**
 * The configuration a format 16 study retains: the version 3 `vite-dev` shape with a required `packageRoot` other than `"."` and a required `library` declaration (API 1.34).
 * Why it exists: an older Codebook refuses `library` under `vite-dev` as an unknown key, so a run that declares it takes its own format and is listed there as saved by a newer Codebook. Validated like the format 10 variant (inspections, operations).
 * Read by {@link studyConfigurationSchema}; no earlier format accepts a `library`.
 */
const viteLibraryRepositoryConfigSchema = operationsConfigurationShape
  .extend({
    adapter: z.literal('vite-dev'),
    packageRoot: repositoryPathSchema.refine(
      (value) => value !== '.',
      'A format 16 study names a package folder other than ".".',
    ),
    library: libraryDeclarationSchema,
  })
  .superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
/**
 * The configuration a format 18 study retains: the version 3 `next-dev-webpack` shape with a required `packageRoot` other than `"."` and a required `library` declaration (API 1.36).
 * Why it exists: an older Codebook refuses `library` under `next-dev-webpack` as an unknown key, so a run that declares it takes its own format and is listed there as saved by a newer Codebook. Validated like the format 9 variant (inspections, operations). A root app never reaches a save: the run is refused with `library-needs-package-root` before anything starts.
 * Read by {@link studyConfigurationSchema}; no earlier format accepts a `library` under this adapter.
 */
const nextLibraryRepositoryConfigSchema = operationsConfigurationShape
  .extend({
    adapter: z.literal('next-dev-webpack'),
    packageRoot: repositoryPathSchema.refine(
      (value) => value !== '.',
      'A format 18 study names a package folder other than ".".',
    ),
    library: libraryDeclarationSchema,
  })
  .superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
/**
 * The configuration a format 11 study retains: the version 3 `react-scripts-dev` shape, root (`packageRoot` absent or `"."`) or nested.
 * Why it exists: an older Codebook refuses the adapter value, so every `react-scripts-dev` run takes its own format and is listed there as saved by a newer Codebook (D5). Validated like the format 9 and 10 variants (inspections, operations; {@link validateInspections} also refuses a server participant under `react-scripts-dev`).
 * Read by {@link studyConfigurationSchema}; no earlier format accepts this adapter.
 */
const reactScriptsRepositoryConfigSchema = operationsConfigurationShape
  .extend({ adapter: z.literal('react-scripts-dev') })
  .superRefine(validateRetainedStudyConfiguration)
  // A run that declares `library` is saved as format 17 only.
  .refine(declaresNoLibrary, 'Only a study of format 17 keeps a library.')
/**
 * The configuration a format 17 study retains: the version 3 `react-scripts-dev` shape with a required `library` declaration (API 1.35).
 * Why it exists: an older Codebook refuses `library` under `react-scripts-dev` as an unknown key, so a run that declares it takes its own format and is listed there as saved by a newer Codebook. Validated like the format 11 variant (inspections, operations).
 * Read by {@link studyConfigurationSchema}; no earlier format accepts a `library` under this adapter.
 */
const reactScriptsLibraryRepositoryConfigSchema = operationsConfigurationShape
  .extend({
    adapter: z.literal('react-scripts-dev'),
    library: libraryDeclarationSchema,
  })
  .superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
/**
 * The configuration a format 15 study retains: the version 3 `expo-web-dev` shape, root (`packageRoot` absent or `"."`) or nested.
 * Why it exists: an older Codebook refuses the adapter value, so every `expo-web-dev` run takes its own format and is listed there as saved by a newer Codebook (DX-16). Validated like the format 11 variant (inspections, operations; {@link validateInspections} also refuses a server participant under `expo-web-dev`).
 * Read by {@link studyConfigurationSchema}; no earlier format accepts this adapter.
 */
const expoWebRepositoryConfigSchema = operationsConfigurationShape
  .extend({ adapter: z.literal('expo-web-dev') })
  .superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
  // A run that declares `apiServer` is saved as format 19 only.
  .refine(
    (configuration) => configuration.apiServer === undefined,
    'Only a study of format 19 keeps an apiServer.',
  )
/**
 * The configuration a format 19 study retains: the version 3 `expo-web-dev` shape with a required `apiServer` declaration (API 1.37).
 * Why it exists: an older Codebook refuses `apiServer` as an unknown key, so a run that declares it takes its own format and is listed there as saved by a newer Codebook. Validated like the format 15 variant (inspections, operations, and the `apiServer` folder and stop rules).
 * Read by {@link studyConfigurationSchema}; no earlier format accepts an `apiServer`.
 */
const expoWebApiServerRepositoryConfigSchema = operationsConfigurationShape
  .extend({
    adapter: z.literal('expo-web-dev'),
    apiServer: apiServerDeclarationSchema,
  })
  .superRefine((configuration, context) => {
    validateInspections(configuration, context)
    validateOperations(configuration, context)
  })
/** Every configuration a saved study can hold: the retained union of formats 3 to 8, the format 9 package-root variant (Next), the format 10 package-root variant (Vite), the format 11 variant (react-scripts), the format 15 variant (Expo web), the format 16 variant (Vite with a library), the format 17 variant (react-scripts with a library) the format 18 variant (Next with a library) or the format 19 variant (Expo web with an apiServer). */
export const studyConfigurationSchema = z.union([
  retainedRepositoryConfigSchema,
  packageRootRepositoryConfigSchema,
  vitePackageRootRepositoryConfigSchema,
  viteLibraryRepositoryConfigSchema,
  reactScriptsRepositoryConfigSchema,
  reactScriptsLibraryRepositoryConfigSchema,
  nextLibraryRepositoryConfigSchema,
  expoWebRepositoryConfigSchema,
  expoWebApiServerRepositoryConfigSchema,
])
export type RepositoryConfiguration = z.infer<typeof repositoryConfigSchema>
export type RetainedRepositoryConfiguration = z.infer<
  typeof retainedRepositoryConfigSchema
>
export type OperationsRepositoryConfiguration = z.infer<
  typeof operationsRepositoryConfigSchema
>
export type RepositoryOperation = z.infer<typeof repositoryOperationSchema>
export type RepositoryInspection = z.infer<typeof repositoryInspectionSchema>
export type RepositoryCondition = z.infer<typeof repositoryConditionSchema>
export type ConfiguredDomFailure = z.infer<typeof configuredDomFailureSchema>
