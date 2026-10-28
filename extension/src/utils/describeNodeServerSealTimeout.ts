/**
 * Words why a server history was abandoned because its seal took too long.
 * Called by {@link NodeServerHistoryRecorder} when the seal passes its bound; the status item and Save show it.
 * @param seconds - The bound that passed, in seconds.
 * @returns The sentence `Learning replay could not be saved: timed out after <s> s.`
 * @example describeNodeServerSealTimeout(10) // => 'Learning replay could not be saved: timed out after 10 s.'
 */
export function describeNodeServerSealTimeout(seconds: number): string {
  return `Learning replay could not be saved: timed out after ${seconds} s.`
}
