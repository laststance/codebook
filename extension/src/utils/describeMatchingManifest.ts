/**
 * Words the condition under which a published manifest matches the source, for a folder with and without a Git repository; called by {@link buildWikiUpdatePrompt} and {@link buildWikiGeneratePrompt} for the sentence that names what Codebook accepts.
 * @param hasGitRepository - Whether the opened folder is inside a Git repository; without one no revision and no added-file condition can hold.
 * @returns
 * - With a repository: the hashes, the revision and the added files
 * - Without one: the hashes only, and the request to record no revision
 * @example
 * describeMatchingManifest(false) // => 'every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one.'
 */
export function describeMatchingManifest(hasGitRepository: boolean): string {
  return hasGitRepository
    ? 'every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths.'
    : 'every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one.'
}
