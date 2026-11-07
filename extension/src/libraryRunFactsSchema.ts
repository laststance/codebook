import { z } from 'zod'

import {
  LIBRARY_REACHED_THROUGH_LIMIT_PACKAGES,
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
  package: string
  loaded?: boolean
  loadCount?: number
  publishedCopyLoaded?: boolean
  publishedCopyPath?: string
  reachedThrough?: string[]
  reachedThroughCount?: number
} & Partial<
  Record<
    Exclude<
      | (typeof PREPARED_FIELDS)[number]
      | (typeof COMPLETE_OBSERVATION_FIELDS)[number],
      'loaded' | 'loadCount' | 'publishedCopyLoaded'
    >,
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
 * Adds an issue when `package` is longer than a package name may be although the library was prepared: before the name is known `package` holds the declared folder (up to the path limit), and once prepared it is the real package name.
 * Called by the {@link libraryRunFactsSchema} refinement.
 * @param facts - The parsed facts.
 * @param context - The refinement context that receives the issue.
 * @example addPackageNameIssue({ package: 'x'.repeat(300), prepared: true, observation: 'pending' }, context) // issue at ['package']
 */
function addPackageNameIssue(
  facts: ParsedFacts,
  context: z.RefinementCtx,
): void {
  if (
    facts.prepared &&
    facts.package.length > NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS
  )
    context.addIssue({
      code: 'custom',
      path: ['package'],
      message: `package is a package name of at most ${NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS} characters once the library is prepared.`,
    })
}

/**
 * Adds an issue for a `reachedThrough` relation that breaks its rules: the two fields come together, the names are sorted (code-unit order) and unique, and the count is at least the number of names listed.
 * Called by the {@link libraryRunFactsSchema} refinement.
 * @param facts - The parsed facts.
 * @param context - The refinement context that receives the issues.
 * @example addReachedThroughIssues({ reachedThrough: ['b', 'a'], reachedThroughCount: 2, ... }, context) // issue at ['reachedThrough']
 */
function addReachedThroughIssues(
  facts: ParsedFacts,
  context: z.RefinementCtx,
): void {
  const { reachedThrough, reachedThroughCount } = facts
  // Both fields describe one relation: neither exists without the other.
  if ((reachedThrough === undefined) !== (reachedThroughCount === undefined))
    context.addIssue({
      code: 'custom',
      path: [
        reachedThrough === undefined ? 'reachedThrough' : 'reachedThroughCount',
      ],
      message: 'reachedThrough and reachedThroughCount come together.',
    })
  if (reachedThrough === undefined || reachedThroughCount === undefined) return
  // Strictly ascending order is both the sort rule and the uniqueness rule.
  if (
    reachedThrough.some(
      (name, index) => index > 0 && name <= reachedThrough[index - 1]!,
    )
  )
    context.addIssue({
      code: 'custom',
      path: ['reachedThrough'],
      message: 'reachedThrough lists unique package names in sorted order.',
    })
  if (reachedThroughCount < reachedThrough.length)
    context.addIssue({
      code: 'custom',
      path: ['reachedThroughCount'],
      message: 'reachedThroughCount is at least the number of names listed.',
    })
}

/**
 * Adds an issue when a `complete` observation breaks its own rules: the library must be prepared, and `loaded` is true exactly when `loadCount` is above zero, so the study never claims the correspondence without a count.
 * Called by {@link addObservationIssues}.
 * @param facts - The parsed facts.
 * @param context - The refinement context that receives the issues.
 * @example addCompleteObservationIssues({ prepared: true, observation: 'complete', loaded: true, loadCount: 0 }, context) // issue at ['loaded']
 */
function addCompleteObservationIssues(
  facts: ParsedFacts,
  context: z.RefinementCtx,
): void {
  if (facts.observation !== 'complete') return
  if (!facts.prepared)
    context.addIssue({
      code: 'custom',
      path: ['observation'],
      message: 'A complete observation requires a prepared library.',
    })
  if (
    facts.loaded !== undefined &&
    facts.loadCount !== undefined &&
    facts.loaded !== facts.loadCount > 0
  )
    context.addIssue({
      code: 'custom',
      path: ['loaded'],
      message: 'loaded is true exactly when loadCount is above zero.',
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
  addCompleteObservationIssues(facts, context)
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
 * The library facts a saved `vite-dev` study of format 16 or `react-scripts-dev` study of format 17 keeps (the run resource's library view as it stood at the save).
 * Which fields exist depends on the state, not on a fixed list (D18): `package` (the declared folder until the name is known), `packageRoot`, `prepared` and `observation` always; the build facts only when `prepared`; `loaded`, `loadCount` and `publishedCopyLoaded` when the observation is `complete`, and as lower bounds when it is `incomplete`, never when it is `pending` or `unreadable`; `publishedCopyPath` only when `publishedCopyLoaded`; `cleanup` once the private folder was released; `reachedThrough` and `reachedThroughCount` together, when the Example declares the library only through its direct dependencies.
 * Read by {@link configuredStudySchema}; the state rules are checked here so a study that breaks them is listed as unreadable like any malformed study.
 * @example
 * libraryRunFactsSchema.parse({ package: 'widgets', packageRoot: 'packages/widgets', prepared: false, observation: 'pending' })
 */
export const libraryRunFactsSchema = z
  .strictObject({
    // Before the package name is known this holds the declared folder, so the bound is the path limit; addPackageNameIssue keeps a prepared name within the name limit.
    package: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
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
    // The packages of the Example's own dependencies that declare the library when the Example does not list it itself (API 1.35, D14): at most 16 sorted unique names and the count of all of them.
    reachedThrough: z
      .array(z.string().min(1).max(NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS))
      .min(1)
      .max(LIBRARY_REACHED_THROUGH_LIMIT_PACKAGES)
      .optional(),
    reachedThroughCount: z.number().int().positive().optional(),
  })
  .superRefine((facts, context) => {
    addPackageNameIssue(facts, context)
    addReachedThroughIssues(facts, context)
    addPreparedIssues(facts, context)
    addObservationIssues(facts, context)
  })

export type LibraryRunFacts = z.infer<typeof libraryRunFactsSchema>
