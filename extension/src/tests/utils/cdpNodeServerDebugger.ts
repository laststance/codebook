import { pathToFileURL } from 'node:url'

import type { Protocol } from 'devtools-protocol'

import type {
  NodeServerArmedStop,
  NodeServerDebugger,
  NodeServerDebuggerHandlers,
  NodeServerDebuggerInput,
  NodeServerDebuggerPause,
  NodeServerStopCapture,
  NodeServerStopTarget,
} from '../../nodeServerDebugger'
import { Cdp } from '../../runtimeSupport/cdp'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { verifyNodeTestInspectorOwnership } from '../../utils/verifyNodeTestInspectorOwnership'

import { defer } from './defer'

/**
 * A test stand-in for the editor's debugger: it drives the server's inspector directly over CDP, as the Part A spike did, behind the same {@link NodeServerDebugger} seam.
 * Real-process tests use it to run the product's run, launcher and request path against a real child process (evidence ladder level 3); `no_claim`: the DAP binding and `pwa-node` attach.
 * @param input - The run's debugger input (stops, journal).
 * @returns The stand-in debugger.
 * @example const debug = createCdpNodeServerDebugger(input)
 */
export function createCdpNodeServerDebugger(
  input: NodeServerDebuggerInput,
): NodeServerDebugger {
  let cdp: Cdp | undefined
  let handlers: NodeServerDebuggerHandlers | undefined
  let nextToken = 0
  const entry = defer<void>()
  let entryPaused = false
  let released = false
  const breakpoints = new Map<number, string>()
  const livePauses = new Map<
    number,
    { callFrames: Protocol.Debugger.CallFrame[]; target?: NodeServerStopTarget }
  >()
  /** Reads the connection or fails the way a run needs. */
  const connection = (): Cdp => {
    if (!cdp) throw new Error('The stand-in debugger is not attached.')
    return cdp
  }
  /** Tells which armed stop a pause is: its breakpoint id was hit and the top frame is on its line. */
  const stopOf = (event: Protocol.Debugger.PausedEvent) => {
    const line = event.callFrames[0]?.location.lineNumber
    return input.stops.find(
      (stop) =>
        event.hitBreakpoints?.includes(
          breakpoints.get(stop.declaredStopIndex) ?? '',
        ) && line === stop.line - 1,
    )
  }
  const onPaused = (event: Protocol.Debugger.PausedEvent): void => {
    // The first pause is the entry pause (`--inspect-brk`); the run never sees it.
    if (!entryPaused) {
      entryPaused = true
      livePauses.set(0, { callFrames: event.callFrames })
      entry.resolve()
      return
    }
    const target = stopOf(event)
    const token = ++nextToken
    livePauses.set(token, { callFrames: event.callFrames, target })
    const frame = event.callFrames[0]
    const pause: NodeServerDebuggerPause = {
      token,
      sessionId: 'cdp',
      threadId: 1,
      reason: event.reason,
      declaredStopIndex: target?.declaredStopIndex,
      location: frame && {
        path: target?.path ?? 'other',
        line: frame.location.lineNumber + 1,
      },
    }
    handlers?.onPause(pause)
  }
  return {
    assertSourcesUnchanged(): void {},
    async attach(attach): Promise<void> {
      cdp = await Cdp.connect(attach.endpoint, () => undefined)
      cdp.onClose = (): void => {
        if (!released) handlers?.onEnd('the inspector connection closed')
      }
      cdp.on('Debugger.paused', onPaused)
      cdp.on('Debugger.resumed', () => {
        for (const token of [...livePauses.keys()].filter((key) => key > 0)) {
          livePauses.delete(token)
          handlers?.onResume(token)
        }
      })
      await cdp.request('Debugger.enable', undefined)
      await cdp.request('Runtime.enable', undefined)
      await cdp.request('Runtime.runIfWaitingForDebugger', undefined)
      await entry.promise
      // The entry pause: the inspector must belong to the launched process.
      await verifyNodeTestInspectorOwnership(
        cdp,
        attach.packageRoot,
        attach.processGroup,
        attach.signal,
        () => undefined,
      )
    },
    subscribe(listener) {
      handlers = listener
      return { dispose: () => (handlers = undefined) }
    },
    async armStops(stops): Promise<NodeServerArmedStop[]> {
      const armed: NodeServerArmedStop[] = []
      for (const stop of stops) {
        const result = await connection().request(
          'Debugger.setBreakpointByUrl',
          {
            lineNumber: stop.line - 1,
            url: pathToFileURL(stop.file).href,
          },
        )
        breakpoints.set(stop.declaredStopIndex, result.breakpointId)
        armed.push({
          declaredStopIndex: stop.declaredStopIndex,
          boundLine: (result.locations[0]?.lineNumber ?? stop.line - 1) + 1,
        })
      }
      return armed
    },
    async releaseEntry(): Promise<void> {
      await connection().request('Debugger.resume', {})
    },
    setRequestWindow(): void {},
    async capture(pause): Promise<NodeServerStopCapture> {
      const live = livePauses.get(pause.token)
      const frame = live?.callFrames[0]
      const target = live?.target
      if (!live || !frame || !target)
        throw new Error('The owned pause is no longer current.')
      const facts: NodeServerStopCapture['facts'] = []
      for (const inspection of target.inspections) {
        const result = await connection().request(
          'Debugger.evaluateOnCallFrame',
          {
            callFrameId: frame.callFrameId,
            expression: inspection.path,
            returnByValue: true,
          },
        )
        facts.push({
          path: inspection.path,
          mode: inspection.mode,
          display: String(result.result.value),
        })
      }
      return {
        path: target.path,
        line: frame.location.lineNumber + 1,
        sourceHash: target.hash,
        facts,
        unavailable: [],
        snapshot: { version: 1, frames: [], variables: [], limitations: [] },
      }
    },
    async resume(): Promise<void> {
      await connection().request('Debugger.resume', {})
    },
    async retireStops(): Promise<void> {
      for (const breakpointId of breakpoints.values())
        await connection().request('Debugger.removeBreakpoint', {
          breakpointId,
        })
      breakpoints.clear()
    },
    async release(): Promise<void> {
      released = true
      cdp?.close()
      await waitUntil(
        () => cdp?.closed ?? true,
        'the inspector connection to close',
        5_000,
      )
    },
  }
}
