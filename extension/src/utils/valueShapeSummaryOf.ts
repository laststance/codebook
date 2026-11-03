import {
  VALUE_SHAPE_DEPTH_LIMIT,
  VALUE_SHAPE_KEY_LIMIT,
  VALUE_SHAPE_KEY_LIMIT_CHARS,
  VALUE_SHAPE_SUMMARY_LIMIT_CHARS,
} from '../constants'

/**
 * Describes the shape of a value without any of its values: type names, array lengths and property names only.
 *
 * Why it exists: a Pages hit whose event has an unexpected shape is explained in one Output line, and that line must help a maintainer see what changed (a field renamed, a list that became a string) without copying anything the debuggee produced. Called by {@link pagesDataFunctionHitVerdictOf} for a `verdict-error`.
 * @param value - Anything; a CDP event that failed its schema.
 * @returns A string such as `{callFrames:array(2),reason:string}`; a string value is `string`, never its text; a name that is not identifier-like is `?`; the whole is at most 300 characters.
 * @example
 * valueShapeSummaryOf({ callFrames: 'SECRET', reason: 'other' }) // => '{callFrames:string,reason:string}'
 * valueShapeSummaryOf({ callFrames: [{ location: {} }, {}] })     // => '{callFrames:array(2)[{location:{}}]}'
 */
export function valueShapeSummaryOf(value: unknown): string {
  return shapeOf(value, 0).slice(0, VALUE_SHAPE_SUMMARY_LIMIT_CHARS)
}

/** Describes one value and its children; the outer function only cuts the length. */
function shapeOf(value: unknown, depth: number): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return arrayShapeOf(value, depth)
  if (typeof value !== 'object') return typeof value
  // Past the depth limit a nested object is only named, so a deep payload cannot grow the line.
  if (depth >= VALUE_SHAPE_DEPTH_LIMIT) return 'object'
  const names = Object.keys(value).slice(0, VALUE_SHAPE_KEY_LIMIT)
  const entries = names.map(
    (name) =>
      `${safeNameOf(name)}:${shapeOf(Reflect.get(value, name), depth + 1)}`,
  )
  return `{${entries.join(',')}}`
}

/** Describes a list by its length and the shape of its first element. */
function arrayShapeOf(list: readonly unknown[], depth: number): string {
  const first = list[0]
  if (first === undefined || depth >= VALUE_SHAPE_DEPTH_LIMIT)
    return `array(${list.length})`
  return `array(${list.length})[${shapeOf(first, depth + 1)}]`
}

/** Keeps a property name only when it looks like a protocol field, so a name that carries data is not copied. */
function safeNameOf(name: string): string {
  return name.length <= VALUE_SHAPE_KEY_LIMIT_CHARS &&
    /^[A-Za-z_]\w*$/.test(name)
    ? name
    : '?'
}
