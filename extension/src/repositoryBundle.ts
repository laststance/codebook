import { z } from 'zod'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from './constants'
import type { SourceMapLimits } from './sourceMapLimits'

// The configured browser adapter supports flat v3 maps with retained originals and an empty source root.
export const mapSchema = z.object({
  version: z.literal(3),
  file: z.string().default(''),
  sources: z.array(z.string()).min(1),
  sourcesContent: z.array(z.string()),
  names: z.array(z.string()),
  mappings: z.string().min(1),
  sourceRoot: z.literal('').default(''),
  sections: z.never().optional(),
})
/**
 * Builds the schema of a sealed bundle under one adapter's byte limits.
 *
 * Why it exists: the JavaScript and map byte refinements were fixed at 8 MiB and 16 MiB, which rejects a Metro bundle before the verifier reads it. Called by {@link createBundleVerifier} with the run's limits.
 * @param limits - The adapter's size limits; only the byte limits apply here.
 * @returns A strict schema whose `javascript` and `sourceMap` refinements use the limits.
 * @example bundleSchemaOf(DEFAULT_SOURCE_MAP_LIMITS).parse(bundle) // => the bundle
 */
export function bundleSchemaOf(limits: SourceMapLimits) {
  return z.strictObject({
    sourcePath: z.string().min(1),
    mapSource: z.string().min(1),
    scriptUrl: z.string().min(1),
    source: z
      .string()
      .refine(
        (value) => Buffer.byteLength(value) <= REPOSITORY_SOURCE_LIMIT_BYTES,
        'Original exceeds byte limit',
      ),
    javascript: z
      .string()
      .refine(
        (value) => Buffer.byteLength(value) <= limits.bundleBytes,
        'JavaScript exceeds byte limit',
      ),
    sourceMap: z
      .string()
      .refine(
        (value) => Buffer.byteLength(value) <= limits.mapBytes,
        'Map exceeds byte limit',
      ),
    chunkPath: z.string(),
    chunkHash: z.string().regex(/^[a-f\d]{64}$/),
    // An inline page script: where its text starts in the page (zero-based), because the browser reports its positions in the whole page's coordinates while `javascript` holds the script text alone.
    scriptStart: z
      .strictObject({
        line: z.number().int().min(0),
        column: z.number().int().min(0),
      })
      .optional(),
  })
}
/** A sealed bundle: the shape every limit profile of {@link bundleSchemaOf} accepts. */
export type BundleSource = z.infer<ReturnType<typeof bundleSchemaOf>>
