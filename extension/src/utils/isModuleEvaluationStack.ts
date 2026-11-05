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
 * Why it exists: a module-scope line runs once, when the module is first evaluated, and a function-body line runs again on every call; only the stack tells them apart, because the extension ships no JavaScript parser (Cycle 0086, decision R3). In the recorded stack of Next 16 the module script's own anonymous top-level code sits directly above the module factory named like the script's address without its prefix (`(rsc)/./db/index.ts`), and `__webpack_require__` follows. That pair is the top of the stack for a top-level line, and lies below the callee's frames for a line in a function the module calls while it loads (`const client = createClient()`, an immediately invoked function). Called by {@link ConfiguredBrowserRun} for a hit of a provisional breakpoint during the preparation window, and for a hit of an armed server stop to label it as a module evaluation.
 * @param frames - The paused event's call frames, top frame first.
 * @param moduleScriptId - The id of the stop module's own script (the one the top frame must be in).
 * @param moduleScriptUrl - The address that script was announced under; a React server copy (`about://React/Server/…`) is never a module evaluation.
 * @returns `true` when the top frame is in that script and the stack holds the script's anonymous top-level frame directly above the module's factory.
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
  // The paused line is in this module: a top frame in another script is no evaluation of it.
  if (frames[0]?.location?.scriptId !== moduleScriptId) return false
  const factoryName = moduleScriptUrl.startsWith(WEBPACK_INTERNAL_PREFIX)
    ? moduleScriptUrl.slice(WEBPACK_INTERNAL_PREFIX.length)
    : moduleScriptUrl
  // The module is being evaluated when its own anonymous top-level frame sits directly above its factory, at the top or below a function it called while loading.
  return frames.some((frame, index) =>
    isTopLevelAboveFactory(
      frame,
      frames[index + 1],
      moduleScriptId,
      factoryName,
    ),
  )
}

/**
 * Tells whether one frame is a module script's anonymous top-level code and the next frame is that module's factory.
 * Called by {@link isModuleEvaluationStack} for each frame of a paused stack.
 * @param frame - The frame to test.
 * @param below - The frame under it; the factory runs in the chunk's script, and a factory frame without a location (a malformed event) proves nothing.
 * @param moduleScriptId - The module's own script.
 * @param factoryName - The factory's name: the module's address without its `webpack-internal:///` prefix.
 * @returns `true` for the module's top-level frame directly above its factory.
 * @example isTopLevelAboveFactory({ functionName: '', location: { scriptId: '12' } }, { functionName: '(rsc)/./db/index.ts', location: { scriptId: '3' } }, '12', '(rsc)/./db/index.ts') // => true
 */
function isTopLevelAboveFactory(
  frame: ModuleEvaluationFrame,
  below: ModuleEvaluationFrame | undefined,
  moduleScriptId: string,
  factoryName: string,
): boolean {
  const belowLocation = below?.location
  return (
    frame.location?.scriptId === moduleScriptId &&
    (frame.functionName ?? '') === '' &&
    belowLocation !== undefined &&
    belowLocation !== null &&
    belowLocation.scriptId !== moduleScriptId &&
    below?.functionName === factoryName
  )
}
