/**
 * Reads one number of a version, where a missing number counts as 0; called by {@link isLaterNumberList} for each position of both versions.
 * @param numbers - The numbers of a version, from the left.
 * @param position - The position to read, counted from 0.
 * @returns The number at that position, or 0 when the version has fewer numbers.
 * @example
 * versionNumberAt([0, 2, 28], 3) // => 0
 */
function versionNumberAt(numbers: number[], position: number): number {
  return numbers[position] ?? 0
}

/**
 * Compares two versions number by number from the left; called by {@link isNewerExtensionVersion} once both texts are known to be dotted numbers.
 * @param candidateNumbers - The numbers of the version to judge.
 * @param referenceNumbers - The numbers of the version it is compared with.
 * @returns
 * - `true` when the first number that differs is greater in the candidate
 * - `false` when it is smaller there, or when no number differs
 * @example
 * isLaterNumberList([0, 2, 29], [0, 2, 28])    // => true
 * isLaterNumberList([0, 2, 28], [0, 2, 28, 0]) // => false
 */
function isLaterNumberList(
  candidateNumbers: number[],
  referenceNumbers: number[],
): boolean {
  const numberCount = Math.max(candidateNumbers.length, referenceNumbers.length)
  // The first number that differs decides; equal versions fall through.
  for (let position = 0; position < numberCount; position += 1) {
    const candidateNumber = versionNumberAt(candidateNumbers, position),
      referenceNumber = versionNumberAt(referenceNumbers, position)
    if (candidateNumber !== referenceNumber)
      return candidateNumber > referenceNumber
  }
  return false
}

/**
 * Says whether one Codebook extension version is newer than another, so that {@link verifyManagedCursorSkill} can leave the shared Cursor skill a newer window deployed instead of writing an older one over it.
 *
 * Versions are compared number by number from the left (`0.2.28`, also with a fourth number); a missing number counts as 0.
 *
 * @param candidate - The version to judge, for example the `extensionVersion` a skill receipt records.
 * @param reference - The version it is compared with, for example {@link EXTENSION_VERSION} of the running window.
 * @returns
 * - `true` when `candidate` is a later version than `reference`
 * - `false` when it is the same or an earlier one, or when either text is not dotted numbers (an unreadable version never blocks an update)
 * @example
 * isNewerExtensionVersion('0.2.29', '0.2.28')   // => true
 * isNewerExtensionVersion('0.2.28', '0.2.28.0') // => false
 * isNewerExtensionVersion('0.2.9', '0.2.28')    // => false
 * isNewerExtensionVersion('next', '0.2.28')     // => false
 */
export function isNewerExtensionVersion(
  candidate: string,
  reference: string,
): boolean {
  const isDottedNumbers = (version: string): boolean =>
    /^\d+(\.\d+)*$/.test(version)
  if (!isDottedNumbers(candidate) || !isDottedNumbers(reference)) return false
  return isLaterNumberList(
    candidate.split('.').map(Number),
    reference.split('.').map(Number),
  )
}
