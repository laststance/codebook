import { z } from 'zod'

import { BOOK_ID_LIMIT_CHARS } from './constants'

// Stable repository identities are shared by authoring, runtime descriptors and learner history.
export const bookIdSchema = z
  .string()
  .min(1)
  .max(BOOK_ID_LIMIT_CHARS)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
export const repositoryItemSchema = z.string().refine((value) => {
  const [prefix, bookId, nodeId, extra] = value.split('/')
  return (
    prefix === 'repository' &&
    extra === undefined &&
    bookIdSchema.safeParse(bookId).success &&
    bookIdSchema.safeParse(nodeId).success
  )
}, 'Use repository/<bookId>/<nodeId> with stable book and node IDs.')
export const learningItemSchema = repositoryItemSchema
