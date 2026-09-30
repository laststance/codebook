import { sha256 } from '../runtimeSupport/utils/sha256'
import { bookAnchorSchema, type BookAnchor } from '../sourceSchemas'

/** Canonicalizes complete citation sets for learner decisions, ignoring order/exact duplicates without merging ranges. @example citationContext([anchor, anchor]).anchors.length // 1 */
export function citationContext(anchors: readonly BookAnchor[]) {
  const unique = new Map<string, BookAnchor>()
  // The tuple fixes serialization independently of caller property order or locale.
  for (const input of anchors) {
    const anchor = bookAnchorSchema.parse(input)
    unique.set(
      JSON.stringify([
        anchor.path,
        anchor.hash,
        anchor.startLine,
        anchor.endLine,
      ]),
      anchor,
    )
  }
  const keys = [...unique.keys()].sort()
  return {
    kind: 'citations' as const,
    hash: sha256(JSON.stringify(keys)),
    anchors: keys.map((key) => unique.get(key)!),
  }
}
