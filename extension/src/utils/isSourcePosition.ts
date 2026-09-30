/** Bounds zero-based UTF-16 coordinates for exact bundle verification without allocating all source lines. @example isSourcePosition('a\r\nb', 1, 1) // true */
export function isSourcePosition(
  source: string,
  line: number,
  column: number,
): boolean {
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(column) ||
    line < 0 ||
    column < 0
  )
    return false
  const separators = /\r\n|\r|\n/g
  let start = 0
  for (let currentLine = 0; currentLine < line; currentLine++) {
    const newline = separators.exec(source)
    if (!newline) return false
    start = newline.index + newline[0].length
  }
  return column <= (separators.exec(source)?.index ?? source.length) - start
}
