import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'

/** The open flags of this system that {@link openWithoutFollowing} uses. A system without a flag does not define it: Windows has neither `O_NOFOLLOW` nor `O_NONBLOCK`. Every system defines `O_RDWR`; a test that hands only the flags of a system it stands in for may leave it out, and this system's is taken. @example const flags: NoFollowOpenConstants = { O_RDONLY: 0 } */
export type NoFollowOpenConstants = {
  O_RDONLY: number
  O_RDWR?: number
  O_NOFOLLOW?: number
  O_NONBLOCK?: number
}

/** What an opened file is used for: `read` for its bytes and its status; `read-write` for a change through the file itself, such as its times, which Windows allows only through a file that was opened with write access. Neither creates or truncates a file. */
export type NoFollowOpenAccess = 'read' | 'read-write'

/** Why a path was not opened on a system whose open cannot refuse a link: it holds a link (`ELOOP`, the code the open with `O_NOFOLLOW` answers on Linux and macOS), it holds something else that is no regular file (`ENOTREG`), or another file took it between the look and the open (`EREPLACED`). */
type LookRefusalCode = 'ELOOP' | 'ENOTREG' | 'EREPLACED'

/**
 * Builds the error of a path the look refused, with a `code` a caller can tell it by as it tells a file system error; called by {@link lookAtRegularFile} and {@link openFileLookedAtFirst}.
 * @param code - Why the path was refused.
 * @param message - The sentence of the error.
 * @returns The error, not thrown yet.
 * @example
 * throw lookRefusal('ELOOP', 'The path holds a link, which is not followed.')
 */
