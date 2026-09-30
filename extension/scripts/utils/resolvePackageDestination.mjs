import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { BUILD_PACKAGES, COMPILED_DIRECTORIES } from './packageConstants.mjs'

/** Rejects package destinations that cleaning could erase or source snapshots could consume, including directory aliases. @example await resolvePackageDestination(repository, '/tmp/Codebook build.vsix') */
export async function resolvePackageDestination(repository, destination) {
  const absolute = resolve(destination),
    unresolved = []
  let ancestor = absolute
  while (true) {
    const entry = await lstat(ancestor).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (entry) {
      if (ancestor === absolute && !entry.isFile())
        throw new Error(
          'The VSIX destination must be a regular file, not a symlink or directory.',
        )
      break
    }
    unresolved.unshift(basename(ancestor))
    ancestor = dirname(ancestor)
  }
  const canonical = join(await realpath(ancestor), ...unresolved),
    root = await realpath(repository)
  const forbidden = [
    ...COMPILED_DIRECTORIES,
    ...BUILD_PACKAGES.flatMap((name) =>
      ['src', 'fixture', 'scripts', 'patches', 'node_modules'].map(
        (part) => `${name}/${part}`,
      ),
    ),
  ]
  if (!canonical.endsWith('.vsix'))
    throw new Error('The package destination must end in .vsix.')
  // Reserve owned names across filesystem casing rules even when the compiler directory does not exist yet.
  const comparison = relative(root, canonical)
    .split(sep)
    .join('/')
    .toLowerCase()
  if (
    forbidden.some(
      (part) => comparison === part || comparison.startsWith(`${part}/`),
    )
  )
    throw new Error(
      'The VSIX destination overlaps owned build/source directories (including case variants).',
    )
  return canonical
}
