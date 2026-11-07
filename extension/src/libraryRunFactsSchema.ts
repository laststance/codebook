import { z } from 'zod'

import {
  NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_PACKAGE_MANAGERS,
  NODE_SCRIPT_LIBRARY_PATH_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_REVISION_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS,
  REPOSITORY_PATH_LIMIT_CHARS,
} from './constants'
import { repositoryHashSchema } from './sourceSchemas'

/** The fields that exist only once the library was built and packed. */
const PREPARED_FIELDS = [
  'version',
  'revision',
  'dirty',
  'packageManager',
  'buildMs',
  'packMs',
  'tarballSha256',
  'installedVersion',
] as const

/** The fields that exist only when the observation of what the page was served is `complete`, the one state that may support a negative. */
const COMPLETE_OBSERVATION_FIELDS = [
  'loaded',
  'loadCount',
  'publishedCopyLoaded',
] as const

/** The facts as the object schema parses them, before the state rules. */
type ParsedFacts = {
  prepared: boolean
  observation: 'pending' | 'complete' | 'incomplete' | 'unreadable'
  publishedCopyLoaded?: boolean
  publishedCopyPath?: string
} & Partial<
  Record<
    | (typeof PREPARED_FIELDS)[number]
    | (typeof COMPLETE_OBSERVATION_FIELDS)[number],
    unknown
  >
>

/**
 * Adds an issue for each build fact that disagrees with `prepared`: the build facts exist exactly when the library was built and packed.
 * Called by the {@link libraryRunFactsSchema} refinement.
 * @param facts - The parsed facts.
 * @param context - The refinement context that receives the issues.
 * @example addPreparedIssues({ prepared: false, version: '1.0.0', observation: 'pending' }, context) // issue at ['version']
 */
function addPreparedIssues(facts: ParsedFacts, context: z.RefinementCtx): void {
  for (const field of PREPARED_FIELDS)
    if ((facts[field] !== undefined) !== facts.prepared)
      context.addIssue({
        code: 'custom',
        path: [field],
        message: facts.prepared
          ? `${field} is required once the library is prepared.`
          : `${field} exists only once the library is prepared.`,
      })
}

/**
 * Adds an issue for each observation fact that disagrees with the observation state: required when `complete`, absent when `pending` or `unreadable` (which never read as "not loaded"), and a copy path only with `publishedCopyLoaded`.
 * Called by the {@link libraryRunFactsSchema} refinement.
 * @param facts - The parsed facts.
 * @param context - The refinement context that receives the issues.
 * @example addObservationIssues({ prepared: true, observation: 'unreadable', loaded: false }, context) // issue at ['loaded']
 */
function addObservationIssues(
  facts: ParsedFacts,
  context: z.RefinementCtx,
): void {
  const isKnown =
    facts.observation === 'complete' || facts.observation === 'incomplete'
  for (const field of COMPLETE_OBSERVATION_FIELDS) {
    const isPresent = facts[field] !== undefined
    if (facts.observation === 'complete' && !isPresent)
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required when the observation is complete.`,
      })
    if (!isKnown && isPresent)
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is absent when the observation is ${facts.observation}.`,
      })
  }
  if (
    facts.publishedCopyPath !== undefined &&
    facts.publishedCopyLoaded !== true
  )
    context.addIssue({
      code: 'custom',
      path: ['publishedCopyPath'],
      message: 'publishedCopyPath exists only when publishedCopyLoaded.',
    })
}

/**
 * The library facts a saved `vite-dev` study of format 16 keeps (the run resource's library view as it stood at the save).
 * Which fields exist depends on the state, not on a fixed list (D18): `package`, `packageRoot`, `prepared` and `observation` always; the build facts only when `prepared`; `loaded`, `loadCount` and `publishedCopyLoaded` when the observation is `complete`, and as lower bounds when it is `incomplete`, never when it is `pending` or `unreadable`; `publishedCopyPath` only when `publishedCopyLoaded`; `cleanup` once the private folder was released.
 * Read by {@link configuredStudySchema}; the state rules are checked here so a study that breaks them is listed as unreadable like any malformed study.
 * @example
 * libraryRunFactsSchema.parse({ package: 'widgets', packageRoot: 'packages/widgets', prepared: false, observation: 'pending' })
 */
export const libraryRunFactsSchema = z
  .strictObject({
    package: z.string().min(1).max(NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS),
    packageRoot: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
    prepared: z.boolean(),
    version: z
      .string()
      .min(1)
      .max(NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS)
      .optional(),
    revision: z
      .string()
      .min(1)
      .max(NODE_SCRIPT_LIBRARY_REVISION_LIMIT_CHARS)
      .optional(),
    dirty: z.boolean().optional(),
    packageManager: z
      .strictObject({
        name: z.enum(NODE_SCRIPT_LIBRARY_PACKAGE_MANAGERS),
        version: z
          .string()
          .min(1)
          .max(NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS)
          .nullable(),
      })
      .optional(),
    buildMs: z.number().finite().nonnegative().optional(),
    packMs: z.number().finite().nonnegative().optional(),
    tarballSha256: repositoryHashSchema.optional(),
    installedVersion: z
      .string()
      .min(1)
      .max(NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS)
      .nullable()
      .optional(),
    observation: z.enum(['pending', 'complete', 'incomplete', 'unreadable']),
    loaded: z.boolean().optional(),
    loadCount: z.number().int().nonnegative().optional(),
    publishedCopyLoaded: z.boolean().optional(),
    publishedCopyPath: z
      .string()
      .min(1)
      .max(NODE_SCRIPT_LIBRARY_PATH_LIMIT_CHARS)
      .optional(),
    cleanup: z.enum(['removed', 'pending']).optional(),
  })
  .superRefine((facts, context) => {
    addPreparedIssues(facts, context)
    addObservationIssues(facts, context)
  })

export type LibraryRunFacts = z.infer<typeof libraryRunFactsSchema>
