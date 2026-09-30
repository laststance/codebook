import { z } from 'zod'
import {
  BOOK_MAX_ANCHORS,
  BOOK_MAX_EDGES,
  BOOK_MAX_LINKS,
  BOOK_MAX_NODES,
  BOOK_MAX_REVISIONS,
  BOOK_MAX_SECTIONS,
  BOOK_MAX_SOURCES,
  BOOK_SCHEMA_VERSION,
  BOOK_SCHEMA_VERSION_V2,
  BOOK_SECTION_LIMIT_CHARS,
  BOOK_TITLE_LIMIT_CHARS,
  KEY_LENGTH_LIMIT,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from './constants'
import { itemSchema } from './studySchemas'
import { studyIdSchema } from './legacyStudySchemas'
import {
  bookAnchorSchema,
  repositoryHashSchema,
  repositoryPathSchema,
} from './sourceSchemas'
import { bookIdSchema, learningItemSchema } from './identitySchemas'
export { bookIdSchema } from './identitySchemas'
export {
  bookAnchorSchema,
  repositoryHashSchema,
  repositoryPathSchema,
} from './sourceSchemas'

export const repositorySourceSchema = z.strictObject({
  path: repositoryPathSchema,
  hash: repositoryHashSchema,
  text: z.string().max(REPOSITORY_SOURCE_LIMIT_BYTES),
  lineCount: z.number().int().positive(),
})
export const sourceListSchema = z.strictObject({
  instanceId: z.uuid(),
  cursor: z
    .string()
    .regex(/^[a-f0-9]{64}:(0|[1-9]\d*)$/)
    .optional(),
})
export const sourceReadSchema = z.strictObject({
  instanceId: z.uuid(),
  path: repositoryPathSchema,
  expectedHash: repositoryHashSchema.optional(),
})
export const bookObservationLinkSchema = z.strictObject({
  studyId: studyIdSchema,
  observationId: z.string().min(1).max(KEY_LENGTH_LIMIT),
  sourceHash: repositoryHashSchema,
})
export const bookNodeSchema = z.strictObject({
  id: bookIdSchema,
  title: z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS),
  sections: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS),
        text: z.string().min(1).max(BOOK_SECTION_LIMIT_CHARS),
      }),
    )
    .min(1)
    .max(BOOK_MAX_SECTIONS),
  anchors: z.array(bookAnchorSchema).min(1).max(BOOK_MAX_ANCHORS),
  observations: z.array(bookObservationLinkSchema).max(BOOK_MAX_LINKS),
  learningItemId: itemSchema.optional(),
})
export const bookDocumentSchema = z
  .strictObject({
    title: z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS),
    summary: z.string().min(1).max(BOOK_SECTION_LIMIT_CHARS),
    nodes: z.array(bookNodeSchema).min(1).max(BOOK_MAX_NODES),
    edges: z
      .array(
        z.strictObject({
          from: bookIdSchema,
          to: bookIdSchema,
          relationship: z.enum(['calls', 'uses', 'contains', 'related']),
          explanation: z.string().min(1).max(BOOK_SECTION_LIMIT_CHARS),
        }),
      )
      .max(BOOK_MAX_EDGES),
  })
  .superRefine((document, context) => {
    const identities = new Set(document.nodes.map((node) => node.id))
    if (identities.size !== document.nodes.length)
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'Node IDs must be unique.',
      })
    // A relation is authored interpretation; valid endpoints do not make it an observed call path.
    document.edges.forEach((edge, index) => {
      if (!identities.has(edge.from) || !identities.has(edge.to))
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message:
            'Both relationship endpoints must name nodes in this document.',
        })
    })
  })
export const publishBookSchema = z.strictObject({
  instanceId: z.uuid(),
  bookId: bookIdSchema,
  key: z.string().min(1).max(KEY_LENGTH_LIMIT),
  expectedRevision: z.number().int().nonnegative(),
  document: bookDocumentSchema,
})
export const bookPublishIntentSchema = publishBookSchema.omit({
  instanceId: true,
})
export const openBookSchema = z.strictObject({
  instanceId: z.uuid(),
  bookId: bookIdSchema,
  revision: z.number().int().positive(),
  nodeId: bookIdSchema,
  anchorIndex: z
    .number()
    .int()
    .nonnegative()
    .max(BOOK_MAX_ANCHORS - 1)
    .optional(),
})
export const bookObservationBindingSchema = bookObservationLinkSchema.extend({
  nodeId: bookIdSchema,
  linkIndex: z
    .number()
    .int()
    .nonnegative()
    .max(BOOK_MAX_LINKS - 1),
  itemId: z.never(),
  observationHash: repositoryHashSchema,
  elapsedMs: z.number().nonnegative(),
  outcome: z.string().min(1).max(KEY_LENGTH_LIMIT),
})
export const bookRevisionSchema = z.strictObject({
  revision: z.number().int().positive(),
  key: z.string().min(1).max(KEY_LENGTH_LIMIT),
  inputDigest: repositoryHashSchema,
  expectedRevision: z.number().int().nonnegative(),
  publishedAt: z.iso.datetime(),
  document: bookDocumentSchema,
  sources: z.array(repositorySourceSchema).min(1).max(BOOK_MAX_SOURCES),
  sourceChecks: z
    .array(
      z.strictObject({
        path: repositoryPathSchema,
        hash: repositoryHashSchema,
        acquiredAt: z.iso.datetime(),
        checkedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(BOOK_MAX_SOURCES),
  observations: z
    .array(bookObservationBindingSchema)
    .max(BOOK_MAX_NODES * BOOK_MAX_LINKS),
  hash: repositoryHashSchema,
})
export const repositoryBookSchema = z.strictObject({
  version: z.literal(BOOK_SCHEMA_VERSION),
  workspaceKey: repositoryHashSchema,
  bookId: bookIdSchema,
  revisions: z.array(bookRevisionSchema).min(1).max(BOOK_MAX_REVISIONS),
})
// Keep v1 closed and preserve field ordering so copied revisions retain their original hashes.
export const bookObservationBindingV2Schema =
  bookObservationBindingSchema.extend({ itemId: learningItemSchema })
export const bookRevisionV2Schema = bookRevisionSchema.extend({
  observations: z
    .array(bookObservationBindingV2Schema)
    .max(BOOK_MAX_NODES * BOOK_MAX_LINKS),
})
export const repositoryBookV2Schema = repositoryBookSchema.extend({
  version: z.literal(BOOK_SCHEMA_VERSION_V2),
  revisions: z.array(bookRevisionV2Schema).min(1).max(BOOK_MAX_REVISIONS),
})
export type RepositorySource = z.infer<typeof repositorySourceSchema>
export type SourceListInput = z.infer<typeof sourceListSchema>
export type SourceReadInput = z.infer<typeof sourceReadSchema>
export type BookDocument = z.infer<typeof bookDocumentSchema>
export type BookNode = z.infer<typeof bookNodeSchema>
export type BookAnchor = z.infer<typeof bookAnchorSchema>
export type BookObservationLink = z.infer<typeof bookObservationLinkSchema>
export type PublishBookInput = z.infer<typeof publishBookSchema>
export type OpenBookInput = z.infer<typeof openBookSchema>
export type BookPublishIntent = z.infer<typeof bookPublishIntentSchema>
export type BookRevision = z.infer<typeof bookRevisionV2Schema>
export type RepositoryBook = z.infer<typeof repositoryBookV2Schema>
export type BookObservationBinding = z.infer<
  typeof bookObservationBindingV2Schema
>
