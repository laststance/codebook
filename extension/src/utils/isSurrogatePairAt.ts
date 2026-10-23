import {
  HIGH_SURROGATE_FIRST_UNIT,
  HIGH_SURROGATE_LAST_UNIT,
  LOW_SURROGATE_FIRST_UNIT,
  LOW_SURROGATE_LAST_UNIT,
} from '../constants'

/**
 * Tells whether a surrogate pair starts at an offset of a text: a high surrogate there and a low one after it, which together are one code point, so a count or a cut never splits one character in two; called by {@link countCodePoints}, the pair table of {@link stripTerminalControls} and the split-pair check of {@link indexNodeTestOutput} (F328).
 * @param text - The text.
 * @param offset - The UTF-16 offset of the pair's first unit; an offset outside the text reads no pair.
 * @returns Whether `text[offset]` is a high surrogate and `text[offset + 1]` a low one.
 * @example
 * isSurrogatePairAt('a\u{1F600}', 1) // => true
 * isSurrogatePairAt('a\u{1F600}', 2) // => false
 */
export function isSurrogatePairAt(text: string, offset: number): boolean {
  const high = text.charCodeAt(offset)
  const low = text.charCodeAt(offset + 1)
  return (
    high >= HIGH_SURROGATE_FIRST_UNIT &&
    high <= HIGH_SURROGATE_LAST_UNIT &&
    low >= LOW_SURROGATE_FIRST_UNIT &&
    low <= LOW_SURROGATE_LAST_UNIT
  )
}
