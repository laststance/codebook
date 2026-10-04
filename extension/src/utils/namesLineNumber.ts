/**
 * Tells whether a text contains a line's number as a number of its own, for the one bounded check {@link StudyService.explain} makes on the first interpretation of a stop the debugger moved to another line.
 * It is a guard on prose, not a proof of the place: "paused on line 22 with the value 23" contains 23 and passes, and a numeral that is spelled out or written in another script than ASCII or full-width digits is not read. What a learner reads as the place is Codebook's own structured {@link BoundPlace}, whatever the text says.
 * @param text - The agent's interpretation.
 * @param line - The line the stop paused on.
 * @returns
 * - `true` when the text, after NFKC normalisation (full-width digits become ASCII digits), holds the number with no digit directly before or after it
 * - `false` otherwise, also when the digits occur only inside a longer number
 * @example
 * namesLineNumber('The action pauses on line 23.', 23) // => true
 * namesLineNumber('２３行目で停止しました。', 23) // => true
 * namesLineNumber('The value is 123 after 230 ms.', 23) // => false
 * namesLineNumber('二十三行目で停止しました。', 23) // => false
 */
export function namesLineNumber(text: string, line: number): boolean {
  return new RegExp(`(?<![0-9])${line}(?![0-9])`).test(text.normalize('NFKC'))
}
