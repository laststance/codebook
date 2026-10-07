import { resolve } from 'node:path'

import type * as DropSecondNameOfMovedFileModule from '../../utils/dropSecondNameOfMovedFile'
import type * as DropSecondNameOfOneFileModule from '../../utils/dropSecondNameOfOneFile'
import { openWithoutFollowing } from '../../utils/openWithoutFollowing'

import { loadModule } from './loadModule'

/**
 * Loads the two rules that remove a second name ({@link dropSecondNameOfOneFile}, {@link dropSecondNameOfMovedFile}) over an opener that refuses a file a program holds for itself, as Windows does with `EBUSY`; a test hands the result to a loaded Cursor skill deployment or Cursor MCP catalog in place of their two modules, because a stub of their own opener does not reach the modules they import.
 * Only the opens of the two rules are refused: every other read of the loaded deployment or catalog opens the file as it is, so the hold falls exactly into the instant in which Codebook compares the two names.
 * @param refusalCodeOf - Asked at every open of the rules: the code to refuse the path with, or undefined to open it.
 * @returns Both loaded modules.
 * @example
 * const rules = await loadSecondNameRulesOverHeldFiles((path) => (isHeld && path === skillPath ? 'EBUSY' : undefined))
 * const window = await loadModule(deploymentPath, { './utils/dropSecondNameOfMovedFile': rules.ofMovedFile, './utils/dropSecondNameOfOneFile': rules.ofOneFile }, { Error })
 */
export async function loadSecondNameRulesOverHeldFiles(
  refusalCodeOf: (path: string) => string | undefined,
): Promise<{
  ofOneFile: typeof DropSecondNameOfOneFileModule
  ofMovedFile: typeof DropSecondNameOfMovedFileModule
}> {
  const ofOneFile = await loadModule<typeof DropSecondNameOfOneFileModule>(
    resolve(__dirname, '../../utils/dropSecondNameOfOneFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (path: string) => {
          const code = refusalCodeOf(path)
          if (code !== undefined)
            throw Object.assign(
              new Error(`${code}: resource busy or locked, open '${path}'`),
              { code },
            )
          return openWithoutFollowing(path)
        },
      },
    },
    // The rules tell a refusal by `instanceof Error` and its code; this error belongs to this realm.
    { Error },
  )
  const ofMovedFile = await loadModule<typeof DropSecondNameOfMovedFileModule>(
    resolve(__dirname, '../../utils/dropSecondNameOfMovedFile.js'),
    { './dropSecondNameOfOneFile': ofOneFile },
    { Error },
  )
  return { ofOneFile, ofMovedFile }
}
