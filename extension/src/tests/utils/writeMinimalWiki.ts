import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Writes the one-page Wiki the reader and window fixtures open (an index page and a manifest without pages) into a project's `.codebook/wiki`, so {@link serveMinimalWiki} and {@link openWikiOpeningWindow} publish the same site.
 * @param projectRoot - The project's real path; the manifest names it as the repository root.
 * @returns The Wiki folder and the path of its manifest.
 * @throws When the folder or one of the two files cannot be written.
 * @example
 * await writeMinimalWiki('/tmp/codebook-wiki-status-x')
 * // => { outputDirectory: '/tmp/codebook-wiki-status-x/.codebook/wiki', manifestPath: '/tmp/codebook-wiki-status-x/.codebook/wiki/codebook-wiki.json' }
 */
export async function writeMinimalWiki(
  projectRoot: string,
): Promise<{ outputDirectory: string; manifestPath: string }> {
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><body>Wiki</body>',
  )
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
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
  return { outputDirectory, manifestPath }
}
