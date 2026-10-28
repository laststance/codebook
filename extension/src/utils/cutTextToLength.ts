import { isSurrogatePairAt } from './isSurrogatePairAt'

/**
 * Cuts a text to at most a number of UTF-16 units without saying so, never between the two halves of a surrogate pair, so a stored field stays inside its schema bound (which counts units) and stays valid text; called by {@link NodeServerHistorySinkImpl} for every bounded field of a history entry.
 * @param text - The text to bound.
 * @param limit - The most UTF-16 units the result may hold.
 * @returns `text` itself when it fits, else its longest beginning of at most `limit` units that ends between characters.
 * @example
 * cutTextToLength('x'.repeat(5_000), 2_048).length // => 2_048
 * cutTextToLength('ab\u{1F600}', 3) // => 'ab' (the pair would be split)
 */
export function cutTextToLength(text: string, limit: number): string {
  if (text.length <= limit) return text
  // A pair that straddles the cut is dropped whole.
  return text.slice(0, isSurrogatePairAt(text, limit - 1) ? limit - 1 : limit)
}
