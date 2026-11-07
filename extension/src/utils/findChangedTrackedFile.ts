import { hashTrackedFiles, UNREADABLE_HASH_PREFIX } from './hashTrackedFiles'
import { listTrackedFiles } from './listTrackedFiles'
import type { SourceSnapshotFileSet } from './listTrackedFiles'

/** What the comparison of a snapshot with the files as they are now found. */
export type TrackedFileComparison =
  { kind: 'changed'; path: string } | { kind: 'unverified'; path: string }

/**
 * Re-reads a snapshot's files and names the first one whose content, link target or executable bit changed, or else the first one that could not be checked.
 * Called by {@link buildWxtExtension} and the library build after every way a build ends, once its process tree is confirmed ended.
 * A file that could not be read before or after the build has no content to compare, so it is never a match.
 * @param repositoryRoot - The folder the snapshot's paths are relative to.
 * @param snapshot - Path to entry from {@link hashTrackedFiles}, taken before the build.
 * @param fileSet - The file set the snapshot was listed with. With `tracked-and-untracked` the folder is listed again and a path that was not in the snapshot counts as changed; with `tracked` (default) only the snapshot's paths are compared.
 * @returns
 * - `{ kind: 'changed', path }` for the first changed path in sorted order (a change is reported before an unreadable file)
 * - `{ kind: 'unverified', path }` for the first path in sorted order that was unreadable before or after the build, when nothing changed
 * - `undefined` when every file reads as before
 * @throws What {@link listTrackedFiles} throws, only for `tracked-and-untracked`.
 * @example
 * await findChangedTrackedFile('/repo', new Map([['a.ts', 'abc']])) // => { kind: 'changed', path: 'a.ts' } when a.ts changed
 */
export async function findChangedTrackedFile(
  repositoryRoot: string,
  snapshot: ReadonlyMap<string, string>,
  fileSet: SourceSnapshotFileSet = 'tracked',
): Promise<TrackedFileComparison | undefined> {
  // A file created during the build is not in the snapshot; listing again finds it.
  const created =
    fileSet === 'tracked'
      ? []
      : (
          await listTrackedFiles(repositoryRoot, repositoryRoot, fileSet)
        ).filter((path) => !snapshot.has(path))
  const paths = [...snapshot.keys()].sort()
  const after = await hashTrackedFiles(repositoryRoot, paths)
  let firstUnverified: string | undefined
  for (const path of paths) {
    const before = snapshot.get(path) ?? ''
    const now = after.get(path) ?? ''
    // A failed read on either side leaves nothing to compare.
    if (
      before.startsWith(UNREADABLE_HASH_PREFIX) ||
      now.startsWith(UNREADABLE_HASH_PREFIX)
    ) {
      firstUnverified ??= path
      continue
    }
    if (before !== now) return { kind: 'changed', path }
  }
  const firstCreated = created.sort()[0]
  if (firstCreated !== undefined) return { kind: 'changed', path: firstCreated }
  return firstUnverified === undefined
    ? undefined
    : { kind: 'unverified', path: firstUnverified }
}
