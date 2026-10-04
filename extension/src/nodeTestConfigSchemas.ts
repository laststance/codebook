import { z } from 'zod'

import {
  BOOK_TITLE_LIMIT_CHARS,
  CONFIGURED_OBSERVATION_LIMIT,
  NODE_TEST_TITLE_PATH_LIMIT,
  REPOSITORY_CONFIG_LIMIT_BYTES,
} from './constants'
import {
  repositoryBookSelectionSchema,
  repositorySourceStopSchema,
  stopInspectionsSchema,
} from './repositoryConfigSchemas'
import { repositoryHashSchema, repositoryPathSchema } from './sourceSchemas'
import { missingValueInspectionMessage } from './utils/missingValueInspectionMessage'

const testFileSchema = repositoryPathSchema
  .refine(
    (path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path),
    'Select a repository test or spec file.',
  )
  // Vitest receives this path as a bare argument; a leading dash would be parsed as an option such as --config.
  .refine(
    (path) => !path.startsWith('-'),
    'A test file path cannot begin with "-".',
  )
const testTitleSchema = z
  .string()
  .min(1)
  .max(BOOK_TITLE_LIMIT_CHARS)
  .regex(/^[^\x00-\x1f\x7f]+$/)
const nodeTestStopSchema = repositorySourceStopSchema.extend({
  anchorIndex: repositoryBookSelectionSchema.shape.anchorIndex,
  inspections: stopInspectionsSchema,
})

/** Bounds the intended repository-local Vitest test and its debugger observations before a Node runtime is acquired. @example nodeTestConfigSchema.parse({ version: 1, adapter: 'vitest-node', book, testFile: 'src/a.test.ts', testTitles: ['subscription', 'notifies once'], source, inspections }) */
export const nodeTestConfigSchema = z
  .strictObject({
    version: z.literal(1),
    adapter: z.literal('vitest-node'),
    book: repositoryBookSelectionSchema,
    testFile: testFileSchema,
    testHash: repositoryHashSchema,
    testName: testTitleSchema
      .optional()
      .describe(
        'Retired. Saved Node histories may contain it; a new run that sends it is refused. Cite the test with testTitles.',
      ),
    testTitles: z
      .array(testTitleSchema)
      .min(1)
      .max(NODE_TEST_TITLE_PATH_LIMIT)
      .optional()
      .describe(
        'Required for a new run: every enclosing describe title, outermost first, then the test title, exactly as Vitest reports them. Example: ["invoice data queries", "converts stored invoice cents to dollars for the edit form"].',
      ),
    source: repositorySourceStopSchema,
    inspections: stopInspectionsSchema,
    additionalStops: z
      .array(nodeTestStopSchema)
      .max(CONFIGURED_OBSERVATION_LIMIT - 1)
      .optional(),
  })
  .superRefine((configuration, context) => {
    // One citation names its test once; the retired field only remains for saved histories.
    if (
      configuration.testName !== undefined &&
      configuration.testTitles !== undefined
    )
      context.addIssue({
        code: 'custom',
        path: ['testName'],
        message: 'Cite the test with testTitles only.',
      })
    // Every requested stop needs a concrete value; type-only output cannot prove the test's runtime state. The refusal names the stop and what it declares.
    for (const [index, inspections] of [
      configuration.inspections,
      ...(configuration.additionalStops ?? []).map((stop) => stop.inspections),
    ].entries()) {
      const missingValueInspection = missingValueInspectionMessage(
        inspections,
        index
          ? `configuration.additionalStops[${index - 1}].inspections`
          : 'configuration.inspections',
      )
      if (!missingValueInspection) continue
      context.addIssue({
        code: 'custom',
        path: index
          ? ['additionalStops', index - 1, 'inspections']
          : ['inspections'],
        message: missingValueInspection,
      })
    }
    if (
      Buffer.byteLength(JSON.stringify(configuration)) >
      REPOSITORY_CONFIG_LIMIT_BYTES
    )
      context.addIssue({
        code: 'custom',
        message: `Node test configuration exceeds ${REPOSITORY_CONFIG_LIMIT_BYTES} bytes.`,
      })
  })

export type NodeTestConfiguration = z.infer<typeof nodeTestConfigSchema>
