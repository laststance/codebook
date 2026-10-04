import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
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

/** What a candidate's receipt says it was prepared for: the output folder and the hash of the manifest it started from, each whatever its type. */
type ReceiptBinding = { output: unknown; baselineSha256: unknown }

/**
 * Reads the hash of the manifest a candidate was prepared from; called by {@link bindingOfReceipt} with the receipt's `baseline`.
 * @param baseline - The value of the receipt's `baseline` key, or `undefined` when the receipt has none.
 * @returns The value of `manifestSha256` whatever its type, or `undefined` when the baseline is no object or has no such key.
 * @example
 * baselineManifestHash({ manifestSha256: 'a1b2…' }) // => 'a1b2…'
 * baselineManifestHash('a1b2…')                     // => undefined
 */
function baselineManifestHash(baseline: unknown): unknown {
  return typeof baseline === 'object' &&
    baseline !== null &&
    'manifestSha256' in baseline
    ? baseline.manifestSha256
    : undefined
}

/**
 * Picks the two values that bind a candidate out of its parsed receipt; called by {@link readReceiptBinding} for a receipt that is a JSON object.
 * @param receipt - The parsed receipt.
 * @returns The receipt's `output` and its `baseline.manifestSha256`, each `undefined` when the receipt does not name it.
 * @example
 * bindingOfReceipt({ output: '/repo/.codebook/wiki', baseline: { manifestSha256: 'a1b2…' } })
 * // => { output: '/repo/.codebook/wiki', baselineSha256: 'a1b2…' }
 */
function bindingOfReceipt(receipt: object): ReceiptBinding {
  const baseline = 'baseline' in receipt ? receipt.baseline : undefined
  return {
    output: 'output' in receipt ? receipt.output : undefined,
    baselineSha256: baselineManifestHash(baseline),
  }
}

/**
 * Reads the output and baseline a candidate's receipt is bound to; called by {@link isReceiptBoundTo} with the bytes of the receipt file.
 * @param receiptBytes - The bytes of the candidate's receipt.
 * @returns The binding of {@link bindingOfReceipt}; `undefined` when the bytes are no JSON or the receipt is no JSON object.
 * @example
 * readReceiptBinding(Buffer.from('{"output":"/repo/.codebook/wiki","baseline":{"manifestSha256":"a1b2…"}}'))
 * // => { output: '/repo/.codebook/wiki', baselineSha256: 'a1b2…' }
 * readReceiptBinding(Buffer.from('not json')) // => undefined
 */
function readReceiptBinding(receiptBytes: Buffer): ReceiptBinding | undefined {
  try {
    const receipt: unknown = JSON.parse(receiptBytes.toString('utf8'))
    if (typeof receipt !== 'object' || receipt === null) return undefined
    return bindingOfReceipt(receipt)
  } catch {
    return undefined
  }
}

/**
 * Says whether a sibling of the Wiki folder may be a candidate at all; called by {@link listBoundCandidates} before any receipt is read.
 * @param sibling - One entry of the Wiki folder's parent.
 * @param outputName - The Wiki folder's own name.
 * @returns `false` for what is no folder, for the Wiki folder itself and for a backup the publisher kept (reading each one's receipt would grow with every update); `true` otherwise.
 * @example
 * isCandidateFolder(stageFolderEntry, 'wiki') // => true for a folder named 'wiki.stage-3f6c'
 */
function isCandidateFolder(sibling: Dirent, outputName: string): boolean {
  return (
    sibling.isDirectory() &&
    sibling.name !== outputName &&
    // A backup the publisher kept is never accepted as a stage; reading each one's receipt would grow with every update.
    !sibling.name.startsWith(outputName + WIKI_PUBLISH_BACKUP_INFIX)
  )
}

/**
 * Says whether a candidate's receipt binds it to this Wiki as it is published now; called by {@link readBoundCandidate}.
 * @param receiptBytes - The bytes of the candidate's receipt.
 * @param boundOutput - The Wiki folder in the form the publisher records it: its parent resolved, then its name.
 * @param publishedSha256 - The hash of the manifest that is published now.
 * @returns Whether the receipt names this output and this manifest as its baseline; a candidate prepared from an older generation is refused by the publisher.
 * @example
 * isReceiptBoundTo(receiptBytes, '/repo/.codebook/wiki', publishedSha256) // => true
 */
