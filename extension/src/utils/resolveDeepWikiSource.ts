import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Resolves a browser citation only inside the opened checkout when the Wiki URI handler opens source. @param projectRoot - Canonical opened workspace root. @param citedRoot - Root recorded in the generated Wiki. @param citedPath - Project-relative citation path. @param citedHash - Optional cited file SHA-256. @returns The canonical file and whether its contents differ. @example await resolveDeepWikiSource('/repo', '/repo', 'src/main.ts', undefined) */
export async function resolveDeepWikiSource(
  projectRoot: string,
  citedRoot: string,
  citedPath: string,
  citedHash: string | undefined,
): Promise<{ filePath: string; changed: boolean }> {
  if (citedRoot !== projectRoot)
    throw new Error(
      'This citation belongs to another checkout. Open its matching project in the editor.',
    )
  if (!citedPath || isAbsolute(citedPath) || citedPath.includes('\0'))
    throw new Error('The Wiki citation has an invalid source path.')
  const filePath = await realpath(join(projectRoot, citedPath))
  const projectRelativePath = relative(projectRoot, filePath)
  // Realpath also rejects symlinks that escape the selected repository.
  if (
    !projectRelativePath ||
    projectRelativePath === '..' ||
    projectRelativePath.startsWith(`..${sep}`)
  )
    throw new Error('The Wiki citation points outside the opened project.')
  if (citedHash && !/^[a-f0-9]{64}$/i.test(citedHash))
    throw new Error('The Wiki citation has an invalid source hash.')
  const changed =
    citedHash === undefined ||
    createHash('sha256')
      .update(await readFile(filePath))
      .digest('hex') !== citedHash.toLowerCase()
  return { filePath, changed }
}
