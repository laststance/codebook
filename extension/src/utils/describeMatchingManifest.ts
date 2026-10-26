/**
 * Words the condition under which a published manifest matches the source, for a folder with and without a Git repository, and for one about which Git could not be asked; called by {@link buildWikiUpdatePrompt} and {@link buildWikiGeneratePrompt} for the sentence that names what Codebook accepts.
 * @param hasGitRepository - Whether the opened folder is inside a Git repository; without one no revision and no added-file condition can hold; `undefined` when Git is missing or did not answer, so the agent is asked for a revision only if its own Git gives one (/ship review, Cycle 0055 pt1).
 * @returns
 * - With a repository: the hashes, the revision and the added files
 * - Without one: the hashes only, and the request to record no revision
 * - Unknown: the hashes, and the revision only where Git answers
 * @example
 * describeMatchingManifest(false) // => 'every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one.'
 */
export function describeMatchingManifest(
  hasGitRepository: boolean | undefined,
): string {
  // Git that is missing or did not answer leaves the repository unknown: a revision is asked for only if the agent's Git gives one.
  if (hasGitRepository === undefined)
    return 'every includedSources sha256 equals the file on disk. Codebook could not ask Git about this folder: record generated.revision only if Git gives you the full commit hash of HEAD, and do not create a repository.'
  return hasGitRepository
    ? 'every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths.'
    : 'every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one.'
}
