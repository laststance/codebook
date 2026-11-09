/**
 * Tells whether a normalized relative path leaves its folder.
 *
 * Why it exists: a prefix test on `..` also rejects a file named `..app.js`; only `..` itself or a `../` (or `..\`) segment leaves the folder. Called by the static page readiness and script path resolution.
 * @param relativePath - A normalized folder-relative path.
 * @returns `true` for `..`, `../…` and `..\…`.
 * @example leavesStaticPageFolder('../x.js') // => true
 * @example leavesStaticPageFolder('..app.js') // => false
 */
export function leavesStaticPageFolder(relativePath: string): boolean {
  return (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\')
  )
}
