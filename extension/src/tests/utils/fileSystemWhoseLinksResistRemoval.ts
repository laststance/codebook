import * as fileSystem from 'node:fs/promises'

import {
  removeAsNodeOnWindows,
  type RemovalFileSystem,
} from './removeAsNodeOnWindows'

/** A system error as a file system call throws it. @example systemError('EPERM', 'unlink', '/tmp/a-link') */
function systemError(code: string, call: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${call} '${path}'`), { code })
}

/** What a test asks of the stand-in beside its fixed answers: what `lstat` and `rmdir` answer for a link. */
export type ResistingLinks = {
  /** `a directory`: `lstat` answers for a link what `stat` answers for the folder it leads to, as the file system layer of Node.js does on Windows for a junction whose target is a volume. `a link` (the default): the real answer. */
  lstatOfALink?: 'a link' | 'a directory'
  /** `not empty` (the default): `rmdir` of a link answers `ENOTEMPTY`, the answer after which a removal lists a directory. `removes it`: the link is removed as a name and the folder it leads to stays, as Windows removes a junction. */
  rmdirOfALink?: 'not empty' | 'removes it'
}

/** The stand-in as a loaded module gets it: every name of `node:fs/promises`, of which a test of the stand-in itself calls the listing. */
type ResistingFileSystem = Record<string, unknown> & {
  /**
   * Notes the path when a loaded module or the stand-in's regression test lists a folder, preserving the real listing's options and result.
   * @param path - The folder to list and record in the stand-in's listing history.
   * @param optionsAsHandedOver - The caller's optional encoding or options, forwarded unchanged.
   * @returns The real listing's names, buffers or entries, according to the caller's options.
   * @example
   * await resisting.fileSystem.readdir('/private/folder', { withFileTypes: false }) // => ['a-file.txt']
   */
  readdir: (path: string, ...optionsAsHandedOver: unknown[]) => Promise<unknown>
}

/**
 * Builds a stand-in for `node:fs/promises` on which a link cannot be removed as a file, for the tests of what Codebook lists and removes at paths a repository can supply: the real file system, except that
 * `unlink` of a link answers `EPERM` (as Windows does for a link this user may not delete, and for a junction to a volume), `rmdir` of a link answers `ENOTEMPTY` or removes the link as a name ({@link ResistingLinks}), `lstat` of a link answers as a link or as the folder it leads to, `chmod` changes nothing (on Windows it only clears the read-only mark), every `readdir` is noted and answered by the real listing with the options the caller gave (names unless the caller asked for entries), and `rm` is the recursive removal of Node.js as it runs on Windows ({@link removeAsNodeOnWindows}) over these calls.
 * A removal that looks at every entry with `lstat` and unlinks a link fails here by the link's name; one that calls `rm` goes on into the folder the link leads to. With `lstat` answering "a directory", only a caller that also asks where the entry really is leaves the folder behind the link alone.
 * @param links - What `lstat` and `rmdir` answer for a link; the defaults when omitted.
 * @returns `fileSystem`, the stand-in to hand to a loaded module as `node:fs/promises`, and `listed`, the paths of all listings so far.
 * @example
 * const resisting = fileSystemWhoseLinksResistRemoval()
 * const { removeWithoutFollowing } = await loadModule<typeof removalModule>(path, { 'node:fs/promises': resisting.fileSystem })
 */
export function fileSystemWhoseLinksResistRemoval(links: ResistingLinks = {}): {
  fileSystem: ResistingFileSystem
  listed: string[]
} {
  const listed: string[] = []
  /** Says whether a link stands at the path itself. */
  const isLink = async (path: string): Promise<boolean> =>
    (await fileSystem.lstat(path)).isSymbolicLink()
  const calls: RemovalFileSystem = {
    lstat: async (path) =>
      links.lstatOfALink === 'a directory' && (await isLink(path))
        ? fileSystem.stat(path)
        : fileSystem.lstat(path),
    stat: (path) => fileSystem.stat(path),
    chmod: async () => undefined,
    unlink: async (path) => {
      if (await isLink(path)) throw systemError('EPERM', 'unlink', path)
      await fileSystem.unlink(path)
    },
    rmdir: async (path) => {
      if (!(await isLink(path))) return fileSystem.rmdir(path)
      if (links.rmdirOfALink !== 'removes it')
        throw systemError('ENOTEMPTY', 'rmdir', path)
      await fileSystem.unlink(path)
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
      // A listing with options (entry types, a whole tree, an encoding) is noted too, and the real listing answers it with exactly what the caller handed over: names where names were asked for, entries only where the caller asked for entries.
      readdir: async (
        path: string,
        ...optionsAsHandedOver: unknown[]
      ): Promise<unknown> => {
        listed.push(path)
        return Reflect.apply(fileSystem.readdir, fileSystem, [
          path,
          ...optionsAsHandedOver,
        ])
      },
      rm: (path: string): Promise<void> => removeAsNode(path),
    },
    listed,
  }
}
