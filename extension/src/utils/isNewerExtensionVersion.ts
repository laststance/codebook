/**
 * Says whether one Codebook extension version is newer than another, so that {@link verifyManagedCursorSkill} can leave the shared Cursor skill a newer window deployed instead of writing an older one over it.
 *
 * Versions are compared number by number from the left (`0.2.28`, also with a fourth number); a missing number counts as 0.
 *
 * @param candidate - The version to judge, for example the `extensionVersion` a skill receipt records.
 * @param reference - The version it is compared with, for example `EXTENSION_VERSION` of the running window.
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
  const candidateNumbers = candidate.split('.').map(Number),
    referenceNumbers = reference.split('.').map(Number)
  const numberCount = Math.max(candidateNumbers.length, referenceNumbers.length)
  // The first number that differs decides; equal versions fall through.
  for (let position = 0; position < numberCount; position += 1) {
    const candidateNumber = candidateNumbers[position] ?? 0,
      referenceNumber = referenceNumbers[position] ?? 0
    if (candidateNumber !== referenceNumber)
      return candidateNumber > referenceNumber
  }
  return false
}
