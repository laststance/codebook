import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type DeepWikiReader, startDeepWikiReader } from '../../deepWikiReader'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

/**
 * Publishes a one-page Wiki in a temporary project and serves it, for tests of the reader's routes and of its served page script.
 *
 * @param readUpdateStatus - Update state the reader answers at `api/update-status`; idle when omitted.
 * @returns The started reader, the path of its manifest and a `close` that stops the reader and removes the project.
 * @throws When the Wiki cannot be written or its reader does not start; the temporary project is removed before the error is passed on.
 *
 * @example
 * ```ts
 * const wiki = await serveMinimalWiki(() => ({ state: 'idle' }))
 * try {
 *   await fetch(new URL('api/update-status', wiki.reader.url))
 * } finally {
 *   await wiki.close()
 * }
 * ```
 */
export async function serveMinimalWiki(
  readUpdateStatus?: () => WikiUpdateStatus,
): Promise<{
  reader: DeepWikiReader
  manifestPath: string
  close(): Promise<void>
}> {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-status-'),
  )
  const removeProject = (): Promise<void> =>
    rm(projectDirectory, { recursive: true, force: true })
  try {
    const projectRoot = await realpath(projectDirectory)
    const output = join(projectRoot, '.codebook', 'wiki')
    await mkdir(output, { recursive: true })
    await writeFile(
      join(output, 'index.html'),
      '<!doctype html><body>Wiki</body>',
    )
    const manifestPath = join(output, 'codebook-wiki.json')
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        pages: [],
        assets: [],
        includedSources: [],
      }),
    )
    const reader = await startDeepWikiReader(
      output,
      projectRoot,
      async () => ({ handoff: 'unused' }),
      'vscode',
      readUpdateStatus,
    )
    return {
      reader,
      manifestPath,
      async close(): Promise<void> {
        await reader.close()
        await removeProject()
      },
    }
  } catch (error) {
    // A fixture that failed hands no `close` to its caller, so it removes its own temporary project.
    await removeProject()
    throw error
  }
}
