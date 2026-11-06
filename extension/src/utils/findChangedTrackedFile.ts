import { hashTrackedFiles } from './hashTrackedFiles'

/**
 * Re-hashes a snapshot's files and names the first one whose content changed.
 * Called by {@link buildWxtExtension} after every way a build ends, once its process tree is confirmed ended.
 * @param repositoryRoot - The folder the snapshot's paths are relative to.
 * @param snapshot - Path to hash from {@link hashTrackedFiles}, taken before the build.
 * @returns The first changed path in sorted order, or `undefined` when every file hashes as before.
 * @example
 * await findChangedTrackedFile('/repo', new Map([['a.ts', 'abc']])) // => 'a.ts' when a.ts changed
 */
export async function findChangedTrackedFile(
  repositoryRoot: string,
  snapshot: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const paths = [...snapshot.keys()].sort()
  const after = await hashTrackedFiles(repositoryRoot, paths)
  return paths.find((path) => after.get(path) !== snapshot.get(path))
}
