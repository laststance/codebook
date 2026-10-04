import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

import { WIKI_METADATA_FILE_LIMIT_BYTES } from '../constants'

/** A manifest or receipt of a Wiki folder as one read saw it. */
export type WikiRegularFile = {
  bytes: Buffer
  /** Inode of the file the bytes came from; a file written anew has another one. */
  inode: number
  /** When the file was last written (epoch milliseconds). */
  modifiedAtMs: number
}

/**
 * Reads a manifest or a publication receipt of a Wiki or candidate folder only when it is a regular file of bounded size, without following a link and without waiting on a pipe.
 *
 * Why: these files are read before an update's timeout and cancel exist; a link to a named pipe would hold that read forever and a link to an endless device would fill memory. The publisher refuses such entries too.
 * Trigger: {@link readWikiPublishToken}, {@link readWikiPublicationIdentity}, {@link listWikiCandidates}, {@link readWikiOwnedPaths} and {@link findWikiUpdateStartBlock} read every Wiki metadata file through it.
 *
 * @param path - Absolute path of the manifest or receipt.
 * @returns
 * - A regular file of at most {@link WIKI_METADATA_FILE_LIMIT_BYTES}: its bytes, inode and modification time, all from one open file
 * - A missing file, a link, a pipe, a device, a folder, a larger file or one that cannot be read: undefined
 *
 * @example
 * ```ts
 * await readWikiRegularFile('/repo/.codebook/wiki/codebook-wiki.json') // => { bytes, inode: 1837462, modifiedAtMs: 1790000000000 }
 * await readWikiRegularFile('/repo/.codebook/wiki/a-named-pipe')       // => undefined, at once
 * ```
 */
export async function readWikiRegularFile(
  path: string,
): Promise<WikiRegularFile | undefined> {
  let file: FileHandle | undefined
  try {
    // Without O_NONBLOCK the open itself waits for the writer of a named pipe; O_NOFOLLOW refuses a link.
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const fileStat = await file.stat()
    if (!fileStat.isFile() || fileStat.size > WIKI_METADATA_FILE_LIMIT_BYTES)
      return undefined
    return {
      bytes: await file.readFile(),
      inode: fileStat.ino,
      modifiedAtMs: fileStat.mtimeMs,
    }
  } catch {
    return undefined
  } finally {
    await file?.close()
  }
}
