import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'

import { EXTENSION_BUILD_HASH_CONCURRENCY } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/** Prefix of the value a path hashes to when its read failed for a reason that is not a state of the path. */
export const UNREADABLE_HASH_PREFIX = 'unreadable:'

/** Suffix of an entry whose file has an executable bit; a changed bit is a changed entry. */
const EXECUTABLE_ENTRY_SUFFIX = ':executable'

/** Prefix of an entry whose path is a symbolic link; only the link's target text follows, never the content it points at. */
const LINK_ENTRY_PREFIX = 'link:'

/** Prefix of an entry whose path is neither a regular file, a directory nor a link (FIFO, socket, device); it is never opened. */
const SPECIAL_ENTRY_PREFIX = 'special:'

/** The state of a path that cannot be inspected or read: `absent` for a missing path, else `unreadable:<code>`. */
function unavailableState(error: unknown): string {
  const code = systemErrorCode(error)
  // Absent is a state of the path, so it stays comparable; every other code is a failed inspection.
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent'
  return `${UNREADABLE_HASH_PREFIX}${code === '' ? 'unknown' : code}`
}

/** The type name of a stat result that is not a regular file, directory or link. */
function specialType(stats: Stats): string {
  if (stats.isFIFO()) return 'fifo'
  if (stats.isSocket()) return 'socket'
  if (stats.isCharacterDevice()) return 'character-device'
  if (stats.isBlockDevice()) return 'block-device'
  return 'unknown'
}

/** The snapshot entry of one path, decided by `lstat` first so only a regular file is ever opened. */
async function readSnapshotEntry(absolutePath: string): Promise<string> {
  let stats: Stats
  try {
    stats = await lstat(absolutePath)
  } catch (error) {
    return unavailableState(error)
  }
  // A directory (gitlink, submodule entry, or a path that became a folder) has no content to read.
  if (stats.isDirectory()) return 'directory'
  try {
    // A link records where it points; retargeting a link to equal content is still a change.
    if (stats.isSymbolicLink()) {
      return `${LINK_ENTRY_PREFIX}${await readlink(absolutePath)}`
    }
    // A FIFO or socket would block a read, so every non-regular type is recorded by name and left unopened.
    if (!stats.isFile()) return `${SPECIAL_ENTRY_PREFIX}${specialType(stats)}`
    const content = await readFile(absolutePath)
    const hash = createHash('sha256').update(content).digest('hex')
    return (stats.mode & 0o111) !== 0
      ? `${hash}${EXECUTABLE_ENTRY_SUFFIX}`
      : hash
  } catch (error) {
    // The path may have become a folder between the lstat and the read.
    return systemErrorCode(error) === 'EISDIR'
      ? 'directory'
      : unavailableState(error)
  }
}

/**
 * Takes the source snapshot of files as they are on disk, so a build's effect on them can be compared afterwards.
 * Called by {@link buildWxtExtension} and the library build before the build and again (through {@link findChangedTrackedFile}) after the build's process tree ended.
 * @param repositoryRoot - The folder the paths are relative to.
 * @param paths - Repository-relative paths, from {@link listTrackedFiles}.
 * @returns Path to entry. A regular file's entry is its SHA-256, with `:executable` appended when it has an executable bit. A symbolic link's entry is `link:<target>` (target text only, its content is never read). A FIFO, socket or device is `special:<type>` and is never opened. A missing file (`ENOENT`) or one whose parent is now a file (`ENOTDIR`) is `absent`, and a directory (`EISDIR`, a tracked gitlink or submodule entry) is `directory`. Any other read error is `unreadable:<code>`, which {@link findChangedTrackedFile} never counts as a match.
 * @example
 * await hashTrackedFiles('/repo', ['a.ts']) // => Map { 'a.ts' => 'e3b0c442…' }
 */
export async function hashTrackedFiles(
  repositoryRoot: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  // Batches bound the open files; each batch reads its files in parallel.
  for (
    let start = 0;
    start < paths.length;
    start += EXTENSION_BUILD_HASH_CONCURRENCY
  ) {
    const batch = paths.slice(start, start + EXTENSION_BUILD_HASH_CONCURRENCY)
    const batchHashes = await Promise.all(
      batch.map((path) => readSnapshotEntry(join(repositoryRoot, path))),
    )
    batch.forEach((path, index) => hashes.set(path, batchHashes[index] ?? ''))
  }
  return hashes
}
