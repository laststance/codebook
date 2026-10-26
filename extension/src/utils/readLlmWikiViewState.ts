import {
  LLM_WIKI_RESERVATION_MESSAGE,
  LLM_WIKI_ROW_ACTIONS,
  LLM_WIKI_WATCHING_MESSAGE,
  MS_PER_MINUTE,
  OPEN_DEEP_WIKI_COMMAND,
  SHOW_LLM_WIKI_ATTENTION_COMMAND,
  WIKI_UPDATE_REASON_LIMIT_CHARS,
} from '../constants'

import { describeMinutes } from './describeMinutes'
import { describeWikiFreshness } from './describeWikiFreshness'
import {
  describeWikiGeneration,
  type WikiGeneration,
} from './describeWikiGeneration'
import { formatClockTime } from './formatClockTime'
import type { WikiRunKind, WikiUpdateHost } from './wikiUpdateRun'

/** The key of one inline action of a row ({@link LLM_WIKI_ROW_ACTIONS}); the manifest shows the command of each key on the rows whose context value names it. */
export type LlmWikiRowActionKey = keyof typeof LLM_WIKI_ROW_ACTIONS

/** The stable id of a row, kept across changes of its label so the editor keeps the selection (accessibility). */
export type LlmWikiRowId =
  | 'wiki'
  | 'run'
  | 'elsewhere'
  | 'reservation'
  | 'last-attempt'
  | 'attention'
  | 'output'
  | 'folder'
  | 'trust'
  | 'loading'
  | 'error'

/** The rows that show a run, whoever owns it: while one stands the view reads its state again on a timer, and the Wiki row offers no Update. */
export const LLM_WIKI_RUN_ROW_IDS: ReadonlySet<LlmWikiRowId> = new Set([
  'run',
  'elsewhere',
  'reservation',
])

/** The rows that show a start was waiting for a chat or a generation ended unpublished: a publication that follows them is a late one. */
export const LLM_WIKI_WAITING_ROW_IDS: ReadonlySet<LlmWikiRowId> = new Set([
  'reservation',
  'last-attempt',
])

/** One row of the LLM Wiki view, as plain data: the view turns it into a tree item. */
export type LlmWikiRow = {
  id: LlmWikiRowId
  label: string
  /** The grey text after the label; it may truncate in a narrow sidebar. */
  description?: string
  /** The text of the hover; it holds the full text when the description is short. */
  tooltip?: string
  /** A theme icon's id (a codicon), for example `book` or `sync~spin`. */
  icon: string
  /** The command a click on the row runs, with the row's id as its argument where the command shows the row's sentence. */
  command?: { command: string; arguments?: string[] }
  /** The inline actions of the row, also in its context menu. */
  actions: LlmWikiRowActionKey[]
  /** The full sentence of an attention or last-attempt row, shown by {@link SHOW_LLM_WIKI_ATTENTION_COMMAND}. */
  detail?: string
}

/** What the view shows: `none` when the folder holds no Wiki and no run (the welcome content shows), `other` for every row; the view adds `loading` before its first read. */
export type LlmWikiViewModel = {
  state: 'none' | 'other'
  rows: LlmWikiRow[]
  /** The wrapping message above the tree; set while a VS Code watch is shown. */
  message?: string
}

/** How fresh the published Wiki is: still being checked, or the answer of the freshness check. */
export type LlmWikiFreshness =
  | { status: 'checking' }
  | {
      status: 'current' | 'changed' | 'unknown'
      reason?: string
      isAdditionUnchecked?: boolean
    }

/** Why a generation of this window ended without a publication. */
export type LlmWikiStoppedGeneration = {
  state: 'cancelled' | 'timed-out' | 'failed' | 'conflict'
  host: WikiUpdateHost
  /** The bound a `timed-out` end passed (ms). */
  timeoutMs?: number
  /** The exit code of the Cursor agent's process, where it ended on its own. */
  agentExitCode?: number
  /** The full sentence the editor told ({@link wikiGenerateNotice}). */
  sentence: string
}

