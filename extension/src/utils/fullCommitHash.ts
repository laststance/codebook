/**
 * Keeps a generated revision only when it is a full commit hash; called by {@link findAddedSources} before the revision is given to Git, and by {@link describeWikiGeneration} before it shortens the revision for the Wiki row.
 * @param generatedRevision - The revision the manifest records, if any.
 * @returns The revision when it is 40 to 64 hexadecimal digits, `undefined` otherwise (none, empty, a short hash, a branch name).
 * @example
 * fullCommitHash('0f9e8d7c6b5a49382716051a2b3c4d5e6f708192') // => '0f9e8d7c6b5a49382716051a2b3c4d5e6f708192'
 * fullCommitHash('main')                                     // => undefined
 */
export function fullCommitHash(
  generatedRevision: string | undefined,
): string | undefined {
  return generatedRevision && /^[a-f0-9]{40,64}$/i.test(generatedRevision)
    ? generatedRevision
    : undefined
}
