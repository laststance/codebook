import {
  NODE_SERVER_HISTORY_REASON_CODES as CODES,
  NODE_SERVER_MISSING_LIST_LIMIT,
  NODE_SERVER_REQUEST_CAPTURE_LIMIT,
} from './constants'

/** What each partial reason of a server history means for an agent, and what to do about it; keyed by the stable code `captureMissing` lists and the README's troubleshooting table repeats. */
const NODE_SERVER_SAVE_CODE_HELP: readonly {
  code: string
  meaning: string
  action: string
}[] = [
  {
    code: CODES.noResponseRequestFailed,
    meaning: 'The request failed, so there is no response to cite.',
    action:
      'Cite the request-failed entry as the end of the story; start a new run to record a response.',
  },
  {
    code: CODES.noResponseStopped,
    meaning:
      'The run was stopped (by you, the learner or Save) before the server answered.',
    action:
      'Let the run reach its response before saving, or accept a partial replay.',
  },
  {
    code: CODES.noResponseExited,
    meaning: 'The server exited before it answered.',
    action:
      'Read the exit in the run resource; start a new run once the server stays up.',
  },
  {
    code: CODES.noResponseRunFailed,
    meaning: 'The run failed before the server answered.',
    action: 'Read the run resource error; start a new run after the fix.',
  },
  {
    code: CODES.stopNotReached,
    meaning: 'A declared stop was never hit by the request.',
    action: 'Declare stops on lines the request runs, in a new run.',
  },
  {
    code: CODES.snapshotMissing,
    meaning:
      'A stop has no usable debugger snapshot (no frames, scopes or matching top frame).',
    action: 'Start a new run; the replay cannot show values for that stop.',
  },
  {
    code: CODES.sourceUnavailable,
    meaning:
      'The executed source of a stop was not stored (too large, or not captured).',
    action: 'Declare stops in a smaller file in a new run.',
  },
  {
    code: CODES.valueUnavailable,
    meaning: 'A required inspected value could not be read at a stop.',
    action: 'Declare a path that exists at that line, in a new run.',
  },
  {
    code: CODES.appendFailed,
    meaning: 'Writing the history failed after the entry it names.',
    action: 'Tell the learner; check disk space; start a new run.',
  },
  {
    code: CODES.sizeLimit,
    meaning:
      'The history reached its size limit; later events were not recorded.',
    action: 'Declare fewer stops or a quieter server in a new run.',
  },
  {
    code: CODES.captureBudgetExhausted,
    meaning: `More than ${NODE_SERVER_REQUEST_CAPTURE_LIMIT} stop hits happened; later hits were not recorded.`,
    action: 'Declare stops the request hits less often, in a new run.',
  },
  {
    code: CODES.outputTruncated,
    meaning:
      'The server printed more output than the history keeps; later output was dropped.',
    action:
      'The stops and the response are unaffected; no action is needed unless the output matters.',
  },
]

/**
 * Builds the `save` section of `codebook://help/node-server`: the one canonical text for saving a server run as a Server replay (the stop budget, the three verdicts, the codes and one worked example that the doc test validates against the tool's input schema).
 * Called by {@link nodeServerHelp}; the README, the skill and the tool description link here instead of retelling it.
 * @returns The JSON-serializable section.
 * @example nodeServerSaveHelp().example.tool // => 'codebook_explain_node_history'
 */
export function nodeServerSaveHelp() {
  return {
    summary:
      "A node-server run is saved as a Server replay: the learner's Save learning replay, or you through codebook_explain_node_history, keeps the question, summary and sequence beside the recorded request, output, executed source at each stop, debugger values and response. Replaying it never sends the request or starts the server.",
    requires:
      'codebook_status reports API 1.9 or later. On an older API, tell the learner to update Codebook and do not try to save a server explanation.',
    stopBudget: `At most ${NODE_SERVER_REQUEST_CAPTURE_LIMIT} stop hits are recorded per request; a hit beyond that is not recorded and the history reads partial (${CODES.captureBudgetExhausted}).`,
    route: [
      'codebook_continue until the run reads responded or request-failed, then explain the stops in chat as before.',
      'codebook_stop (or the learner presses Save learning replay): the history is sealed. Read nodeServer.history and nodeServer.historyIssue; a history that is unavailable or failed saves nothing.',
      'Read codebook://node-history/<studyId>/events (the study id is runId-bound: nodeServer.historyUri): a lean list of citable events; codebook://node-history/<studyId>/events/<sequence> gives one entry in full.',
      'codebook_explain_node_history with expectedRevision 0 (or the current revision) and content whose steps cite the request, every stop you explained, the response or request failure, and optionally output.',
      'Read the run resource again: claim a saved replay only when nodeServer.learningCoverage is complete and nodeServer.captureMissing is an empty list.',
    ],
    references: [
      { type: 'request', shape: '{ type: "request", sequence }' },
      {
        type: 'stop',
        shape:
          '{ type: "stop", sequence, sourceHash } (the hash of the executed source the stop entry lists)',
      },
      {
        type: 'output',
        shape: '{ type: "output", sequence, channel: "stdout" | "stderr" }',
      },
      { type: 'response', shape: '{ type: "response", sequence }' },
      { type: 'request-failed', shape: '{ type: "request-failed", sequence }' },
    ],
    verdicts: {
      saved:
        'The history is sealed: it is listed in Saved studies and opens as a Server replay.',
      captureComplete: `captureMissing is an empty list: no partial reason holds. A 4xx or 5xx response is a complete capture. captureMissing lists {code, text, params} with the codes below, at most ${NODE_SERVER_MISSING_LIST_LIMIT} plus captureMissingCount.`,
      learningComplete:
        'learningCoverage is complete: the material cites the request, at least one hit of every declared stop that was reached, and the recorded response or request failure. Output and source are optional. learningMissing lists {type, sequence} (a stop also declaredStopIndex and hit).',
    },
    codes: NODE_SERVER_SAVE_CODE_HELP,
    example: {
      tool: 'codebook_explain_node_history',
      arguments: {
        studyId: '<nodeServer.historyUri without codebook://node-history/>',
        expectedRevision: 0,
        content: {
          question: 'How does the server answer the declared request?',
          title: 'The request through the handler',
          summary:
            'Codebook sends the request, the handler stops once, and the server answers.',
          participants: [{ id: 'server', label: 'Server' }],
          steps: [
            {
              id: 'request',
              from: 'server',
              to: 'server',
              label: 'Request',
              explanation: 'Codebook sends the declared request.',
              evidence: 'observed',
              reference: { type: 'request', sequence: 1 },
            },
            {
              id: 'stop-1',
              from: 'server',
              to: 'server',
              label: 'Handler stop',
              explanation:
                'The handler is paused with the values recorded here.',
              evidence: 'observed',
              reference: {
                type: 'stop',
                sequence: 4,
                sourceHash: '<sourceHash of that stop entry>',
              },
            },
            {
              id: 'response',
              from: 'server',
              to: 'server',
              label: 'Response',
              explanation: 'The server answers with the recorded status.',
              evidence: 'observed',
              reference: { type: 'response', sequence: 6 },
            },
          ],
        },
      },
      successCheck:
        'The answer carries the new revision. Read the run resource: nodeServer.learningCoverage complete and nodeServer.captureMissing empty means saved and complete.',
      conflictFix:
        'IDEMPOTENCY_CONFLICT names the current revision: re-read the learning material, retry once with that revision. INVALID_REFERENCE names the citation and the nearest valid sequences: re-read the history events, correct the citation, retry once.',
    },
  }
}
