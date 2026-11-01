import {
  EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
  EXTENSION_HISTORY_REASON_CODES,
  EXTENSION_HISTORY_STILL_RECORDING_TEXT,
  NODE_SERVER_MISSING_LIST_LIMIT,
} from './constants'

/** One code of a chrome-extension history, as the `save` section words it for an agent. */
interface ExtensionSaveCodeHelp {
  /** What the code says about the history. */
  meaning: string
  /** What the history keeps despite it. */
  evidenceKept: string
  /** What to do and tell the learner. */
  action: string
  /** Whether saving again can recover the missing part; false wherever a part was never recorded. */
  retryHelps: boolean
  /** Where the code is listed: `captureMissing` of the run resource, or only the Saved studies listing. */
  listedIn: 'captureMissing' | 'saved-studies-listing'
}

/**
 * What each code of {@link EXTENSION_HISTORY_REASON_CODES} means for an agent, keyed by the constant's own key so a code added there fails to compile here until it is worded.
 * Saving again never recovers a part that was not recorded: the saved part stays replayable, and only a new run records it.
 */
const EXTENSION_SAVE_CODE_HELP: Record<
  keyof typeof EXTENSION_HISTORY_REASON_CODES,
  ExtensionSaveCodeHelp
> = {
  filmstripMissing: {
    meaning:
      'Some frames of the surface filmstrip were not recorded (the screenshot failed, was too slow or was dropped when the history ended).',
    evidenceKept:
      'Every stop, pause, click and the result, and the frames that were recorded.',
    action:
      'Tell the learner the replay shows no picture between some moments; start a new run only if the missing frames matter.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  pinnedFrameMissing: {
    meaning:
      'The live run captured the surface frame pinned at a pause, but the history could not keep it (the frame budget, the history already finalizing, or a failed write). The stop still replays with the last recorded frame and its distance from the stop; saving again cannot recover it.',
    evidenceKept:
      'The pause, its captured values, the source at the stop and the filmstrip frames.',
    action:
      'Cite the stop and the last recorded frame with its distance label; start a new run only if the exact pause frame matters.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  snapshotMissing: {
    meaning:
      'A stop has no usable debugger snapshot (no frames, scopes or matching top frame).',
    evidenceKept: 'The click and the other stops.',
    action: 'Do not cite values for that stop; start a new run to record them.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  sourceUnavailable: {
    meaning: 'The executed source of a stop was not stored.',
    evidenceKept: 'The stop and its values.',
    action: 'Declare stops in a smaller file in a new run.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  sizeLimit: {
    meaning: `The history reached its size limit (${EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES} bytes of events, snapshots and sources); later entries were not recorded.`,
    evidenceKept: 'Everything recorded before the limit.',
    action: 'Declare fewer stops or fewer clicks in a new run.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  surfaceEnded: {
    meaning: 'The extension surface or the browser ended before the run did.',
    evidenceKept: 'Everything recorded until it ended.',
    action:
      'Read the run resource error; start a new run once the surface stays open.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  stopNotReached: {
    meaning: 'A declared stop never paused.',
    evidenceKept: 'The other stops and the result.',
    action:
      'Declare stops on lines the clicks run after the page loaded, in a new run.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  resultMissing: {
    meaning: 'The run ended before its observed result was read.',
    evidenceKept: 'The clicks and the stops.',
    action:
      'Do not claim a result; start a new run to record it. The saved part stays replayable.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  appendFailed: {
    meaning: 'Writing the history failed after the entry it names.',
    evidenceKept: 'The entries written before the failure.',
    action: 'Tell the learner; check disk space; start a new run.',
    retryHelps: false,
    listedIn: 'captureMissing',
  },
  formatNewer: {
    meaning: 'A newer Codebook recorded the history.',
    evidenceKept: 'All of it, unchanged on disk.',
    action:
      'Tell the learner to update Codebook; Saved studies lists the replay once this version can read it.',
    retryHelps: true,
    listedIn: 'saved-studies-listing',
  },
  frameDamaged: {
    meaning: 'A frame file of the filmstrip is damaged on disk.',
    evidenceKept: 'The events and the other frames.',
    action:
      'The replay shows that moment without a picture; start a new run to record it again.',
    retryHelps: false,
    listedIn: 'saved-studies-listing',
  },
}

/**
 * Builds the `save` section of `codebook://help/chrome-extension`: the one canonical text for saving a chrome-extension run as an Extension replay (the route, the references, the verdicts, one row per history code and one worked example that a doc test parses with the material schema).
 * Called by {@link chromeExtensionHelp}; the README and the skill link here instead of retelling it.
 * @returns The JSON-serializable section.
 * @example chromeExtensionSaveHelp().example.tool // => 'codebook_explain_node_history'
 */
