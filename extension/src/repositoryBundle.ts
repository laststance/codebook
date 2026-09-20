import { z } from 'zod';
import { REPOSITORY_JAVASCRIPT_LIMIT_BYTES, REPOSITORY_MAP_LIMIT_BYTES, REPOSITORY_SOURCE_LIMIT_BYTES } from './constants';

// The configured browser adapter supports flat v3 maps with retained originals and an empty source root.
export const mapSchema = z.object({ version: z.literal(3), file: z.string().default(''),
  sources: z.array(z.string()).min(1), sourcesContent: z.array(z.string()), names: z.array(z.string()),
  mappings: z.string().min(1), sourceRoot: z.literal('').default(''), sections: z.never().optional() });
export const bundleSchema = z.strictObject({
  sourcePath: z.string().min(1), mapSource: z.string().min(1), scriptUrl: z.string().min(1),
  source: z.string().refine(value => Buffer.byteLength(value) <= REPOSITORY_SOURCE_LIMIT_BYTES, 'Original exceeds byte limit'),
  javascript: z.string().refine(value => Buffer.byteLength(value) <= REPOSITORY_JAVASCRIPT_LIMIT_BYTES, 'JavaScript exceeds byte limit'),
  sourceMap: z.string().refine(value => Buffer.byteLength(value) <= REPOSITORY_MAP_LIMIT_BYTES, 'Map exceeds byte limit'),
  chunkPath: z.string(), chunkHash: z.string().regex(/^[a-f\d]{64}$/),
});
export type BundleSource = z.infer<typeof bundleSchema>;
