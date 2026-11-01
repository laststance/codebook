import { z } from 'zod'

import {
  ASK_LEARNER_SECRET,
  CONFIGURED_OBSERVATION_LIMIT,
  CROSS_RUNTIME_CONFIG_VERSION,
  OPERATIONS_CONFIG_VERSION,
  REPOSITORY_OPERATION_LIMIT,
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
import { repositoryHashSchema, repositoryPathSchema } from './sourceSchemas'
import { missingValueInspectionMessage } from './utils/missingValueInspectionMessage'
import { normalizedSignInPathname } from './utils/normalizedSignInPathname'

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
  adapter: z.enum(['next-dev-webpack', 'vite-dev']),
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
/** The stop-to-operation link every stop of a version 3 run declares: the 1-based operation after whose input the stop is armed. */
const afterOperationSchema = z
  .number()
  .int()
  .min(1)
  .max(REPOSITORY_OPERATION_LIMIT)

/**
 * The version 3 configuration: version 2's fields without `initialInputs` and `action`, the run-level `before` and `after`, 1 to 8 ordered `operations`, and an `afterOperation` on every stop.
 * Called through {@link operationsRepositoryConfigSchema}, which adds the cross-field rules.
 */
const operationsConfigurationShape = z.strictObject({
  version: z.literal(OPERATIONS_CONFIG_VERSION),
  adapter: z.enum(['next-dev-webpack', 'vite-dev']),
  book: repositoryBookSelectionSchema,
  source: repositorySourceStopSchema,
  participant: z.enum(['browser', 'server']),
  afterOperation: afterOperationSchema,
  before: conditionsSchema,
  after: conditionsSchema,
  operations: z
    .array(repositoryOperationSchema)
    .min(1)
    .max(REPOSITORY_OPERATION_LIMIT),
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
  const titles = new Set<string>()
  for (const [index, operation] of configuration.operations.entries()) {
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
  const declared = [
    { path: ['afterOperation'], value: configuration.afterOperation },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      path: ['additionalStops', index, 'afterOperation'],
      value: stop.afterOperation,
    })),
  ]
  let previous = 0
  for (const { path, value } of declared) {
    if (value > configuration.operations.length)
      context.addIssue({
        code: 'custom',
        path,
        message: `afterOperation ${value} is declared at configuration.${path.join('.')}, but the run declares ${configuration.operations.length} operations.`,
      })
    // A later stop cannot belong to an earlier operation than the stop before it: the stops are taken in declared order.
    if (value < previous)
      context.addIssue({
        code: 'custom',
        path,
        message: `afterOperation ${value} at configuration.${path.join('.')} is lower than the ${previous} of the stop before it; declare the stops in the order of their operations.`,
      })
    previous = Math.max(previous, value)
  }
}

/**
 * Refuses a server participant under `adapter: "vite-dev"`, which seals and debugs browser modules only.
 * Called by {@link validateInspections} for both configuration versions, so the public schema, not a later start, rejects it.
 * @param configuration - A parsed configuration of either version.
 * @param context - The refinement context that receives one issue per server participant.
 * @example refuseViteServerParticipants({ adapter: 'vite-dev', participant: 'server', … }, context) // adds an issue at ['participant']
 */
function refuseViteServerParticipants(
  configuration:
    | z.infer<typeof repositoryConfigurationShape>
    | z.infer<typeof crossRuntimeConfigurationShape>
    | z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  if (configuration.adapter !== 'vite-dev' || !('participant' in configuration))
    return
  const declared = [
    { path: ['participant'], participant: configuration.participant },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      path: ['additionalStops', index, 'participant'],
      participant: stop.participant,
    })),
  ]
  for (const { path, participant } of declared)
    if (participant === 'server')
      context.addIssue({
        code: 'custom',
        path,
        message: `adapter "vite-dev" supports browser stops only; participant "server" is declared at configuration.${path.join('.')}.`,
      })
}

/** Applies shared bounded fact requirements to both retained intent versions without changing their serialized fields. @example validateInspections(configuration, context) */
function validateInspections(
  configuration:
    | z.infer<typeof repositoryConfigurationShape>
    | z.infer<typeof crossRuntimeConfigurationShape>
    | z.infer<typeof operationsConfigurationShape>,
  context: z.RefinementCtx,
): void {
  refuseViteServerParticipants(configuration, context)
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
export const retainedRepositoryConfigSchema = z.union([
  repositoryConfigSchema,
  crossRuntimeRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
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
