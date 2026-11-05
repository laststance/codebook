import { isReactServerCopyUrl } from './isReactServerCopyUrl'

/** The part of a `Debugger.paused` call frame that {@link isModuleEvaluationStack} reads. */
export interface ModuleEvaluationFrame {
  /** The frame's function name; empty (or absent) for the top-level code of an evaluated script. */
  functionName?: string
  /** Absent in a malformed event; such a frame is no module's code. */
  location?: { scriptId: string } | null
}

/** The prefix Next's webpack gives every module script address, which its module factory's name leaves out. */
const WEBPACK_INTERNAL_PREFIX = 'webpack-internal:///'

/**
 * Tells whether a server pause stands in the top-level code of a module's own script, that is, while Next evaluates the module for the first time.
 *
 * Why it exists: a module-scope line runs once, when the module is first evaluated, and a function-body line runs again on every call; only the stack tells them apart, because the extension ships no JavaScript parser (Cycle 0086, decision R3). In the recorded stack of Next 16 the top frame is the module script's own anonymous top-level code, the next frame is the module factory named like the script's address without its prefix (`(rsc)/./db/index.ts`), and `__webpack_require__` follows. Called by {@link ConfiguredBrowserRun} for a hit of a provisional breakpoint during the preparation window, and for a hit of an armed server stop to label it as a module evaluation.
 * @param frames - The paused event's call frames, top frame first.
 * @param moduleScriptId - The id of the stop module's own script (the one the top frame must be in).
 * @param moduleScriptUrl - The address that script was announced under; a React server copy (`about://React/Server/…`) is never a module evaluation.
 * @returns `true` when the top frame is the anonymous top-level code of that script and the frame below it is the module's factory.
 * @example
 * ```ts
 * isModuleEvaluationStack(
 *   [
 *     { functionName: '', location: { scriptId: '12' } },
 *     { functionName: '(rsc)/./db/index.ts', location: { scriptId: '3' } },
 *     { functionName: '__webpack_require__', location: { scriptId: '3' } },
 *   ],
 *   '12',
 *   'webpack-internal:///(rsc)/./db/index.ts',
 * ) // => true
 * ```
 */
export function isModuleEvaluationStack(
  frames: readonly ModuleEvaluationFrame[],
  moduleScriptId: string,
  moduleScriptUrl: string | undefined,
): boolean {
  // React's fabricated copies run no module code, whatever their stack looks like.
  if (moduleScriptUrl === undefined || isReactServerCopyUrl(moduleScriptUrl))
    return false
  const [top, factory] = frames
  // A named top frame is a function body; an unnamed one in another script is no evaluation of this module.
  if (
    top === undefined ||
    top.location?.scriptId !== moduleScriptId ||
    (top.functionName ?? '') !== ''
  )
    return false
  const factoryName = moduleScriptUrl.startsWith(WEBPACK_INTERNAL_PREFIX)
    ? moduleScriptUrl.slice(WEBPACK_INTERNAL_PREFIX.length)
    : moduleScriptUrl
  // The factory runs in the chunk's script, not in the module's own one.
  return (
    factory !== undefined &&
    factory.location?.scriptId !== moduleScriptId &&
    factory.functionName === factoryName
  )
}
