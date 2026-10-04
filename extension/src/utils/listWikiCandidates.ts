import { createHash } from 'node:crypto'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
  WIKI_MANIFEST_FILE,
  WIKI_PUBLICATION_RECEIPT_FILE,
  WIKI_PUBLISH_BACKUP_INFIX,
} from '../constants'

import { readWikiOwnedPaths } from './readWikiOwnedPaths'
import { readWikiRegularFile } from './readWikiRegularFile'
import { systemErrorCode } from './systemErrorCode'

/** A prepared update of a Wiki that the publisher would still accept for it. */
export type WikiCandidate = {
  /** Folder name of the candidate; it is a sibling of the output folder. */
  name: string
  /** When its receipt or its manifest was last written (epoch milliseconds), whichever is later. */
  writtenAtMs: number
  /** Output-relative paths its manifest owns so far. */
  ownedPaths: string[]
}

/** Reads the output and baseline a candidate's receipt is bound to; undefined when the receipt is not a JSON object. */
function readReceiptBinding(
  receiptBytes: Buffer,
): { output: unknown; baselineSha256: unknown } | undefined {
  try {
    const receipt: unknown = JSON.parse(receiptBytes.toString('utf8'))
    if (typeof receipt !== 'object' || receipt === null) return undefined
    const baseline = 'baseline' in receipt ? receipt.baseline : undefined
    return {
      output: 'output' in receipt ? receipt.output : undefined,
      baselineSha256:
        typeof baseline === 'object' &&
        baseline !== null &&
        'manifestSha256' in baseline
          ? baseline.manifestSha256
          : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Lists the candidates the publisher would still accept for a published Wiki, whatever their folders are called.
 *
 * Why: the publisher takes any sibling folder as a stage (`--stage`), and binds it by its receipt: `output` names the Wiki and `baseline.manifestSha256` the generation it was prepared from. A folder name or a folder time says neither.
 * Trigger: the extension calls it before an update starts (is someone else updating?) and on each look of a run (did the agent stage something, does it collide with a learner file?).
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns Candidates bound to this output and prepared from the currently published manifest, in folder-name order; empty when the Wiki or its parent folder cannot be read. A backup the publisher kept (`<output>.previous-<uuid>`) is never one, and a receipt or manifest that is not a regular file ({@link readWikiRegularFile}) is not read.
 *
 * @example
 * ```ts
 * await listWikiCandidates('/repo/.codebook/wiki')
 * // => [{ name: 'wiki.stage-3f6c…', writtenAtMs: 1790000000000, ownedPaths: ['index.html', 'pages/overview.html'] }]
 * ```
 */
export async function listWikiCandidates(
  outputDirectory: string,
): Promise<WikiCandidate[]> {
  try {
    const published = await readWikiRegularFile(
      join(outputDirectory, WIKI_MANIFEST_FILE),
    )
    if (!published) return []
    const publishedSha256 = createHash('sha256')
      .update(published.bytes)
      .digest('hex')
    // The publisher records the output with its parent folder resolved, so the comparison uses the same form.
    const parent = await realpath(dirname(outputDirectory))
    const outputName = basename(outputDirectory)
    const boundOutput = join(parent, outputName)
    const candidates: WikiCandidate[] = []
    for (const sibling of await readdir(parent, { withFileTypes: true })) {
      if (!sibling.isDirectory() || sibling.name === outputName) continue
      // A backup the publisher kept is never accepted as a stage; reading each one's receipt would grow with every update.
      if (sibling.name.startsWith(outputName + WIKI_PUBLISH_BACKUP_INFIX))
        continue
      const receipt = await readWikiRegularFile(
        join(parent, sibling.name, WIKI_PUBLICATION_RECEIPT_FILE),
      )
      // A folder without a regular receipt file was never prepared by the publisher, or vanished meanwhile.
      if (!receipt) continue
      const binding = readReceiptBinding(receipt.bytes)
      // A candidate prepared from an older generation is refused by the publisher, so it is nobody's update any more.
      if (
        binding?.output !== boundOutput ||
        binding.baselineSha256 !== publishedSha256
      )
        continue
      const manifestPath = join(parent, sibling.name, WIKI_MANIFEST_FILE)
      const manifestStat = await lstat(manifestPath).catch(() => undefined)
      candidates.push({
        name: sibling.name,
        writtenAtMs: Math.max(receipt.modifiedAtMs, manifestStat?.mtimeMs ?? 0),
        ownedPaths: [...((await readWikiOwnedPaths(manifestPath)) ?? [])],
      })
    }
    return candidates.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    // A Wiki folder that is missing or being swapped right now has no candidates this look.
    if (systemErrorCode(error) === 'ENOENT') return []
    throw error
  }
}