/** Everything the view's rows are made of, read once; {@link readLlmWikiViewState} turns it into rows. */
export type LlmWikiViewFacts =
  | { kind: 'no-folder' }
  | { kind: 'untrusted' }
  | {
      kind: 'ready'
      /** The editor this window runs in. */
      host: WikiUpdateHost
      /** The absolute opened project folder the Wiki output belongs to; the freshness check inspects this project and no other. */
      projectRoot: string
      repositoryName: string
      /** The output folder as the learner reads it ({@link wikiOutputLabel}). */
      outputLabel: string
      /** The absolute resolved output folder. */
      outputDirectory: string
      /** Set when the file watcher could not be made, so the view refreshes on visibility and its Refresh only. */
      isWatcherBroken?: true
      nowMs: number
      /** The publisher's receipt that names the manifest now on disk; the view compares it between reads to notice a late publication. Absent while the folder holds none. */
      publication?: string
      /** A published Wiki that reads as a Wiki of this project. */
      wiki?: { freshness: LlmWikiFreshness; generation: WikiGeneration }
      /** This window's run. `isAwaitingChat` marks a VS Code run that still waits for the chat's first sign. */
      run?: {
        kind: WikiRunKind
        startedAtMs: number
        timeoutMs: number
        isAwaitingChat: boolean
      }
      /** A live marker of another window; `kind` is absent while the marker is being written. */
      elsewhere?: { kind?: WikiRunKind; startedAtMs: number }
      /** The reservation of a stopped VS Code watch, from any window. */
      reservation?: {
        kind?: WikiRunKind
        host: WikiUpdateHost
        startedAtMs: number
        retryAtMs: number
      }
      lastAttempt?: LlmWikiStoppedGeneration
      /** A start block, or a manifest that cannot be used; `cause` is a conflict cause, `foreign-manifest`, or one a later version adds. */
      attention?: { cause: string; sentence: string }
    }

/** How the rows write times and dates; tests pass fixed ones. */
export type LlmWikiViewWording = {
  formatTime: (epochMs: number) => string
  formatDate: (epochMs: number) => string
}

/** The wording the view reads in the editor's locale. */
const LOCAL_WORDING: LlmWikiViewWording = {
  formatTime: (epochMs) => formatClockTime(epochMs),
  formatDate: (epochMs) => new Date(epochMs).toLocaleDateString(),
}

/** How an attention cause is worded and what its row offers (the plan's attention table). */
type AttentionRow = {
  label: string
  shortCause: string
  actions: LlmWikiRowActionKey[]
  /** Whether the cause leaves the manifest unusable, so the Wiki row is not shown. */
  hidesWiki: boolean
}

/** The attention row of every cause of a start block and of a foreign manifest. */
const ATTENTION_ROWS = new Map<string, AttentionRow>([
  [
    'held-publish-lock',
    {
      label: 'Publish in progress or stopped',
      shortCause: 'publish lock found',
      actions: ['copy-recovery', 'refresh'],
      hidesWiki: false,
    },
  ],
  [
    'unfinished-publish',
    {
      label: 'Publish in progress or stopped',
      shortCause: 'unfinished publish',
      actions: ['copy-recovery', 'refresh'],
      hidesWiki: false,
    },
  ],
  [
    'edited-manifest',
    {
      label: 'Wiki manifest needs recovery',
      shortCause: 'manifest edited',
      actions: ['copy-recovery', 'refresh'],
      hidesWiki: true,
    },
  ],
  [
    'unreadable-manifest',
    {
      label: 'Wiki manifest needs recovery',
      shortCause: 'manifest unreadable',
      actions: ['copy-recovery', 'refresh'],
      hidesWiki: true,
    },
  ],
  [
    'not-a-folder',
    {
      label: 'Wiki folder belongs elsewhere',
      shortCause: 'output is a file or link',
      actions: ['change-location'],
      hidesWiki: true,
    },
  ],
  [
    'linked-parent',
    {
      label: 'Wiki folder belongs elsewhere',
      shortCause: 'link on the folder path',
      actions: ['change-location'],
      hidesWiki: true,
    },
  ],
  [
    'foreign-manifest',
    {
      label: 'Wiki folder belongs elsewhere',
      shortCause: 'another checkout',
      actions: ['change-location'],
      hidesWiki: true,
    },
  ],
  [
    'learner-file',
    {
      label: 'Wiki files changed by hand',
      shortCause: 'your file is in the folder',
      actions: ['reveal-folder', 'refresh'],
      hidesWiki: false,
    },
  ],
  [
    'special-file',
    {
      label: 'Wiki files changed by hand',
      shortCause: 'link or special file',
      actions: ['reveal-folder', 'refresh'],
      hidesWiki: false,
    },
  ],
  [
    'edited-page',
    {
      label: 'Wiki files changed by hand',
      shortCause: 'page edited by hand',
      actions: ['reveal-folder', 'refresh'],
      hidesWiki: false,
    },
  ],
  [
    'missing-page',
    {
      label: 'Wiki files changed by hand',
      shortCause: 'page missing',
      actions: ['reveal-folder', 'refresh'],
      hidesWiki: false,
    },
  ],
])

