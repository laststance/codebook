import { constants as fileSystemConstants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

/**
 * Says whether a path is a regular file this user may run; the program check of {@link gitExecutablePath} and of {@link psProgramPath} for `ps` (the process listing and the process group checks of the inspectors), unless a test names its own.
 * @param path - An absolute path.
 * @returns `true` for a regular file that is executable for this user (on Windows, which decides by the extension, any regular file); `false` for anything else, also a path that cannot be read.
 * @example
 * await isProgramFile('/usr/bin/git') // => true
 * await isProgramFile('/tmp')         // => false
 */
export async function isProgramFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    // Windows decides by the extension; POSIX by the file's execute permission.
    if (process.platform !== 'win32')
      await access(path, fileSystemConstants.X_OK)
    return true
  } catch {
    return false
  }
}
