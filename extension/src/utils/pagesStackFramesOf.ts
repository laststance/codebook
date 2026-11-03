import type {
  PagesAsyncCallFrame,
  PagesSyncCallFrame,
} from './parsePagesPausedEvent'

/** One frame of a paused Pages stack, synchronous or from the async chain, with its script address resolved. */
export type PagesStackFrame = {
  origin: 'sync' | 'async'
  /** Only a synchronous frame has one; `Debugger.evaluateOnCallFrame` needs it. */
  callFrameId: string | undefined
  functionName: string
  scriptId: string
  /** The script address; `''` when no source of the run announced the script. */
  url: string
  /** 0-based, as V8 reports it. */
  lineNumber: number
  /** 0-based, as V8 reports it. */
  columnNumber: number
}

/** The frames of one part of a paused stack: the synchronous call frames, or the frames of one async level. */
export type PagesStackFrameSource =
  | { origin: 'sync'; callFrames: readonly PagesSyncCallFrame[] }
  | { origin: 'async'; callFrames: readonly PagesAsyncCallFrame[] }

/**
 * Turns the frames of a paused event into one list shape with the script address of every frame resolved.
 *
 * Why it exists: js-debug's proxy forwards synchronous frames with an empty `url` and asynchronous frames with a filled one, so the renderer and page-module checks need one place that resolves both. Called by {@link pagesDataFunctionHitVerdictOf} for the synchronous frames and by {@link readPagesAsyncChain} for each async level.
 * @param source - Which part of the stack the frames come from, and the frames.
 * @param scriptUrlOf - The address of a script by id, from the run's `Debugger.scriptParsed` events; it wins over a frame's own `url`.
 * @returns The frames in the order given (innermost first), each with `url` set to the resolved address.
 * @example
 * pagesStackFramesOf({ origin: 'sync', callFrames: [{ callFrameId: '1', functionName: 'getServerSideProps', location: { scriptId: '7', lineNumber: 21, columnNumber: 4 }, url: '' }] }, (id) => (id === '7' ? '(pages-dir-node)/./pages/index.js' : undefined))
 * // => [{ origin: 'sync', callFrameId: '1', functionName: 'getServerSideProps', scriptId: '7', url: '(pages-dir-node)/./pages/index.js', lineNumber: 21, columnNumber: 4 }]
 */
export function pagesStackFramesOf(
  source: PagesStackFrameSource,
  scriptUrlOf: (scriptId: string) => string | undefined,
): PagesStackFrame[] {
  if (source.origin === 'sync')
    return source.callFrames.map((frame) => ({
      origin: 'sync',
      callFrameId: frame.callFrameId,
      functionName: frame.functionName,
      scriptId: frame.location.scriptId,
      url: scriptUrlOf(frame.location.scriptId) ?? frame.url,
      lineNumber: frame.location.lineNumber,
      columnNumber: frame.location.columnNumber,
    }))
  return source.callFrames.map((frame) => ({
    origin: 'async',
    callFrameId: undefined,
    functionName: frame.functionName,
    scriptId: frame.scriptId,
    url: scriptUrlOf(frame.scriptId) ?? frame.url,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber,
  }))
}
