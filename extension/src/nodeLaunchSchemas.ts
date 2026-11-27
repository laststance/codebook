import { z } from 'zod'

import {
  BUN_LOADER_API,
  BUN_MINIMUM_VERSION,
  NODE_SERVER_PORT_MAX,
  NODE_SERVER_PORT_MIN,
} from './constants'
import { repositoryPathSchema } from './sourceSchemas'

// The launch fields every Node process Codebook starts declares (entry, folder, loader, port), kept free of the repository configuration schemas so the node-server and node-script configurations and the `apiServer` declaration of a version 3 `expo-web-dev` configuration share them without an import cycle. `nodeServerConfigSchemas` re-exports them for its existing importers.

/** The entry files node runs: TypeScript ones through the repository's own tsx, JavaScript ones directly. */
const ENTRY_EXTENSION = /\.(?:ts|mts|cts|js|mjs|cjs)$/
/** The entry extensions that need tsx, since plain node runs JavaScript only. */
const TYPESCRIPT_ENTRY_EXTENSION = /\.(?:ts|mts|cts)$/
const PORT_EXPECTATION = `expected an integer from ${NODE_SERVER_PORT_MIN} to ${NODE_SERVER_PORT_MAX}, the port the server's own code listens on.`

/** The entry file of a repository Node run, shared by the node-server, node-script and `apiServer` declarations. */
export const nodeEntrySchema = repositoryPathSchema
  .refine(
    (path) => ENTRY_EXTENSION.test(path),
    'expected a .ts, .mts, .cts, .js, .mjs or .cjs file relative to packageRoot.',
  )
  // node receives the entry as a bare argument; a leading dash would be read as an option such as --inspect.
  .refine(
    (path) => !path.startsWith('-'),
    'expected an entry that does not begin with "-", which node would read as an option.',
  )

/** The folder a repository Node run executes in: `"."` or a package folder, without a default. */
export const nodePackageFolderSchema = z.union([
  z.literal('.'),
  repositoryPathSchema,
])

/** The folder a repository Node run executes in: `"."` or a package folder; shared with the node-script configuration. */
export const nodePackageRootSchema = nodePackageFolderSchema
  .default('.')
  .describe(
    'The folder the process runs in, relative to the repository: "." or a package folder such as "apps/api".',
  )

/** How node runs the entry (`tsx` or `node`); shared with the node-script configuration. */
export const nodeLoaderSchema = z
  .enum(['tsx', 'node'])
  .optional()
  .describe(
    'How node runs the entry: "tsx" through the repository\'s own tsx, "node" for a JavaScript entry. Defaults from the entry\'s extension.',
  )

/** Every loader a Node run's declaration can name: the shared `tsx` and `node`, and `bun`, which only a node-server declaration accepts ({@link nodeServerLoaderSchema}). */
export type NodeRunLoader = 'tsx' | 'node' | 'bun'

/**
 * How a node-server runs its entry: the shared `tsx` and `node` loaders, or `bun`, which runs the entry on the Bun runtime (Cycle 0152).
 * Why separate: the node-script and `apiServer` routes launch Node only, so `bun` stays out of {@link nodeLoaderSchema}, which they share.
 * Used by the node-server configuration schema; `bun` is never a default, only a declared choice.
 */
export const nodeServerLoaderSchema = z
  .enum(['tsx', 'node', 'bun'])
  .optional()
  .describe(
    `How the server runs its entry: "tsx" through the repository's own tsx, "node" for a JavaScript entry, "bun" on the Bun runtime (API ${BUN_LOADER_API}; Bun ${BUN_MINIMUM_VERSION} or later on the PATH or in ~/.bun/bin). Defaults from the entry's extension; "bun" is used only when declared.`,
  )

/**
 * The port a repository Node server listens on, as its own code binds it.
 * Shared by {@link nodeServerConfigSchema} and the `apiServer` declaration of a version 3 `expo-web-dev` configuration.
 */
export const nodeServerPortSchema = z
  .number(PORT_EXPECTATION)
  .int(PORT_EXPECTATION)
  .min(NODE_SERVER_PORT_MIN, PORT_EXPECTATION)
  .max(NODE_SERVER_PORT_MAX, PORT_EXPECTATION)
  .describe(
    "The port the server's own code listens on. Codebook never sets PORT or any variable; it only checks this port.",
  )

/**
 * Refuses a TypeScript entry declared with the plain `node` loader, which runs JavaScript only.
 *
 * Called from the `superRefine` of {@link nodeServerConfigSchema}, the node-script configuration schema and the `apiServer` declaration, so one rule serves all three.
 *
 * @param configuration - The parsed entry and optional loader.
 * @param context - The refinement context that receives the issue at `loader`.
 */
export function addNodeLoaderIssue(
  configuration: { entry: string; loader?: NodeRunLoader | undefined },
  context: z.RefinementCtx,
): void {
  if (
    configuration.loader === 'node' &&
    TYPESCRIPT_ENTRY_EXTENSION.test(configuration.entry)
  )
    context.addIssue({
      code: 'custom',
      path: ['loader'],
      message:
        'expected "tsx" for a TypeScript entry; plain node runs JavaScript entries only.',
    })
}

/**
 * Fills the loader from the entry's extension: TypeScript runs through tsx, JavaScript through node.
 *
 * @param configuration - A parsed configuration with an entry and an optional loader.
 * @returns The configuration with a concrete loader.
 */
export function withDefaultNodeLoader<
  Configuration extends { entry: string; loader?: NodeRunLoader | undefined },
>(
  configuration: Configuration,
): Omit<Configuration, 'loader'> & {
  loader: NonNullable<Configuration['loader']> | 'tsx' | 'node'
} {
  return {
    ...configuration,
    loader:
      configuration.loader ??
      (TYPESCRIPT_ENTRY_EXTENSION.test(configuration.entry)
        ? ('tsx' as const)
        : ('node' as const)),
  }
}
