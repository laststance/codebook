/**
 * Says whether a repository-relative path lies at or below a repository-relative folder, by path segments (`apps/api2` is not inside `apps/api`).
 *
 * Why it exists: the `apiServer` rules of a version 3 `expo-web-dev` configuration and of its saved format 19 study decide a stop's participant from its folder, and must not read a shared name prefix as containment. Called by the configuration schema and by the study evidence checks.
 *
 * @param folder - A repository-relative folder; `"."` is the repository root and contains everything. A trailing slash is ignored.
 * @param path - A repository-relative file or folder path.
 * @returns `true` when `path` equals `folder` or lies below it.
 * @example
 * isRepositoryPathInFolder('apps/api', 'apps/api/src/server.ts') // => true
 * isRepositoryPathInFolder('apps/api', 'apps/api2/src/server.ts') // => false
 * isRepositoryPathInFolder('.', 'apps/app/App.tsx') // => true
 */
export function isRepositoryPathInFolder(
  folder: string,
  path: string,
): boolean {
  const folderSegments = folder
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
  const pathSegments = path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
  // The repository root (no segments) contains every path.
  return folderSegments.every(
    (segment, index) => pathSegments[index] === segment,
  )
}
