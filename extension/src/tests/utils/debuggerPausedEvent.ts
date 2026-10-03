/** Where a test's runtime pause is and what the debugger reports about it. */
export interface TestPausePlace {
  callFrameId: string
  scriptId: string
  lineNumber: number
  columnNumber: number
  hitBreakpoints: string[]
  /** The top frame's function; absent as in the pauses of the declared stops. */
  functionName?: string
  /** Why the runtime paused; `other` (a breakpoint) unless a test sends the runtime's own `instrumentation` pause. */
  reason?: string
}

/**
 * Builds the `Debugger.paused` payload a runtime sends, with one call frame at the given generated place, so both run harnesses send one shape.
 * Called by {@link nativeParticipantsHarness} and {@link configuredRuntimeHarness} for declared pauses and for the debugger's own pauses.
 * @param place - The frame and the hit breakpoints.
 * @returns The payload, with reason `other` unless the place names one.
 * @example
 * debuggerPausedEvent({ callFrameId: 'server', scriptId: 'server', lineNumber: 0, columnNumber: 0, hitBreakpoints: ['native'] })
 * // => { reason: 'other', hitBreakpoints: ['native'], callFrames: [{ callFrameId: 'server', location: { scriptId: 'server', lineNumber: 0, columnNumber: 0 } }] }
 */
export function debuggerPausedEvent(place: TestPausePlace) {
  return {
    reason: place.reason ?? 'other',
    hitBreakpoints: place.hitBreakpoints,
    callFrames: [
      {
        callFrameId: place.callFrameId,
        ...(place.functionName === undefined
          ? {}
          : { functionName: place.functionName }),
        location: {
          scriptId: place.scriptId,
          lineNumber: place.lineNumber,
          columnNumber: place.columnNumber,
        },
      },
    ],
  }
}
