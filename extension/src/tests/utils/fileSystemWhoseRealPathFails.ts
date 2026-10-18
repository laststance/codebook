import * as fileSystem from 'node:fs/promises'

/**
 * A stand-in for `node:fs/promises` whose `realpath` fails for one folder with a system error, as it does for a folder of another user (`EACCES`) or for some junctions on Windows (`EINVAL`); every other call is the real one. A test hands it to a module it loads apart ({@link loadModule}), so that module's look at a path meets a folder whose real path the system cannot name.
 * @param failingPath - The folder whose real path cannot be named.
 * @param code - The system error `realpath` fails with.
 * @returns The stand-in's calls.
 * @example
 * await fileSystemWhoseRealPathFails('/repo/.codebook', 'EACCES').realpath('/repo/.codebook') // rejects with code EACCES
 */
export function fileSystemWhoseRealPathFails(
  failingPath: string,
  code: 'EACCES' | 'EINVAL',
): Record<string, unknown> {
  return {
    ...fileSystem,
    realpath: async (path: string): Promise<string> => {
      // Only the one folder fails; every other path has its real answer.
      if (path === failingPath)
        throw Object.assign(new Error(`${code}: realpath '${path}'`), {
          code,
        })
      return fileSystem.realpath(path)
    },
  }
}