function lookRefusal(code: LookRefusalCode, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * Says whether an open file is the file a look at its path found, by the device and the inode number of both; called by {@link openFileLookedAtFirst}.
 * Both are read as `bigint`, because an inode number can be larger than a `number` holds exactly. Node.js documents `dev` as the id of the device that holds the file and `ino` as the file system's inode number of the file, and nothing of its own for Windows. That the look at a path and the file opened at it answer the same two numbers there is an observation, not a documented rule: on GitHub's `windows-latest` runner with Node.js 24.21.0 the regular-file cases of this opener's and of the Wiki metadata reader's tests pass (the Windows job, run 37321685601), and they would fail if the two disagreed. It fits what libuv 1.52.1, the version in that Node.js, does in `src/win/fs.c`: one routine, `fs__stat_assign_statbuf` (line 1905), fills `st_dev` from the volume's serial number (line 1908) and `st_ino` from the file's id (line 1971), and it is called for a path (line 1800) and for an open file (line 1891). Another version, or a file system that numbers no files and answers one value for all of them, can differ: then the regular-file cases of the Windows job fail, or only the look's refusal of a link is left.
 * {@link unchangedSource} is not used here: it also asks that size and times did not change, and would refuse a marker another window is writing at that moment.
 * @param file - The file that was opened.
 * @param lookedAt - What `lstat` answered for the path before the open.
 * @returns `true` when both name one file; `false` for another file, which the path came to name between the look and the open.
 * @example
 * await isFileLookedAt(file, await lstat(path, { bigint: true })) // => true while nothing replaced the path
 */
async function isFileLookedAt(
  file: FileHandle,
  lookedAt: BigIntStats,
): Promise<boolean> {
  const opened = await file.stat({ bigint: true })
  return opened.dev === lookedAt.dev && opened.ino === lookedAt.ino
}

/**
 * Looks at a path without following a link at it and answers only for a regular file; called by {@link openFileLookedAtFirst} before anything is opened.
 * @param path - Absolute path of the file.
 * @returns What `lstat` answered for the regular file at the path, with exact numbers.
 * @throws The file system's error when the path cannot be looked at (`ENOENT` for a missing file); an error with the code `ELOOP` for a link; one with the code `ENOTREG` for a pipe, a device or a folder, which is refused here because such a system has no `O_NONBLOCK` either and the open of a pipe would wait.
 * @example
 * await lookAtRegularFile('C:\\repo\\.codebook\\wiki\\a-link') // rejects with code 'ELOOP'
 */
async function lookAtRegularFile(path: string): Promise<BigIntStats> {
  const lookedAt = await lstat(path, { bigint: true })
  if (lookedAt.isSymbolicLink())
    throw lookRefusal(
      'ELOOP',
      `The path holds a link, which is not followed: ${path}`,
    )
  if (!lookedAt.isFile())
    throw lookRefusal('ENOTREG', `Not a regular file: ${path}`)
  return lookedAt
}

/**
 * Opens a file on a system whose open cannot refuse a link: the path is looked at without following it, and the opened file must be the one that look found; called by {@link openWithoutFollowing} where `O_NOFOLLOW` does not exist.
 * @param path - Absolute path of the file.
 * @param flags - The flags of the open.
 * @returns The open regular file.
 * @throws What {@link lookAtRegularFile} throws for a path that is missing or holds no regular file; the file system's error when the open fails; an error with the code `EREPLACED` when the opened file is not the file that was looked at (the path was replaced in between), after the file was closed.
 * @example
 * await openFileLookedAtFirst('C:\\repo\\.codebook\\wiki\\codebook-wiki.json', constants.O_RDONLY)
 */
async function openFileLookedAtFirst(
  path: string,
  flags: number,
): Promise<FileHandle> {
  const lookedAt = await lookAtRegularFile(path)
  const file = await open(path, flags)
  // Between the look and the open the path can have become a link to another file.
  if (await isFileLookedAt(file, lookedAt).catch(() => false)) return file
  await file.close()
  throw lookRefusal(
    'EREPLACED',
    `The path came to hold another file between the look at it and its open: ${path}`,
  )
}

/**
 * Picks the access flag of an open, for {@link openWithoutFollowing}.
 * @param openConstants - The open flags this system defines.
 * @param access - What the file is opened for.
 * @returns `O_RDONLY` for `read`; `O_RDWR` for `read-write`, which opens an existing file and neither creates nor truncates one.
 * @example
 * accessFlagOf(constants, 'read-write') // => constants.O_RDWR
 */
function accessFlagOf(
  { O_RDONLY, O_RDWR = constants.O_RDWR }: NoFollowOpenConstants,
  access: NoFollowOpenAccess,
): number {
  return access === 'read-write' ? O_RDWR : O_RDONLY
}

/**
 * Opens a path without following a link at it, in the way this system allows; every reader that must not read through a link opens through it: {@link readWikiRegularFile}, {@link hashFileSha256} and the Cursor MCP catalog ({@link refreshCursorMcpCatalog}).
 * Where the system has `O_NOFOLLOW` (Linux, macOS) the open itself refuses a link, and `O_NONBLOCK` keeps it from waiting for the writer of a named pipe. Where it has not (Windows), the path is looked at first and the opened file must be the file that look found ({@link openFileLookedAtFirst}). Which way is taken depends on the flag alone, never on the system's name, so a test can take the flag away.
 * @param path - Absolute path of the file.
 * @param openConstants - The open flags this system defines; `fs.constants` unless a test takes one away.
 * @param access - `read` unless the caller changes something through the file itself: the Cursor MCP catalog sets its config's times through a file opened with `read-write`, because Windows sets times only through a file opened with write access. The file must exist either way; nothing is created or truncated.
 * @returns The open file. With `O_NOFOLLOW` it can still be a pipe, a device or a folder, which the caller refuses by its `stat`; without the flag it is a regular file.
 * @throws
 * - The file system's error when the path cannot be opened (`ENOENT` for a missing file; `EPERM` or `EACCES` for `read-write` on a file this user may not write, such as a read-only one)
 * - For a link at the path: the open's own error with `O_NOFOLLOW` (`ELOOP` on Linux and macOS), and an error with the code `ELOOP` without the flag
 * - Without the flag only: an error with the code `ENOTREG` for a pipe, a device or a folder, and one with the code `EREPLACED` for a path that another file took between the look and the open
 * @example
 * ```ts
 * const file = await openWithoutFollowing('/repo/.codebook/wiki/codebook-wiki.json')
 * await openWithoutFollowing('/repo/.codebook/wiki/a-link') // rejects with code 'ELOOP', on Windows too
 * ```
 */
export async function openWithoutFollowing(
  path: string,
  openConstants: NoFollowOpenConstants = constants,
  access: NoFollowOpenAccess = 'read',
): Promise<FileHandle> {
  const { O_NOFOLLOW, O_NONBLOCK = 0 } = openConstants
  const accessFlags = accessFlagOf(openConstants, access) | O_NONBLOCK
  // Without O_NOFOLLOW the open would follow a link, so the path is looked at first.
  if (O_NOFOLLOW === undefined) return openFileLookedAtFirst(path, accessFlags)
  return open(path, accessFlags | O_NOFOLLOW)
}
