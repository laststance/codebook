import { z } from 'zod'

import {
  ASK_LEARNER_SECRET,
  CONFIGURED_OBSERVATION_LIMIT,
  NODE_SERVER_PORT_MAX,
  NODE_SERVER_PORT_MIN,
  NODE_SERVER_SIGN_IN_FIELD_LIMIT_CHARS,
  NODE_SERVER_SIGN_IN_FIELDS_MAX,
  NODE_SERVER_SIGN_IN_SECRET_FIELD_LIMIT_CHARS,
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
import { isSecretName } from './utils/isSecretName'
import { nodeServerRequestPathProblem } from './utils/nodeServerRequestPathProblem'
import { redactSecretText } from './utils/redactSecretText'

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

/** The entry file of a repository Node run, shared by {@link nodeServerConfigSchema} and the node-script configuration. */
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

/** The folder a repository Node run executes in: `"."` or a package folder; shared with the node-script configuration. */
export const nodePackageRootSchema = z
  .union([z.literal('.'), repositoryPathSchema])
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

/** The extra stops of a Node profile run, capped at the configured observation limit; shared with the node-script configuration. */
export const nodeAdditionalStopsSchema = z
  .array(nodeTestStopSchema)
  .max(
    CONFIGURED_OBSERVATION_LIMIT - 1,
    `expected at most ${CONFIGURED_OBSERVATION_LIMIT - 1} additional stops.`,
  )
  .optional()

/**
 * Refuses a TypeScript entry declared with the plain `node` loader, which runs JavaScript only.
 *
 * Called from the `superRefine` of {@link nodeServerConfigSchema} and the node-script configuration schema.
 *
 * @param configuration - The parsed entry and optional loader.
 * @param context - The refinement context that receives the issue.
 */
function addNodeLoaderIssue(
  configuration: { entry: string; loader?: 'tsx' | 'node' | undefined },
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
  Configuration extends { entry: string; loader?: 'tsx' | 'node' | undefined },
>(
  configuration: Configuration,
): Omit<Configuration, 'loader'> & { loader: 'tsx' | 'node' } {
  return {
    ...configuration,
    loader:
      configuration.loader ??
      (TYPESCRIPT_ENTRY_EXTENSION.test(configuration.entry)
        ? ('tsx' as const)
        : ('node' as const)),
  }
}

/**
 * Adds the issues every Node profile declaration shares: a TypeScript entry with the node loader, a stop without a required value inspection, and a declaration over the byte limit.
 *
 * Called as the `superRefine` of {@link nodeServerConfigSchema} and the node-script configuration schema, so both profiles keep one rule set.
 *
 * @param configuration - The parsed declaration (entry, loader, stops and inspections).
 * @param context - The refinement context that receives the issues.
 */
export function addNodeRunConfigurationIssues(
  configuration: Parameters<typeof addStopInspectionIssues>[0] &
    Parameters<typeof addNodeLoaderIssue>[0],
  context: z.RefinementCtx,
): void {
  addNodeLoaderIssue(configuration, context)
  // Every requested stop needs a concrete value; type-only output cannot prove the process's runtime state.
  addStopInspectionIssues(configuration, context)
  if (
    Buffer.byteLength(JSON.stringify(configuration)) >
    REPOSITORY_CONFIG_LIMIT_BYTES
  )
    context.addIssue({
      code: 'custom',
      message: `expected a configuration of at most ${REPOSITORY_CONFIG_LIMIT_BYTES} bytes.`,
    })
}

/** A path on the server, refused with the same words for the declared request and for `signIn`. */
const serverPathSchema = z.string().superRefine((path, context) => {
  const problem = nodeServerRequestPathProblem(path)
  if (problem)
    context.addIssue({
      code: 'custom',
      message: `expected a path on the server starting with "/", ${problem}.`,
    })
})

const SIGN_IN_FIELD_TEXT = `expected a non-empty string of at most ${NODE_SERVER_SIGN_IN_FIELD_LIMIT_CHARS} characters.`

/**
 * The one sign-in request a node-server run sends before its declared request: POST JSON of `fields` plus the learner's typed secret under `secretField`.
 * Why: an authenticated route answers 401 before its handler runs; the learner types the password into the editor's masked box, so it is never in the configuration or the chat. Each refusal names its field path and never quotes the refused value.
 * Parsed as the optional `signIn` of {@link nodeServerConfigSchema}.
 * @example
 * signInSchema.parse({ path: '/api/auth/sign-in/email', fields: { email: 'learner@example.test' }, secretField: 'password', secret: 'ask-learner' })
 */
export const signInSchema = z
  .strictObject({
    path: serverPathSchema.describe(
      'The sign-in route, from the server root (for example "/api/auth/sign-in/email"); always sent as POST with content-type application/json.',
    ),
    fields: z
      .record(
        z
          .string(SIGN_IN_FIELD_TEXT)
          .min(1, SIGN_IN_FIELD_TEXT)
          .max(NODE_SERVER_SIGN_IN_FIELD_LIMIT_CHARS, SIGN_IN_FIELD_TEXT),
        z
          .string(SIGN_IN_FIELD_TEXT)
          .min(1, SIGN_IN_FIELD_TEXT)
          .max(NODE_SERVER_SIGN_IN_FIELD_LIMIT_CHARS, SIGN_IN_FIELD_TEXT),
      )
      .describe(
        "The account's non-secret fields, such as its email; ask the learner which account to use. Never a password: name that field in secretField.",
      ),
    secretField: z
      .string()
      .min(1, 'expected the body key the password is sent under.')
      .max(
        NODE_SERVER_SIGN_IN_SECRET_FIELD_LIMIT_CHARS,
        `expected a key of at most ${NODE_SERVER_SIGN_IN_SECRET_FIELD_LIMIT_CHARS} characters.`,
      )
      .describe(
        'The body key the learner\'s typed secret is sent under (for example "password").',
      ),
    secret: z.literal(ASK_LEARNER_SECRET, {
      error: `expected "${ASK_LEARNER_SECRET}": the learner types the secret into the editor's box.`,
    }),
  })
  .superRefine((signIn, context) => {
    const keys = Object.keys(signIn.fields)
    // One to eight fields: the account needs an identifier, and the bound keeps the body small.
    if (keys.length < 1 || keys.length > NODE_SERVER_SIGN_IN_FIELDS_MAX)
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: `expected 1 to ${NODE_SERVER_SIGN_IN_FIELDS_MAX} non-secret fields.`,
      })
    for (const key of keys) {
      // The secret goes under secretField only, so the same key in fields would be sent twice.
      if (key === signIn.secretField)
        context.addIssue({
          code: 'custom',
          path: ['fields', key],
          message: 'expected no field named like secretField.',
        })
      // A secret-named key would put a password in the configuration and the chat.
      else if (isSecretName(key))
        context.addIssue({
          code: 'custom',
          path: ['fields', key],
          message:
            'expected a non-secret field: name a password or token field in secretField, so the learner types it.',
        })
      // A credential-shaped value is refused without quoting it.
      else if (redactSecretText(signIn.fields[key]!) !== signIn.fields[key])
        context.addIssue({
          code: 'custom',
          path: ['fields', key],
          message:
            'expected a non-secret value: this one has the shape of a credential.',
        })
    }
  })

