import { StudyError } from '../errors'

/** A path an agent sent without its `value:` or `type:` prefix, and the captured key it was saved under. */
interface RewrittenFactPath {
  from: string
  to: string
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
    if (!key) return path
    rewritten.push({ from: path, to: key })
    return key
  })
  return { paths, rewritten }
}
