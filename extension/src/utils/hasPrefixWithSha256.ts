import { createHash } from 'node:crypto'

/**
 * Tells whether some bytes start with exactly the bytes a SHA-256 names, comparing only prefixes that end right after a line break.
 *
 * Why: a rollback journal of an older Codebook build records only the hash of the file it moved aside, so when that hash is not the one of the file a first setup published, the only proof that the file is still the published one with text appended in place is that its bytes start with the published bytes. A file Codebook publishes ends in a line break, so only those ends are candidates; each is hashed from one running hash, so the bytes are hashed once.
 * Trigger: the Devin config module calls it when a run ({@link writeManagedDevinMcpEntry}, {@link refreshManagedDevinMcpEntry}, {@link removeManagedDevinMcpEntry}) settles such a journal, with the config its recovery put back and the publish record's `stagedSha256`.
 *
 * @param bytes - The bytes to look at, such as a whole config file.
 * @param sha256 - The lowercase hex SHA-256 of the prefix being looked for.
 * @returns
 * - `true` when the bytes up to and including one of their line breaks hash to `sha256` (the whole bytes count when they end in a line break)
 * - `false` otherwise, also for bytes without a line break
 * @example
 * ```ts
 * hasPrefixWithSha256(Buffer.from('{}\n\n'), sha256Of('{}\n'))    // => true
 * hasPrefixWithSha256(Buffer.from('{}\n'), sha256Of('{}\n'))      // => true
 * hasPrefixWithSha256(Buffer.from('{"a":1}\n'), sha256Of('{}\n')) // => false
 * ```
 */
export function hasPrefixWithSha256(bytes: Buffer, sha256: string): boolean {
  const runningHash = createHash('sha256')
  let hashedUpTo = 0
  // Each line break ends one candidate: the running hash takes the bytes since the previous one, and a copy of it gives that prefix's digest.
  for (
    let lineBreakAt = bytes.indexOf('\n');
    lineBreakAt !== -1;
    lineBreakAt = bytes.indexOf('\n', lineBreakAt + 1)
  ) {
    runningHash.update(bytes.subarray(hashedUpTo, lineBreakAt + 1))
    hashedUpTo = lineBreakAt + 1
    if (runningHash.copy().digest('hex') === sha256) return true
  }
  return false
}