function isReceiptBoundTo(
  receiptBytes: Buffer,
  boundOutput: string,
  publishedSha256: string,
): boolean {
  const binding = readReceiptBinding(receiptBytes)
  return (
    binding?.output === boundOutput &&
    binding.baselineSha256 === publishedSha256
  )
}

/**
 * Describes a candidate that is bound to this Wiki: when it was last written and what its manifest owns so far; called by {@link readBoundCandidate}.
 * @param candidateDirectory - The candidate's folder.
 * @param name - The candidate's folder name.
 * @param receiptModifiedAtMs - When its receipt was last written (epoch milliseconds).
 * @returns The candidate; a manifest that is not there yet gives the receipt's time and no owned paths.
 * @example
 * await describeCandidate('/repo/.codebook/wiki.stage-3f6c', 'wiki.stage-3f6c', 1790000000000)
 * // => { name: 'wiki.stage-3f6c', writtenAtMs: 1790000000000, ownedPaths: ['index.html'] }
 */
async function describeCandidate(
  candidateDirectory: string,
  name: string,
  receiptModifiedAtMs: number,
): Promise<WikiCandidate> {
  const manifestPath = join(candidateDirectory, WIKI_MANIFEST_FILE)
  const manifestStat = await lstat(manifestPath).catch(() => undefined)
  return {
    name,
    writtenAtMs: Math.max(receiptModifiedAtMs, manifestStat?.mtimeMs ?? 0),
    ownedPaths: [...((await readWikiOwnedPaths(manifestPath)) ?? [])],
  }
}

/**
 * Reads one sibling folder as a candidate of this Wiki; called by {@link listBoundCandidates} for each folder that may be one.
 * @param candidateDirectory - The sibling folder.
 * @param name - Its folder name.
 * @param boundOutput - The Wiki folder in the form the publisher records it.
 * @param publishedSha256 - The hash of the manifest that is published now.
 * @returns
 * - The candidate, when its receipt binds it to this output and this manifest
 * - `undefined` for a folder without a regular receipt file (never prepared by the publisher, or vanished meanwhile) and for one bound to another output or an older generation
 * @example
 * await readBoundCandidate('/repo/.codebook/notes', 'notes', '/repo/.codebook/wiki', publishedSha256) // => undefined
 */
async function readBoundCandidate(
  candidateDirectory: string,
  name: string,
  boundOutput: string,
  publishedSha256: string,
): Promise<WikiCandidate | undefined> {
  const receipt = await readWikiRegularFile(
    join(candidateDirectory, WIKI_PUBLICATION_RECEIPT_FILE),
  )
  // A folder without a regular receipt file was never prepared by the publisher, or vanished meanwhile.
  if (!receipt) return undefined
  // A candidate prepared from an older generation is refused by the publisher, so it is nobody's update any more.
  if (!isReceiptBoundTo(receipt.bytes, boundOutput, publishedSha256))
    return undefined
  return describeCandidate(candidateDirectory, name, receipt.modifiedAtMs)
}

/**
 * Looks through the siblings of the Wiki folder for candidates prepared from the published manifest, one folder after the other; called by {@link listWikiCandidates} once that manifest was read.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param publishedSha256 - The hash of the manifest that is published now.
 * @returns The candidates in folder-name order.
 * @throws The file system's error when the parent folder cannot be resolved or listed.
 * @example
 * await listBoundCandidates('/repo/.codebook/wiki', publishedSha256) // => [{ name: 'wiki.stage-3f6c', writtenAtMs: 1790000000000, ownedPaths: ['index.html'] }]
 */
async function listBoundCandidates(
  outputDirectory: string,
  publishedSha256: string,
): Promise<WikiCandidate[]> {
  // The publisher records the output with its parent folder resolved, so the comparison uses the same form.
  const parent = await realpath(dirname(outputDirectory))
  const outputName = basename(outputDirectory)
  const boundOutput = join(parent, outputName)
  const candidates: WikiCandidate[] = []
  for (const sibling of await readdir(parent, { withFileTypes: true })) {
    if (!isCandidateFolder(sibling, outputName)) continue
    const candidate = await readBoundCandidate(
      join(parent, sibling.name),
      sibling.name,
      boundOutput,
      publishedSha256,
    )
    if (candidate) candidates.push(candidate)
  }
  return candidates.sort((left, right) => left.name.localeCompare(right.name))
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
    return await listBoundCandidates(outputDirectory, publishedSha256)
  } catch (error) {
    // A Wiki folder that is missing or being swapped right now has no candidates this look.
    if (systemErrorCode(error) === 'ENOENT') return []
    throw error
  }
}
