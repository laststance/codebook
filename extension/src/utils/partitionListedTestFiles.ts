import { realpath } from 'node:fs/promises'

import type { VitestListedFile } from './listVitestTestFiles'

/**
 * Splits what a Vitest listing reported into the entries that are the cited test file, compared by real path, and every other entry, in Vitest's order.
 * Called by {@link prepareNodeTestLaunch} to exclude the other files Vitest's substring filter adds, and by {@link planNodeTestExecution} to count how often a root listing selects the cited file.
 * @param entries - The listed files; a file included by several Vitest projects appears once per project.
 * @param testFile - The cited test's real path.
 * @returns The cited entries and the others.
 * @example
 * await partitionListedTestFiles([{ file: '/repo/a.test.ts' }, { file: '/repo/copy/a.test.ts' }], '/repo/a.test.ts')
 * // => { cited: [{ file: '/repo/a.test.ts' }], others: [{ file: '/repo/copy/a.test.ts' }] }
 */
export async function partitionListedTestFiles(
  entries: VitestListedFile[],
  testFile: string,
): Promise<{ cited: VitestListedFile[]; others: VitestListedFile[] }> {
  const cited: VitestListedFile[] = []
  const others: VitestListedFile[] = []
  for (const entry of entries) {
    const isCited =
      entry.file === testFile ||
      (await realpath(entry.file).then(
        (file) => file === testFile,
        () => false,
      ))
    ;(isCited ? cited : others).push(entry)
  }
  return { cited, others }
}
