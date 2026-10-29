import { EXTENSION_BUNDLED_LINE_LIMIT_CHARS } from '../constants'
import { StudyError } from '../errors'

/** A `sourceMappingURL` comment, in either comment style and its legacy `@` form. */
const SOURCE_MAP_COMMENT = /\/[/*][#@]\s*sourceMappingURL\s*=/

/**
 * Refuses a stop file that is bundled (DXR9): it carries a `sourceMappingURL` comment, or the stop's own line is longer than the limit. A long line elsewhere in the file does not matter.
 * Called by {@link resolveChromeExtensionRun} for each stop whose file the context loads.
 * @param stopIndex - The stop's 1-based position, named in the sentence.
 * @param source - The stop file's text.
 * @param stopLine - The stop's own line text.
 * @throws `BUNDLED_EXTENSION_UNSUPPORTED` naming the rule that fired.
 * @example
 * assertStopNotBundled(1, 'x\n//# sourceMappingURL=a.map\n', 'x') // throws "Stop 1 is in a bundled file; …"
 */
export function assertStopNotBundled(
  stopIndex: number,
  source: string,
  stopLine: string,
): void {
  const rule = SOURCE_MAP_COMMENT.test(source)
    ? 'a sourceMappingURL comment'
    : stopLine.length > EXTENSION_BUNDLED_LINE_LIMIT_CHARS
      ? `the stop's line is longer than ${EXTENSION_BUNDLED_LINE_LIMIT_CHARS} characters`
      : undefined
  if (rule === undefined) return
  throw new StudyError(
    'BUNDLED_EXTENSION_UNSUPPORTED',
    `Stop ${stopIndex} is in a bundled file; this version explains unbundled extension sources only. Rule: ${rule}.`,
  )
}
