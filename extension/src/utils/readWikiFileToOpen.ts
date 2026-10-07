import { readWikiRegularFile } from './readWikiRegularFile'

/**
 * Reads the manifest or the entry page of a Wiki that is being opened, as a file of the Wiki folder and never through a link, and says in a sentence when it cannot; called by the extension's owner check and entry check before "Open LLM Wiki" starts a reader, and by {@link readDeepWikiManifest} for every request of the reader.
 *
 * Why: these two files lie in the learner's project, where a cloned repository decides what stands at their paths. Read by name, a link to a pipe held the opening for good and a link to an endless device was read until memory ran out; the reader of Wiki metadata files ({@link readWikiRegularFile}) takes a regular file of bounded size only, follows no link and waits on nothing. Its refusal is worded here, because a bare file error tells the learner nothing to do.
 *
 * @param path - Absolute path of the manifest or the entry page.
 * @param part - What the file is, as the sentence names it.
 * @returns The file's bytes.
 * @throws An error whose message names the file and what to do when the path holds nothing, a link, a folder, a pipe or a device, or a file larger than {@link WIKI_METADATA_FILE_LIMIT_BYTES}.
 * @example
 * ```ts
 * await readWikiFileToOpen('/repo/.codebook/wiki/codebook-wiki.json', 'manifest') // => <Buffer 7b 22 73 …>
 * await readWikiFileToOpen('/repo/.codebook/wiki/a-link.html', 'entry page')
 * // rejects: The Wiki’s entry page (/repo/.codebook/wiki/a-link.html) is missing, is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first
 * ```
 */
export async function readWikiFileToOpen(
  path: string,
  part: 'manifest' | 'entry page',
): Promise<Buffer> {
  const file = await readWikiRegularFile(path)
  if (!file)
    throw new Error(
      `The Wiki’s ${part} (${path}) is missing, is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
    )
  return file.bytes
}
