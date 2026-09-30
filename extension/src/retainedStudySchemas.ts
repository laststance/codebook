import { z } from 'zod'
import {
  configuredStudySchema,
  configuredStudyMetadataSchema,
  configuredSelectionSchema,
} from './configuredStudySchemas'

// Only configured repository studies grant current reading or selection capabilities.
export const retainedStudySchema = configuredStudySchema
export const retainedStudyMetadataSchema = configuredStudyMetadataSchema
export const retainedStudySelectionSchema = configuredSelectionSchema
export type RetainedStudy = z.infer<typeof retainedStudySchema>
export type RetainedStudyMetadata = z.infer<typeof retainedStudyMetadataSchema>
export type RetainedStudySelection = z.infer<
  typeof retainedStudySelectionSchema
>
