import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const MANIFEST_FILE = 'codebook-wiki.json'
const RECEIPT_FILE = 'codebook-publication.json'

/** Lists regular files below a directory as `/`-separated relative paths; links and special files are skipped like the publisher does. */
async function listRegularFiles(
  directory: string,
  prefix = '',
): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory())
      files.push(...(await listRegularFiles(directory, path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/** Reads the paths a manifest owns (index, pages, assets); undefined when it is missing or not a manifest. */
async function readOwnedPaths(
  manifestPath: string,
): Promise<Set<string> | undefined> {
  try {
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) return undefined
    const pages =
      'pages' in manifest && Array.isArray(manifest.pages) ? manifest.pages : []
    const assets =
      'assets' in manifest && Array.isArray(manifest.assets)
        ? manifest.assets
        : []
    const paths = new Set<string>(['index.html'])
    for (const page of pages)
      if (
        typeof page === 'object' &&
        page !== null &&
        'path' in page &&
        typeof page.path === 'string'
      )
        paths.add(page.path)
    for (const asset of assets) if (typeof asset === 'string') paths.add(asset)
    return paths
  } catch {
    return undefined
  }
}

/**
 * Names the learner-owned files in a published Wiki folder that a prepared update candidate would overwrite.
 *
 * Why: the publisher refuses such a candidate and keeps everything, but only the agent sees that refusal; the extension must tell the learner why no update appeared.
 * Trigger: the extension asks while it watches a VS Code update and after a failed Cursor update.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param notBeforeMs - Only candidate folders touched at or after this time count, so an abandoned old candidate is not blamed.
 * @returns Output-relative paths of manual files that collide with a candidate's pages or assets; empty when none.
 *
 * @example
 * ```ts
 * await detectWikiPublishConflicts('/repo/.codebook/wiki', Date.parse('2026-10-03T12:00:00Z')) // => ['pages/overview.html']
 * ```
 */
export async function detectWikiPublishConflicts(
  outputDirectory: string,
  notBeforeMs: number,
): Promise<string[]> {
  const published = await readOwnedPaths(join(outputDirectory, MANIFEST_FILE))
  if (!published) return []
  // Candidate folders are siblings named `<output>.stage-<id>`; the publisher refuses any other stage layout.
  const parent = dirname(outputDirectory)
  const stagePrefix = `${basename(outputDirectory)}.stage-`
  const candidates: Set<string>[] = []
  for (const name of await readdir(parent)) {
    if (!name.startsWith(stagePrefix)) continue
    const stageDirectory = join(parent, name)
    if ((await stat(stageDirectory)).mtimeMs < notBeforeMs) continue
    const owned = await readOwnedPaths(join(stageDirectory, MANIFEST_FILE))
    if (owned) candidates.push(owned)
  }
  if (!candidates.length) return []
  const manual = (await listRegularFiles(outputDirectory)).filter(
    (path) =>
      path !== MANIFEST_FILE && path !== RECEIPT_FILE && !published.has(path),
  )
  const colliding = new Set<string>()
  for (const path of manual)
    for (const owned of candidates)
      for (const ownedPath of owned)
        if (
          ownedPath === path ||
          ownedPath.startsWith(`${path}/`) ||
          path.startsWith(`${ownedPath}/`)
        )
          colliding.add(path)
  return [...colliding].sort()
}
