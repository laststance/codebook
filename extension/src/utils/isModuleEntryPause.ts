import { posix } from 'node:path'

import type { Protocol } from 'devtools-protocol'

/** What the id of the debug adapter's own breakpoint at a module's first position begins with, as the page's runtime named it in the native journals of Cycle 0046 (`br:2:0:0:actions` for `app/lib/actions.ts`): a breakpoint at line 0, column 0, followed by the pattern it was set by. */
const MODULE_ENTRY_BREAKPOINT_ID_START = 'br:2:0:0:'

/** The characters js-debug writes a backslash before when it turns a file's base name into the pattern of that breakpoint. */
const ESCAPED_IN_ENTRY_PATTERN = /[/\\.?*()^${}|[\]+]/g

/** Gives a source file's base name without its last extension, the text js-debug sets its breakpoint at a module's first position by. @example entryNameOf('app/lib/actions.ts') // 'actions' */
function entryNameOf(sourcePath: string): string {
  return posix.basename(sourcePath, posix.extname(sourcePath) || undefined)
}

/** Tells whether a hit breakpoint id is the one of the debug adapter's own breakpoint at the first position of the modules named like a source file. @example isEntryBreakpointOf('br:2:0:0:actions', 'app/lib/actions.ts') // true */
function isEntryBreakpointOf(
  breakpointId: string,
  sourcePath: string,
): boolean {
  const pattern = entryNameOf(sourcePath).replace(
    ESCAPED_IN_ENTRY_PATTERN,
    '\\$&',
  )
  return breakpointId === `${MODULE_ENTRY_BREAKPOINT_ID_START}${pattern}`
}

/** Tells whether a pause's top frame is at line 0, column 0 of its script, where js-debug sets its breakpoint at a module's first position. @example isAtFirstPosition(pauseAt(0, 0, [])) // true */
function isAtFirstPosition(event: Protocol.Debugger.PausedEvent): boolean {
  const location = event.callFrames[0]?.location
  return location?.lineNumber === 0 && location.columnNumber === 0
}

/** Gives the id of the one breakpoint a pause hit; `undefined` for a pause that hit none or several. @example onlyHitBreakpoint(pauseAt(0, 0, ['br:2:0:0:actions'])) // 'br:2:0:0:actions' */
function onlyHitBreakpoint(
  event: Protocol.Debugger.PausedEvent,
): string | undefined {
  const hitBreakpoints = event.hitBreakpoints ?? []
  return hitBreakpoints.length === 1 ? hitBreakpoints[0] : undefined
}

/**
 * Tells whether a pause is the debug adapter's own pause at the first position of a module, which the adapter resumes by itself once it has read the module's source map; {@link ConfiguredBrowserRun} asks it for a page pause in a run that declares no browser stop, to give that pause the adapter's bound instead of the short bound of a pause nobody owns.
 * js-debug sets a breakpoint at line 1, column 1 for each file that has a breakpoint, and with source maps read per script it sets it by a pattern that is the file's base name without its extension (read in the bundled js-debug 1.140.0: the entry breakpoint's class, `getModeKeyForSource`, `_setByUrlRegexp`). So the page pauses for a moment at the first position of every script whose address contains that name. The two native journals of Cycle 0046 show the pause: top frame at line 1, column 1, one hit breakpoint, id `br:2:0:0:actions` for a stop declared in `app/lib/actions.ts`.
 * The rule is what the journals and the source agree on, and nothing wider, so that a pause the learner or another tool caused keeps the short bound: a breakpoint set on a line of a file is set by the file's address or by its script, never by a bare base name at the first position.
 * @param event - The pause as the runtime reported it.
 * @param scriptUrl - The address the runtime announced for the paused script; `undefined` for a script it never announced.
 * @param sourcePaths - The source files of the run's declared stops, by their paths with forward slashes.
 * @returns `true` when the top frame is at line 0, column 0 of its script, the pause hit exactly one breakpoint, that breakpoint's id is `br:2:0:0:` followed by the base name, without its extension and with a backslash before each of `/\.?*()^${}|[]+`, of one of the source files, and the script's address contains that base name; `false` otherwise.
 * @example
 * isModuleEntryPause(pauseAt(0, 0, ['br:2:0:0:actions']), 'webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts', ['app/lib/actions.ts']) // => true
 * isModuleEntryPause(pauseAt(0, 0, ['1:0:0:webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts']), 'webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts', ['app/lib/actions.ts']) // => false
 * isModuleEntryPause(pauseAt(10, 6, ['br:2:0:0:actions']), 'webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts', ['app/lib/actions.ts']) // => false
 */
export function isModuleEntryPause(
  event: Protocol.Debugger.PausedEvent,
  scriptUrl: string | undefined,
  sourcePaths: readonly string[],
): boolean {
  const breakpointId = onlyHitBreakpoint(event)
  // Only a pause at a script's first position that hit one breakpoint can be the adapter's entry pause.
  if (breakpointId === undefined || !isAtFirstPosition(event)) return false
  return sourcePaths.some(
    (sourcePath) =>
      isEntryBreakpointOf(breakpointId, sourcePath) &&
      Boolean(scriptUrl?.includes(entryNameOf(sourcePath))),
  )
}
