import { findLinkOnWikiPath } from './findLinkOnWikiPath'

/**
 * Refuses to read a Wiki whose folder's path in the project passes through a link or a file, which the publisher refuses to write through too; called by the extension's "Open DeepWiki in Browser" before it reads the manifest to check the Wiki's owner, and by {@link readDeepWikiManifest} before every read of the reader.
 *
 * Why: a cloned repository can carry `.codebook`, or another folder on the Wiki folder's path, as a link to a folder outside the project. Read by its path, the Wiki behind it would be opened and served, although no publish of this project can have written it there.
 * The sentence ends without a full stop, like the other sentences of a Wiki that cannot be opened ({@link readWikiFileToOpen}): the open command adds its own next step after it.
 *
 * @param outputDirectory - Resolved Wiki output.
 * @param projectRoot - Canonical opened repository.
 * @throws A sentence that names the Wiki folder, the entry on its path and the two ways on, when {@link findLinkOnWikiPath} finds such an entry; what the file system throws for a path that cannot be looked at.
 * @example
 * await assertNoLinkOnWikiPath('/repo/.codebook/wiki', '/repo')
 * // rejects while `.codebook` is a link: The Wiki folder /repo/.codebook/wiki lies behind a link or a file in the project (/repo/.codebook), and Codebook reads no Wiki through it: …
 */
export async function assertNoLinkOnWikiPath(
  outputDirectory: string,
  projectRoot: string,
): Promise<void> {
  const linkedEntry = await findLinkOnWikiPath(projectRoot, outputDirectory)
  // A link on the path would have the Wiki read and served from outside the project.
  if (linkedEntry !== undefined)
    throw new Error(
      `The Wiki folder ${outputDirectory} lies behind a link or a file in the project (${linkedEntry}), and Codebook reads no Wiki through it: replace it by a real folder, or set codebook.wikiOutputDirectory to a folder outside the project`,
    )
}
