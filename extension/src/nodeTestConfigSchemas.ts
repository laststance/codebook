import { z } from 'zod';
import { BOOK_TITLE_LIMIT_CHARS, CONFIGURED_OBSERVATION_LIMIT, REPOSITORY_CONFIG_LIMIT_BYTES, REPOSITORY_INSPECTION_LIMIT } from './constants';
import { repositoryHashSchema, repositoryPathSchema } from './sourceSchemas';
import { repositoryBookSelectionSchema, repositoryInspectionSchema, repositorySourceStopSchema } from './repositoryConfigSchemas';

const testFileSchema = repositoryPathSchema.refine(path => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path), 'Select a repository test or spec file.');
const nodeTestStopSchema = repositorySourceStopSchema.extend({
  anchorIndex: repositoryBookSelectionSchema.shape.anchorIndex,
  inspections: z.array(repositoryInspectionSchema).min(1).max(REPOSITORY_INSPECTION_LIMIT),
});

/** Bounds the intended repository-local Vitest test and its debugger observations before a Node runtime is acquired. @example nodeTestConfigSchema.parse({ version: 1, adapter: 'vitest-node', book, testFile: 'src/a.test.ts', source, inspections }) */
export const nodeTestConfigSchema = z.strictObject({
  version: z.literal(1),
  adapter: z.literal('vitest-node'),
  book: repositoryBookSelectionSchema,
  testFile: testFileSchema,
  testHash: repositoryHashSchema,
  testName: z.string().min(1).max(BOOK_TITLE_LIMIT_CHARS).regex(/^[^\x00-\x1f\x7f]+$/).optional(),
  source: repositorySourceStopSchema,
  inspections: z.array(repositoryInspectionSchema).min(1).max(REPOSITORY_INSPECTION_LIMIT),
  additionalStops: z.array(nodeTestStopSchema).max(CONFIGURED_OBSERVATION_LIMIT - 1).optional(),
}).superRefine((configuration, context) => {
  // Every requested stop needs a concrete value; type-only output cannot prove the test's runtime state.
  for (const [index, inspections] of [configuration.inspections, ...(configuration.additionalStops ?? []).map(stop => stop.inspections)].entries()) {
    if (inspections.some(inspection => inspection.required && inspection.mode === 'value')) continue;
    context.addIssue({ code: 'custom', path: index ? ['additionalStops', index - 1, 'inspections'] : ['inspections'], message: 'At least one required value inspection is needed.' });
  }
  if (Buffer.byteLength(JSON.stringify(configuration)) > REPOSITORY_CONFIG_LIMIT_BYTES) context.addIssue({ code: 'custom', message: `Node test configuration exceeds ${REPOSITORY_CONFIG_LIMIT_BYTES} bytes.` });
});

export type NodeTestConfiguration = z.infer<typeof nodeTestConfigSchema>;
