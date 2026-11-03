/** A short piece of a runtime file kept at its real 0-based line and column. */
export type RuntimeTextFragment = { line: number; column: number; text: string }

/**
 * Builds a runtime text from fragments kept at their real line and column: each fragment sits at its place, the rest is blank.
 *
 * Why it exists: the tests vendor only short fragments of Next's Pages renderer, and a frame's recorded location must find in the built text what it found in the real file. Called by {@link pagesRuntimeTextOf} for a vendored excerpt.
 * @param fragments - The fragments in any order; two of one line must not overlap.
 * @returns The text: lines up to the last fragment's line, joined with `\n`, blank where no fragment is.
 * @example
 * runtimeTextOfFragments([{ line: 1, column: 6, text: 'b' }, { line: 1, column: 2, text: 'a' }]) // => '\n  a   b'
 */
export function runtimeTextOfFragments(
  fragments: readonly RuntimeTextFragment[],
): string {
  const lines: string[] = []
  // Placed in line and column order, so the fragments before one on its line are the ones left of it.
  const fragmentsInPlaceOrder = fragments.toSorted(
    (first, second) => first.line - second.line || first.column - second.column,
  )
  for (const fragment of fragmentsInPlaceOrder) {
    const before = lines[fragment.line] ?? ''
    // A fragment starts after the earlier ones of its line, at its real column.
    lines[fragment.line] = before.padEnd(fragment.column) + fragment.text
  }
  return Array.from(lines, (line) => line ?? '').join('\n')
}
