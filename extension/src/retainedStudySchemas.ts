import { z } from 'zod';
import { configuredStudySchema, configuredStudyMetadataSchema, configuredSelectionSchema } from './configuredStudySchemas';
import { studyArchiveSchema, studyMetadataSchema, selectionSchema } from './studySchemas';

// Union current formats without widening either historical schema's meaning.
export const retainedStudySchema = z.discriminatedUnion('version', [studyArchiveSchema, configuredStudySchema]);
export const retainedStudyMetadataSchema = z.discriminatedUnion('version', [studyMetadataSchema, configuredStudyMetadataSchema]);
export const retainedStudySelectionSchema = z.discriminatedUnion('profile', [selectionSchema, configuredSelectionSchema]);
export type RetainedStudy = z.infer<typeof retainedStudySchema>;
export type RetainedStudyMetadata = z.infer<typeof retainedStudyMetadataSchema>;
export type RetainedStudySelection = z.infer<typeof retainedStudySelectionSchema>;
