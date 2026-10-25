import { realpath } from 'node:fs/promises'

import { NODE_TEST_LISTED_FILE_REALPATH_CONCURRENCY } from '../constants'

import type { VitestListedFile } from './listVitestTestFiles'

/**
 * Tells whether one listed entry is the cited test file, by its path or its real path.
 * @param entry - A file Vitest listed.
 * @param testFile - The cited test's real path.
 * @returns Whether the entry is the cited file; an entry whose real path cannot be read is not.
 * @example await isCitedEntry({ file: '/repo/link.test.ts' }, '/repo/a.test.ts') // => true when the link leads to a.test.ts
 */
const isCitedEntry = async (
  entry: VitestListedFile,
  testFile: string,
): Promise<boolean> =>
  entry.file === testFile ||
  realpath(entry.file).then(
    (file) => file === testFile,
    () => false,
  )

/**
 * Splits what a Vitest listing reported into the entries that are the cited test file, compared by real path, and every other entry, in Vitest's order.
 * Resolves {@link NODE_TEST_LISTED_FILE_REALPATH_CONCURRENCY} entries at a time, so a short filter that lists thousands of files in a large repository is compared quickly.
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
  const verdicts: boolean[] = []
  for (
    let start = 0;
    start < entries.length;
    start += NODE_TEST_LISTED_FILE_REALPATH_CONCURRENCY
  )
    verdicts.push(
      ...(await Promise.all(
        entries
          .slice(start, start + NODE_TEST_LISTED_FILE_REALPATH_CONCURRENCY)
          .map((entry) => isCitedEntry(entry, testFile)),
      )),
    )
  return {
    cited: entries.filter((_entry, index) => verdicts[index]),
    others: entries.filter((_entry, index) => !verdicts[index]),
  }
}
