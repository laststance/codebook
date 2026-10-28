import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

/**
 * Names a file by its device and its inode number, read as `bigint` because an inode number can be larger than a number holds exactly; {@link openWithoutFollowing} compares the file it opened with the file it looked at by this name.
 * @param {import('node:fs').BigIntStats} status - A status read with `{ bigint: true }`.
 * @returns {string} Both numbers in one text.
 * @example
 * fileNameOnDevice(await lstat(path, { bigint: true })) // => '2114:48064969'
 */
function fileNameOnDevice(status) {
  return `${status.dev}:${status.ino}`
}

/**
 * Says why a path that was looked at without following it is not opened; called by {@link openWithoutFollowing} where the open cannot refuse a link.
 * @param {import('node:fs').BigIntStats} lookedAt - What `lstat` answered for the path.
 * @returns {'ELOOP' | 'ENOTREG' | undefined} `ELOOP` for a link (the code the open with `O_NOFOLLOW` answers on Linux and macOS); `ENOTREG` for a pipe, a device or a folder, which is refused before the open because such a system has no `O_NONBLOCK` either and the open of a pipe would wait; `undefined` for a regular file.
 * @example
 * refusalOfLook(await lstat('C:\\work\\a-link.vsix', { bigint: true })) // => 'ELOOP'
 */
function refusalOfLook(lookedAt) {
  if (lookedAt.isSymbolicLink()) return 'ELOOP'
  return lookedAt.isFile() ? undefined : 'ENOTREG'
}

/**
 * Builds the error of a path that was not opened, with a `code` a caller can tell it by as it tells a file system error; called by {@link openFileLookedAt}.
 * @param {'ELOOP' | 'ENOTREG' | 'EREPLACED'} code - Why the path was not opened.
 * @param {string} path - The path.
 * @returns {Error} The error, not thrown yet.
 * @example
 * throw notOpened('ELOOP', 'C:\\work\\a-link.vsix')
 */
function notOpened(code, path) {
  return Object.assign(new Error(`${code}: the path is not opened: ${path}`), {
    code,
  })
}

/**
 * Says whether an open file is the file a look at its path found, by {@link fileNameOnDevice} of both; called by {@link openFileLookedAt}.
 * @param {import('node:fs/promises').FileHandle} file - The file that was opened.
 * @param {import('node:fs').BigIntStats} lookedAt - What `lstat` answered for the path before the open.
 * @returns {Promise<boolean>} `true` when both name one file; `false` for another file, and when the opened file's status cannot be read: a file that cannot be told to be the one that was looked at is not used.
 * @example
 * await isFileOfTheLook(file, await lstat(path, { bigint: true })) // => true while nothing replaced the path
 */
async function isFileOfTheLook(file, lookedAt) {
  return file.stat({ bigint: true }).then(
    (opened) => fileNameOnDevice(opened) === fileNameOnDevice(lookedAt),
    () => false,
  )
}

/**
 * Opens a file on a system whose open cannot refuse a link: the path is looked at without following it, and the opened file must be the one that look found; called by {@link openWithoutFollowing} where `O_NOFOLLOW` does not exist.
 * @param {string} path - Path of the file.
 * @param {number} flags - The flags of the open.
 * @param {{ lstat: typeof lstat, open: typeof open }} fileSystem - The look and the open.
 * @returns {Promise<import('node:fs/promises').FileHandle>} The open regular file.
 * @throws The file system's error when the path cannot be looked at or opened; an error with the code `ELOOP` or `ENOTREG` for what {@link refusalOfLook} refuses; one with the code `EREPLACED` when another file took the path between the look and the open, or the opened file's status cannot be read. The file is closed on each of these ways out.
 * @example
 * await openFileLookedAt('C:\\work\\codebook.vsix', constants.O_RDONLY, { lstat, open })
 */
async function openFileLookedAt(path, flags, fileSystem) {
  const lookedAt = await fileSystem.lstat(path, { bigint: true })
  const refusal = refusalOfLook(lookedAt)
  if (refusal) throw notOpened(refusal, path)
  const file = await fileSystem.open(path, flags)
  // Between the look and the open the path can have become a link to another file.
  if (await isFileOfTheLook(file, lookedAt)) return file
  await file.close()
  throw notOpened('EREPLACED', path)
}

/**
 * Opens a path for reading without following a link at it, in the way this system allows; called by {@link readVsixBytes}. It is the rule of the extension's `src/utils/openWithoutFollowing.ts`, written again here because a script cannot load compiled extension code.
 * Why not the `.ts` file itself: the Node.js of `.node-version` imports it into a script without a flag, as it strips the types, but warns at every run (`MODULE_TYPELESS_PACKAGE_JSON`: `extension/package.json` names no module type and the file parses only as an ES module). `"type": "module"` there would end the warning and also turn the extension's own build into ES modules (`tsconfig.json` compiles with `"module": "Node16"`, which follows that field). This copy also keeps a seam for its look and its open (`fileSystem`), which the scripts' tests use; an ES module script cannot load the `.ts` module with another file system, as the extension's tests do. The Windows job runs this file's tests (`scripts/tests/openWithoutFollowing.test.mjs`) beside those of the `.ts` rule.
 * Where the system has `O_NOFOLLOW` (Linux, macOS) the open itself refuses a link, and `O_NONBLOCK` keeps it from waiting for the writer of a named pipe. Where it has not (Windows), the path is looked at first and the opened file must be the file that look found ({@link openFileLookedAt}). Which way is taken depends on the flag alone, never on the system's name, so a test can take the flag away.
 * @param {string} path - Path of the file.
 * @param {{ O_RDONLY: number, O_NOFOLLOW?: number, O_NONBLOCK?: number }} [flagsOfTheSystem] - The open flags this system defines; `fs.constants` unless a test takes one away.
 * @param {{ lstat: typeof lstat, open: typeof open }} [fileSystem] - The look and the open; those of `node:fs/promises` unless a test puts something between the two (a script's module cannot be loaded with another file system, as the extension's tests load theirs).
 * @returns {Promise<import('node:fs/promises').FileHandle>} The open file. With `O_NOFOLLOW` it can still be a pipe, a device or a folder, which the caller refuses by its `stat`; without the flag it is a regular file.
 * @throws The file system's error when the path cannot be opened. For a link: the open's own error with the flag (`ELOOP` on Linux and macOS), and an error with the code `ELOOP` without it. Without the flag also an error with the code `ENOTREG` for a pipe, a device or a folder, and one with the code `EREPLACED` when another file took the path between the look and the open.
 * @example
 * const file = await openWithoutFollowing('/tmp/codebook.vsix')
 */
export async function openWithoutFollowing(
  path,
  flagsOfTheSystem = constants,
  fileSystem = { lstat, open },
) {
  const readingWithoutWaiting =
    flagsOfTheSystem.O_RDONLY | (flagsOfTheSystem.O_NONBLOCK ?? 0)
  // With the flag the open itself refuses a link; without it the path is looked at first.
  return flagsOfTheSystem.O_NOFOLLOW === undefined
    ? openFileLookedAt(path, readingWithoutWaiting, fileSystem)
    : fileSystem.open(path, readingWithoutWaiting | flagsOfTheSystem.O_NOFOLLOW)
}
