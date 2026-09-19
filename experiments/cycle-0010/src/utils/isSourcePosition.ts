/** Rejects impossible zero-based UTF-16 positions before {@link createBundleVerifier} accepts SourceMap's preceding range. @example isSourcePosition('a\nb', 1, 1) // true */
export function isSourcePosition(source: string, line: number, column: number): boolean {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 0 || column < 0) return false;
  let start = 0;
  // Find only the requested line without allocating a full line array for large modules.
  for (let current = 0; current < line; current++) {
    const newline = source.indexOf('\n', start);
    if (newline < 0) return false;
    start = newline + 1;
  }
  const newline = source.indexOf('\n', start), end = newline < 0 ? source.length : newline;
  return column <= end - start;
}
