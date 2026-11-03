import { PREVIEW_CLASS_NAME_MAX_CHARS } from '../constants'

import { classNameOf } from './secretShapes'

/** What a variable with no debugger type and no plausible leading identifier is saved as. */
const UNKNOWN_CLASS_NAME = 'Object'

/**
 * Names the class of a debugger's variable like {@link classNameOf}, but never returns a long run of the value's own text.
 * Why: a variable the capture does not read (a raw value above the scan bound) or withholds keeps only its class name. When the debugger reported no type, {@link classNameOf} reads the name from the start of the value preview, and an identifier-like value (`eyJhbGciOi…`, a hex string) is one run of any length, so the whole unscanned value would be saved as its "class name".
 * Called by {@link captureReplayDebugSnapshot}, {@link withheldVariableValue} and {@link maskSavedDebugSnapshot}.
 * @param variable - A variable's debugger type and value preview.
 * @returns The debugger's type as reported, else the identifier the preview starts with when it is at most {@link PREVIEW_CLASS_NAME_MAX_CHARS} characters, else `Object`.
 * @example
 * boundedClassNameOf({ type: undefined, value: 'Socket {connecting: false}' }) // => 'Socket'
 * boundedClassNameOf({ type: 'Uint8Array', value: 'y'.repeat(20_000) }) // => 'Uint8Array'
 * boundedClassNameOf({ type: undefined, value: 'x'.repeat(20_000) }) // => 'Object'
 */
export function boundedClassNameOf(variable: {
  type?: string | undefined
  value: string
}): string {
  const name = classNameOf(variable)
  // The debugger's own type is a class name as reported; only a name read from the value is bounded.
  const isReportedType = Boolean(variable.type?.trim())
  return isReportedType || name.length <= PREVIEW_CLASS_NAME_MAX_CHARS
    ? name
    : UNKNOWN_CLASS_NAME
}
