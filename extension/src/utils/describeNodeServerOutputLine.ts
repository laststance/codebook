/** One plain entry for the Output › Codebook channel: its text and whether it reports a failure. */
export type NodeServerOutputLine = { level: 'info' | 'error'; text: string }

/**
 * Words a node-server run's failure as one plain Output › Codebook line that names the run.
 * Called by {@link describeNodeServerOutputLine} for a `node-server.failure` event and by {@link StudyService} for a start, request or run failure whose run reported no such event.
 * @param runId - The run's id.
 * @param code - The failure's error code.
 * @param cause - The sanitized cause.
 * @returns The line, at level `error`.
 * @example describeNodeServerFailureLine('r1', 'SERVER_EXITED', 'exit code 1') // => { level: 'error', text: 'Run r1 failed: SERVER_EXITED: exit code 1' }
 */
export function describeNodeServerFailureLine(
  runId: string,
  code: string,
  cause: string,
): NodeServerOutputLine {
  return { level: 'error', text: `Run ${runId} failed: ${code}: ${cause}` }
}

/**
 * Words the request and the response (or failure) of a node-server run as plain Output › Codebook lines, each naming the run, from the events the run's journal whitelisted. Output text and other event types write nothing.
 * Called by {@link StudyService} for each whitelisted `node-server.*` event.
 * @param runId - The run's id.
 * @param type - The event type.
 * @param detail - The whitelisted event detail ({@link nodeServerEventDetail}).
 * @returns The line to write; `undefined` for an event that has none.
 * @example
 * describeNodeServerOutputLine('r1', 'node-server.request', { method: 'GET', path: '/api/healthz', bodyBytes: 0, address: '127.0.0.1:4100' })
 * // => { level: 'info', text: 'Run r1: sent GET /api/healthz to 127.0.0.1:4100 (0 body bytes).' }
 */
export function describeNodeServerOutputLine(
  runId: string,
  type: string,
  detail: Record<string, unknown>,
): NodeServerOutputLine | undefined {
  if (type === 'node-server.request')
    return {
      level: 'info',
      text: `Run ${runId}: sent ${String(detail.method)} ${String(detail.path)} to ${String(detail.address)} (${String(detail.bodyBytes)} body bytes).`,
    }
  if (type === 'node-server.response')
    return {
      level: 'info',
      text: `Run ${runId}: response ${String(detail.status)}${typeof detail.contentType === 'string' ? ` ${detail.contentType}` : ''} after ${String(detail.elapsedMs)} ms (${String(detail.bodyBytes)} body bytes).`,
    }
  if (type === 'node-server.failure')
    return describeNodeServerFailureLine(
      runId,
      String(detail.code),
      String(detail.cause),
    )
  return undefined
}
