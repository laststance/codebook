import { z } from 'zod'

import { BOOK_MAX_ANCHORS } from './constants'
import { bookAnchorSchema, repositoryHashSchema } from './sourceSchemas'
import { citationContext } from './utils/citationContext'

// Preserve the exact existing canonical context across reader, configured runtime and learner formats.
export const citationContextSchema = z
  .strictObject({
    kind: z.literal('citations'),
    hash: repositoryHashSchema,
    anchors: z.array(bookAnchorSchema).min(1).max(BOOK_MAX_ANCHORS),
  })
  .refine(
    (context) =>
      JSON.stringify(context) ===
      JSON.stringify(citationContext(context.anchors)),
    'Citation context must have a verified canonical hash and deduplicated ordering.',
  )
