import { lstat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import { readWikiRegularFile } from './readWikiRegularFile'
import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether nothing stands at a path, as opposed to an entry that is there and cannot be read as a Wiki file; called by {@link readWikiFileToOpen} after the reader of Wiki files refused the path.
 * @param path - Absolute path of the manifest or the entry page.
 * @returns `true` when the path, or the folder it lies in, does not exist; `false` when an entry stands there, also one that cannot be looked at.
 * @example
 * await isMissing('/repo/.codebook/wiki/codebook-wiki.json') // => true in a project whose Wiki was never generated
 */
async function isMissing(path: string): Promise<boolean> {
  return lstat(path).then(
    () => false,
    (error: unknown) => ['ENOENT', 'ENOTDIR'].includes(systemErrorCode(error)),
  )
}

/**
 * Reads the manifest or the entry page of a Wiki that is being opened, as a file of the Wiki folder and never through a link, and says in a sentence when it cannot; called by the extension's owner check and entry check before "Open LLM Wiki" starts a reader, and by {@link readDeepWikiManifest} for every request of the reader.
 *
 * Why: these two files lie in the learner's project, where a cloned repository decides what stands at their paths. Read by name, a link to a pipe held the opening for good and a link to an endless device was read until memory ran out; the reader of Wiki metadata files ({@link readWikiRegularFile}) takes a regular file of bounded size only, follows no link and waits on nothing. Its refusal is worded here, because a bare file error tells the learner nothing to do: a file that is not there means that no Wiki was generated yet, which is the ordinary first use and names nothing to remove; an entry that is there and is refused names what stands in the way.
 *
 * @param path - Absolute path of the manifest or the entry page.
 * @param part - What the file is, as the sentence names it.
 * @returns The file's bytes.
 * @throws An error whose message says that no Wiki was found at the folder when the file does not exist, and one that names the file and what to remove when the path holds a link, a folder, a pipe or a device, or a file larger than {@link WIKI_METADATA_FILE_LIMIT_BYTES}.
 * @example
 * ```ts
 * await readWikiFileToOpen('/repo/.codebook/wiki/codebook-wiki.json', 'manifest') // => <Buffer 7b 22 73 …>
 * await readWikiFileToOpen('/repo/.codebook/wiki/codebook-wiki.json', 'manifest')
 * // rejects, before any Wiki was generated: No Wiki was found at /repo/.codebook/wiki: its manifest (codebook-wiki.json) does not exist
 * await readWikiFileToOpen('/repo/.codebook/wiki/index.html', 'entry page')
 * // rejects, for a link at that path: The Wiki’s entry page (/repo/.codebook/wiki/index.html) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first
 * ```
 */
export async function readWikiFileToOpen(
  path: string,
  part: 'manifest' | 'entry page',
): Promise<Buffer> {
  const file = await readWikiRegularFile(path)
  if (file) return file.bytes
  // Nothing at the path is the ordinary case of a project whose Wiki was not generated yet: nothing is to be removed.
  if (await isMissing(path))
    throw new Error(
      `No Wiki was found at ${dirname(path)}: its ${part} (${basename(path)}) does not exist`,
    )
  throw new Error(
    `The Wiki’s ${part} (${path}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
  )
}