/**
 * Refuses a declared request that is itself the sign-in (its path, without the query, equals `signIn.path`): it would sign in a second time.
 * Called by the superRefine of {@link nodeServerConfigSchema}.
 * @param configuration - The parsed declaration, before defaults.
 * @param context - Zod's refinement context.
 * @example addSignInRequestIssue({ request: { method: 'POST', path: '/login' }, signIn: { path: '/login', … } }, context) // adds an issue at request.path
 */
function addSignInRequestIssue(
  configuration: {
    request: { path: string }
    signIn?: { path: string }
  },
  context: z.RefinementCtx,
): void {
  if (!configuration.signIn) return
  const requestPath = configuration.request.path.split('?')[0]
  const signInPath = configuration.signIn.path.split('?')[0]
  if (requestPath === signInPath)
    context.addIssue({
      code: 'custom',
      path: ['request', 'path'],
      message:
        'expected a request other than the signIn route: Codebook sends the sign-in first, then this request.',
    })
}

const requestSchema = z
  .strictObject({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], {
      error: 'expected GET, POST, PUT, PATCH or DELETE.',
    }),
    path: serverPathSchema,
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
    packageRoot: nodePackageRootSchema,
    entry: nodeEntrySchema.describe(
      'The server entry file, relative to packageRoot, as its package runs it (for example "src/server.ts").',
    ),
    loader: nodeLoaderSchema,
    port: z
      .number(PORT_EXPECTATION)
      .int(PORT_EXPECTATION)
      .min(NODE_SERVER_PORT_MIN, PORT_EXPECTATION)
      .max(NODE_SERVER_PORT_MAX, PORT_EXPECTATION)
      .describe(
        "The port the server's own code listens on. Codebook never sets PORT or any variable; it only checks this port.",
      ),
    request: requestSchema,
    signIn: signInSchema
      .optional()
      .describe(
        'Optional (API 1.31): one sign-in request sent before the declared request; its session cookie is kept in memory and sent with the declared request.',
      ),
    source: repositorySourceStopSchema,
    inspections: nodeTestStopInspectionsSchema,
    additionalStops: nodeAdditionalStopsSchema,
  })
  .superRefine((configuration, context) => {
    addNodeRunConfigurationIssues(configuration, context)
    addSignInRequestIssue(configuration, context)
  })
  .transform(withDefaultNodeLoader)

export type NodeServerConfiguration = z.infer<typeof nodeServerConfigSchema>
