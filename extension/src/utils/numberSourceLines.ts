/**
 * Writes a source text with each line after its one-based number and a tab, so an agent takes the line of a citation or a stop from Codebook's answer instead of counting lines; called by {@link StudyService.source} for `codebook_source` and by {@link readRepositoryResource} for a book's cited source.
 * Lines are split as `lineCount` and every citation check split them (CRLF, CR and LF each end one line), so the numbers are the ones Codebook checks; the numbered copy is computed for the answer and never stored.
 * @param text - The exact source text.
 * @returns
 * - One line per line of `text`, each `<number>\t<line>`, joined with LF
 * - A blank line as its number and the tab alone
 * - A text that ends with a line end gets one last numbered empty line, as `lineCount` counts it
 * @example
 * numberSourceLines('const a = 1\n\nexport const b = a') // => '1\tconst a = 1\n2\t\n3\texport const b = a'
 * numberSourceLines('a\r\n') // => '1\ta\n2\t'
 */
export function numberSourceLines(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line, index) => `${index + 1}\t${line}`)
    .join('\n')
}
