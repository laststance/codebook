import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Says whether a workspace-relative path is a regular file reached without any link, asking only `lstat` of each component; called by {@link findNextPagesSource} for each candidate and by {@link hasNextAppPageSource} for an App page file.
 * @param workspace - The opened workspace.
 * @param relativePath - A workspace-relative path with `/` separators.
 * @returns `true` for a regular file; `false` when a component is absent, not a folder, or a link.
 * @throws When the status of a component cannot be read for another reason (e.g. permission).
 * @example
 * await isUnlinkedRegularFile('/repo', 'src/pages/index.tsx') // => true
 */
export async function isUnlinkedRegularFile(
  workspace: string,
  relativePath: string,
): Promise<boolean> {
  const components = relativePath.split('/')
  let current = workspace
  for (const [index, component] of components.entries()) {
    current = join(current, component)
    const status = await lstat(current).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
          return undefined
        throw error
      },
    )
    // A link is never followed out of the workspace, so a linked folder or file is no source.
    if (!status || status.isSymbolicLink()) return false
    if (index < components.length - 1 && !status.isDirectory()) return false
    if (index === components.length - 1) return status.isFile()
  }
  return false
}
