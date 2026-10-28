import { ERROR_RECOVERY } from '../errors'

import { cutCauseForDisplay } from './cutCauseForDisplay'

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

/** Where a server run's learning replay stands, beside the run's own state. */
export type NodeServerLearningStatus =
  | {
      kind: 'recording'
      /** The distinct declared stops with at least one recorded hit. */
      reached: number
      declared: number
      responseRecorded: boolean
    }
  | { kind: 'finished' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'partial' }
  /** No history started: storage unavailable, full or refused. */
  | { kind: 'unavailable'; cause: string }
  /** The history could not be written or sealed: the cause is the whole sentence. */
  | { kind: 'failed'; cause: string }

/**
 * Words where a server run stands (`Server starting`, `Listening on :<port>`, `Paused at stop <n> of <m>`, `Paused by you in the debugger`, `Responded <status>`, `Failed: <code>`, `Stopping`, `Stopped`).
 * @param input - The run's state, error and `nodeServer` block.
 * @returns The state words.
 * @example describeNodeServerState({ state: 'responded', nodeServer: { stops: [{}], response: { status: 200 } } }) // => 'Responded 200'
 */
export function describeNodeServerState(input: NodeServerStatusInput): string {
  const block = input.nodeServer
  // A failure, of the run or of its request, outranks the state it left behind.
  if (input.error) return `Failed: ${input.error.code}`
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
  return words[input.state] ?? input.state
}

/**
 * Words the status bar item of a node-server run: the learning replay's state beside where the run stands, so the learner sees what Save does and what is recorded (D11).
 * Called by {@link NodeServerLearningSave.item} for the current server run.
 * @param input - The run's state, error and `nodeServer` block.
 * @param learning - Where the run's learning replay stands.
 * @returns The item's `text` and `tooltip`. A failed run's tooltip starts with the first sentence of the code's recovery and points to Output › Codebook.
 * @example
 * describeNodeServerStatus({ state: 'ready', nodeServer: { address: { port: 4100 }, stops: [{}] } }, { kind: 'unavailable', cause: 'the store is full.' }).text
 * // => 'Listening on :4100 · Learning replay unavailable: the store is full.'
 */
export function describeNodeServerStatus(
  input: NodeServerStatusInput,
  learning: NodeServerLearningStatus,
): { text: string; tooltip: string } {
  const state = describeNodeServerState(input)
  const failureTip = input.error
    ? `${firstRecoverySentence(input.error.code)} See Output › Codebook. `
    : ''
  switch (learning.kind) {
    case 'recording': {
      const answer = learning.responseRecorded
        ? 'a response is recorded'
        : 'no response is recorded yet'
      return {
        text: `$(record) Recording explanation · ${state} · Save learning replay`,
        tooltip: `${failureTip}Save learning replay stops this server run and saves its request, output, executed source, debugger stops and response (${learning.reached} of ${learning.declared} stops recorded; ${answer}).`,
      }
    }
    case 'finished':
      return {
        text: '$(save) Recording finished · Save learning replay',
        tooltip: `${failureTip}Save learning replay saves the sealed server history with the chat's learning material.`,
      }
    case 'saving':
      return {
        text: '$(sync~spin) Saving learning…',
        tooltip: 'Codebook is sealing the server history.',
      }
    case 'saved':
      return {
        text: '$(check) Learning saved · Open replay',
        tooltip:
          'Saved: the server history is complete and the chat explained it. Opens the server replay.',
      }
    case 'partial':
      return {
        text: '$(warning) Learning partially saved · Open replay',
        tooltip:
          'Saved what was recorded. Open replay to inspect it and what is missing.',
      }
    case 'unavailable':
      return {
        text: `${state} · Learning replay unavailable: ${cutCauseForDisplay(learning.cause)}`,
        tooltip: `${failureTip}This server run is not recorded for a learning replay: ${cutCauseForDisplay(learning.cause)}`,
      }
    case 'failed':
      return {
        text: `${state} · ${cutCauseForDisplay(learning.cause)}`,
        tooltip: `${failureTip}${cutCauseForDisplay(learning.cause)} The run is unaffected; what was recorded opens read-only if it can be read.`,
      }
  }
}
