import { join } from 'node:path'

/** The calls of `node:fs/promises` that the removal of Node.js makes, each as that removal uses it. */
export type RemovalFileSystem = {
  lstat(path: string): Promise<{ isDirectory(): boolean }>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  unlink(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  chmod(path: string, mode: number): Promise<void>
}

/** The answers after which the removal of Node.js empties a directory on Windows (`notEmptyErrorCodes` of its source). */
const NOT_EMPTY_CODES_ON_WINDOWS = ['ENOTEMPTY', 'EEXIST']

/** Reads the system error name of what a file system call threw; `''` when it carries none. @example codeOf(Object.assign(new Error('x'), { code: 'EPERM' })) // => 'EPERM' */
function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : ''
}

/**
 * Builds the recursive removal of Node.js as it runs on Windows, over a file system a test hands in, so a test can show where that removal goes when the system answers `EPERM`.
 * It follows `lib/internal/fs/rimraf.js` of Node.js 24.21.0 step by step (`_rimraf`, `fixWinEPERM`, `_rmdir`, `_rmchildren`, without retries, which are off by default): a look with `lstat`; a directory is removed with `rmdir` and emptied when that answers "not empty"; anything else is unlinked; and after `EPERM` from the look or the unlink the entry is looked at again with `stat`, which follows a link, and treated as a directory when the link leads to one.
 * @param fileSystem - The file system the removal runs on.
 * @returns The removal, as `rm(path, { recursive: true, force: true })` of `node:fs/promises` is called.
 * @example
 * const rm = removeAsNodeOnWindows({ ...fileSystem, unlink: unlinkThatRefusesLinks })
 * await rm('/tmp/project/a-link-to-a-folder') // empties the folder the link leads to when `rmdir` of the link answers ENOTEMPTY
 */
export function removeAsNodeOnWindows(
  fileSystem: RemovalFileSystem,
): (path: string) => Promise<void> {
  /** `_rmchildren`: every entry of the directory is removed, then the directory. */
  const removeChildren = async (path: string): Promise<void> => {
    for (const name of await fileSystem.readdir(path))
      await removeEntry(join(path, name))
    await fileSystem.rmdir(path)
  }
  /** `_rmdir`: the directory is removed; one that is not empty is emptied first. */
  const removeDirectory = async (
    path: string,
    originalError: unknown,
  ): Promise<void> => {
    try {
      await fileSystem.rmdir(path)
    } catch (error) {
      if (NOT_EMPTY_CODES_ON_WINDOWS.includes(codeOf(error)))
        return removeChildren(path)
      throw codeOf(error) === 'ENOTDIR' ? originalError : error
    }
  }
  /** `fixWinEPERM`: after `EPERM` the entry is made writable and looked at with `stat`, which follows a link. */
  const removeAfterRefusal = async (
    path: string,
    originalError: unknown,
  ): Promise<void> => {
    try {
      await fileSystem.chmod(path, 0o666)
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return
      throw originalError
    }
    const followed = await fileSystem.stat(path).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return undefined
      throw originalError
    })
    if (!followed) return
    if (followed.isDirectory()) return removeDirectory(path, originalError)
    await fileSystem.unlink(path)
  }
  /** `_rimraf`: one entry, looked at with `lstat` first. */
  const removeEntry = async (path: string): Promise<void> => {
    const looked = await fileSystem.lstat(path).then(
      (entry) => ({ entry }),
      (error: unknown) => ({ error }),
    )
    if ('error' in looked) {
      if (codeOf(looked.error) === 'ENOENT') return
      if (codeOf(looked.error) === 'EPERM')
        return removeAfterRefusal(path, looked.error)
    } else if (looked.entry.isDirectory()) {
      return removeDirectory(path, undefined)
    }
    try {
      await fileSystem.unlink(path)
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return
      if (codeOf(error) === 'EISDIR') return removeDirectory(path, error)
      if (codeOf(error) === 'EPERM') return removeAfterRefusal(path, error)
      throw error
    }
  }
  return removeEntry
}
