import { z } from 'zod'

import { BOOK_MAX_LINKS } from './constants'
import {
  repositorySelectionSchema,
  type RepositorySelection,
} from './learnerSchemas'
import type { RepositoryBookStore } from './repositoryBook'
import type { RepositorySourceService } from './repositorySource'
import type { citationLearningState } from './utils/citationLearningState'

export const repositoryActionSchema = z.enum([
  'refresh',
  'latest',
  'source',
  'current-file',
  'connect',
  'retry',
])
const identity = { revision: z.number().int().nonnegative() }
export const repositoryMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('rendered'),
    ...identity,
    selection: repositorySelectionSchema.optional(),
    width: z.number().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('select'),
    ...identity,
    selection: repositorySelectionSchema,
  }),
  z.strictObject({
    type: z.literal('location'),
    ...identity,
    selection: repositorySelectionSchema,
  }),
  z.strictObject({
    type: z.literal('action'),
    ...identity,
    action: repositoryActionSchema,
  }),
  z.strictObject({
    type: z.literal('understanding'),
    ...identity,
    understood: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('evidence'),
    ...identity,
    selection: repositorySelectionSchema,
    linkIndex: z
      .number()
      .int()
      .min(0)
      .max(BOOK_MAX_LINKS - 1),
    recording: z.boolean(),
  }),
])
export interface RepositoryViewMessage {
  type: 'repository'
  revision: number
  loading: boolean
  saving: boolean
  error?: string
  catalog: Awaited<ReturnType<RepositoryBookStore['list']>>
  selection?: RepositorySelection
  book?: Omit<Awaited<ReturnType<RepositoryBookStore['read']>>, 'revision'> & {
    revision: Omit<
      Awaited<ReturnType<RepositoryBookStore['read']>>['revision'],
      'sources'
    >
  }
  sources: Awaited<ReturnType<RepositorySourceService['inspect']>>
  understanding?: ReturnType<typeof citationLearningState>
}

/** The reader's request that the Repository Wiki's document post `ready` again: {@link RepositoryReader} sends it once the pane is shown after a `ready` reached it while the pane still counted as hidden, which it cannot take for the shown document's (CR5-6); the document's script ({@link repositoryHtml}) answers it with `ready`. */
export type RepositoryReadyRequest = { type: 'announce-ready' }
