import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The two entry points of the shipped publisher (`skills/codebook/publish-wiki.mjs`) the fixture drives. */
type WikiPublisher = {
  prepareWikiStage(options: {
    projectRoot: string
    outputDirectory: string
    stageDirectory?: string
  }): Promise<{ stage: string }>
  publishWiki(options: {
    projectRoot: string
    outputDirectory: string
    stageDirectory: string
  }): Promise<unknown>
}

/** What a candidate site of the fixture contains besides its index page. */
export type WikiCandidateContent = {
  /** Text of the index page's heading; a different text is a different generation. */
  heading: string
  /** Extra page paths the candidate owns, for example `pages/notes.html`. */
  extraPages?: string[]
  /** Paths the manifest lists as excluded; changing only this keeps the displayed identity. */
  excludedPaths?: string[]
}

/** Tells TypeScript that the dynamically imported `.mjs` module has the publisher's two functions. */
function isWikiPublisher(module: unknown): module is WikiPublisher {
  return (
    typeof module === 'object' &&
    module !== null &&
    'prepareWikiStage' in module &&
    typeof module.prepareWikiStage === 'function' &&
    'publishWiki' in module &&
    typeof module.publishWiki === 'function'
  )
}

/** Lists every regular file below a folder as `/`-separated relative paths, sorted. */
async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await listFiles(directory, path)))
    else files.push(path)
  }
  return files.sort()
}

/**
 * Publishes a real Wiki with the shipped publisher into a temporary project, adds a learner's own file, and lets a test act as the editor agent (prepare, write a candidate, publish) and hash the whole output folder.
 *
 * Why: the update flow infers what an agent did from the publisher's files (stage names, receipts, baseline, journal), so its tests must run against those files as the publisher really writes them.
 * Used by the Wiki update flow and conflict-probe tests.
 *
 * @param outputSetting - Project-relative output folder, as `codebook.wikiOutputDirectory` would name it.
 * @returns The project and output paths, the agent's three steps, the folder hash and a cleanup.
 * @throws When the first publish fails, for example over an output folder the publisher refuses; the temporary project is removed before the error is passed on.
 *
 * @example
 * ```ts
 * const wiki = await publishedWikiFixture()
 * const stage = await wiki.prepare()
 * await wiki.writeCandidate(stage, { heading: 'Second' })
 * await wiki.publish(stage)
 * await wiki.hashOutput() // => '4be1…' (sha256 over every file of the output folder)
 * ```
 */
export async function publishedWikiFixture(
  outputSetting = '.codebook/wiki',
): Promise<{
  projectRoot: string
  outputDirectory: string
  /** The learner's own file inside the output folder, which every publish must keep. */
  learnerFile: string
  prepare(stageDirectory?: string): Promise<string>
  writeCandidate(stage: string, content: WikiCandidateContent): Promise<void>
  publish(stage: string): Promise<void>
  hashOutput(): Promise<string>
  cleanup(): Promise<void>
}> {
  const loaded: unknown = await import(
    pathToFileURL(
      resolve(__dirname, '../../../skills/codebook/publish-wiki.mjs'),
    ).href
  )
  if (!isWikiPublisher(loaded))
    throw new Error('The shipped Wiki publisher did not load.')
  const publisher = loaded
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-published-')),
  )
  const outputDirectory = join(projectRoot, outputSetting)
  const sourceText = 'export const value = 1;\n'
  const cleanup = (): Promise<void> =>
    rm(projectRoot, { recursive: true, force: true })
  const prepare = async (stageDirectory?: string): Promise<string> =>
    (
      await publisher.prepareWikiStage({
        projectRoot,
        outputDirectory,
        ...(stageDirectory === undefined ? {} : { stageDirectory }),
      })
    ).stage
  const writeCandidate = async (
    stage: string,
    content: WikiCandidateContent,
  ): Promise<void> => {
    const sources = [{ path: 'source.ts', line: 1 }]
    await writeFile(
      join(stage, 'codebook-wiki.json'),
      JSON.stringify({
        schemaVersion: 1,
        readerVersion: 2,
        repositoryRoot: projectRoot,
        generated: { revision: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0' },
        pages: [
          {
            path: 'index.html',
            title: 'Overview',
            section: 'Guide',
            contentHtml: `<h2 id="intro">${content.heading}</h2>`,
            sources,
            outline: [{ id: 'intro', label: 'Introduction' }],
          },
          ...(content.extraPages ?? []).map((path) => ({
            path,
            title: path,
            section: 'Guide',
            contentHtml: '<p>Additional source explanation.</p>',
            sources,
            outline: [],
          })),
        ],
        assets: [],
        excludedPaths: content.excludedPaths ?? [],
        includedSources: [
          {
            path: 'source.ts',
            sha256: createHash('sha256').update(sourceText).digest('hex'),
          },
        ],
      }),
    )
  }
  const publish = async (stage: string): Promise<void> => {
    await publisher.publishWiki({
      projectRoot,
      outputDirectory,
      stageDirectory: stage,
    })
  }
  const learnerFile = join(outputDirectory, 'notes', 'mine.md')
  try {
    await writeFile(join(projectRoot, 'source.ts'), sourceText)
    const firstStage = await prepare()
    await writeCandidate(firstStage, { heading: 'First' })
    await publish(firstStage)
    await mkdir(join(outputDirectory, 'notes'))
    await writeFile(learnerFile, 'my own notes\n')
  } catch (error) {
    // A fixture that failed hands no cleanup to its caller, so it removes its own temporary project.
    await cleanup()
    throw error
  }
  return {
    projectRoot,
    outputDirectory,
    learnerFile,
    prepare,
    writeCandidate,
    publish,
    async hashOutput(): Promise<string> {
      const digest = createHash('sha256')
      for (const path of await listFiles(outputDirectory))
        digest
          .update(`${path}\0`)
          .update(await readFile(join(outputDirectory, path)))
      return digest.digest('hex')
    },
    cleanup,
  }
}
