import type { Protocol } from 'devtools-protocol'

import type { OutstandingPageRequest } from './pagesRequestPathOf'

/** Next's `pages-manifest.json`: a route (`/products/[id]`) to its compiled page (`pages/products/[id].js`). */
export type PagesManifest = Readonly<Record<string, string>>

/**
 * What the Pages verdict reads from the run, as an interface the run implements and a test scripts.
 *
 * Why it exists: the verdict ({@link pagesDataFunctionHitVerdictOf}) decides from facts, and every fact that is not in the `Debugger.paused` event comes through here, so the verdict does no I/O and `configuredBrowserRun.ts` only wires these members to the debugger channel, the manifest file and the browser participant. Each member that reads may reject; the verdict treats a rejection as a failed read.
 */
export interface PagesHitReader {
  /** The address of a script by id, from the run's `Debugger.scriptParsed` events; `undefined` for a script no event announced. js-debug's proxy forwards synchronous frames with an empty `url`, so this resolves them. */
  scriptUrlOf(scriptId: string): string | undefined
  /** The source text of a script (`Debugger.getScriptSource`). The run reads the renderer's text once and keeps it, so this answers from that copy; `undefined` when it could not be read. */
  scriptSourceOf(scriptId: string): Promise<string | undefined>
  /** `Debugger.evaluateOnCallFrame` through the proxy, exactly as asked. */
  evaluateOnCallFrame(
    request: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse>
  /** `Debugger.getStackTrace` through the proxy, for an async chain that continues in a stack trace id. */
  getStackTrace(
    stackTraceId: Protocol.Runtime.StackTraceId,
  ): Promise<Protocol.Runtime.StackTrace>
  /** The id of the debugger this run's pauses come from, when the run knows it; a stack trace id with another `debuggerId` is not read. */
  readonly ownDebuggerId: string | undefined
  /** `pages-manifest.json` of the development build; `undefined` when it could not be read. */
  pagesManifest(): Promise<PagesManifest | undefined>
  /** The requests the browser participant has sent and not yet received an answer for, at this moment. */
  outstandingRequests(): readonly OutstandingPageRequest[]
}
