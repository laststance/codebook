import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import {
  createPackedLibraryFiles,
  type PackedLibraryFiles,
} from '../../utils/servePackedLibraryFile'

import { removeTestFolder } from './removeTestFolder'

/** The checked-out library source the packed build was made from. */
export const LIBRARY_SOURCE = `export const a = 1
export const double = (x: number) => x * 2
`

/** The packed build: two lines that map onto the two lines of {@link LIBRARY_SOURCE}, ending in a reference to its map. */
export const LIBRARY_BUILD = `export const a = 1
export const double = (x) => x * 2
//# sourceMappingURL=lib.mjs.map
`

/** The packed build's map: its one source is the packed copy's `src/a.ts`, relative to `dist/`. */
export const LIBRARY_MAP = JSON.stringify({
  version: 3,
  file: 'lib.mjs',
  sources: ['../src/a.ts'],
  sourcesContent: [LIBRARY_SOURCE],
  names: [],
  mappings: 'AAAA;AACA',
})

/** A checked-out library folder, its packed copy and the files served from the copy. */
export type PackedLibraryFixture = {
  /** The checked-out library's real folder. */
  libraryRoot: string
  /** The packed copy's real folder. */
  packedRoot: string
  files: PackedLibraryFiles
}

/**
 * Builds a checked-out library and its packed copy, whose map names `src/a.ts` with the text both copies hold.
 * @param context - The test, which removes the folders when it ends.
 * @param options - `checkedOutSource` writes another text into the checked-out `src/a.ts`; the packed copy keeps the shared text.
 * @returns The folders and the files served from the packed copy.
 * @example const library = await createPackedLibrary(context)
 */
export async function createPackedLibrary(
  context: TestContext,
  options: { checkedOutSource?: string } = {},
): Promise<PackedLibraryFixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'codebook-lib-')))
  context.after(() => removeTestFolder(base))
  const libraryRoot = join(base, 'checked-out')
  const packedRoot = join(base, 'private', 'node_modules', 'lib')
  for (const folder of [
    join(libraryRoot, 'src'),
    join(packedRoot, 'src'),
    join(packedRoot, 'dist'),
  ])
    await mkdir(folder, { recursive: true })
  await writeFile(
    join(libraryRoot, 'src', 'a.ts'),
    options.checkedOutSource ?? LIBRARY_SOURCE,
  )
  await writeFile(join(packedRoot, 'src', 'a.ts'), LIBRARY_SOURCE)
  await writeFile(join(packedRoot, 'dist', 'lib.mjs'), LIBRARY_BUILD)
  await writeFile(join(packedRoot, 'dist', 'lib.mjs.map'), LIBRARY_MAP)
  return {
    libraryRoot,
    packedRoot,
    files: createPackedLibraryFiles(packedRoot, libraryRoot),
  }
}
