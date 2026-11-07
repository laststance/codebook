import { VITE_LIBRARY_CANDIDATE_LIST_LIMIT_COUNT } from './constants'
import { StudyError } from './errors'
import {
  libraryRecoveryOf,
  type LibraryBuildUnmappedCause,
  type LibraryRecoveryReason,
} from './nextRefusals'
import { encodeViteLibraryVariant } from './utils/viteLibraryFailureIdentity'

/** The `details.reason` values a nested Vite app's library stop is refused with (`library-place-ambiguous` is never raised under `vite-dev`, decision D14). */
export type ViteLibraryRefusalReason = Exclude<
  LibraryRecoveryReason,
  'library-place-ambiguous'
>

/** The variant a Vite library build change carries in a run's failure text (`RUNTIME_FAILED(vite-library-build-changed): …`), so its Vite fields survive the text a timer or an event records. */
export const VITE_LIBRARY_BUILD_CHANGED_VARIANT = 'vite-library-build-changed'

/** The variant a lazy-import refusal carries in a run's failure text (`VITE_SEAL_FAILED(lazy-import): …`). */
export const VITE_LIBRARY_LAZY_IMPORT_VARIANT = 'lazy-import'

/** What a Vite library refusal names: the app, the library and the stop file. */
export type ViteLibraryStopIdentity = Readonly<{
  /** The Vite app's canonical repository-relative package root. */
  packageRoot: string
  /** The library's package name (`package.json` `name`). */
  library: string
  /** The repository-relative stop file. */
  file: string
}>

/** What a refusal of the packed route knows about the run's build: the revision the library was built from, when the build had finished. */
export type ViteLibraryPackedFacts = Readonly<{ revision?: string }>

/**
 * Names the build of the packed route in a refusal sentence.
 * @param library - The library's package name.
 * @param packed - The run's packed-build facts.
 * @returns `the packed build of library X (built from revision R)`, without the revision when it is not known.
 * @example packedBuildPhrase('@acme/core', { revision: 'abc' }) // => 'the packed build of library @acme/core (built from revision abc)'
 */
function packedBuildPhrase(
  library: string,
  packed: ViteLibraryPackedFacts,
): string {
  const revision = packed.revision
    ? ` (built from revision ${packed.revision})`
    : ''
  return `the packed build of library ${library}${revision}`
}

/** The sentence each cause of `library-build-unmapped` adds to the message. */
const UNMAPPED_CAUSE_SENTENCES: Record<LibraryBuildUnmappedCause, string> = {
  'no-map':
    'no served module of the library carries an inline source map that names the file',
  'no-content':
    'the served source map names the file but carries no sourcesContent for it, so the library must be built with source maps that include sourcesContent',
  'no-line':
    'the served source maps name the file but none maps the declared line or a later line of the citation',
  malformed: 'a served source map of the library is not a flat version 3 map',
  bound:
    "Vite's module graph from the entry page is larger than Codebook searches, so the library's modules could not all be listed",
  deadline:
    "walking Vite's module graph from the entry page took longer than Codebook waits",
  prebundled:
    "the entry page reaches the library only through one of Vite's optimized dependencies (a pre-bundled chunk), which is not the library's own built file",
  'lazy-import':
    'the library module is not loaded by the entry page itself; only the operation loads it, so the debugger cannot be armed on it before the operation is sent',
}

/** The causes of `library-build-unmapped` that a rebuild with source maps (including sourcesContent) can fix. */
const MAP_FIXED_BY_REBUILD: ReadonlySet<LibraryBuildUnmappedCause> = new Set([
  'no-map',
  'no-content',
  'malformed',
])

/**
 * Builds the `VITE_SEAL_FAILED` refusal of a nested Vite app's library stop, raised before the browser opens (or, for `lazy-import`, when the first stop is armed).
 *
 * Why it exists: Cycle 0075's reason vocabulary (`library-build-stale`, `library-build-unmapped`, `library-not-in-build`) must reach a Vite chat under the Vite code with the same fields. Called by the library seal ({@link sealViteLibraryStop}) and by the run when a library module is not yet loaded at arming.
 * @param request - The reason, the stop's identity, the cause of an unmapped refusal and the candidate module URLs of a not-in-build refusal (only the first {@link VITE_LIBRARY_CANDIDATE_LIST_LIMIT_COUNT} are listed).
 * @returns The refusal: `details.reason`, `details.library`, `details.file`, `details.packageRoot`, `details.sideEffects` and, where the reason has them, `details.cause` or `details.candidates`.
 * @example
 * throw viteLibraryRefusal({ reason: 'library-build-stale', packageRoot: 'examples/react/basic', library: '@scope/core', file: 'packages/core/src/a.ts' })
 */