/** What a cause added later without a row of its own falls back to: its own sentence, and a way to look again. */
const FALLBACK_ATTENTION_ROW: AttentionRow = {
  label: 'Wiki needs attention',
  shortCause: 'see details',
  actions: ['refresh'],
  hidesWiki: false,
}

/** The row of a view that reads its state for the first time. */
export const LLM_WIKI_LOADING_ROW: LlmWikiRow = {
  id: 'loading',
  label: 'Reading the LLM Wiki state…',
  icon: 'loading~spin',
  actions: [],
}

/** The row of a view whose read threw: the cause is in Output › Codebook, and Refresh retries. */
export const LLM_WIKI_ERROR_ROW: LlmWikiRow = {
  id: 'error',
  label: 'Could not read the LLM Wiki state',
  description: 'Refresh to retry',
  tooltip:
    'The cause is written to Output › Codebook. The Refresh action in the title bar reads the state again.',
  icon: 'error',
  command: { command: LLM_WIKI_ROW_ACTIONS['show-output'].command },
  actions: [],
}

/** Words a run kind as the progress word of a row's label. @example runWord('generate') // => 'Generating' */
function runWord(kind: WikiRunKind | undefined): string {
  return kind === 'generate' ? 'Generating' : 'Updating'
}

/** Names an editor host as the learner knows it. @example hostName('vscode') // => 'VS Code' */
function hostName(host: WikiUpdateHost): string {
  return host === 'cursor' ? 'Cursor' : 'VS Code'
}

/** Counts the whole minutes of a duration with one rule for every number of a row, so `N min of M` rounds both numbers alike. @example wholeMinutes(750_000) // => 12 */
function wholeMinutes(durationMs: number): number {
  return Math.max(0, Math.floor(durationMs / MS_PER_MINUTE))
}

/**
 * Builds row 1, the published Wiki: its label, the shared freshness wording and the generation line of the tooltip.
 * @param facts - The ready facts that hold a Wiki.
 * @param wiki - The published Wiki.
 * @param wording - How times and dates are written.
 * @param hasRunRow - Whether a run row stands, which hides the Update action.
 * @returns The Wiki row.
 * @example wikiRow(facts, wiki, wording, false).description // => 'Wiki source current'
 */
function wikiRow(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  wiki: NonNullable<Extract<LlmWikiViewFacts, { kind: 'ready' }>['wiki']>,
  wording: LlmWikiViewWording,
  hasRunRow: boolean,
): LlmWikiRow {
  const freshness = wiki.freshness
  const description =
    freshness.status === 'checking'
      ? 'Checking freshness…'
      : describeWikiFreshness(
          freshness.status,
          freshness.reason ?? '',
          freshness.isAdditionUnchecked ?? false,
          WIKI_UPDATE_REASON_LIMIT_CHARS,
        )
  const generationLine = describeWikiGeneration(
    wiki.generation,
    wording.formatDate,
  )
  const reasonLine =
    freshness.status === 'unknown' ? freshness.reason : undefined
  // The description truncates in a narrow sidebar, so the caveat is also said in full here.
  const additionLine =
    freshness.status !== 'checking' && freshness.isAdditionUnchecked
      ? 'No Git revision is recorded for this Wiki, so added files are not checked.'
      : undefined
  return {
    id: 'wiki',
    label: `${facts.repositoryName} Wiki`,
    description,
    tooltip: [
      generationLine,
      reasonLine,
      additionLine,
      'Click to open the Wiki in the browser.',
    ]
      .filter((line) => line !== undefined && line !== '')
      .join('\n'),
    icon: 'book',
    command: { command: OPEN_DEEP_WIKI_COMMAND },
    actions: hasRunRow ? [] : ['update'],
  }
}

