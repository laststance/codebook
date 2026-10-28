import type { NodeServerStopCapture } from '../../nodeServerDebugger'
import { sha256 } from '../../runtimeSupport/utils/sha256'

import { HANDLER_SOURCE_TEXT } from './nodeServerHistoryFixture'

/**
 * Builds what the run's debugger reads at one stop of `src/handler.ts`, in the shape the history sink takes: a presentable snapshot whose top frame carries the executed source text.
 * @param options - The line, the top frame's name and the declared inspections' displays.
 * @returns A debugger capture.
 * @example sink.stop(60, { declaredStopIndex: 0 }, 1, debuggerCapture({ line: 2 }))
 */
export function debuggerCapture(
  options: {
    line?: number
    frameName?: string
    facts?: NodeServerStopCapture['facts']
    unavailable?: string[]
  } = {},
): NodeServerStopCapture {
  const line = options.line ?? 2
  const hash = sha256(HANDLER_SOURCE_TEXT)
  const frameName = options.frameName ?? 'handler'
  return {
    path: 'src/handler.ts',
    line,
    sourceHash: hash,
    facts: options.facts ?? [{ path: 'id', mode: 'value', display: '7' }],
    unavailable: options.unavailable ?? [],
    snapshot: {
      version: 1,
      frames: [
        {
          name: frameName,
          line,
          column: 1,
          source: {
            name: 'src/handler.ts',
            text: HANDLER_SOURCE_TEXT,
            hash,
            line,
          },
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'id', value: '7', type: 'string', children: [] }],
      limitations: [],
    },
  }
}
