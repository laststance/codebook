import type { LibraryPackage, LibraryPackageFacts } from '../../libraryPackage'
import type { LibraryObservation } from '../../utils/readLibraryObservation'

/** The facts every fake library reports unless a test names its own. */
export const FAKE_LIBRARY_FACTS: LibraryPackageFacts = {
  package: '@acme/widgets',
  version: '2.14.0',
  packageRoot: 'packages/widgets',
  revision: '7114787a'.padEnd(40, '0'),
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 5_500,
  packMs: 620,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '2.12.0',
}

/** An observation of a script that loaded the packed copy twice and nothing else. */
export const COMPLETE_OBSERVATION: LibraryObservation = {
  loaded: true,
  loadCount: 2,
  otherCopyLoaded: false,
  observation: 'complete',
}

/**
 * A stand-in for the built and packed library: it reports fixed facts, answers the observation a test names and pushes its steps (`finishObservation`, `dispose`) onto a shared order list, so a test can check the order of an ending against the process and the history.
 * @param order - The shared list of steps.
 * @param options - The observation to answer (or a failure to read it) and the removal state `dispose` answers.
 * @returns The library package.
 * @example
 * const built = fakeLibraryPackage(order, { observation: COMPLETE_OBSERVATION })
 */
export function fakeLibraryPackage(
  order: string[],
  options: {
    observation?: LibraryObservation
    observationFails?: boolean
    cleanup?: 'removed' | 'pending'
  } = {},
): LibraryPackage {
  return {
    nodeArguments: ['--import', 'file:///fake-private/library-hook.mjs'],
    facts: FAKE_LIBRARY_FACTS,
    finishObservation: async () => {
      order.push('finishObservation')
      if (options.observationFails) throw new Error('observation unreadable')
      return options.observation ?? COMPLETE_OBSERVATION
    },
    dispose: async () => {
      order.push('dispose')
      return { cleanup: options.cleanup ?? 'removed' }
    },
  }
}