/**
 * Builds row 2, this window's run, with the actions that fit its host.
 * @param facts - The ready facts that hold a run.
 * @param run - This window's run.
 * @returns The run row: Stop watching, Open Chat and Show Output in VS Code; Cancel and Show Output in Cursor.
 * @example runRow(facts, run).label // => 'Generating…'
 */
function runRow(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  run: NonNullable<Extract<LlmWikiViewFacts, { kind: 'ready' }>['run']>,
): LlmWikiRow {
  const isCursor = facts.host === 'cursor'
  // A start that could not be read leaves the minutes out rather than showing NaN.
  const progress = Number.isFinite(run.startedAtMs)
    ? ` · ${wholeMinutes(facts.nowMs - run.startedAtMs)} min of ${wholeMinutes(run.timeoutMs)}`
    : ''
  let description: string
  if (isCursor) description = `cursor-agent${progress}`
  else if (run.isAwaitingChat) description = 'Waiting for the chat to start'
  else description = `In chat${progress}`
  return {
    id: 'run',
    label: `${runWord(run.kind)}…`,
    description,
    tooltip: isCursor
      ? 'Cursor Agent is writing the Wiki. Cancel stops it.'
      : 'Codebook is watching the chat for the new Wiki. Stop watching ends Codebook’s watch, not the chat.',
    icon: 'sync~spin',
    actions: isCursor
      ? ['cancel-run', 'show-output']
      : ['stop-watching', 'open-chat', 'show-output'],
  }
}

/**
 * Builds row 2b, a run of another window.
 * @param elsewhere - The other window's marker.
 * @param wording - How times are written.
 * @returns The row; a marker still being written reads as a start.
 * @example elsewhereRow({ kind: 'generate', startedAtMs: 1_790_000_000_000 }, wording).label // => 'Generating in another window'
 */
function elsewhereRow(
  elsewhere: NonNullable<
    Extract<LlmWikiViewFacts, { kind: 'ready' }>['elsewhere']
  >,
  wording: LlmWikiViewWording,
): LlmWikiRow {
  return {
    id: 'elsewhere',
    label:
      elsewhere.kind === undefined
        ? 'Starting in another window'
        : `${runWord(elsewhere.kind)} in another window`,
    description: Number.isFinite(elsewhere.startedAtMs)
      ? `since ${wording.formatTime(elsewhere.startedAtMs)}`
      : undefined,
    icon: 'sync~spin',
    actions: [],
  }
}

/**
 * Builds row 2c, the reservation a stopped VS Code watch left.
 * @param facts - The ready facts that hold a reservation.
 * @param reservation - The reservation.
 * @param wording - How times are written.
 * @returns The row, with the retry time in its description and the run's start in its tooltip.
 * @example reservationRow(facts, reservation, wording).label // => 'Waiting for chat'
 */
function reservationRow(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  reservation: NonNullable<
    Extract<LlmWikiViewFacts, { kind: 'ready' }>['reservation']
  >,
  wording: LlmWikiViewWording,
): LlmWikiRow {
  const retryTime = wording.formatTime(reservation.retryAtMs)
  // The countdown rounds up so the learner never retries early, and never reads 0.
  const minutesLeft = Math.max(
    1,
    Math.ceil((reservation.retryAtMs - facts.nowMs) / MS_PER_MINUTE),
  )
  const startedAt = Number.isFinite(reservation.startedAtMs)
    ? ` at ${wording.formatTime(reservation.startedAtMs)}`
    : ''
  return {
    id: 'reservation',
    label: 'Waiting for chat',
    description: `retry after ${retryTime} (about ${minutesLeft} min)`,
    tooltip: `${runWord(reservation.kind)} started${startedAt} in ${hostName(reservation.host)}. Open Chat opens the chat view; find the session in the chat history to stop it. Codebook allows a new start after ${retryTime} even if the chat stopped earlier.`,
    icon: 'clock',
    actions: ['open-chat'],
  }
}

