import { StudyError } from '../errors'

/** A path an agent sent without its `value:` or `type:` prefix, and the captured key it was saved under. */
interface RewrittenFactPath {
  from: string
  to: string
}

/**
 * Finds the one captured key a bare path stands for; called by {@link resolveCapturedFactPaths} for each path sent without a prefix.
 * @param path - The path as the agent sent it, without `value:` or `type:`.
 * @param index - The path's place among the sent paths, named in the refusal.
 * @param capturedFacts - The snapshot's captured facts by key.
 * @returns The captured key (`value:<path>` or `type:<path>`), or `undefined` when no captured fact has the path.
 * @throws An `INVALID_REFERENCE` {@link StudyError} naming both keys when a `value:` fact and a `type:` fact were captured for the path: what the agent meant cannot be told.
 * @example
 * capturedKeyOfBarePath('nextTheme', 0, { 'value:nextTheme': 'dark' }) // => 'value:nextTheme'
 * capturedKeyOfBarePath('missing', 1, { 'value:nextTheme': 'dark' })   // => undefined
 */
function capturedKeyOfBarePath(
  path: string,
  index: number,
  capturedFacts: Readonly<Record<string, unknown>>,
): string | undefined {
  const keys = [`value:${path}`, `type:${path}`].filter((key) =>
    Object.hasOwn(capturedFacts, key),
  )
  const [key, otherKey] = keys
  // What the agent meant cannot be told when both kinds of fact were captured for the path.
  if (key && otherKey)
    throw new StudyError(
      'INVALID_REFERENCE',
      `valuePaths[${index}] "${path}" is the path of two captured facts of this snapshot, ${key} and ${otherKey}. Send the one you mean with its prefix; the same key is free.`,
    )
  return key
}

/**
 * Turns the value paths of a `codebook_explain` call into the captured keys of its snapshot, so an agent that leaves out the `value:` or `type:` prefix is taken at its word when only one captured fact has that path; called by {@link StudyService.explain} after it read the snapshot and before it computes the call's idempotency signature.
 * A path that already carries a prefix, and a bare path no captured fact has, are left as they are; the caller then answers an uncaptured path as before.
 * @param valuePaths - The paths as the agent sent them.
 * @param capturedFacts - The snapshot's captured facts by key (`value:<path>` or `type:<path>`).
 * @returns The keys to save under, in the order sent, and every path that was rewritten.
 * @throws An `INVALID_REFERENCE` {@link StudyError} naming both keys when a bare path is the path of a captured `value:` fact and of a captured `type:` fact.
 * @example
 * resolveCapturedFactPaths(['nextTheme'], { 'value:nextTheme': 'dark' })
 * // => { paths: ['value:nextTheme'], rewritten: [{ from: 'nextTheme', to: 'value:nextTheme' }] }
 * resolveCapturedFactPaths(['value:nextTheme', 'missing'], { 'value:nextTheme': 'dark' })
 * // => { paths: ['value:nextTheme', 'missing'], rewritten: [] }
 */
export function resolveCapturedFactPaths(
  valuePaths: readonly string[],
  capturedFacts: Readonly<Record<string, unknown>>,
): { paths: string[]; rewritten: RewrittenFactPath[] } {
  const rewritten: RewrittenFactPath[] = []
  const paths = valuePaths.map((path, index) => {
    // A path with a prefix is a key already.
    if (path.includes(':')) return path
    const key = capturedKeyOfBarePath(path, index, capturedFacts)
    if (!key) return path
    rewritten.push({ from: path, to: key })
    return key
  })
  return { paths, rewritten }
}
