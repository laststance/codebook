import { z } from 'zod'

import { APPLICATION_GROUP_MARKER_VERSION } from './constants'
import { editorLayoutSchema } from './utils/isProportionalEditorLayout'

/** The record {@link StudyWorkspace} persists under {@link APPLICATION_GROUP_MARKER_KEY} once the layout of the Application group it claimed is confirmed: the reader that wrote it (a group of the same reader is still known to it, so only an earlier window's record proves a leftover), the group's column, the main grid's group count and that confirmed layout. */
export const applicationGroupMarkerSchema = z.strictObject({
  version: z.literal(APPLICATION_GROUP_MARKER_VERSION),
  writer: z.string().min(1),
  column: z.number().int().positive(),
  groupCount: z.number().int().positive(),
  layout: editorLayoutSchema,
})

/** Codebook's persisted proof of the Application group it claimed; see {@link applicationGroupMarkerSchema}. */
export type ApplicationGroupMarker = z.infer<
  typeof applicationGroupMarkerSchema
>