/** Says in a few words how a generation ended without a publication. @example describeStoppedCause({ state: 'timed-out', host: 'cursor', timeoutMs: 3_300_000, sentence: '' }) // => 'stopped after 55 minutes' */
function describeStoppedCause(stopped: LlmWikiStoppedGeneration): string {
  if (stopped.state === 'cancelled')
    return stopped.host === 'cursor' ? 'cancelled' : 'stopped watching'
  if (stopped.state === 'timed-out')
    return `stopped after ${describeMinutes(stopped.timeoutMs ?? 0)}`
  if (stopped.state === 'conflict') return 'files in the way'
  return stopped.agentExitCode === undefined
    ? 'no Wiki published'
    : `agent exit ${stopped.agentExitCode}`
}

/**
 * Builds row 3, the generation of this window that ended without a publication.
 * @param stopped - How it ended.
 * @param isTryAgainOffered - Whether Try again is offered: not while a run or an attention row stands.
 * @returns The row; a click shows its full sentence.
 * @example lastAttemptRow({ state: 'failed', host: 'cursor', agentExitCode: 1, sentence: '…' }, true).description // => 'agent exit 1'
 */
function lastAttemptRow(
  stopped: LlmWikiStoppedGeneration,
  isTryAgainOffered: boolean,
): LlmWikiRow {
  return {
    id: 'last-attempt',
    label: 'Last generation stopped',
    description: describeStoppedCause(stopped),
    tooltip: stopped.sentence,
    icon: 'info',
    command: {
      command: SHOW_LLM_WIKI_ATTENTION_COMMAND,
      arguments: ['last-attempt'],
    },
    actions: isTryAgainOffered ? ['try-again'] : [],
    detail: stopped.sentence,
  }
}

/**
 * Finds how a cause is worded and what its row offers, with the fallback for a cause added later.
 * @param cause - The cause of a start block, a foreign manifest or a later version's cause.
 * @returns The cause's attention row, or {@link FALLBACK_ATTENTION_ROW}.
 * @example attentionRowOf('edited-page').label // => 'Wiki files changed by hand'
 */
function attentionRowOf(cause: string): AttentionRow {
  return ATTENTION_ROWS.get(cause) ?? FALLBACK_ATTENTION_ROW
}

/**
 * Builds row 4, what blocks a start or makes the manifest unusable.
 * @param attention - The cause and the sentence of the block.
 * @returns The row; a click shows the sentence with Copy details.
 * @example attentionRow({ cause: 'edited-page', sentence: '…' }).label // => 'Wiki files changed by hand'
 */
function attentionRow(
  attention: NonNullable<
    Extract<LlmWikiViewFacts, { kind: 'ready' }>['attention']
  >,
): LlmWikiRow {
  const row = attentionRowOf(attention.cause)
  return {
    id: 'attention',
    label: row.label,
    description: row.shortCause,
    tooltip: attention.sentence,
    icon: 'warning',
    command: {
      command: SHOW_LLM_WIKI_ATTENTION_COMMAND,
      arguments: ['attention'],
    },
    actions: row.actions,
    detail: attention.sentence,
  }
}

/**
 * Builds the rows of a ready view in the fixed order: Wiki, run, elsewhere, reservation, last attempt, attention.
 * @param facts - The ready facts.
 * @param wording - How times and dates are written.
 * @returns The rows before the Output row; empty when the folder holds no Wiki and no run.
 * @example readyRows(facts, wording).map((row) => row.id) // => ['wiki']
 */
function readyRows(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  wording: LlmWikiViewWording,
): LlmWikiRow[] {
  const hasRunRow = Boolean(facts.run || facts.elsewhere || facts.reservation)
  const attentionRowOfCause = facts.attention
    ? attentionRowOf(facts.attention.cause)
    : undefined
  // A cause that leaves the manifest unusable takes the Wiki row away; the other causes leave the published Wiki readable.
  const isWikiShown = Boolean(facts.wiki) && !attentionRowOfCause?.hidesWiki
  const rows: LlmWikiRow[] = []
  if (facts.wiki && isWikiShown)
    rows.push(wikiRow(facts, facts.wiki, wording, hasRunRow))
  if (facts.run) rows.push(runRow(facts, facts.run))
  if (facts.elsewhere) rows.push(elsewhereRow(facts.elsewhere, wording))
  if (facts.reservation)
    rows.push(reservationRow(facts, facts.reservation, wording))
  // A publication ends the last attempt: the Wiki row stands instead.
  if (facts.lastAttempt && !isWikiShown)
    rows.push(lastAttemptRow(facts.lastAttempt, !hasRunRow && !facts.attention))
  if (facts.attention) rows.push(attentionRow(facts.attention))
  return rows
}

