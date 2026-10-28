/**
 * Says whether a start of a root already shows a private name: it reaches past the folder every user shares (the root's last separator), so it must not be released as typed.
 * Why: output released by time and debugger values cut by a marker both fail closed on this one rule. Called by {@link createRootHidingStage} and {@link hideTrailingRootPrefix}.
 * @param normalizedStart - The start, in the form {@link normalizeForPrefix} gives.
 * @param normalizedSpelling - The root's spelling in the same form.
 * @returns True when the start is a beginning of the spelling and shows part of its last name.
 * @example showsPrivateName('/users/a', '/users/ada') // => true
 */
export function showsPrivateName(
  normalizedStart: string,
  normalizedSpelling: string,
): boolean {
  return (
    normalizedSpelling.startsWith(normalizedStart) &&
    normalizedStart.length > normalizedSpelling.lastIndexOf('/') + 1
  )
}
