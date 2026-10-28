/**
 * Puts a path in the form root spellings are compared in: without case and with any run of separators as one.
 * Why: Windows roots match without regard to case or separator kind, and output and debugger values must hide the same text. Called by {@link createRootHidingStage} and {@link hideTrailingRootPrefix}.
 * @param text - A path or a path fragment.
 * @returns The comparison form.
 * @example normalizeForPrefix('C:\\\\Users\\Ada') // => 'c:/users/ada'
 */
export function normalizeForPrefix(text: string): string {
  return text.toLowerCase().replace(/[\\/]+/g, '/')
}
