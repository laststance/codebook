import { z } from 'zod'

import {
  CONFIGURED_OBSERVATION_LIMIT,
  CROSS_RUNTIME_CONFIG_VERSION,
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
} from './constants'
import { bookIdSchema } from './identitySchemas'
import { repositoryHashSchema, repositoryPathSchema } from './sourceSchemas'

const selectorSchema = z
  .string()
  .min(1)
  .max(REPOSITORY_SELECTOR_LIMIT_CHARS)
  .regex(/^[^\x00-\x1f\x7f]+$/)
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
export const repositoryInspectionSchema = z.strictObject({
  path: inspectionPathSchema,
  mode: z.enum(['value', 'type']),
  required: z.boolean(),
})
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

const repositoryConfigurationShape = z.strictObject({
  version: z.literal(REPOSITORY_CONFIG_VERSION),
  adapter: z.literal('next-dev-webpack'),
  book: repositoryBookSelectionSchema,
  source: repositorySourceStopSchema,
  action: z.strictObject({
    title: z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS),
    selector: selectorSchema,
    before: conditionsSchema,
    after: conditionsSchema,
  }),
  inspections: z
    .array(repositoryInspectionSchema)
    .min(1)
    .max(REPOSITORY_INSPECTION_LIMIT),
  additionalStops: z
    .array(
      z.strictObject({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
        inspections: z
          .array(repositoryInspectionSchema)
          .min(1)
          .max(REPOSITORY_INSPECTION_LIMIT),
      }),
    )
    .max(CONFIGURED_OBSERVATION_LIMIT - 1)
    .optional(),
  entryPath: repositoryEntryPathSchema.optional(),
  initialInputs: z
    .array(z.strictObject({ selector: selectorSchema, text: literalSchema }))
    .max(REPOSITORY_INPUT_LIMIT)
    .refine(
      (inputs) =>
        new Set(inputs.map((input) => input.selector)).size === inputs.length,
      'Input selectors must be distinct.',
    )
    .optional(),
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

/** Applies shared bounded fact requirements to both retained intent versions without changing their serialized fields. @example validateInspections(configuration, context) */
function validateInspections(
  configuration:
    | z.infer<typeof repositoryConfigurationShape>
    | z.infer<typeof crossRuntimeConfigurationShape>,
  context: z.RefinementCtx,
): void {
  // Each ordered stop must independently declare useful, unambiguous facts.
  for (const [index, inspections] of [
    configuration.inspections,
    ...(configuration.additionalStops ?? []).map((stop) => stop.inspections),
  ].entries()) {
    const path = index
      ? ['additionalStops', index - 1, 'inspections']
      : ['inspections']
    // A type-only stop cannot supply the useful actual value required by the configured learning contract.
    if (
      !inspections.some(
        (inspection) => inspection.required && inspection.mode === 'value',
      )
    )
      context.addIssue({
        code: 'custom',
        path,
        message: 'At least one required value inspection is needed.',
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
export const retainedRepositoryConfigSchema = z.union([
  repositoryConfigSchema,
  crossRuntimeRepositoryConfigSchema,
])
export type RepositoryConfiguration = z.infer<typeof repositoryConfigSchema>
export type RetainedRepositoryConfiguration = z.infer<
  typeof retainedRepositoryConfigSchema
>
export type RepositoryInspection = z.infer<typeof repositoryInspectionSchema>
export type RepositoryCondition = z.infer<typeof repositoryConditionSchema>
