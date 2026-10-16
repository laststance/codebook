import { z } from 'zod'

import {
  APPLICATION_GROUP_MARKER_VERSION,
  STUDY_GROUPS_MARKER_VERSION,
} from './constants'
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

/** The record {@link StudyWorkspace} persists under {@link APPLICATION_GROUP_MARKER_KEY} when it names two or more groups it created that a reload would leave empty (the Application's group and the Study Context's created group, finding 599): the same fields as {@link applicationGroupMarkerSchema}, with the `columns` of those groups at the main layout Codebook confirmed last. */
export const studyGroupsMarkerSchema = z.strictObject({
  version: z.literal(STUDY_GROUPS_MARKER_VERSION),
  writer: z.string().min(1),
  columns: z.array(z.number().int().positive()).min(2),
  groupCount: z.number().int().positive(),
  layout: editorLayoutSchema,
})

/** Codebook's persisted proof of two or more groups it created; see {@link studyGroupsMarkerSchema}. */
export type StudyGroupsMarker = z.infer<typeof studyGroupsMarkerSchema>

/** Either record as {@link parseRecordedStudyGroups} reads it, whatever its version: the writer, the columns of the groups it names, the main grid's group count and its layout. */
export type RecordedStudyGroups = Omit<StudyGroupsMarker, 'version'>