export function viteLibraryRefusal(
  request: ViteLibraryStopIdentity & {
    reason: Exclude<ViteLibraryRefusalReason, 'library-build-changed'>
    cause?: LibraryBuildUnmappedCause
    candidates?: readonly string[]
    /** Set for a stop in the checked-out library of a run that built and packed it: the sentences name the packed build and the side effects are `partial`. */
    packed?: ViteLibraryPackedFacts
  },
): StudyError {
  const { reason, packageRoot, library, file } = request
  const place = `${file} in library ${library} (packageRoot ${packageRoot})`
  const message = viteLibraryMessage(request, place)
  const candidates = request.candidates?.slice(
    0,
    VITE_LIBRARY_CANDIDATE_LIST_LIMIT_COUNT,
  )
  return new StudyError(
    'VITE_SEAL_FAILED',
    message,
    message,
    request.packed
      ? viteLibraryPackedRecoveryOf(reason)
      : libraryRecoveryOf(reason, 'vite'),
    undefined,
    {
      reason,
      ...(request.cause === undefined ? {} : { cause: request.cause }),
      packageRoot,
      library,
      file,
      ...(candidates === undefined ? {} : { candidates }),
      // A lazy-import refusal comes after the page loaded, so its code already ran; every other reason is raised before the browser opens.
      // The packed route built and packed the library and wrote its ignored output before the refusal; the private folder is removed.
      sideEffects:
        request.cause === 'lazy-import'
          ? 'unknown'
          : request.packed
            ? 'partial'
            : 'none',
    },
  )
}

/**
 * Lists the candidate module URLs of a `library-not-in-build` message, capped so the message stays short.
 * @param candidates - Every candidate URL the selection found.
 * @returns The first {@link VITE_LIBRARY_CANDIDATE_LIST_LIMIT_COUNT} joined by commas, plus `and N more` for the rest; `none` for no candidate.
 * @example
 * listedCandidates(['/a.js', '/b.js']) // => '/a.js, /b.js'
 */
function listedCandidates(candidates: readonly string[] | undefined): string {
  if (!candidates?.length) return 'none'
  const listed = candidates.slice(0, VITE_LIBRARY_CANDIDATE_LIST_LIMIT_COUNT)
  const more = candidates.length - listed.length
  return more > 0 ? `${listed.join(', ')} and ${more} more` : listed.join(', ')
}

/** Words the message of {@link viteLibraryRefusal} for its reason. */
function viteLibraryMessage(
  request: Parameters<typeof viteLibraryRefusal>[0],
  place: string,
): string {
  if (request.packed)
    return packedLibraryMessage(request, request.packed, place)
  if (request.reason === 'library-build-stale')
    return `The library's served source map for ${place} carries source text that differs from the checked-out file, so a stop there was refused before the browser opened. Run the build script of library ${request.library} yourself, then start again; Codebook never builds.`
  if (request.reason === 'library-not-in-build')
    return `The modules the entry page loads do not hold exactly one served module of the library that maps ${place} (${listedCandidates(request.candidates)}), so a stop there cannot be sealed. The page may load another build of the file, or may not load it at all.`
  const cause = request.cause ? UNMAPPED_CAUSE_SENTENCES[request.cause] : ''
  // Only a missing, malformed or contentless map is fixed by a rebuild; the other causes (no-line, prebundled, lazy-import, bound, deadline) are not.
  const rebuild =
    request.cause !== undefined && MAP_FIXED_BY_REBUILD.has(request.cause)
      ? ' The library must be built with source maps that include sourcesContent.'
      : ''
  return `The library's served modules cannot be tied to ${place} (${request.cause ?? 'unknown'}: ${cause}). Codebook never builds.${rebuild}`
}

/** Words the message of {@link viteLibraryRefusal} for a stop on the packed route. */
function packedLibraryMessage(
  request: Parameters<typeof viteLibraryRefusal>[0],
  packed: ViteLibraryPackedFacts,
  place: string,
): string {
  const build = packedBuildPhrase(request.library, packed)
  if (request.reason === 'library-build-stale')
    return `The source text that ${build} carries for ${place} differs from the checked-out file, which was edited after the build, so a stop there was refused before the browser opened. Start the run again to build and pack the current file.`
  if (request.reason === 'library-not-in-build')
    return `The modules the entry page loads do not hold exactly one served module of ${build} that maps ${place} (${listedCandidates(request.candidates)}), so a stop there cannot be sealed. The page may load another copy of the file, or may not load it at all.`
  const cause = request.cause ? UNMAPPED_CAUSE_SENTENCES[request.cause] : ''
  const rebuild =
    request.cause !== undefined && MAP_FIXED_BY_REBUILD.has(request.cause)
      ? " The library's own build must emit source maps that include sourcesContent."
      : ''
  return `The served modules of ${build} cannot be tied to ${place} (${request.cause ?? 'unknown'}: ${cause}).${rebuild}`
}

/**
 * Gives the static recovery of a refusal on the packed route: what to tell the learner, what the run built and wrote, and that no browser opened.
 *
 * Why it exists: the Vite recovery of {@link libraryRecoveryOf} says Codebook never builds and `details.sideEffects` is none, which is false once the library was built and packed. Called by {@link viteLibraryRefusal} for a packed refusal.
 * @param reason - The refusal's reason.
 * @returns The recovery text, ending at the reason's help anchor.
 * @example viteLibraryPackedRecoveryOf('library-build-stale') // => 'The checked-out file was edited after this run\'s build. …'
 */
