import type { LibraryRunFacts } from '../libraryRunFactsSchema'

import { describeLibraryObservation } from './describeLibraryObservation'

/**
 * Words the line the browser replay shows under its title for a saved Vite library run: whether the page ran on the checked-out library, from the saved facts only.
 *
 * Why it exists: the replay never reads the packed files; the sentence is a function of what the run recorded. Called by the Study workspace when it builds the message for a format 16 study.
 * @param library - The saved library facts, absent for a study of any other format.
 * @returns The sentence, or `undefined` when the study has no library facts or the library was never built (nothing was served, so there is nothing to claim or disclaim).
 * @example
 * describeStudyLibraryLine({ package: '@acme/widgets', packageRoot: 'packages/widgets', prepared: true, version: '1.2.0', revision: '7114787aaaa', dirty: false, packageManager: { name: 'pnpm', version: null }, buildMs: 1, packMs: 1, tarballSha256: 'a'.repeat(64), installedVersion: '1.1.0', observation: 'complete', loaded: true, loadCount: 3, publishedCopyLoaded: false })
 * // => 'Ran on the checked-out @acme/widgets 1.2.0 built from 7114787 (packed by pnpm)'
 */
export function describeStudyLibraryLine(
  library: LibraryRunFacts | undefined,
): string | undefined {
  if (
    library === undefined ||
    !library.prepared ||
    library.version === undefined ||
    library.revision === undefined ||
    library.dirty === undefined ||
    library.packageManager === undefined
  )
    return undefined
  return describeLibraryObservation(
    {
      package: library.package,
      version: library.version,
      revision: library.revision,
      dirty: library.dirty,
      packageManager: library.packageManager.name,
      observation: library.observation,
      loaded: library.loaded,
      publishedCopyLoaded: library.publishedCopyLoaded,
      publishedCopyPath: library.publishedCopyPath,
    },
    'page',
  )
}
