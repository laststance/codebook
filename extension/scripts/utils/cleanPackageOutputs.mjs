import { lstat, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { COMPILED_DIRECTORIES } from './packageConstants.mjs'

/** Removes only known compiler outputs before packaging so deleted source cannot survive as stale JavaScript or declarations. @example await cleanPackageOutputs(repository) */
export async function cleanPackageOutputs(repository) {
  const root = await realpath(repository)
  // Validate every owner before deleting anything; directory aliases cannot redirect cleanup.
  for (const part of COMPILED_DIRECTORIES) {
    const output = join(root, part),
      owner = dirname(output)
    if ((await realpath(owner)) !== owner)
      throw new Error(`Build owner is an alias: ${part}`)
    const current = await lstat(output).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (current && !current.isDirectory())
      throw new Error(`Build output is not an owned directory: ${part}`)
  }
  for (const part of COMPILED_DIRECTORIES)
    await rm(join(root, part), { recursive: true, force: true })
}
