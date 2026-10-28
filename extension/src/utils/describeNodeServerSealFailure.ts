/** The words every seal failure sentence starts with; a cause that already starts with it is shown as it is. */
export const NODE_SERVER_SEAL_FAILURE_PREFIX =
  'Learning replay could not be saved'

/**
 * Words why a server history was abandoned because its seal took too long.
 * Called by {@link NodeServerHistoryRecorder} when the seal passes its bound; the status item and Save show it.
 * @param seconds - The bound that passed, in seconds.
 * @returns The sentence `Learning replay could not be saved: timed out after <s> s.`
 * @example describeNodeServerSealTimeout(10) // => 'Learning replay could not be saved: timed out after 10 s.'
 */
export function describeNodeServerSealTimeout(seconds: number): string {
  return `${NODE_SERVER_SEAL_FAILURE_PREFIX}: timed out after ${seconds} s.`
}

/**
 * Words why a server history could not be sealed, for the status item and Save.
 * Called by {@link NodeServerHistoryRecorder} when the seal failed.
 * @param cause - The failure, already without private paths.
 * @returns `Learning replay could not be saved: <cause>.`
 * @example describeNodeServerSealFailure('EROFS: read-only') // => 'Learning replay could not be saved: EROFS: read-only.'
 */
export function describeNodeServerSealFailure(cause: string): string {
  return `${NODE_SERVER_SEAL_FAILURE_PREFIX}: ${cause.replace(/\.$/, '')}.`
}
