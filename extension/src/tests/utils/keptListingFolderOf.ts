import { basename, dirname } from 'node:path'

/** The name {@link listVitestTestFiles} gives its private listing folder in the temporary directory, before the random part. */
const LISTING_FOLDER_PREFIX = 'codebook-vitest-list-'

/**
 * Names the private folder a Vitest listing kept, from the arguments its stand-in Vitest was started with, for a test's cleanup that deletes that folder with everything in it.
 *
 * The folder is taken from the `--json=` argument wherever it stands, and is answered only when it is a listing folder directly in the temporary directory: a cleanup must never hand any other path (the folder of a filter, the working directory) to a recursive delete.
 *
 * @param startedWith - The arguments the stand-in Vitest recorded.
 * @param temporaryDirectory - The machine's temporary directory, where the product creates the folder.
 * @returns
 * - The folder of the `--json=` output, when its name starts with `codebook-vitest-list-` and it lies directly in the temporary directory
 * - `undefined` when no argument names an output, or the output lies anywhere else
 * @example
 * keptListingFolderOf(['list', '--filesOnly', '--json=/tmp/codebook-vitest-list-x/files.json'], '/tmp') // => '/tmp/codebook-vitest-list-x'
 * keptListingFolderOf(['list', '--filesOnly', 'src/a.test.ts'], '/tmp') // => undefined
 */
export function keptListingFolderOf(
  startedWith: string[],
  temporaryDirectory: string,
): string | undefined {
  const output = startedWith
    .find((argument) => argument.startsWith('--json='))
    ?.slice('--json='.length)
  if (!output) return undefined
  const folder = dirname(output)
  return dirname(folder) === temporaryDirectory &&
    basename(folder).startsWith(LISTING_FOLDER_PREFIX)
    ? folder
    : undefined
}
