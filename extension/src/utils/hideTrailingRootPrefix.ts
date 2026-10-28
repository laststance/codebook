import { REPLAY_DEBUG_TRUNCATION_MARKER } from '../constants'

import { privateRootSpellings } from './sanitizeCause'
import type { CauseRoots } from './sanitizeCause'

/** Compares paths the way Windows roots match: without case and with any run of separators as one. */
function normalizeForPrefix(text: string): string {
  return text.toLowerCase().replace(/[\\/]+/g, '/')
}

/**
 * Finds the earliest raw index whose tail, once separator runs collapse to one character, is at most `limit` characters; the scan window must be measured after normalizing, since an escaped Windows path doubles its separators.
 * @param body - The captured text without its marker.
 * @param limit - The longest normalized root spelling.
 * @returns The raw index to start scanning from.
 * @example
 * normalizedWindowStart('a\\\\b', 3) // => 0
 */
function normalizedWindowStart(body: string, limit: number): number {
  let count = 0
  for (let index = body.length - 1; index >= 0; index--) {
    const isSeparator = /[\\/]/.test(body[index] ?? '')
    // A separator run counts once: only its last character adds to the length.
    const continuesRun = isSeparator && /[\\/]/.test(body[index + 1] ?? '')
    if (!continuesRun) count++
    if (count > limit) return index + 1
  }
  return 0
}

/**
 * Hides a private root's start that a cut left at the end of a text: the debugger capture cuts a long value at a fixed length and appends {@link REPLAY_DEBUG_TRUNCATION_MARKER}, which can fall inside a root (`… /Users/ad… [truncated]`), a fragment {@link createRootHider} cannot match.
 * Fails closed like the output stage's timed release: a tail that shows part of a private name (past the folder every user shares) reads as the placeholder of the most general root it begins; a tail that stays within the shared folders is kept. Called by {@link NodeServerHistorySinkImpl} for each debugger text before roots are hidden.
 * @param text - A captured text; only one ending with the marker is touched.
 * @param roots - The private roots of this window.
 * @returns The text with such a tail replaced by `~`, `<workspace>` or `<storage>`; the text itself otherwise.
 * @example
 * hideTrailingRootPrefix('x /Users/ad… [truncated]', { storage: [], home: '/Users/ada' }) // => 'x ~… [truncated]'
 * hideTrailingRootPrefix('x /Users/ad', { storage: [], home: '/Users/ada' }) // => 'x /Users/ad'
 */
export function hideTrailingRootPrefix(
  text: string,
  roots: CauseRoots,
): string {
  // Only a text the capture cut can end inside a root.
  if (!text.endsWith(REPLAY_DEBUG_TRUNCATION_MARKER)) return text
  const body = text.slice(0, -REPLAY_DEBUG_TRUNCATION_MARKER.length)
  const kinds: [string, readonly string[]][] = [
    ['<storage>', roots.storage],
    ['<workspace>', [roots.workspace ?? []].flat()],
    ['~', [roots.home ?? []].flat()],
  ]
  const candidates = kinds.flatMap(([placeholder, kindRoots]) =>
    privateRootSpellings({ storage: kindRoots }).map((spelling) => ({
      normalized: normalizeForPrefix(spelling),
      placeholder,
    })),
  )
  const longest = Math.max(
    0,
    ...candidates.map(({ normalized }) => normalized.length),
  )
  // The earliest start first: the longest tail that is still a beginning of a root.
  for (
    let start = normalizedWindowStart(body, longest);
    start < body.length;
    start++
  ) {
    // A root begins where a path segment does, never inside a name.
    if (start > 0 && /[A-Za-z0-9._-]/.test(body[start - 1] ?? '')) continue
    const tail = normalizeForPrefix(body.slice(start))
    const revealing = candidates
      .filter(
        ({ normalized }) =>
          normalized.startsWith(tail) &&
          tail.length > normalized.lastIndexOf('/') + 1,
      )
      // The shortest root is the most general one: `~` before a workspace inside it.
      .sort(
        (left, right) => left.normalized.length - right.normalized.length,
      )[0]
    if (revealing)
      return `${body.slice(0, start)}${revealing.placeholder}${REPLAY_DEBUG_TRUNCATION_MARKER}`
  }
  return text
}
