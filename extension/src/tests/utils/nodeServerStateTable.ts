import type { ErrorCode } from '../../errors'
import { StudyError } from '../../errors'
import type { NodeServerState } from '../../runtime'

/** What a call answers in a state: a refusal with its code, or that the call is accepted. */
export type Outcome = ErrorCode | 'accepted'

/**
 * THE STATE × CALL TABLE (Issue #139 task 10, AC 3), the one source of the cell tests below. Rows are the ten states of a node-server run; columns are the calls an agent makes. A cell is the code the call is refused with, or `accepted`.
 *
 * - start (a new key): `BUSY` while any run still owns resources (every state but stopped); accepted once the run is stopped.
 * - http-request (a new key): the order is LEARNER_PAUSED (the learner holds the server: learner-paused, unattributed), then REQUEST_ALREADY_SENT (a request went out: in flight, paused, responded, request-failed, and a stopping or stopped run that sent one), then RUN_NOT_READY (preparing; a run that never sent and is ending). Only `ready` accepts.
 * - continue (the current arguments when the run is paused, otherwise the arguments of the earlier pause): LEARNER_PAUSED first; then STALE_PAUSE for a run that is ending or ended (every pause is historical); then NO_PAUSE when the server is not paused at a declared stop (preparing, ready, in flight, responded, request-failed). Only `paused` accepts.
 * - stop: accepted in every state (idempotent; it cancels a preparation, releases a live run, retries a failed stop and answers the stopped run).
 * - the same key and arguments replay the stored receipt in every state: for start in every row; for http-request in every row after the request went out.
 */
export const STATE_TABLE: readonly {
  state: NodeServerState
  start: Outcome
  httpRequest: Outcome
  continue: Outcome
  stop: Outcome
}[] = [
  {
    state: 'preparing',
    start: 'BUSY',
    httpRequest: 'RUN_NOT_READY',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'ready',
    start: 'BUSY',
    httpRequest: 'accepted',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'request-in-flight',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'paused',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'accepted',
    stop: 'accepted',
  },
  {
    state: 'learner-paused',
    start: 'BUSY',
    httpRequest: 'LEARNER_PAUSED',
    continue: 'LEARNER_PAUSED',
    stop: 'accepted',
  },
  {
    state: 'unattributed',
    start: 'BUSY',
    httpRequest: 'LEARNER_PAUSED',
    continue: 'LEARNER_PAUSED',
    stop: 'accepted',
  },
  {
    state: 'responded',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'request-failed',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'stopping',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'STALE_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'stopped',
    start: 'accepted',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'STALE_PAUSE',
    stop: 'accepted',
  },
]

/** Runs a call and reports `accepted` or the code it was refused with. */
export async function outcomeOf(call: () => unknown): Promise<Outcome> {
  try {
    await call()
    return 'accepted'
  } catch (error) {
    if (error instanceof StudyError) return error.code
    throw error
  }
}
