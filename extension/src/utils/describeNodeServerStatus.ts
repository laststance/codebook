import { ERROR_RECOVERY } from '../errors'

/** What the status item says beside every state: server runs have no replay yet. */
const NO_REPLAY_TEXT = 'Learning replay is not available for server runs yet'

/** What the status item's tooltip says beside every state: nothing of a server run is saved. */
const NOT_SAVED_TOOLTIP =
  'Server runs are not saved yet: there is no study to save and no replay to open for this run.'

/** What {@link describeNodeServerStatus} reads of a server run's state ({@link StudyService.state}). */
export type NodeServerStatusInput = {
  state: string
  error?: { code: string } | undefined
  nodeServer?:
    | {
        address?: { port: number } | undefined
        stops: readonly unknown[]
        pause?: { stopNumber: number } | undefined
        response?: { status: number } | undefined
      }
    | undefined
}

/**
 * Takes the first sentence of an error's recovery, which names the fix, for a tooltip.
 * @param code - The error code.
 * @returns The recovery up to and including its first sentence end; the whole recovery when it has one sentence; an empty text for a code without recovery.
 * @example firstRecoverySentence('RUN_NOT_READY') // => 'Read the run until its state is ready and its nextActions list http-request, then send the request once.'
 */
function firstRecoverySentence(code: string): string {
  const recovery =
    Object.entries(ERROR_RECOVERY).find(([name]) => name === code)?.[1] ?? ''
  return /^.*?[.!?](?=\s|$)/s.exec(recovery)?.[0] ?? recovery
}

/**
 * Words the status bar item of a node-server run: where the run stands, always beside the fact that server runs have no replay yet, and never as saved (D11).
 * Called by {@link StudyWorkspace} each time it draws the item for the current run.
 * @param input - The run's state, error and `nodeServer` block.
 * @returns The item's `text` and `tooltip`: `Server starting`, `Listening on :<port>`, `Paused at stop <n> of <m>`, `Paused by you in the debugger`, `Responded <status>`, `Failed: <code>` (its tooltip: the first sentence of the code's recovery and a pointer to Output › Codebook), `Stopping` or `Stopped`, each followed by ` · Learning replay is not available for server runs yet`.
 * @example
 * describeNodeServerStatus({ state: 'responded', nodeServer: { stops: [{}, {}], response: { status: 200 } } }).text
 * // => 'Responded 200 · Learning replay is not available for server runs yet'
 */
export function describeNodeServerStatus(input: NodeServerStatusInput): {
  text: string
  tooltip: string
} {
  const block = input.nodeServer
  // A failure, of the run or of its request, outranks the state it left behind.
  if (input.error)
    return {
      text: `Failed: ${input.error.code} · ${NO_REPLAY_TEXT}`,
      tooltip: `${firstRecoverySentence(input.error.code)} See Output › Codebook. ${NOT_SAVED_TOOLTIP}`,
    }
  const words: Record<string, string> = {
    preparing: 'Server starting',
    ready: `Listening on :${block?.address?.port ?? ''}`,
    'request-in-flight': `Listening on :${block?.address?.port ?? ''}`,
    paused: `Paused at stop ${block?.pause?.stopNumber ?? ''} of ${block?.stops.length ?? ''}`,
    'learner-paused': 'Paused by you in the debugger',
    unattributed: 'Paused by you in the debugger',
    responded: `Responded ${block?.response?.status ?? ''}`,
    stopping: 'Stopping',
    stopped: 'Stopped',
  }
  return {
    text: `${words[input.state] ?? input.state} · ${NO_REPLAY_TEXT}`,
    tooltip: `Codebook server run: ${input.state}. ${NOT_SAVED_TOOLTIP}`,
  }
}
