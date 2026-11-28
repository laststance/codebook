/** How often `part` occurs in `text`, so a test can require a line exactly once. */
export function occurrencesOf(text: string, part: string): number {
  return text.split(part).length - 1
}
