import { StudyError } from './errors'
import {
  libraryRecoveryOf,
  type LibraryBuildUnmappedCause,
  type LibraryRecoveryReason,
} from './nextRefusals'

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
 * @param request - The reason, the stop's identity, the cause of an unmapped refusal, the candidate module URLs of a not-in-build refusal and `details.sideEffects` (`none` before the browser opens; `unknown` for `lazy-import`, whose page already ran).
 * @returns The refusal: `details.reason`, `details.library`, `details.file`, `details.packageRoot`, `details.sideEffects` and, where the reason has them, `details.cause` or `details.candidates`.
 * @example
 * throw viteLibraryRefusal({ reason: 'library-build-stale', packageRoot: 'examples/react/basic', library: '@scope/core', file: 'packages/core/src/a.ts' })
 */
export function viteLibraryRefusal(
  request: ViteLibraryStopIdentity & {
    reason: Exclude<ViteLibraryRefusalReason, 'library-build-changed'>
    cause?: LibraryBuildUnmappedCause
    candidates?: readonly string[]
    sideEffects?: 'none' | 'unknown'
  },
): StudyError {
  const { reason, packageRoot, library, file } = request
  const place = `${file} in library ${library} (packageRoot ${packageRoot})`
  const message = viteLibraryMessage(request, place)
  return new StudyError(
    'VITE_SEAL_FAILED',
    message,
    message,
    libraryRecoveryOf(reason, 'vite'),
    undefined,
    {
      reason,
      ...(request.cause === undefined ? {} : { cause: request.cause }),
      packageRoot,
      library,
      file,
      ...(request.candidates === undefined
        ? {}
        : { candidates: [...request.candidates] }),
      sideEffects: request.sideEffects ?? 'none',
    },
  )
}

/** Words the message of {@link viteLibraryRefusal} for its reason. */
function viteLibraryMessage(
  request: Parameters<typeof viteLibraryRefusal>[0],
  place: string,
): string {
  if (request.reason === 'library-build-stale')
    return `The library's served source map for ${place} carries source text that differs from the checked-out file, so a stop there was refused before the browser opened. Run the build script of library ${request.library} yourself, then start again; Codebook never builds.`
  if (request.reason === 'library-not-in-build')
    return `The modules the entry page loads do not hold exactly one served module of the library that maps ${place} (${request.candidates?.join(', ') || 'none'}), so a stop there cannot be sealed. The page may load another build of the file, or may not load it at all.`
  const cause = request.cause ? UNMAPPED_CAUSE_SENTENCES[request.cause] : ''
  // Only a missing, malformed or contentless map is fixed by a rebuild; the other causes (no-line, prebundled, lazy-import, bound, deadline) are not.
  const rebuild =
    request.cause !== undefined && MAP_FIXED_BY_REBUILD.has(request.cause)
      ? ' The library must be built with source maps that include sourcesContent.'
      : ''
  return `The library's served modules cannot be tied to ${place} (${request.cause ?? 'unknown'}: ${cause}). Codebook never builds.${rebuild}`
}

/**
 * Builds the failure of a library whose served module changed after the seal: the executed bytes differ from the sealed ones, including a hot update (`…?t=<n>`).
 *
 * Why it exists: under Vite the executed-bytes check ends a library stop with this failure instead of the generic changed-module error. Called by the run when that check finds a difference for a library stop.
 * @param identity - The app, the library and the stop file.
 * @returns The `RUNTIME_FAILED` error: `details.reason: "library-build-changed"`, `details.sideEffects: "unknown"` (the page had loaded).
 * @example
 * throw viteLibraryBuildChangedFailure({ packageRoot: 'examples/react/basic', library: '@scope/core', file: 'packages/core/src/a.ts' })
 */
export function viteLibraryBuildChangedFailure(
  identity: ViteLibraryStopIdentity,
): StudyError {
  const message = `The served module of library ${identity.library} changed while the run was open (the executed code of ${identity.file} differs from the code sealed before the start; a rebuild or a hot update), so Codebook stopped it for packageRoot ${identity.packageRoot}. Finish the rebuild yourself and start again; Codebook never builds.`
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
 * @returns `RUNTIME_FAILED(vite-library-build-changed): …` for a Vite library build change, `VITE_SEAL_FAILED(lazy-import): …` for a lazy-import refusal; `undefined` for any other error.
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
    return `RUNTIME_FAILED(${VITE_LIBRARY_BUILD_CHANGED_VARIANT}): ${error.message}`
  if (
    error.code === 'VITE_SEAL_FAILED' &&
    error.details?.cause === 'lazy-import'
  )
    return `VITE_SEAL_FAILED(${VITE_LIBRARY_LAZY_IMPORT_VARIANT}): ${error.message}`
  return undefined
}
