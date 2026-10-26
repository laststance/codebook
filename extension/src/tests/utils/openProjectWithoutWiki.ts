import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openWikiUpdateWindow } from './wikiUpdateWindow'

/** Says whether a path exists on disk. */
export const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

/** Publishes a first Wiki the way the publisher would: its entry page, then the manifest of this project and the receipt that names the manifest's hash, each moved into place. */
export async function publishGeneratedWiki(
  outputDirectory: string,
  projectRoot: string,
  repositoryRoot = projectRoot,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'index.html'), '<title>Wiki</title>')
  const manifestText = JSON.stringify({
    schemaVersion: 1,
    repositoryRoot,
    generated: { revision: '1936e41913729663cc99081e3224db89bb2d8e56' },
    pages: [],
    assets: [],
    excludedPaths: [],
    includedSources: [{ path: 'src/a.ts', sha256: 'a'.repeat(64) }],
  })
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  await writeFile(`${manifestPath}.next`, manifestText)
  await rename(`${manifestPath}.next`, manifestPath)
  const receiptPath = join(outputDirectory, 'codebook-publication.json')
  await writeFile(
    `${receiptPath}.next`,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'published',
      manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
    }),
  )
  await rename(`${receiptPath}.next`, receiptPath)
}

/** Opens a window on a project that has no Wiki and no `.codebook` folder yet, the ordinary first use; the browser reader is not opened, since there is nothing to serve. */
export async function openProjectWithoutWiki(
  options: Omit<
    Parameters<typeof openWikiUpdateWindow>[0],
    'projectRoot' | 'openReader'
  > = {},
) {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-generate-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const window = await openWikiUpdateWindow({
    ...options,
    projectRoot,
    openReader: false,
  })
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  return {
    ...window,
    projectRoot,
    outputDirectory,
    markerPath: `${outputDirectory}.update-run.json`,
    /** Closes the editor window as the learner does, keeping the project on disk for the test's assertions; `close` still removes it. */
    closeWindow: (): Promise<void> => window.close(),
    async close(): Promise<void> {
      await window.close()
      await rm(projectDirectory, { recursive: true, force: true })
    },
  }
}
