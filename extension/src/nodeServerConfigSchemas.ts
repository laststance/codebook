import { z } from 'zod'

import {
  CONFIGURED_OBSERVATION_LIMIT,
  NODE_SERVER_PORT_MAX,
  NODE_SERVER_PORT_MIN,
  REPOSITORY_CONFIG_LIMIT_BYTES,
} from './constants'
import { nodeTestStopSchema } from './nodeTestConfigSchemas'
import {
  nodeTestStopInspectionsSchema,
  repositoryBookSelectionSchema,
  repositorySourceStopSchema,
} from './repositoryConfigSchemas'
import { repositoryPathSchema } from './sourceSchemas'
import { addStopInspectionIssues } from './utils/addStopInspectionIssues'
import { describeNodeServerRequestBodyIssues } from './utils/describeNodeServerRequestBodyIssues'
import { nodeServerRequestPathProblem } from './utils/nodeServerRequestPathProblem'

/** The entry files node runs: TypeScript ones through the repository's own tsx, JavaScript ones directly. */
const ENTRY_EXTENSION = /\.(?:ts|mts|cts|js|mjs|cjs)$/
/** The entry extensions that need tsx, since plain node runs JavaScript only. */
const TYPESCRIPT_ENTRY_EXTENSION = /\.(?:ts|mts|cts)$/
const PORT_EXPECTATION = `expected an integer from ${NODE_SERVER_PORT_MIN} to ${NODE_SERVER_PORT_MAX}, the port the server's own code listens on.`
const CONTENT_TYPES = [
  'application/json',
  'text/plain',
  'application/x-www-form-urlencoded',
] as const

const entrySchema = repositoryPathSchema
  .refine(
    (path) => ENTRY_EXTENSION.test(path),
    'expected a .ts, .mts, .cts, .js, .mjs or .cjs file relative to packageRoot.',
  )
  // node receives the entry as a bare argument; a leading dash would be read as an option such as --inspect.
  .refine(
    (path) => !path.startsWith('-'),
    'expected an entry that does not begin with "-", which node would read as an option.',
  )

const requestSchema = z
  .strictObject({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], {
      error: 'expected GET, POST, PUT, PATCH or DELETE.',
    }),
    path: z.string().superRefine((path, context) => {
      const problem = nodeServerRequestPathProblem(path)
      if (problem)
        context.addIssue({
          code: 'custom',
          message: `expected a path on the server starting with "/", ${problem}.`,
        })
    }),
    contentType: z
      .enum(CONTENT_TYPES, {
        error: `expected ${CONTENT_TYPES.join(', ')}.`,
      })
      .optional(),
    body: z.string().optional(),
  })
  .superRefine((request, context) => {
    for (const { field, message } of describeNodeServerRequestBodyIssues(
      request,
      CONTENT_TYPES,
    ))
      context.addIssue({ code: 'custom', path: [field], message })
  })

/**
 * Bounds one node-server run before anything is spawned: the repository's own server entry (run by node, optionally through the repository's tsx), the port the server's own code listens on, one declared HTTP request, and the stops with their inspections.
 * No command, environment, port assignment or node option can be declared: Codebook starts only `node [--import <the repository's tsx>] <entry>` in `packageRoot` and checks the declared port.
 * The loader defaults from the entry's extension (TypeScript → `tsx`, JavaScript → `node`); a TypeScript entry declared with `node` is refused.
 * Parsed by the node-server start; its issues are worded by {@link describeNodeServerConfigurationIssues}.
 * @example
 * nodeServerConfigSchema.parse({ version: 1, adapter: 'node-server', book, entry: 'src/server.ts', port: 4100, request: { method: 'GET', path: '/api/healthz' }, source, inspections })
 * // => { ..., packageRoot: '.', loader: 'tsx', ... }
 */
export const nodeServerConfigSchema = z
  .strictObject({
    version: z.literal(1),
    adapter: z.literal('node-server'),
    book: repositoryBookSelectionSchema,
    packageRoot: z
      .union([z.literal('.'), repositoryPathSchema])
      .default('.')
      .describe(
        'The folder the server runs in, relative to the repository: "." or a package folder such as "apps/api".',
      ),
    entry: entrySchema.describe(
      'The server entry file, relative to packageRoot, as its package runs it (for example "src/server.ts").',
    ),
    loader: z
      .enum(['tsx', 'node'])
      .optional()
      .describe(
        'How node runs the entry: "tsx" through the repository\'s own tsx, "node" for a JavaScript entry. Defaults from the entry\'s extension.',
      ),
    port: z
      .number(PORT_EXPECTATION)
      .int(PORT_EXPECTATION)
      .min(NODE_SERVER_PORT_MIN, PORT_EXPECTATION)
      .max(NODE_SERVER_PORT_MAX, PORT_EXPECTATION)
      .describe(
        "The port the server's own code listens on. Codebook never sets PORT or any variable; it only checks this port.",
      ),
    request: requestSchema,
    source: repositorySourceStopSchema,
    inspections: nodeTestStopInspectionsSchema,
    additionalStops: z
      .array(nodeTestStopSchema)
      .max(
        CONFIGURED_OBSERVATION_LIMIT - 1,
        `expected at most ${CONFIGURED_OBSERVATION_LIMIT - 1} additional stops.`,
      )
      .optional(),
  })
  .superRefine((configuration, context) => {
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
    // Every requested stop needs a concrete value; type-only output cannot prove the server's runtime state.
    addStopInspectionIssues(configuration, context)
    if (
      Buffer.byteLength(JSON.stringify(configuration)) >
      REPOSITORY_CONFIG_LIMIT_BYTES
    )
      context.addIssue({
        code: 'custom',
        message: `expected a configuration of at most ${REPOSITORY_CONFIG_LIMIT_BYTES} bytes.`,
      })
  })
  .transform((configuration) => ({
    ...configuration,
    loader:
      configuration.loader ??
      (TYPESCRIPT_ENTRY_EXTENSION.test(configuration.entry)
        ? ('tsx' as const)
        : ('node' as const)),
  }))

export type NodeServerConfiguration = z.infer<typeof nodeServerConfigSchema>
