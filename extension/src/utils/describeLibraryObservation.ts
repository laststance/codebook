import { LIBRARY_SHORT_REVISION_CHARS } from '../constants'
import type { LibraryRunView } from '../nodeScriptRuntimeTypes'

/** What a run's replay line needs of its library facts: the built identity and the observation. Both the Script replay (journal entries) and the browser replay (saved facts) build one. */
export type LibraryObservationInput = Pick<
  LibraryRunView,
  'observation' | 'loaded' | 'publishedCopyLoaded' | 'publishedCopyPath'
> & {
  package: string
  version: string
  /** The repository's HEAD before the build (40 hex characters). */
  revision: string
  dirty: boolean
  /** The package manager's name (`pnpm` or `npm`). */
  packageManager: string
}

/** Who loaded the library: a `node-script` run's script or a `vite-dev` run's page; it only changes the words. */
export type LibraryObserver = 'script' | 'page'

/**
 * Words the replay line for a run that declared a library: whether the run executed the checked-out library, read from the library facts.
 * The correspondence sentence appears only when the packed copy was loaded, no other copy was, and the observation is `complete`. Every other state says so in its own words, and an observation that is not complete is never worded as "not loaded".
 * Called by {@link describeLibraryCorrespondence} for the Script replay and by the browser replay for a Vite library run; the `script` words are the Script replay's existing output.
 * @param input - The built identity and the observation of the run.
 * @param observer - Whether a script or a page loaded the library; defaults to `script`.
 * @returns The sentence under the replay title.
 * @example
 * describeLibraryObservation({ package: '@reduxjs/toolkit', version: '2.14.0', revision: '7114787aaaa', dirty: false, packageManager: 'pnpm', observation: 'complete', loaded: true, publishedCopyLoaded: false })
 * // => 'Ran on the checked-out @reduxjs/toolkit 2.14.0 built from 7114787 (packed by pnpm)'
 * describeLibraryObservation({ ...input, observation: 'unreadable' }, 'page') // => 'What the page loaded was not fully observed.'
 */
export function describeLibraryObservation(
  input: LibraryObservationInput,
  observer: LibraryObserver = 'script',
): string {
  const built = `${input.package} ${input.version}`
  // No complete observation: the line must not read a missing or damaged file as "not loaded".
  if (input.observation !== 'complete')
    return `What the ${observer} loaded was not fully observed.`
  const revision = input.revision.slice(0, LIBRARY_SHORT_REVISION_CHARS)
  const dirty = input.dirty ? ' (uncommitted changes)' : ''
  const otherCopy = input.publishedCopyPath ?? 'an unknown path'
  // Another copy is named before "not loaded": a run that loaded only another copy did not load the built one, and saying just that would hide the copy it ran on.
  if (input.publishedCopyLoaded)
    return input.loaded
      ? `Built ${built} from ${revision}${dirty}, but the ${observer} also loaded another copy at ${otherCopy}.`
      : `Built ${built} from ${revision}${dirty}, but the ${observer} did not load it; it loaded another copy at ${otherCopy}.`
  if (!input.loaded)
    return observer === 'script'
      ? `Built ${built}, but not loaded by this script.`
      : `Built ${built}, but not served to this page.`
  return `Ran on the checked-out ${built} built from ${revision}${dirty} (packed by ${input.packageManager})`
}
