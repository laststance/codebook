import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Which Next routers a workspace's route folders hold before launch: `app` for `app/` or `src/app/`, `pages` for `pages/` or `src/pages/`, `both`, or `none`. */
export type NextRouterKind = 'app' | 'pages' | 'both' | 'none'

/** The readiness note for {@link NextRouterKind} `none`: it names every folder searched, so the learner can see why no router was found. */
export const NEXT_ROUTE_FOLDER_NOT_FOUND_NOTE =
  'No Next route folder was found (looked for app, src/app, pages, src/pages).'

/** Whether a workspace-relative path is a folder; a file, a missing path or one that cannot be read is no route folder. */
async function isFolder(workspace: string, path: string): Promise<boolean> {
  const info = await stat(join(workspace, path)).catch(() => undefined)
  return info?.isDirectory() ?? false
}

/**
 * Reads which Next routers the workspace's route folders hold, from the filesystem alone, before anything is launched.
 *
 * Why it exists: `codebook_status` labels the `next-dev-webpack` readiness with the router kind, so an agent knows before a start whether the workspace has App Router pages, Pages Router pages or both. Called by {@link readRepositoryAdapterReadiness}. It is a label, never a readiness failure.
 * Next looks for each router's folder at the root first and in `src/` second (its root folder wins when both exist); for the kind it is enough that either exists. Only existence is checked: nothing in the folders is read.
 *
 * @param workspace - The workspace root, which is the package root.
 * @returns
 * - `'app'` when only `app/` or `src/app/` exists
 * - `'pages'` when only `pages/` or `src/pages/` exists
 * - `'both'` when a folder of each router exists
 * - `'none'` when none of the four folders exists
 * @example
 * await readNextRouterKind('/repo') // => 'pages' for a workspace with src/pages/index.tsx
 */
export async function readNextRouterKind(
  workspace: string,
): Promise<NextRouterKind> {
  const [rootApp, sourceApp, rootPages, sourcePages] = await Promise.all([
    isFolder(workspace, 'app'),
    isFolder(workspace, 'src/app'),
    isFolder(workspace, 'pages'),
    isFolder(workspace, 'src/pages'),
  ])
  const hasApp = rootApp || sourceApp
  const hasPages = rootPages || sourcePages
  if (hasApp && hasPages) return 'both'
  if (hasApp) return 'app'
  if (hasPages) return 'pages'
  return 'none'
}
