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

/** V8 counts these as line terminators when it numbers the lines of a script; global, so one pass meets each in turn. */
const LINE_TERMINATORS = new RegExp(
  `\\r\\n|[\\n\\r${String.fromCharCode(0x2028, 0x2029)}]`,
  'g',
)

/** Where each line of a text starts and ends (its terminator excluded), line `i` being `text.slice(lineStarts[i], lineEnds[i])`. */
type LineIndex = {
  text: string
  lineStarts: readonly number[]
  lineEnds: readonly number[]
}

/** The text numbered last: the frames of one hit, and the hits of one run, ask the same renderer text again and again; it is kept until a different text is asked. */
let lastLineIndex: LineIndex | undefined

/**
 * Says which data function the source of Next's Pages renderer calls at a frame's location, if any.
 *
 * Why it exists: the data-function call frame is a renderer frame, and only the renderer's text at the frame's location can tell it from the other renderer frames (`render`, `get`, the component render path). Called by {@link pagesDataFunctionHitVerdictOf} for each renderer frame of a hit.
 * The lines of the text are numbered once and kept until a different text is asked, so the many frames of a hit cost one pass over the renderer text (about 1 MiB), not one per frame.
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
  const sourceAtLocation = lineOf(rendererText, lineNumber).slice(columnNumber)
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

/** Reads one line of a text as V8 numbers its lines, `''` past the last; the text's lines are numbered once and kept for the next lookup of the same text. */
function lineOf(text: string, lineNumber: number): string {
  // A different text replaces the kept numbering; the same text (the common case) reuses it.
  if (lastLineIndex?.text !== text) lastLineIndex = lineIndexOf(text)
  const start = lastLineIndex.lineStarts[lineNumber]
  return start === undefined
    ? ''
    : text.slice(start, lastLineIndex.lineEnds[lineNumber])
}

/** Numbers the lines of a text in one linear pass over its terminators. */
function lineIndexOf(text: string): LineIndex {
  const lineStarts = [0]
  const lineEnds: number[] = []
  // Each terminator ends one line and starts the next; `\r\n` counts once.
  for (const terminator of text.matchAll(LINE_TERMINATORS)) {
    lineEnds.push(terminator.index)
    lineStarts.push(terminator.index + terminator[0].length)
  }
  lineEnds.push(text.length)
  return { text, lineStarts, lineEnds }
}
