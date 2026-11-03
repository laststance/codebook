import type { Protocol } from 'devtools-protocol'

import type { PagesHitReader, PagesManifest } from '../../utils/pagesHitReader'
import type { OutstandingPageRequest } from '../../utils/pagesRequestPathOf'

/** What a test scripts of the debugger channel, the manifest file and the browser participant. */
export interface ScriptedPagesReaderOptions {
  /** Script addresses by script id. */
  scriptUrls?: Record<string, string>
  /** Script texts by script id; an id that is absent answers `undefined`, as a text that could not be read. */
  scriptSources?: Record<string, string>
  /** The route `Debugger.evaluateOnCallFrame` of `pathname` answers on exactly one frame; every other frame answers V8's `ReferenceError`. */
  pathname?: { callFrameId: string; value: string }
  /** The answers of `Debugger.getStackTrace` by stack trace id; an `Error` rejects, an id that is absent rejects as V8's `Invalid stack trace id`. */
  stackTraces?: Record<string, Protocol.Runtime.StackTrace | Error>
  /** Replaces the answer of `getStackTrace`, for a read a test holds open. */
  getStackTrace?: PagesHitReader['getStackTrace']
  /** `pages-manifest.json`; `undefined` answers a manifest that could not be read. */
  manifest?: PagesManifest
  requests?: OutstandingPageRequest[]
  ownDebuggerId?: string
}

/** What the verdict asked of the scripted reader. */
export interface ScriptedPagesReaderCalls {
  evaluateOnCallFrame: Protocol.Debugger.EvaluateOnCallFrameRequest[]
  stackTraceIds: Protocol.Runtime.StackTraceId[]
  scriptSourceIds: string[]
  manifestReads: number
}

/**
 * Scripts the reader the Pages verdict reads through, and records every read the verdict made.
 * @param options - The scripted answers.
 * @returns The reader and the record of its calls.
 * @example
 * const { reader, calls } = scriptedPagesReader({ scriptUrls: fixture.scriptUrls, pathname: { callFrameId: 'frame-11', value: '/' } })
 */
export function scriptedPagesReader(options: ScriptedPagesReaderOptions = {}): {
  reader: PagesHitReader
  calls: ScriptedPagesReaderCalls
} {
  const calls: ScriptedPagesReaderCalls = {
    evaluateOnCallFrame: [],
    stackTraceIds: [],
    scriptSourceIds: [],
    manifestReads: 0,
  }
  const reader: PagesHitReader = {
    scriptUrlOf: (scriptId) => options.scriptUrls?.[scriptId],
    scriptSourceOf: async (scriptId) => {
      calls.scriptSourceIds.push(scriptId)
      return options.scriptSources?.[scriptId]
    },
    evaluateOnCallFrame: async (request) => {
      calls.evaluateOnCallFrame.push(request)
      if (request.callFrameId === options.pathname?.callFrameId)
        return { result: { type: 'string', value: options.pathname.value } }
      return {
        result: {
          type: 'object',
          subtype: 'error',
          description: 'ReferenceError: pathname is not defined',
        },
        exceptionDetails: {
          exceptionId: 1,
          text: 'Uncaught',
          lineNumber: 0,
          columnNumber: 0,
        },
      }
    },
    getStackTrace:
      options.getStackTrace ??
      (async (stackTraceId) => {
        calls.stackTraceIds.push(stackTraceId)
        const answer = options.stackTraces?.[stackTraceId.id]
        if (answer === undefined || answer instanceof Error)
          throw answer ?? new Error('Invalid stack trace id')
        return answer
      }),
    ownDebuggerId: options.ownDebuggerId,
    pagesManifest: async () => {
      calls.manifestReads += 1
      return options.manifest
    },
    outstandingRequests: () => options.requests ?? [],
  }
  return { reader, calls }
}