export function viteLibraryPackedRecoveryOf(
  reason: Exclude<ViteLibraryRefusalReason, 'library-build-changed'>,
): string {
  const started =
    "Codebook built and packed the library for this run and wrote its ignored build output; the run's private folder was removed (details.sideEffects is partial). No browser was opened and no input was sent; no page or application code ran."
  const advice: Record<typeof reason, string> = {
    'library-build-stale':
      "The checked-out file was edited after this run's build. Tell the learner and ask for a new start, which builds and packs the current file; never run the build yourself.",
    'library-build-unmapped':
      'The packed build cannot be tied to the stop file; details.cause says why. Read it and follow the help for the cause; do not retry with the same stop.',
    'library-not-in-build':
      'The page does not load that library file from the packed build exactly once (details.candidates lists the module URLs when more than one matches). Tell the learner, or choose a stop in code the entry page runs; do not start another run with the same stop.',
  }
  return `${advice[reason]} ${started} See codebook://help/repository-browser#${reason}.`
}

/**
 * Builds the failure of a library whose served module changed after the seal: the executed bytes differ from the sealed ones, including a hot update (`…?t=<n>`).
 *
 * Why it exists: under Vite the executed-bytes check ends a library stop with this failure instead of the generic changed-module error. Called by the run when that check finds a difference for a library stop.
 * @param identity - The app, the library and the stop file.
 * @param packed - Set for a stop on the packed route: the sentence names the packed build instead of telling the learner to rebuild.
 * @returns The `RUNTIME_FAILED` error: `details.reason: "library-build-changed"`, `details.sideEffects: "unknown"` (the page had loaded).
 * @example
 * throw viteLibraryBuildChangedFailure({ packageRoot: 'examples/react/basic', library: '@scope/core', file: 'packages/core/src/a.ts' })
 */
export function viteLibraryBuildChangedFailure(
  identity: ViteLibraryStopIdentity,
  packed?: ViteLibraryPackedFacts,
): StudyError {
  const message = packed
    ? `The served module of ${packedBuildPhrase(identity.library, packed)} changed while the run was open (the executed code of ${identity.file} differs from the code sealed before the start; a hot update or a replaced file), so Codebook stopped it for packageRoot ${identity.packageRoot}. Start the run again to build and pack the library again.`
    : `The served module of library ${identity.library} changed while the run was open (the executed code of ${identity.file} differs from the code sealed before the start; a rebuild or a hot update), so Codebook stopped it for packageRoot ${identity.packageRoot}. Finish the rebuild yourself and start again; Codebook never builds.`
  return new StudyError(
    'RUNTIME_FAILED',
    message,
    message,
    libraryRecoveryOf('library-build-changed', 'vite'),
    undefined,
    {
      reason: 'library-build-changed',
      packageRoot: identity.packageRoot,
      library: identity.library,
      file: identity.file,
      sideEffects: 'unknown',
    },
  )
}

/**
 * Writes the failure text a run records for a Vite library error raised at an event or inside a tracked activity, the form {@link refusalFailureOf} restores.
 * @param error - What the activity threw.
 * @returns `RUNTIME_FAILED(vite-library-build-changed:<identity>): …` for a Vite library build change, `VITE_SEAL_FAILED(lazy-import:<identity>): …` for a lazy-import refusal, each variant followed by the encoded package root, library and file ({@link encodeViteLibraryVariant}); `undefined` for any other error.
 * @example
 * viteLibraryFailureText(viteLibraryBuildChangedFailure(identity)) // => 'RUNTIME_FAILED(vite-library-build-changed): The served module of library …'
 */
export function viteLibraryFailureText(error: unknown): string | undefined {
  if (!(error instanceof StudyError)) return undefined
  if (
    error.code === 'RUNTIME_FAILED' &&
    error.details?.reason === 'library-build-changed' &&
    error.details.router === undefined
  )
    return `RUNTIME_FAILED(${encodeViteLibraryVariant(VITE_LIBRARY_BUILD_CHANGED_VARIANT, identityOf(error.details))}): ${error.message}`
  if (
    error.code === 'VITE_SEAL_FAILED' &&
    error.details?.cause === 'lazy-import'
  )
    return `VITE_SEAL_FAILED(${encodeViteLibraryVariant(VITE_LIBRARY_LAZY_IMPORT_VARIANT, identityOf(error.details))}): ${error.message}`
  return undefined
}

/**
 * Reads the stop identity a Vite library error carries in its `details`.
 * @param details - The `details` of a library error built by this module.
 * @returns The package root, library and file; an empty string stands for a field the details lack.
 * @example
 * identityOf({ packageRoot: 'app', library: '@s/core', file: 'a.ts' }) // => { packageRoot: 'app', library: '@s/core', file: 'a.ts' }
 */
function identityOf(
  details: Readonly<Record<string, unknown>> | undefined,
): ViteLibraryStopIdentity {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    packageRoot: text(details?.packageRoot),
    library: text(details?.library),
    file: text(details?.file),
  }
}