export function chromeExtensionSaveHelp() {
  return {
    summary:
      "A chrome-extension run is recorded while it runs and saved as an Extension replay: the learner's Save learning replay, or you through codebook_explain_node_history, keeps the question, summary and sequence beside the recorded clicks, stops, captured values, executed source, surface frames and result. Replaying it never clicks anything and never loads the extension.",
    requires:
      'codebook_status reports API 1.13 or later (compare the number after the dot as a whole number: 1.13 is later than 1.9). On an older API, tell the learner to update Codebook and do not try to save an extension explanation.',
    historyByteLimit: `${EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES} bytes of events, snapshots and sources per history (frame files are apart); past it later entries are not recorded and the history reads partial (${EXTENSION_HISTORY_REASON_CODES.sizeLimit}).`,
    route: [
      'Explain each stop in chat as before, then codebook_stop after the last explained click: the history is sealed. Read chromeExtension.history and chromeExtension.historyIssue; a history that is unavailable or failed saves nothing, so say why.',
      'Read the events at chromeExtension.historyUri (a lean list of citable entries; one entry in full is its own resource).',
      'codebook_explain_node_history with expectedRevision 0 (or the current revision) and content whose steps cite every stop you explained (with its sourceHash and context), a pause you rely on, and the result.',
      'Read the run resource again: chromeExtension.learningCoverage and chromeExtension.learningMissing say what the material still lacks; add it and save again with the revision the answer names.',
      'Claim a saved replay only when chromeExtension.learningCoverage is complete and chromeExtension.captureMissing is an empty list; then tell the learner that Open replay or Saved studies opens it.',
    ],
    references: [
      {
        type: 'stop',
        shape:
          '{ type: "stop", sequence, sourceHash, context, targetUrl?, workerGeneration? } (sequence of the capture entry; sourceHash of the executed source that entry lists, 64 hex characters; context page or service-worker, required because a page stop and a service-worker stop may share one source location)',
      },
      {
        type: 'pause',
        shape:
          '{ type: "pause", sequence, context, targetUrl?, workerGeneration? }',
      },
      { type: 'result', shape: '{ type: "result", sequence }' },
    ],
    verdicts: {
      saved:
        'The history is sealed: it is listed in Saved studies and opens as an Extension replay.',
      captureComplete: `captureMissing is an empty list: no partial reason holds. captureMissing lists {code, text, params} with the codes below, at most ${NODE_SERVER_MISSING_LIST_LIMIT} plus captureMissingCount.`,
      learningComplete:
        'learningCoverage is complete: the material cites every captured stop that was reached and the result. learningMissing lists what it still lacks.',
      claimRule:
        'Say a saved replay exists only when learningCoverage is complete and captureMissing is empty; otherwise name each missing part and what would add it.',
    },
    codes: Object.entries(EXTENSION_HISTORY_REASON_CODES).map(
      ([key, code]) => ({
        code,
        ...EXTENSION_SAVE_CODE_HELP[
          key as keyof typeof EXTENSION_HISTORY_REASON_CODES
        ],
      }),
    ),
    refusals: [
      {
        code: 'HISTORY_STILL_RECORDING',
        meaning: EXTENSION_HISTORY_STILL_RECORDING_TEXT,
        action:
          'Stop the run with codebook_stop, then save once. Nothing was saved and the run goes on.',
        retryHelps: true,
      },
      {
        code: 'EVIDENCE_UNAVAILABLE',
        meaning:
          'The run has no history (storage unavailable or a refused or slow history start); the answer names the cause, also in chromeExtension.historyIssue.',
        action:
          'Keep the explanation in the chat and say nothing was saved; start a new run when the cause is fixed.',
        retryHelps: false,
      },
      {
        code: 'PREREQUISITE_MISSING',
        meaning:
          'The study library is full ("Study library is full…"): a new run is refused at codebook_start, and a save into a full library is refused; existing learning is kept.',
        action:
          'Only the learner can raise Codebook: Saved Study Limit or delete a saved study from Saved studies; an editor agent cannot. Retry after the learner made room.',
        retryHelps: true,
      },
    ],
    example: {
      tool: 'codebook_explain_node_history',
      arguments: {
        studyId:
          '<chromeExtension.historyUri without codebook://node-history/>',
        expectedRevision: 0,
        content: {
          question: 'What does the popup button do?',
          title: 'The popup button through the worker',
          summary:
            'The popup sends a message, the service worker answers it, and the popup shows the answer.',
          participants: [{ id: 'extension', label: 'Extension' }],
          steps: [
            {
              id: 'stop-1',
              from: 'extension',
              to: 'extension',
              label: 'Popup stop',
              explanation:
                'The popup script is paused before it sends the message.',
              evidence: 'observed',
              reference: {
                type: 'stop',
                sequence: 4,
                sourceHash: '0'.repeat(64),
                context: 'page',
              },
            },
            {
              id: 'stop-2',
              from: 'extension',
              to: 'extension',
              label: 'Worker stop',
              explanation: 'The service worker is paused as it receives it.',
              evidence: 'observed',
              reference: {
                type: 'stop',
                sequence: 7,
                sourceHash: '0'.repeat(64),
                context: 'service-worker',
              },
            },
            {
              id: 'result',
              from: 'extension',
              to: 'extension',
              label: 'Result',
              explanation: 'The popup shows the recorded answer.',
              evidence: 'observed',
              reference: { type: 'result', sequence: 9 },
            },
          ],
        },
      },
      successCheck:
        'The answer carries the new revision. Read the run resource: chromeExtension.learningCoverage complete and chromeExtension.captureMissing empty means saved and complete.',
      conflictFix:
        'IDEMPOTENCY_CONFLICT names the current revision: re-read the learning material, retry once with that revision. INVALID_REFERENCE names the citation and the nearest valid sequences: re-read the history events, correct the citation, retry once.',
    },
  }
}
