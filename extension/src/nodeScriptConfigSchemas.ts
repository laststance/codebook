import { z } from 'zod'

import {
  addNodeRunConfigurationIssues,
  nodeAdditionalStopsSchema,
  nodeEntrySchema,
  nodeLoaderSchema,
  nodePackageRootSchema,
  withDefaultNodeLoader,
} from './nodeServerConfigSchemas'
import {
  nodeTestStopInspectionsSchema,
  repositoryBookSelectionSchema,
  repositorySourceStopSchema,
} from './repositoryConfigSchemas'
import { repositoryPathSchema } from './sourceSchemas'

/**
 * The shape of the optional `library` declaration of a `node-script` configuration (MCP API 1.33): the repository's own library package the Example should run on.
 * Only the shape is checked here; whether the folder is a real package inside the repository, a dependency of the Example and outside it is the library build's refusal (`LIBRARY_BUILD_UNSUPPORTED`).
 * @example
 * nodeScriptLibrarySchema.parse({ packageRoot: 'packages/toolkit' }) // => { packageRoot: 'packages/toolkit' }
 */
const nodeScriptLibrarySchema = z
  .strictObject({
    packageRoot: z
      .union([z.literal('.'), repositoryPathSchema])
      .describe(
        'The folder of the repository\'s own library package, relative to the repository root ("." or a folder such as "packages/toolkit"). Codebook builds and packs it with the repository\'s package manager so the Example runs on the checked-out library instead of its installed copy.',
      ),
  })
  .describe(
    "Optional. Run the Example on the library package of the opened repository (built and packed by Codebook) instead of the copy installed in the Example's node_modules.",
  )

/**
 * Bounds one Node script run before anything is spawned: the repository's own script entry (run once by node, optionally through the repository's tsx) and the stops with their inspections.
 * No port, request, environment, node option or script argument can be declared, so the strict schema refuses them: Codebook starts only `node [--import <the repository's tsx>] <entry>` in `packageRoot`.
 * The loader defaults from the entry's extension (TypeScript → `tsx`, JavaScript → `node`); a TypeScript entry declared with `node` is refused, and so is an entry beginning with `-`.
 * Reuses the node-server entry, loader, package-root, stop and refinement rules so both profiles share one rule set; parsed by the node-script start.
 * @example
 * nodeScriptConfigSchema.parse({ version: 1, adapter: 'node-script', book, entry: 'check.mjs', source, inspections })
 * // => { ..., packageRoot: '.', loader: 'node', ... }
 */
export const nodeScriptConfigSchema = z
  .strictObject({
    version: z.literal(1),
    adapter: z.literal('node-script'),
    book: repositoryBookSelectionSchema,
    packageRoot: nodePackageRootSchema,
    entry: nodeEntrySchema.describe(
      'The script file node runs once, relative to packageRoot, exactly as its package runs it (for example "test-esm.mjs").',
    ),
    loader: nodeLoaderSchema,
    library: nodeScriptLibrarySchema.optional(),
    source: repositorySourceStopSchema,
    inspections: nodeTestStopInspectionsSchema,
    additionalStops: nodeAdditionalStopsSchema,
  })
  .superRefine(addNodeRunConfigurationIssues)
  .transform(withDefaultNodeLoader)

export type NodeScriptConfiguration = z.infer<typeof nodeScriptConfigSchema>
