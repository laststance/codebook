import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE, WIKI_PUBLICATION_RECEIPT_FILE } from '../constants'

import {
  readWikiRegularFile,
  type WikiRegularFile,
} from './readWikiRegularFile'

/**
 * Says whether a parsed publication receipt vouches for a manifest; called by {@link publicationIdentityOf}.
 * @param receipt - The parsed receipt, whatever JSON it is.
 * @param manifestSha256 - The hash of the manifest now on disk.
 * @returns Whether the receipt is an object whose `manifestSha256` is that hash.
 * @example
 * isReceiptOfManifest({ manifestSha256: 'dc9d3160…' }, 'dc9d3160…') // => true
 * isReceiptOfManifest(null, 'dc9d3160…')                          // => false
 */
function isReceiptOfManifest(
  receipt: unknown,
  manifestSha256: string,
): boolean {
  return (
    typeof receipt === 'object' &&
    receipt !== null &&
    'manifestSha256' in receipt &&
    receipt.manifestSha256 === manifestSha256
  )
}

/**
 * Builds the publication identity from a receipt file and a manifest file that are both there; called by {@link readWikiPublicationIdentity}.
 * @param receiptFile - The publisher's receipt file.
 * @param manifestFile - The manifest file.
 * @returns
 * - The receipt names the manifest's hash: `<that hash>@<inode of the receipt file>`
 * - A receipt that is no JSON, or that does not name this manifest (edited, or mid-replacement): `undefined`
 * @example
 * publicationIdentityOf(receiptFile, manifestFile) // => 'dc9d3160…@1837466'
 */
function publicationIdentityOf(
  receiptFile: WikiRegularFile,
  manifestFile: WikiRegularFile,
): string | undefined {
  try {
    const receipt: unknown = JSON.parse(receiptFile.bytes.toString('utf8'))
    const manifestSha256 = createHash('sha256')
      .update(manifestFile.bytes)
      .digest('hex')
    return isReceiptOfManifest(receipt, manifestSha256)
      ? `${manifestSha256}@${receiptFile.inode}`
      : undefined
  } catch {
    return undefined
  }
}

/** The last identity read for each Wiki folder, with the stamps of the receipt and the manifest it was read from. */
const identityByFolder = new Map<
  string,
  { stamps: string; identity: string | undefined }
>()

/**
 * Stamps a file by its inode, modification time and size; called by {@link readStampsOnDisk} and {@link readWikiPublicationIdentity}, so the identity is read and hashed again only after a file changed.
 * @param file - The inode, the modification time and the size of one file.
 * @returns The three values in one text.
 * @example
 * fileStamp({ inode: 1837466, modifiedAtMs: 1790000000000.5, size: 412 }) // => '1837466:1790000000000.5:412'
 */
function fileStamp(file: {
  inode: number
  modifiedAtMs: number
  size: number
}): string {
  return `${file.inode}:${file.modifiedAtMs}:${file.size}`
}

/**
 * Stamps the receipt and the manifest as they are on disk now, without reading them; called by {@link readWikiPublicationIdentity} before it decides whether the last identity still holds.
 * @param paths - The receipt's and the manifest's paths, in that order.
 * @returns
 * - Both are regular files: their two stamps ({@link fileStamp}) in one text
 * - Either is missing, a link or no regular file: undefined, so the files are read and the reader decides
 * @example
 * await readStampsOnDisk(['/repo/.codebook/wiki/codebook-publication.json', '/repo/.codebook/wiki/codebook-wiki.json']) // => '1837466:1790000000000.5:96|1837462:1790000000000.25:412'
 */
async function readStampsOnDisk(paths: string[]): Promise<string | undefined> {
  const stamps: string[] = []
  for (const path of paths) {
    // A link is not followed, as the read itself does not follow it.
    const fileStat = await lstat(path).catch(() => undefined)
    if (!fileStat?.isFile()) return undefined
    stamps.push(
      fileStamp({
        inode: fileStat.ino,
        modifiedAtMs: fileStat.mtimeMs,
        size: fileStat.size,
      }),
    )
  }
  return stamps.join('|')
}

/**
 * Reads the receipt and the manifest and builds the identity from them; called by {@link readWikiPublicationIdentity} when it has no identity for the files as they are on disk now.
 * @param receiptPath - The publisher's receipt.
 * @param manifestPath - The manifest.
 * @returns
 * - Both are regular files within the limit: the identity ({@link publicationIdentityOf}) with the stamps of the bytes just read, so a change during the read is read again next time
 * - Either cannot be read: undefined
 * @example
 * await readIdentityFromFiles('/repo/.codebook/wiki/codebook-publication.json', '/repo/.codebook/wiki/codebook-wiki.json')
 * // => { stamps: '1837466:1790000000000.5:96|1837462:1790000000000.25:412', identity: 'dc9d3160…@1837466' }
 */
async function readIdentityFromFiles(
  receiptPath: string,
  manifestPath: string,
): Promise<{ stamps: string; identity: string | undefined } | undefined> {
  const receiptFile = await readWikiRegularFile(receiptPath)
  const manifestFile = await readWikiRegularFile(manifestPath)
  if (!receiptFile || !manifestFile) return undefined
  return {
    stamps: [receiptFile, manifestFile]
      .map((file) => fileStamp({ ...file, size: file.bytes.length }))
      .join('|'),
    identity: publicationIdentityOf(receiptFile, manifestFile),
  }
}

/**
 * Reads the identity of the publication a Wiki folder holds: which manifest the publisher's receipt vouches for, and which receipt file says so.
 *
 * Why: a changed manifest alone does not prove a publish. A `git checkout`, an editor's save or a copy puts the same or other bytes under a new inode while the old receipt stays; only the publisher writes a new receipt file that names the manifest's hash. A run counts a publish only when this identity differs from the one it started with. The manifest carries every page's text, so the identity of a folder is kept with the receipt's and the manifest's inode, modification time and size, and the files are read and hashed again only when one of them changed.
 * Trigger: the extension reads it when an update starts, on each look of {@link waitForWikiPublish} and when a run ends; the Wiki reader reads it for every `api/update-status` answer and every served page.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - The receipt names the hash of the manifest now on disk: `<that hash>@<inode of the receipt file>`
 * - No receipt, no manifest, either one not a regular file, or a manifest the receipt does not name (edited, or mid-replacement): undefined
 *
 * @example
 * ```ts
 * await readWikiPublicationIdentity('/repo/.codebook/wiki') // => 'dc9d3160…@1837466'
 * // After `git checkout -- .codebook/wiki/codebook-wiki.json` puts the same bytes back: the same value, so no publish is seen.
 * ```
 */
export async function readWikiPublicationIdentity(
  outputDirectory: string,
): Promise<string | undefined> {
  const receiptPath = join(outputDirectory, WIKI_PUBLICATION_RECEIPT_FILE)
  const manifestPath = join(outputDirectory, WIKI_MANIFEST_FILE)
  const stampsOnDisk = await readStampsOnDisk([receiptPath, manifestPath])
  const cached = identityByFolder.get(outputDirectory)
  // Neither file changed since the last read: its identity still holds. Files that cannot be stamped never equal a kept stamp.
  if (cached && cached.stamps === stampsOnDisk) return cached.identity
  const read = await readIdentityFromFiles(receiptPath, manifestPath)
  if (!read) {
    identityByFolder.delete(outputDirectory)
    return undefined
  }
  identityByFolder.set(outputDirectory, read)
  return read.identity
}
