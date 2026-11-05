/**
 * Lists the declared stop files that lie in the app's own `node_modules`, each once, in declared order.
 *
 * Why it exists: a published package in `node_modules` is not the checked-out library (decision D4), and that is known from the configuration alone, so a react-scripts run refuses such stops before its server starts. Called by `ConfiguredBrowserRun` while it resolves the react-scripts app.
 * @param paths - The declared stop files, repository-relative, possibly repeated.
 * @param toPackageRelative - Maps a repository-relative path into the app folder; `undefined` for a path outside it.
 * @returns The offending repository-relative paths; empty when no stop lies in `node_modules`.
 * @example
 * publishedStopFiles(['app/src/App.js', 'app/node_modules/lib/index.js'], (path) => path.slice(4)) // => ['app/node_modules/lib/index.js']
 */
export function publishedStopFiles(
  paths: readonly string[],
  toPackageRelative: (path: string) => string | undefined,
): string[] {
  const published: string[] = []
  for (const path of paths)
    // A path outside the app is refused as outside-package earlier; only a segment named node_modules inside it counts here.
    if (
      !published.includes(path) &&
      (toPackageRelative(path) ?? '').split('/').includes('node_modules')
    )
      published.push(path)
  return published
}
