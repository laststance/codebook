import type { ConfiguredDescriptor } from '../configuredStudySchemas'

import { sourceLineText } from './sourceLineText'

/**
 * Gives the position a declared stop is taken at: a column declared on a line without characters (a blank line) means that line, so it is taken at the line's start instead of being refused for its column.
 * Called by {@link assertConfiguredDescriptor} and {@link describeColumnPastLineEnd} before the column is checked against its line, and by {@link ConfiguredBrowserRun} when it chooses where the stop's breakpoint is requested and journals what it took.
 * @param position - The stop's declared path, line and column.
 * @param sources - The selected node's retained sources.
 * @returns
 * - The declared position with column 1 when its line has a length of 0 and the column is past 1
 * - The declared position itself otherwise (a line with characters, or a line the sources do not hold), so every other check stays as it was
 * @example
 * takenStopPosition({ path: 'src/theme.ts', line: 2, column: 9 }, [{ path: 'src/theme.ts', text: 'a()\n\nb()' }]) // => { path: 'src/theme.ts', line: 2, column: 1 }
 * takenStopPosition({ path: 'src/theme.ts', line: 1, column: 9 }, [{ path: 'src/theme.ts', text: 'a()\n\nb()' }]) // => the declared position
 */
export function takenStopPosition<
  Position extends { path: string; line: number; column: number },
>(position: Position, sources: ConfiguredDescriptor['sources']): Position {
  const lineText = sourceLineText(sources, position.path, position.line)
  // Only a line without characters has no column to choose; any other line keeps the declared column and its bound.
  if (lineText !== '' || position.column === 1) return position
  return { ...position, column: 1 }
}