/**
 * Builds row 5, the output folder and its Change location action.
 * @param facts - The ready facts.
 * @returns The Output row; its tooltip says so when the file watcher could not be made.
 * @example outputRow(facts).label // => 'Output: .codebook/wiki'
 */
function outputRow(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
): LlmWikiRow {
  return {
    id: 'output',
    label: `Output: ${facts.outputLabel}`,
    description: 'Change location',
    tooltip: facts.isWatcherBroken
      ? `${facts.outputDirectory}\nCodebook could not watch this folder, so the view refreshes when it is shown and with Refresh only.`
      : facts.outputDirectory,
    icon: 'folder',
    // A click on the row changes the location too, so its description reads as the row's own action.
    command: { command: LLM_WIKI_ROW_ACTIONS['change-location'].command },
    actions: ['change-location'],
  }
}

/**
 * Chooses the wrapping message above the LLM Wiki view's rows in VS Code, where the description of a row may be cut off.
 * @param facts - The ready facts.
 * @returns
 * - This window's run: the watching message (Stop watching does not stop the chat)
 * - Only a stopped watch's reservation: that Codebook stopped watching and the chat may still publish
 * - Cursor, or neither: no message
 * @example watchMessageOf({ ...facts, host: 'vscode', run: undefined, reservation }) // => { message: 'Codebook stopped watching the chat, …' }
 */
function watchMessageOf(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
): Pick<LlmWikiViewModel, 'message'> {
  if (facts.host !== 'vscode') return {}
  // A run is a watch Codebook still keeps; a reservation alone is what a stopped watch left.
  if (facts.run) return { message: LLM_WIKI_WATCHING_MESSAGE }
  if (facts.reservation) return { message: LLM_WIKI_RESERVATION_MESSAGE }
  return {}
}

/**
 * Turns one record of facts into the rows of the LLM Wiki view, in their fixed order, each present exactly when its fact holds.
 *
 * Why: the view shows a Wiki beside a run, a reservation and an attention cause, so its rows are independent axes, not one state; one pure function keeps the complexity limits met and lets one table-driven test cover the whole matrix (Eng decision 82).
 * Trigger: {@link LlmWikiView} calls it after each read of the facts.
 *
 * @param facts - What the folder, the trust, this window's run, other windows' markers, the manifest and the last attempt say.
 * @param wording - How times and dates are written; the editor's locale when omitted.
 * @returns
 * - No folder: one row that opens a folder; untrusted: one row that manages trust
 * - Otherwise the Wiki, run, elsewhere, reservation, last-attempt and attention rows that hold, then the Output row when any of them does
 * - No row at all, and state `none`, when the folder holds no Wiki and no run (the welcome content shows)
 * - A `message` in VS Code while a watch or a stopped watch's reservation is shown
 *
 * @example
 * ```ts
 * readLlmWikiViewState({ kind: 'no-folder' }).rows[0]?.label // => 'Open a folder to use the LLM Wiki'
 * ```
 */
export function readLlmWikiViewState(
  facts: LlmWikiViewFacts,
  wording: LlmWikiViewWording = LOCAL_WORDING,
): LlmWikiViewModel {
  if (facts.kind === 'no-folder')
    return {
      state: 'other',
      rows: [
        {
          id: 'folder',
          label: 'Open a folder to use the LLM Wiki',
          icon: 'folder-opened',
          actions: ['open-folder'],
        },
      ],
    }
  if (facts.kind === 'untrusted')
    return {
      state: 'other',
      rows: [
        {
          id: 'trust',
          label: 'Trust this folder to use the LLM Wiki',
          icon: 'shield',
          actions: ['manage-trust'],
        },
      ],
    }
  const rows = readyRows(facts, wording)
  if (rows.length === 0) return { state: 'none', rows: [] }
  return {
    state: 'other',
    rows: [...rows, outputRow(facts)],
    ...watchMessageOf(facts),
  }
}
