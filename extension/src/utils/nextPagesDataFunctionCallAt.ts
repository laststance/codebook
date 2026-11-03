import {
  NEXT_PAGES_RENDERER_PATTERNS,
  NEXT_PAGES_TRACED_AWAIT_WINDOW_CHARS,
} from '../constants'

/** The data function a renderer frame calls, and which text told. */
export type NextPagesDataFunctionCall = {
  dataFunction: (typeof NEXT_PAGES_RENDERER_PATTERNS)[number]['dataFunction']
  /** `call`: the frame is the call (`getServerSideProps(…`); `traced-await`: the frame awaits the traced call (`trace(trace_constants.RenderSpan.getServerSideProps,…`). */
  form: 'call' | 'traced-await'
}

/** V8 counts these as line terminators when it numbers the lines of a script. */
const LINE_TERMINATORS = new RegExp(
  `\\r\\n|[\\n\\r${String.fromCharCode(0x2028, 0x2029)}]`,
)

/**
 * Says which data function the source of Next's Pages renderer calls at a frame's location, if any.
 *
 * Why it exists: the data-function call frame is a renderer frame, and only the renderer's text at the frame's location can tell it from the other renderer frames (`render`, `get`, the component render path). Called by {@link pagesDataFunctionHitVerdictOf} for each renderer frame of a hit.
 * @param rendererText - The source text of the renderer script (`Debugger.getScriptSource`).
 * @param lineNumber - 0-based line of the frame's location.
 * @param columnNumber - 0-based column of the frame's location.
 * @returns
 * - `form: 'call'` when the text there starts with the call text of a pattern
 * - `form: 'traced-await'` when the first characters there hold the traced-await text of a pattern
 * - `undefined` for any other location, a location past the text, and an empty text
 * @example
 * nextPagesDataFunctionCallAt('x'.repeat(5) + 'getServerSideProps({req:req}', 0, 5) // => { dataFunction: 'getServerSideProps', form: 'call' }
 * nextPagesDataFunctionCallAt('render(req,res)', 0, 0)                              // => undefined
 */
export function nextPagesDataFunctionCallAt(
  rendererText: string,
  lineNumber: number,
  columnNumber: number,
): NextPagesDataFunctionCall | undefined {
  const sourceAtLocation = (
    rendererText.split(LINE_TERMINATORS)[lineNumber] ?? ''
  ).slice(columnNumber)
  const call = NEXT_PAGES_RENDERER_PATTERNS.find((pattern) =>
    sourceAtLocation.startsWith(pattern.callText),
  )
  if (call) return { dataFunction: call.dataFunction, form: 'call' }
  const windowAtLocation = sourceAtLocation.slice(
    0,
    NEXT_PAGES_TRACED_AWAIT_WINDOW_CHARS,
  )
  const traced = NEXT_PAGES_RENDERER_PATTERNS.find((pattern) =>
    windowAtLocation.includes(pattern.tracedAwaitText),
  )
  return traced
    ? { dataFunction: traced.dataFunction, form: 'traced-await' }
    : undefined
}
