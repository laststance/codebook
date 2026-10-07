import * as fileSystem from 'node:fs/promises'
import { resolve } from 'node:path'

import type * as DropSecondNameModule from '../../utils/dropSecondNameOfMovedFile'

import { loadModule } from './loadModule'

/**
 * Loads {@link dropSecondNameOfMovedFile} over a file system that refuses every hard link with one code, as a file system without hard links does (`EPERM` on Linux, `ENOTSUP` on macOS); a test hands the result to a loaded Cursor skill deployment or Cursor MCP catalog as their `dropSecondNameOfMovedFile` module, because a stub of their own `node:fs/promises` does not reach the modules they import.
 * @param code - The code the refused link carries.
 * @returns The loaded module.
 * @example
 * const catalog = await loadModule(catalogPath, { './dropSecondNameOfMovedFile': await loadDropSecondNameWhoseLinkIsRefused('EPERM') }, { Error })
 */
export async function loadDropSecondNameWhoseLinkIsRefused(
  code: string,
): Promise<typeof DropSecondNameModule> {
  return loadModule<typeof DropSecondNameModule>(
    resolve(__dirname, '../../utils/dropSecondNameOfMovedFile.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        link: async () => {
          throw Object.assign(new Error(`${code}: refused, link`), { code })
        },
      },
    },
    // The utility's callers tell its refusals by `instanceof Error`; the errors belong to this realm.
    { Error },
  )
}
