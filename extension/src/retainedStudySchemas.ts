import { z } from 'zod';
import { configuredStudySchema, configuredStudyMetadataSchema } from './configuredStudySchemas';
import { studyArchiveSchema, studyMetadataSchema } from './studySchemas';

// Union current formats without widening either historical schema's meaning.
export const retainedStudySchema = z.discriminatedUnion('version', [studyArchiveSchema, configuredStudySchema]);
export const retainedStudyMetadataSchema = z.discriminatedUnion('version', [studyMetadataSchema, configuredStudyMetadataSchema]);
export type RetainedStudy = z.infer<typeof retainedStudySchema>;
export type RetainedStudyMetadata = z.infer<typeof retainedStudyMetadataSchema>;
