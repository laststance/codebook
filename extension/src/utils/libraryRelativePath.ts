/**
 * Gives a library stop's path below the library folder.
 * Why it exists: the library seal reads the stop below the checked-out library, while a declared stop is repository-relative. Called by the `readBundle` of the react-scripts and static-page adapters for a library stop.
 * @param libraryRootRelative - The library's repository-relative folder (`"."` for the repository root).
 * @param repositoryPath - The stop's repository-relative path, inside that folder.
 * @returns The path below the library folder, forward slashes.
 * @example
 * libraryRelativePath('packages/lib', 'packages/lib/src/a.ts') // => 'src/a.ts'
 * libraryRelativePath('.', 'src/a.ts') // => 'src/a.ts'
 */
export function libraryRelativePath(
  libraryRootRelative: string,
  repositoryPath: string,
): string {
  return libraryRootRelative === '.'
    ? repositoryPath
    : repositoryPath.slice(libraryRootRelative.length + 1)
}
