import * as fileSystem from 'node:fs/promises'

import {
  removeAsNodeOnWindows,
  type RemovalFileSystem,
} from './removeAsNodeOnWindows'

/** A system error as a file system call throws it. @example systemError('EPERM', 'unlink', '/tmp/a-link') */
function systemError(code: string, call: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${call} '${path}'`), { code })
}

/**
 * Builds a stand-in for `node:fs/promises` on which a link cannot be removed as a file, for the tests of what Codebook removes at paths a repository can supply: the real file system, except that
 * `unlink` of a link answers `EPERM` (as Windows does for a link this user may not delete), `rmdir` of a link answers `ENOTEMPTY` (the answer after which the removal of Node.js empties a directory), `chmod` changes nothing (on Windows it only clears the read-only mark), every `readdir` is noted, and `rm` is the recursive removal of Node.js as it runs on Windows ({@link removeAsNodeOnWindows}) over these calls.
 * A removal that looks at every entry with `lstat` and unlinks a link fails here by the link's name; one that calls `rm` goes on into the folder the link leads to.
 * @returns `fileSystem`, the stand-in to hand to a loaded module as `node:fs/promises`, and `listed`, the paths of all listings so far.
 * @example
 * const resisting = fileSystemWhoseLinksResistRemoval()
 * const { removeWithoutFollowing } = await loadModule<typeof removalModule>(path, { 'node:fs/promises': resisting.fileSystem })
 */
export function fileSystemWhoseLinksResistRemoval(): {
  fileSystem: Record<string, unknown>
  listed: string[]
} {
  const listed: string[] = []
  /** Says whether a link stands at the path itself. */
  const isLink = async (path: string): Promise<boolean> =>
    (await fileSystem.lstat(path)).isSymbolicLink()
  const calls: RemovalFileSystem = {
    lstat: (path) => fileSystem.lstat(path),
    stat: (path) => fileSystem.stat(path),
    chmod: async () => undefined,
    unlink: async (path) => {
      if (await isLink(path)) throw systemError('EPERM', 'unlink', path)
      await fileSystem.unlink(path)
    },
    rmdir: async (path) => {
      if (await isLink(path)) throw systemError('ENOTEMPTY', 'rmdir', path)
      await fileSystem.rmdir(path)
    },
    readdir: async (path) => {
      listed.push(path)
      return fileSystem.readdir(path)
    },
  }
  const removeAsNode = removeAsNodeOnWindows(calls)
  return {
    // Every other call is the real module's; a loaded module reads only the names it imports.
    fileSystem: {
      ...fileSystem,
      ...calls,
      rm: (path: string): Promise<void> => removeAsNode(path),
    },
    listed,
  }
}
