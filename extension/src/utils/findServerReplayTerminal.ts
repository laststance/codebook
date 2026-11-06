/** The event types that can end a server replay's request story. */
type TerminalType = 'response' | 'request-failed' | 'sign-in' | 'end'

/**
 * Finds the event that closes a server replay: the first response, request failure, failed sign-in or end.
 * A signed-in sign-in is only the first step before the request, so it is never a terminal; a failed one is, as no request follows it.
 * Called by {@link buildServerReplayModel} when it reads a history and by {@link sanitizeServerReplayModel} when it recomputes the terminal from the sanitized events.
 * @param events - The replay events in journal order.
 * @returns The terminal event, or `undefined` when the history ended before any answer.
 * @example findServerReplayTerminal(events)?.type // => 'sign-in' for a failed sign-in
 */
export function findServerReplayTerminal<
  Event extends { type: string; outcome?: string },
>(
  events: readonly Event[],
): Extract<Event, { type: TerminalType }> | undefined {
  return events.find(
    (event): event is Extract<Event, { type: TerminalType }> =>
      event.type === 'response' ||
      event.type === 'request-failed' ||
      (event.type === 'sign-in' && event.outcome === 'failed') ||
      event.type === 'end',
  )
}
