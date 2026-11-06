import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'

import { EXTENSION_BUILD_HASH_CONCURRENCY } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/** Prefix of the value a path hashes to when its read failed for a reason that is not a state of the path. */
export const UNREADABLE_HASH_PREFIX = 'unreadable:'

/** Suffix of an entry whose file has an executable bit; a changed bit is a changed entry. */
const EXECUTABLE_ENTRY_SUFFIX = ':executable'

/** Prefix of an entry whose path is a symbolic link; the link's target text follows, then the content state of what it points at. */
const LINK_ENTRY_PREFIX = 'link:'

/** The content state of a path: its SHA-256, `absent`, `directory` or `unreadable:<code>`. */
async function readContentState(absolutePath: string): Promise<string> {
  try {
    const content = await readFile(absolutePath)
    return createHash('sha256').update(content).digest('hex')
  } catch (error) {
    const code = systemErrorCode(error)
    // Absent and directory are states of the path, so they stay comparable; every other code is a read that failed.
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent'
    if (code === 'EISDIR') return 'directory'
    return `${UNREADABLE_HASH_PREFIX}${code === '' ? 'unknown' : code}`
  }
}

/** The snapshot entry of one path: content state, plus the link target of a symbolic link and the executable bit. */
async function readSnapshotEntry(absolutePath: string): Promise<string> {
  let linkTarget: string | undefined
  let isExecutable = false
  try {
    const stats = await lstat(absolutePath)
    isExecutable = (stats.mode & 0o111) !== 0 && !stats.isDirectory()
    if (stats.isSymbolicLink()) linkTarget = await readlink(absolutePath)
  } catch {
    // The content read below names the state (absent, unreadable) of a path that cannot be inspected.
  }
  const content = await readContentState(absolutePath)
  // A link records where it points, because retargeting a link to equal content is still a change.
  const entry =
    linkTarget === undefined
      ? content
      : `${LINK_ENTRY_PREFIX}${linkTarget}\0${content}`
  // An unreadable state stays a bare `unreadable:` value so the comparison can recognise it.
  if (content.startsWith(UNREADABLE_HASH_PREFIX)) return content
  return isExecutable ? `${entry}${EXECUTABLE_ENTRY_SUFFIX}` : entry
}

/**
 * Takes the source snapshot of files as they are on disk, so a build's effect on them can be compared afterwards.
 * Called by {@link buildWxtExtension} and the library build before the build and again (through {@link findChangedTrackedFile}) after the build's process tree ended.
 * @param repositoryRoot - The folder the paths are relative to.
 * @param paths - Repository-relative paths, from {@link listTrackedFiles}.
 * @returns Path to entry. A regular file's entry is its SHA-256, with `:executable` appended when it has an executable bit. A symbolic link's entry is `link:<target>`, a NUL and the content state of what it points at. A missing file (`ENOENT`) or one whose parent is now a file (`ENOTDIR`) is `absent`, and a directory (`EISDIR`, a tracked gitlink or submodule entry) is `directory`. Any other read error is `unreadable:<code>`, which {@link findChangedTrackedFile} never counts as a match.
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
