import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** The two Next routers, named by the folder each reads its routes from. */
export type NextRouterName = 'app' | 'pages'

/** The workspace-relative folder one Next router reads: the root one or the one under `src/`. */
export type NextRouteFolder<Name extends NextRouterName> = Name | `src/${Name}`

/**
 * Finds the folder a Next router reads its routes from, by Next's own rule (`findDir`): the root folder wins over the one under `src/`.
 * Called by {@link readNextRouteManifests} to know which routers a project has, and by {@link findNextPagesSource} to know where a page's source lives.
 * @param workspace - The opened workspace (the Next project root).
 * @param name - The router whose folder is asked.
 * @returns `name` when the root folder exists, else `src/<name>` when that exists, else `undefined`.
 * @example
 * await findNextRouteFolder('/repo', 'pages') // => 'src/pages' in a project with only src/pages
 */
export async function findNextRouteFolder<Name extends NextRouterName>(
  workspace: string,
  name: Name,
): Promise<NextRouteFolder<Name> | undefined> {
  const folders: readonly NextRouteFolder<Name>[] = [name, `src/${name}`]
  for (const folder of folders)
    if (await existsAsNextSees(join(workspace, folder))) return folder
  return undefined
}

/**
 * Says whether a path exists the way Next asks (`existsSync`): any entry counts, a link to an existing target too; nothing is read but the entry's status. Called by {@link findNextRouteFolder}.
 * @param path - An absolute path.
 * @returns Whether the path exists; every failure to read its status counts as absent, as it does for Next.
 * @example
 * await existsAsNextSees('/repo/pages') // => true when the folder exists
 */
async function existsAsNextSees(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}
