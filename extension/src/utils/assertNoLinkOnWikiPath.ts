import { findLinkOnWikiPath } from './findLinkOnWikiPath'

/**
 * Refuses to read a Wiki whose folder, or a folder on its path in the project, is a link or a file, which the publisher refuses to write through too; called by the extension's "Open DeepWiki in Browser" before it reads the manifest to check the Wiki's owner, and by {@link readDeepWikiManifest} before every read of the reader.
 *
 * Why: a cloned repository can carry `.codebook/wiki`, `.codebook` or another folder on the Wiki folder's path as a link to a folder outside the project. Read by its path, the Wiki behind it would be opened and served, although no publish of this project can have written it there.
 * The sentence ends without a full stop, like the other sentences of a Wiki that cannot be opened ({@link readWikiFileToOpen}): the open command adds its own next step after it.
 *
 * @param outputDirectory - Resolved Wiki output.
 * @param projectRoot - Canonical opened repository.
 * @throws A sentence that names the Wiki folder and the two ways on when {@link findLinkOnWikiPath} finds the Wiki folder itself to be such an entry, and one that also names the entry above it otherwise; what the file system throws for a path that cannot be looked at.
 * @example
 * await assertNoLinkOnWikiPath('/repo/.codebook/wiki', '/repo')
 * // rejects while `.codebook` is a link: The Wiki folder /repo/.codebook/wiki lies behind a link or a file in the project (/repo/.codebook), and Codebook reads no Wiki through it: …
 */
export async function assertNoLinkOnWikiPath(
  outputDirectory: string,
  projectRoot: string,
): Promise<void> {
  // The walk includes the Wiki folder itself: a link there would have the Wiki read and served from outside the project as much as one above it.
  const linkedEntry = await findLinkOnWikiPath(outputDirectory, projectRoot)
  if (linkedEntry === undefined) return
  throw new Error(
    linkedEntry === outputDirectory
      ? `The Wiki folder ${outputDirectory} is itself a link or a file, or leads out of the project, and Codebook reads no Wiki through it: replace it with a real folder (if it is a link to your Wiki's folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project`
      : `The Wiki folder ${outputDirectory} lies behind a link or a file in the project (${linkedEntry}), and Codebook reads no Wiki through it: replace it with a real folder, or set codebook.wikiOutputDirectory to a folder outside the project`,
  )
}
