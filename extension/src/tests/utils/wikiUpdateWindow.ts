import * as fileSystem from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as sleepFor } from 'node:timers/promises'

import * as constants from '../../constants'
import { readDeepWikiManifest } from '../../deepWikiReader'
import type * as ExtensionModule from '../../extension'
import type * as ClaimWikiUpdateMarkerModule from '../../utils/claimWikiUpdateMarker'
import { findWikiUpdateStartBlock } from '../../utils/findWikiUpdateStartBlock'
import {
  inspectDeepWikiFreshness,
  type WikiFreshness,
} from '../../utils/inspectDeepWikiFreshness'
import { listWikiCandidates } from '../../utils/listWikiCandidates'
import { createLlmWikiView, type LlmWikiView } from '../../utils/llmWikiView'
import { PREPARED_LOCK_SUFFIX } from '../../utils/preparedLockSuffix'
import { readWikiPublicationIdentity } from '../../utils/readWikiPublicationIdentity'
import { readWikiPublishToken } from '../../utils/readWikiPublishToken'
import { readWikiWatchStamp } from '../../utils/readWikiWatchStamp'
import * as refreshCursorMcpCatalogModule from '../../utils/refreshCursorMcpCatalog'
import * as runUnderAbortSignalModule from '../../utils/runUnderAbortSignal'
import { startWikiChatUpdate } from '../../utils/startWikiChatUpdate'
import { waitForWikiPublish } from '../../utils/waitForWikiPublish'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { assertConstantsReadBy } from './assertConstantsReadBy'
import { keepLocalAddress, parseFakeUri } from './fakeEditorAddresses'
import { createFakeFileWatching, FakeRelativePattern } from './fakeFileWatching'
import { listenTo } from './listenTo'
import { loadModule } from './loadModule'

/**
 * Makes the `Date` a loaded module sees, whose `now()` answers a test's clock while `new Date(…)` stays real.
 * @param clock - The test's present, in epoch milliseconds.
 * @returns A `Date` subclass whose static `now` calls the clock.
 * @example
 * const ClockedDate = createClockedDate(() => 1_790_000_000_000)
 * ClockedDate.now() // => 1_790_000_000_000 (a loaded module's `Date.now()` reads it)
 */
function createClockedDate(
  clock: () => number,
): new (...args: ConstructorParameters<typeof Date>) => Date {
  class ClockedDate extends Date {
    static override now(): number {
      return clock()
    }
  }
  return ClockedDate
}

/** How often an opening window looks whether the LLM Wiki view has shown its first read. */
const FIRST_VIEW_READ_POLL_MS = 5
/** How long an opening window waits for the LLM Wiki view's first read before the test fails with that cause. */
const FIRST_VIEW_READ_LIMIT_MS = 10_000

/** The Cancel of one run the window showed: the Cancel button of a progress notification (a Cursor run), or a press on the status bar entry that watches a VS Code update. */
export type CancellableProgress = {
  cancel(): void
}

/** A status bar entry the fake editor holds: what the extension set on it, and whether it is on screen. */
type FakeStatusBarEntry = {
  id: string
  alignment: number | undefined
  name?: string
  text: string
  tooltip?: string
  command?: string | { command: string }
  accessibilityInformation?: { label: string; role?: string }
  isShown: boolean
  isDisposed: boolean
  show(): void
  hide(): void
  dispose(): void
}

/** One row of the LLM Wiki view as the editor would draw it. */
export type FakeLlmWikiRow = {
  id: string
  label: string
  description?: string
  tooltip?: string
  iconId?: string
  command?: { command: string; arguments?: unknown[] }
  contextValue?: string
  /** The accessible name the editor reads for the row. */
  accessibleName?: string
}

/** The LLM Wiki view as the fake editor holds it: its rows, its message, its context keys and how often it fired a change. */
export type FakeLlmWikiView = {
  rows(): FakeLlmWikiRow[]
  message(): string | undefined
  contextKeys: Record<string, unknown>
  treeChangeCount(): number
  setVisible(isVisible: boolean): void
  /** Resolves once the view has no debounced refresh waiting and no read or freshness check under way, so a test proves an absent read without a fixed sleep. */
  whenIdle(): Promise<void>
  /** What the fake tree did, in order: `change:<message shown when the change event fired>`, `getChildren` (the root read the editor makes after a change event) and `message:<text written>`. A message written before the change event shows as a `change:` entry that already holds the new text. */
  renderLog(): string[]
}

type UriHandler = (uri: { path: string; query: string }) => Promise<void>

/** A document the fake editor reports as opened: only the address the extension looks at. */
type FakeTextDocument = { uri: { scheme: string; fsPath: string } }

/** A command the fake editor reports as started in a terminal: only the command line the extension looks at. */
type FakeShellExecution = { execution: { commandLine: { value: string } } }

/** One change the window made of its own Wiki update marker: its removal (`release`) or its turn into a stopped watch's reservation (`reserve`), with what the change answered once it settled (`true` once nothing of the run was left to change, `false` while the claim on the marker could not be had, `threw` for a change that threw); no answer while it runs. */
type WikiMarkerChange = {
  kind: 'release' | 'reserve'
  answer?: boolean | 'threw'
}

/** Names of the extension's numeric constants, the ones a test may replace by a shorter value. */
type NumericConstantName = {
  [Name in keyof typeof constants]: (typeof constants)[Name] extends number
    ? Name
    : never
}[keyof typeof constants]

/** An awaited step of an update that a test can keep open: the freshness inspection among the start checks, VS Code's chat command that carries the request, one listing of the candidates (the next listing after `hold` is kept open once it has read the folder; later ones pass), the wait of the start check before its second look at a publish journal written a moment ago (held, it lasts until the release and no real time), a read of the publish token (the start checks read it and so does the end of a run, so a hold set after the start keeps the end open), or the change of the run's marker at its end (its removal or its turn into a reservation: held, the run's end is already recorded and told, and the run waits there), or the write of the reservation that turn puts beside the marker (held, the change holds the claim on the marker while it waits, as a slow disk holds it), or the moment before a start's claim on the marker begins (`claim-start`, after the start looked at the marker), or the moment after a start's claim on the marker answered and before the start reads the answer (`claim-answer`), or a read of the publication identity (the LLM Wiki view reads it after the manifest, so a hold keeps a read open between the two). */
export type HeldUpdateStep =
  | 'freshness-inspection'
  | 'chat-open'
  | 'candidate-listing'
  | 'journal-wait'
  | 'publish-token-read'
  | 'marker-change'
  | 'marker-write'
  | 'claim-start'
  | 'claim-answer'
  | 'start-block'
  | 'publication-read'

/**
 * Opens an editor window (the real extension with a stubbed `vscode`) on a project whose Wiki already exists, and records everything the learner would see of an update.
 *
 * Why: the update flow spans the URI handler, the command, the run state and the notifications; the tests need one window that records all of them while the Wiki folder on disk stays real.
 * Used by the Wiki update flow tests.
 *
 * @param options.projectRoot - Canonical folder the window has open.
 * @param options.outputSetting - Value of `codebook.wikiOutputDirectory`; `.codebook/wiki` when omitted.
 * @param options.cursor - Whether the host is Cursor (the agent runs through its CLI) instead of VS Code (chat plus watch).
 * @param options.chatFails - Makes VS Code's chat command throw: "Chat is unavailable" for `true`, the given message for a text.
 * @param options.chatReply - What VS Code's chat command resolves with once it took the request, as it does with `blockOnResponse` when the chat's response completed (`{}`), completed with an error (`{ errorDetails }`) or waits for a confirmation (`{ type: 'confirmation' }`); a reply that waits for a confirmation, at once, when omitted, so the chat counts as working. A promise that never settles is a chat that never answers.
 * @param options.chatAnswerClock - Sleep handed to the start of the update in the chat (the hand-over of the request, the looks at the Wiki's output and the wait for the first answer), so a test can pass the bound of the session's start and the 30 second bound without waiting.
 * @param options.missingEditorCommands - Commands this editor does not have: the list of its commands leaves them out, and running one throws the editor's "command not found". An editor has the chat's commands when omitted.
 * @param options.signWatchFails - Makes the editor throw this message when the extension registers its listener for opened documents.
 * @param options.editorCommand - What the editor does when the extension runs a command other than the chat request (the reveal of the chat, which is the chat command without a query, the editor's New Chat, the chat's Cancel and its "Remove All Queued", for example): it gets the command's name, and what it returns or throws is the command's result. Such a command returns nothing when omitted.
 * @param options.remoteName - The editor's `env.remoteName`, as a window connected to a remote host reports it (for example `ssh-remote`); absent for a local window.
 * @param options.cursorAgent - What the Cursor agent does; it gets the project, the prompt, the run's abort signal, the bound the run would stop it at and the run's kind.
 * @param options.cancellable - Collects the Cancel of each run the window shows: the Cancel button of a progress notification, and the press on a status bar entry, which runs the entry's command while the entry is on screen, as a click does; the window shows both and records their texts also when omitted.
 * @param options.declineConfirmation - Makes the learner dismiss the modal confirmation of the browser's update link.
 * @param options.watchClock - Clock and sleep handed to the watch, so a test can pass the 15 minute bound without waiting.
 * @param options.openReader - Whether to open the browser reader first, which the state snapshot needs; true when omitted.
 * @param options.constants - Replaces numeric constants of the extension (the grace a closing window gives the Cursor agent, the Cursor run's two-second look interval, a bound), so a test need not wait for them. The replacement reaches `extension.ts` itself and no module it requires (a utility that reads the same constant keeps the real value), so a constant `extension.ts` never reads is refused ({@link assertConstantsReadBy}).
 * @param options.chooseAction - Presses a button of a notification: it gets the notification's text and its button labels and returns the label to press, or a promise of it for a press that comes later; no button is pressed when omitted.
 * @param options.workspaceState - The window's workspace state; two windows opened with the same map are one window before and after a reload.
 * @param options.workspaceStateWrite - Stands in for the editor's storage at every write of the workspace state: it gets the function that writes the value into the map, and the key, and returns the promise the write settles with; a test rejects it without writing, or writes later.
 * @param options.publishTokenReadFails - Makes the read of the publish token among the start checks reject with this message.
 * @param options.openWikiFails - Makes the command that opens the browser Wiki (the button "Open LLM Wiki" of a notification runs it) reject with this message.
 * @param options.realFreshnessCheck - Runs the real freshness check against the project on disk instead of answering what `setFreshness` was given.
 * @param options.cursorSkill - Stands in for the managed Cursor skill a generation readies ({@link verifyManagedCursorSkill}, {@link deployCursorSkill}): each resolves without touching the learner's home unless the test says otherwise; `skillCalls` records which ran.
 * @param options.answerConfirmation - Answers a modal confirmation with the button the test chooses: it gets the confirmation's title and its buttons; the first button is chosen when omitted, none with `declineConfirmation`.
 * @returns What the window showed (chat requests, every editor command the extension ran in order (`executedCommands`: its name, and for the chat request the name followed by " with the update request"), notifications by severity, the buttons each notification offered, confirmations with their detail text, progress titles, the text of every status bar entry it showed (`statusBarTexts`) and of those on screen now (`visibleStatusBarTexts`)), how often its looks read the watch stamp (`stampReads` counts the reads that began, `stampReadsDone` those that returned, so a test can wait for a look instead of for an amount of time) and listed the candidates, how often a start's claim on the marker answered (`markerClaims`), each change of its own update marker with what it answered (`markerChanges`), the two update entries, the state snapshot, `openWorkspace` (makes the window answer another folder as its opened project from then on), `hold` (keeps one awaited step of the next start open until `release()`, so a test can close the window in the middle of it) `openDocument`, `openTerminal` and `runTerminalCommand` (what the editor reports when a file is opened, by the chat or by the learner, a terminal opens or a command starts there), `signListenerCount` (how many listeners for these events the extension holds) and `close`.
 *
 * @example
 * ```ts
 * const window = await openWikiUpdateWindow({ projectRoot: wiki.projectRoot })
 * await window.clickUpdate()
 * window.status().state // => 'running'
 * await window.close()
 * ```
 */
export async function openWikiUpdateWindow(options: {
  projectRoot: string
  outputSetting?: string
  cursor?: boolean
  remoteName?: string
  chatFails?: boolean | string
  chatReply?: () => Promise<unknown>
  chatAnswerClock?: {
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
  }
  editorCommand?: (name: string) => unknown
  missingEditorCommands?: string[]
  signWatchFails?: string
  cursorAgent?: (
    root: string,
    prompt: string,
    signal?: AbortSignal,
    timeoutMs?: number,
    runKind?: string,
  ) => Promise<string>
  cancellable?: CancellableProgress[]
  declineConfirmation?: boolean
  watchClock?: {
    now: () => number
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
  }
  openReader?: boolean
  constants?: Partial<Record<NumericConstantName, number>>
  chooseAction?: (
    message: string,
    actions: string[],
  ) => string | undefined | Promise<string | undefined>
  workspaceState?: Map<string, unknown>
  workspaceStateWrite?: (write: () => void, key: string) => Promise<void>
  publishTokenReadFails?: string
  realFreshnessCheck?: boolean
  openWikiFails?: string
  cursorSkill?: {
    verify?: () => Promise<unknown>
    deploy?: () => Promise<unknown>
    remove?: () => Promise<unknown>
  }
  answerConfirmation?: (
    message: string,
    choices: string[],
  ) => string | undefined
  /** Whether the editor trusts the folder; true when omitted. */
  trusted?: boolean
  /** Opens the window with no folder. */
  noFolder?: boolean
  /** Keeps these steps open from the window's activation on, so a test sees the state before the first read ends; `hold(step)` then returns the same hold. */
  holdAtOpen?: HeldUpdateStep[]
  /** Commands the editor lists besides the chat's (for example the id of its manage-trust command). */
  extraEditorCommands?: string[]
  /** Makes the editor refuse the file watcher of the LLM Wiki view with this message. */
  wikiWatcherFails?: string
  /** Makes this many removals of the window's own run marker throw `EBUSY` before they work, as a scanner holding the file does on Windows; each is recorded in `markerChanges` as `threw`. */
  markerReleaseFailures?: number
  /** Makes this many turns of the window's own marker into a stopped watch's reservation (including a taken-over reservation written back) answer `false`, as when another window holds the claim on the marker at that moment; each is recorded in `markerChanges` with the answer `false`. */
  markerReserveFailures?: number
  /** Replaces `Date.now()` inside `extension.ts` itself (the utilities it requires keep the real clock), so a test can place the moment a Stop is pressed and the moment its rejection is handled in different minutes. */
  clock?: () => number
}): Promise<{
  chatRequests: Array<{ name: string; query: string }>
  executedCommands: string[]
  /** Every editor command the extension ran, in order, with its first argument (a `Uri` is kept as given, so a test reads its `fsPath`). */
  executedCommandCalls: Array<{ name: string; argument: unknown }>
  notices: string[]
  warnings: string[]
  errors: string[]
  offeredActions: Array<{ message: string; actions: string[] }>
  confirmations: string[]
  confirmationDetails: string[]
  progressTitles: string[]
  statusBarTexts: string[]
  /** Which of the managed Cursor skill's steps ran, in order: `verify`, `deploy`. */
  skillCalls: string[]
  /** Every line the extension wrote to Output › Codebook, as `info: …` or `error: …`. */
  outputLines: string[]
  /** How often the extension brought Output › Codebook to the front (`show()` on its channel). */
  outputShownCount(): number
  /** How many Cursor skill steps have begun to wait under their stop and bound: a step that follows an unsettled earlier one is then at its wait for that step. */
  skillStepsStartedCount(): number
  /** Runs one of the extension's registered commands with the arguments a menu or a row passes, as the Command Palette does. */
  runCommand(name: string, ...args: unknown[]): Promise<void>
  /** What the editor shows of the LLM Wiki view. */
  llmWiki: FakeLlmWikiView
  /** Reports a file event the way the editor's watchers do. */
  reportFileEvent(
    kind: 'change' | 'create' | 'delete',
    fsPath: string,
    reportedAs?: string,
  ): void
  /** Says how many file watchers of the extension are alive. */
  liveWatcherCount(): number
  /** The patterns every file watcher of the extension was created with. */
  watchedPatterns(): Array<{ base: string; pattern: string }>
  /** What the extension copied to the clipboard. */
  clipboard: string[]
  /** Changes whether the editor trusts the folder; trust is granted during a session, never revoked. */
  grantTrust(): void
  /** Closes the folder: the window has none from now on. */
  closeFolder(): void
  /** Opens the folder again after {@link closeFolder}, as the learner restores it. */
  reopenFolder(): void
  visibleStatusBarTexts(): string[]
  looks: {
    candidateListings: number
    stampReads: number
    stampReadsDone: number
    markerClaims: number
    /** How often the extension read the publish token: once per read of the LLM Wiki view's state, among the start checks' reads. */
    publishTokenReads: number
    /** How often the freshness of the published Wiki was inspected: once per freshness check of the LLM Wiki view. */
    freshnessInspections: number
  }
  markerChanges: WikiMarkerChange[]
  openWorkspace(nextProjectRoot: string): void
  openDocument(path: string, scheme?: string): void
  openTerminal(): void
  runTerminalCommand(commandLine: string): void
  signListenerCount(): number
  clickUpdate(): Promise<void>
  runUpdateCommand(): Promise<void>
  status(): WikiUpdateStatus
  /** Changes `codebook.wikiOutputDirectory` from now on, as the learner does in the settings; the next update resolves its Wiki folder from it. */
  setOutputSetting(value: string): void
  setFreshness(freshness: WikiFreshness): void
  /** Makes every read of the publish token reject with the message from now on, the start checks' and the one a run's end begins with; `undefined` mends the read. */
  breakPublishTokenRead(message: string | undefined): void
  hold(step: HeldUpdateStep): { started: Promise<void>; release(): void }
  close(): Promise<void>
}> {
  const { projectRoot } = options
  let outputSetting = options.outputSetting ?? '.codebook/wiki'
  let handleUri: UriHandler | undefined
  let readUpdateStatus: (() => WikiUpdateStatus) | undefined
  // The Wiki is stale until a test says otherwise; a current one ends the click as "already current".
  let freshness: WikiFreshness = {
    status: 'changed',
    changedPaths: ['src/a.ts'],
    addedPaths: [],
  }
  // The message the read of the publish token rejects with, or none; a test can break and mend the read while the window is open.
  let publishTokenReadFailure = options.publishTokenReadFails
  const chatRequests: Array<{ name: string; query: string }> = []
  const executedCommands: string[] = []
  const executedCommandCalls: Array<{ name: string; argument: unknown }> = []
  const notices: string[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const offeredActions: Array<{ message: string; actions: string[] }> = []
  // The folder the window answers as its opened project; a test can change it while a run works.
  let openedWorkspace = projectRoot
  const workspaceState = options.workspaceState ?? new Map<string, unknown>()
  /** Records one notification with its buttons and answers with the button the test presses, if any. */
  const showNotification = (
    shown: string[],
    message: string,
    actions: string[],
  ): Promise<string | undefined> => {
    shown.push(message)
    if (actions.length) offeredActions.push({ message, actions })
    return Promise.resolve(
      actions.length ? options.chooseAction?.(message, actions) : undefined,
    )
  }
  // What the editor reports while the chat works: a document it opened, a terminal it opened, a command it started there.
  const documentOpenListeners: Array<(document: FakeTextDocument) => void> = []
  const terminalOpenListeners: Array<() => void> = []
  const terminalCommandListeners: Array<(event: FakeShellExecution) => void> =
    []
  const confirmations: string[] = []
  const confirmationDetails: string[] = []
  const skillCalls: string[] = []
  const outputLines: string[] = []
  let outputShown = 0
  let skillStepsStarted = 0
  let markerReleaseFailuresLeft = options.markerReleaseFailures ?? 0
  let markerReserveFailuresLeft = options.markerReserveFailures ?? 0
  const progressTitles: string[] = []
  const statusBarTexts: string[] = []
  const statusBarEntries: FakeStatusBarEntry[] = []
  const looks = {
    candidateListings: 0,
    stampReads: 0,
    stampReadsDone: 0,
    markerClaims: 0,
    publishTokenReads: 0,
    freshnessInspections: 0,
  }
  const markerChanges: WikiMarkerChange[] = []
  /** Records one change of this window's marker, and what it answered once it settled. */
  const recordMarkerChange = (
    kind: WikiMarkerChange['kind'],
    changing: Promise<boolean>,
  ): Promise<boolean> => {
    const change: WikiMarkerChange = { kind }
    markerChanges.push(change)
    return changing.then(
      (answer) => {
        change.answer = answer
        return answer
      },
      (error: unknown) => {
        change.answer = 'threw'
        throw error
      },
    )
  }
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>()
  const fileWatching = createFakeFileWatching()
  const clipboard: string[] = []
  const contextKeys: Record<string, unknown> = {}
  const configurationListeners: Array<
    (event: { affectsConfiguration: (id: string) => boolean }) => void
  > = []
  const trustListeners: Array<() => void> = []
  let isTrusted = options.trusted ?? true
  let isFolderOpen = !options.noFolder
  let treeProvider:
    | {
        getChildren(): string[]
        getTreeItem(id: string): Record<string, unknown>
        onDidChangeTreeData(listener: () => void): { dispose(): void }
      }
    | undefined
  let treeMessage: string | undefined
  let treeChangeCount = 0
  const renderLog: string[] = []
  let llmWikiView: LlmWikiView | undefined
  const visibilityListeners: Array<(event: { visible: boolean }) => void> = []
  let isViewShown = true
  const holdControls = new Map<
    HeldUpdateStep,
    { started: Promise<void>; release(): void }
  >()
  const holds = new Map<
    HeldUpdateStep,
    { reached(): void; released: Promise<void> }
  >()
  /** Makes a hold on a step, or returns the one already made, for `hold()` and `holdAtOpen`. */
  const makeHold = (
    step: HeldUpdateStep,
  ): { started: Promise<void>; release(): void } => {
    const existing = holdControls.get(step)
    if (existing) return existing
    let reached = (): void => {}
    let release = (): void => {}
    const started = new Promise<void>((resolveStarted) => {
      reached = resolveStarted
    })
    const released = new Promise<void>((resolveReleased) => {
      release = resolveReleased
    })
    holds.set(step, { reached, released })
    const controls = {
      started,
      release(): void {
        holds.delete(step)
        holdControls.delete(step)
        release()
      },
    }
    holdControls.set(step, controls)
    return controls
  }
  for (const step of options.holdAtOpen ?? []) makeHold(step)
  /** Waits until the LLM Wiki view has shown its first read: its state key no longer reads `loading` (an editor without the view never sets it). */
  const untilFirstViewRead = async (): Promise<void> => {
    const deadline = Date.now() + FIRST_VIEW_READ_LIMIT_MS
    while (
      contextKeys[constants.LLM_WIKI_STATE_CONTEXT_KEY] === 'loading' &&
      Date.now() < deadline
    )
      await sleepFor(FIRST_VIEW_READ_POLL_MS)
    if (contextKeys[constants.LLM_WIKI_STATE_CONTEXT_KEY] === 'loading')
      throw new Error(
        `The LLM Wiki view did not show its first read within ${FIRST_VIEW_READ_LIMIT_MS} ms.`,
      )
  }
  /** Waits at a step a test holds open; a step nobody holds passes at once. */
  const passHold = async (step: HeldUpdateStep): Promise<void> => {
    const hold = holds.get(step)
    if (!hold) return
    hold.reached()
    await hold.released
  }
  const withProgress = async (
    progressOptions: { title: string },
    task: (progress: unknown, token: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    progressTitles.push(progressOptions.title)
    const listeners: Array<() => void> = []
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        listeners.push(listener)
        return { dispose(): void {} }
      },
    }
    options.cancellable?.push({
      cancel() {
        token.isCancellationRequested = true
        for (const listener of listeners) listener()
      },
    })
    return task({}, token)
  }
  /** Creates a status bar entry as the editor does; showing it records its text and offers its press to a test that collects the Cancel of each run. */
  const createStatusBarItem = (
    id: string,
    alignment?: number,
  ): FakeStatusBarEntry => {
    const entry: FakeStatusBarEntry = {
      id,
      alignment,
      text: '',
      isShown: false,
      isDisposed: false,
      show(): void {
        // A disposed entry stays gone, and an entry already on screen is not shown twice.
        if (entry.isDisposed || entry.isShown) return
        entry.isShown = true
        statusBarTexts.push(entry.text)
        options.cancellable?.push({
          cancel(): void {
            // A click reaches only an entry that is on screen, and runs the command the entry names.
            if (!entry.isShown) return
            const commandName =
              typeof entry.command === 'string'
                ? entry.command
                : entry.command?.command
            if (commandName !== undefined) void commands.get(commandName)?.()
          },
        })
      },
      hide(): void {
        entry.isShown = false
      },
      dispose(): void {
        entry.isShown = false
        entry.isDisposed = true
      },
    }
    statusBarEntries.push(entry)
    return entry
  }
  // A replaced constant reaches only the extension's own module: one it never reads would change nothing.
  await assertConstantsReadBy(
    resolve(__dirname, '../../extension.js'),
    Object.keys(options.constants ?? {}),
  )
  // The real claim on the marker, whose write of a reservation beside the marker a test can hold while the change holds the claim.
  const { claimWikiUpdateMarker } = await loadModule<
    typeof ClaimWikiUpdateMarkerModule
  >(resolve(__dirname, '../../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      writeFile: async (
        ...written: Parameters<typeof fileSystem.writeFile>
      ) => {
        if (String(written[0]).includes(PREPARED_LOCK_SUFFIX))
          await passHold('marker-write')
        return fileSystem.writeFile(...written)
      },
    },
  })
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../../extension.js'),
    {
      vscode: {
        ProgressLocation: { Notification: 15 },
        StatusBarAlignment: { Left: 1, Right: 2 },
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(
            name: string,
            action: (...args: unknown[]) => Promise<void>,
          ) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          // The commands of the chat a supported editor has, without those the test takes away.
          getCommands: async () =>
            [
              'workbench.action.chat.open',
              'workbench.action.chat.newChat',
              'workbench.action.chat.cancel',
              'workbench.action.chat.removeAllPendingRequests',
              ...(options.extraEditorCommands ?? []),
            ].filter(
              (command) => !options.missingEditorCommands?.includes(command),
            ),
          executeCommand: async (
            name: string,
            argument?: unknown,
            value?: unknown,
          ) => {
            // A context key is the editor's own bookkeeping, not a command the learner ran.
            if (name === 'setContext') {
              contextKeys[String(argument)] = value
              return undefined
            }
            // Only the chat command that carries a query is the request; without one it reveals the chat.
            const query =
              typeof argument === 'object' &&
              argument !== null &&
              'query' in argument &&
              typeof argument.query === 'string'
                ? argument.query
                : undefined
            executedCommands.push(
              query === undefined ? name : `${name} with the update request`,
            )
            executedCommandCalls.push({ name, argument })
            if (
              name === 'codebook.openDeepWiki' &&
              options.openWikiFails !== undefined
            )
              throw new Error(options.openWikiFails)
            if (options.chatFails)
              throw new Error(
                options.chatFails === true
                  ? 'Chat is unavailable'
                  : options.chatFails,
              )
            if (options.missingEditorCommands?.includes(name))
              throw new Error(`command '${name}' not found`)
            // Every other command of the editor does what the test says, and nothing when it says nothing.
            if (query === undefined) return options.editorCommand?.(name)
            await passHold('chat-open')
            chatRequests.push({ name, query })
            // The chat's reply, as `blockOnResponse` returns it; a chat nobody describes works on the request and waits for a confirmation.
            return options.chatReply
              ? options.chatReply()
              : { type: 'confirmation', kind: 'toolInvocation' }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => outputSetting }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          onDidChangeConfiguration: (
            listener: (event: {
              affectsConfiguration: (id: string) => boolean
            }) => void,
          ) => listenTo(configurationListeners, listener),
          onDidGrantWorkspaceTrust: (listener: () => void) =>
            listenTo(trustListeners, listener),
          get isTrusted() {
            return isTrusted
          },
          get workspaceFolders() {
            return isFolderOpen
              ? [{ uri: { scheme: 'file', fsPath: openedWorkspace } }]
              : undefined
          },
          onDidOpenTextDocument: (
            listener: (document: FakeTextDocument) => void,
          ) => {
            if (options.signWatchFails !== undefined)
              throw new Error(options.signWatchFails)
            return listenTo(documentOpenListeners, listener)
          },
          // The opened Wiki watches the project's files; these tests report no file event.
          createFileSystemWatcher: (pattern: FakeRelativePattern) => {
            // The LLM Wiki view's own watcher can be refused; the opened Wiki's watches the project.
            if (
              options.wikiWatcherFails !== undefined &&
              pattern.pattern !== '**'
            )
              throw new Error(options.wikiWatcherFails)
            return fileWatching.createFileSystemWatcher(pattern)
          },
        },
        EventEmitter: class {
          readonly #listeners: Array<(value: unknown) => void> = []
          readonly event = (listener: (value: unknown) => void) =>
            listenTo(this.#listeners, listener)
          fire(value?: unknown): void {
            for (const listener of [...this.#listeners]) listener(value)
          }
          dispose(): void {}
        },
        TreeItem: class {
          id?: string
          description?: string
          tooltip?: string
          accessibilityInformation?: { label: string }
          iconPath?: unknown
          contextValue?: string
          command?: unknown
          constructor(
            readonly label: string,
            readonly collapsibleState?: number,
          ) {}
        },
        ThemeIcon: class {
          constructor(readonly id: string) {}
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        env: {
          ...(options.cursor ? { appName: 'Cursor' } : {}),
          ...(options.remoteName ? { remoteName: options.remoteName } : {}),
          asExternalUri: keepLocalAddress,
          openExternal: async () => true,
          clipboard: {
            writeText: async (text: string) => {
              clipboard.push(text)
            },
          },
        },
        Uri: {
          parse: parseFakeUri,
          file: (fsPath: string) => ({ scheme: 'file', fsPath }),
        },
        window: {
          registerUriHandler: (handler: { handleUri: UriHandler }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
          },
          showInformationMessage: (message: string, ...actions: string[]) =>
            showNotification(notices, message, actions),
          // A modal warning is the confirmation of the browser link; a plain one is a notification.
          showWarningMessage: (
            message: string,
            messageOptions?: { modal?: boolean; detail?: string } | string,
            ...choices: string[]
          ) => {
            if (typeof messageOptions === 'string')
              return showNotification(warnings, message, [
                messageOptions,
                ...choices,
              ])
            if (!messageOptions?.modal)
              return showNotification(warnings, message, choices)
            confirmations.push(message)
            confirmationDetails.push(messageOptions.detail ?? '')
            if (options.declineConfirmation) return Promise.resolve(undefined)
            return Promise.resolve(
              options.answerConfirmation
                ? options.answerConfirmation(message, choices)
                : choices[0],
            )
          },
          // Output › Codebook, as a log channel: each line is kept with its level.
          createOutputChannel: () => ({
            info: (line: string) => outputLines.push(`info: ${line}`),
            error: (line: string) => outputLines.push(`error: ${line}`),
            show(): void {
              outputShown += 1
            },
            dispose(): void {},
          }),
          showErrorMessage: (message: string, ...actions: string[]) =>
            showNotification(errors, message, actions),
          onDidOpenTerminal: (listener: () => void) =>
            listenTo(terminalOpenListeners, listener),
          onDidStartTerminalShellExecution: (
            listener: (event: FakeShellExecution) => void,
          ) => listenTo(terminalCommandListeners, listener),
          createTreeView: (
            _id: string,
            treeOptions: {
              treeDataProvider: NonNullable<typeof treeProvider>
            },
          ) => {
            const provider = treeOptions.treeDataProvider
            treeProvider = {
              ...provider,
              getChildren: () => {
                renderLog.push('getChildren')
                return provider.getChildren()
              },
            }
            // Like the editor, the fake reads the root children after every change event.
            provider.onDidChangeTreeData(() => {
              treeChangeCount += 1
              renderLog.push(`change:${treeMessage ?? ''}`)
              treeProvider?.getChildren()
            })
            return {
              get message() {
                return treeMessage
              },
              set message(next: string | undefined) {
                renderLog.push(`message:${next ?? ''}`)
                treeMessage = next
              },
              get visible() {
                return isViewShown
              },
              onDidChangeVisibility: (
                listener: (event: { visible: boolean }) => void,
              ) => listenTo(visibilityListeners, listener),
              dispose(): void {},
            }
          },
          // A real editor always has both, so every test runs the product's own way of showing a run; only collecting their Cancel is optional.
          withProgress,
          createStatusBarItem,
        },
      },
      './environment': { requireWorkspace: () => openedWorkspace },
      // The managed Cursor skill a generation readies; nothing is written to the learner's home.
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => {
          skillCalls.push('verify')
          return options.cursorSkill?.verify?.()
        },
        deployCursorSkill: async () => {
          skillCalls.push('deploy')
          return options.cursorSkill?.deploy?.()
        },
        // The removal records its call; nothing is removed from the learner's home.
        removeManagedCursorSkill: async () => {
          skillCalls.push('remove')
          await options.cursorSkill?.remove?.()
          return { status: 'removed' }
        },
      },
      // Each Cursor skill step is counted when it begins to wait under its stop and bound; the step's body has by then run up to its first wait (for an earlier step, when one has not settled).
      './utils/runUnderAbortSignal': {
        ...runUnderAbortSignalModule,
        runUnderAbortSignal: <Result>(
          run: () => Promise<Result>,
          signal: AbortSignal,
        ): Promise<Result> => {
          skillStepsStarted += 1
          return runUnderAbortSignalModule.runUnderAbortSignal(run, signal)
        },
      },
      // The removal's catalog step refuses at once, so a test of the skill's removal reads its warning and touches no Cursor config.
      './utils/refreshCursorMcpCatalog': {
        ...refreshCursorMcpCatalogModule,
        captureOwnedCursorMcpCatalogGeneration: async () => {
          throw new Error('No Cursor MCP catalog is used in this test.')
        },
      },
      ...(options.constants
        ? { './constants': { ...constants, ...options.constants } }
        : {}),
      // The real start check runs; a test that holds its wait at a fresh journal decides when the second look comes, and otherwise the real time passes.
      './utils/findWikiUpdateStartBlock': {
        findWikiUpdateStartBlock: async (
          outputDirectory: string,
          projectRoot: string,
        ) => {
          await passHold('start-block')
          return findWikiUpdateStartBlock(outputDirectory, projectRoot, {
            wait: async (delayMs: number) => {
              if (holds.has('journal-wait')) await passHold('journal-wait')
              else await sleepFor(delayMs)
            },
          })
        },
      },
      // The real listing runs; the window only counts how often a look parsed the candidates, and can keep one listing open after it has read the folder.
      './utils/listWikiCandidates': {
        listWikiCandidates: async (outputDirectory: string) => {
          looks.candidateListings += 1
          const candidates = await listWikiCandidates(outputDirectory)
          const hold = holds.get('candidate-listing')
          if (hold) {
            // Only this one listing is kept open; the run's later looks pass.
            holds.delete('candidate-listing')
            hold.reached()
            await hold.released
          }
          return candidates
        },
      },
      // The real claim on the marker runs; the window counts the claims that answered, records each change of its marker (its removal, its turn into a stopped watch's reservation) and what that change answered, and a test can hold that change open.
      './utils/claimWikiUpdateMarker': {
        claimWikiUpdateMarker: async (
          ...claimed: Parameters<typeof claimWikiUpdateMarker>
        ) => {
          await passHold('claim-start')
          const claim = await claimWikiUpdateMarker(...claimed)
          looks.markerClaims += 1
          await passHold('claim-answer')
          if (!('release' in claim)) return claim
          return {
            replacedReservation: claim.replacedReservation,
            release: async () => {
              await passHold('marker-change')
              // A removal that the system refuses for now, as a scanner or an indexer holding the file does.
              if (markerReleaseFailuresLeft > 0) {
                markerReleaseFailuresLeft -= 1
                return recordMarkerChange(
                  'release',
                  Promise.reject(
                    Object.assign(new Error('EBUSY: resource busy or locked'), {
                      code: 'EBUSY',
                    }),
                  ),
                )
              }
              return recordMarkerChange('release', claim.release())
            },
            reserve: async (
              watchEndedAtMs: number,
              takenOver?: Parameters<typeof claim.reserve>[1],
            ) => {
              await passHold('marker-change')
              // The claim on the marker could not be had at this moment: the marker stays as it was and the change is asked for again.
              if (markerReserveFailuresLeft > 0) {
                markerReserveFailuresLeft -= 1
                return recordMarkerChange('reserve', Promise.resolve(false))
              }
              return recordMarkerChange(
                'reserve',
                claim.reserve(watchEndedAtMs, takenOver),
              )
            },
          }
        },
      },
      // The real stamp is read; the window only counts the looks of a watch or of a Cursor run.
      './utils/readWikiWatchStamp': {
        readWikiWatchStamp: async (outputDirectory: string) => {
          looks.stampReads += 1
          const stamp = await readWikiWatchStamp(outputDirectory)
          looks.stampReadsDone += 1
          return stamp
        },
      },
      // The real view runs; the window only keeps its handle so a test can wait for it to settle.
      './utils/llmWikiView': {
        createLlmWikiView: (
          ...created: Parameters<typeof createLlmWikiView>
        ) => {
          llmWikiView = createLlmWikiView(...created)
          return llmWikiView
        },
      },
      './utils/readWikiPublishToken': {
        readWikiPublishToken: async (outputDirectory: string) => {
          looks.publishTokenReads += 1
          if (publishTokenReadFailure !== undefined)
            throw new Error(publishTokenReadFailure)
          await passHold('publish-token-read')
          return readWikiPublishToken(outputDirectory)
        },
      },
      './utils/readWikiPublicationIdentity': {
        readWikiPublicationIdentity: async (outputDirectory: string) => {
          await passHold('publication-read')
          return readWikiPublicationIdentity(outputDirectory)
        },
      },
      './deepWikiReader': {
        readDeepWikiManifest,
        startDeepWikiReader: async (
          _output: string,
          _root: string,
          _answer: unknown,
          _scheme: string,
          statusProvider: () => WikiUpdateStatus,
        ) => {
          readUpdateStatus = statusProvider
          return {
            url: 'http://127.0.0.1:9/index.html',
            acceptForwardedOrigin(): void {},
            noteSourceChange(): void {},
            close: async (): Promise<void> => {},
          }
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose(): Promise<void> {}
        },
      },
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (
          root: string,
          prompt: string,
          signal?: AbortSignal,
          timeoutMs?: number,
          runKind?: string,
        ) =>
          options.cursorAgent
            ? options.cursorAgent(root, prompt, signal, timeoutMs, runKind)
            : 'Updated',
      },
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async (
          ...checked: Parameters<typeof inspectDeepWikiFreshness>
        ) => {
          looks.freshnessInspections += 1
          await passHold('freshness-inspection')
          return options.realFreshnessCheck
            ? inspectDeepWikiFreshness(...checked)
            : freshness
        },
      },
      // The real start in the chat runs (the hand-over, the wait for the first answer, the end of an unanswered request); only its sleep is replaced by the test's clock when one is given.
      './utils/startWikiChatUpdate': {
        startWikiChatUpdate: (
          startOptions: Parameters<typeof startWikiChatUpdate>[0],
        ) =>
          startWikiChatUpdate({
            ...startOptions,
            ...options.chatAnswerClock,
          }),
      },
      // The real watch runs; only its two-second wait between looks is shortened, or replaced by the test's clock.
      './utils/waitForWikiPublish': {
        waitForWikiPublish: <Published>(
          watchOptions: Parameters<typeof waitForWikiPublish<Published>>[0],
        ) =>
          waitForWikiPublish({
            ...watchOptions,
            pollMs: options.watchClock ? watchOptions.pollMs : 20,
            ...options.watchClock,
          }),
      },
    },
    // A test's clock reaches the `Date.now()` calls of `extension.ts` only; every other module keeps the real one.
    options.clock ? { Date: createClockedDate(options.clock) } : {},
  )
  const contextSubscriptions: Array<{ dispose(): unknown }> = []
  boundary.activate({
    extensionPath: resolve(__dirname, '../../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: contextSubscriptions,
    workspaceState: {
      get: (key: string) => workspaceState.get(key),
      update: async (key: string, value: unknown) => {
        const write = (): void => {
          workspaceState.set(key, value)
        }
        // A test's own storage decides when the value is written, or rejects the write.
        if (options.workspaceStateWrite)
          return options.workspaceStateWrite(write, key)
        write()
      },
    },
  })
  // The reader serves the update state, so the browser tab must be open first.
  if (options.openReader ?? true)
    await commands.get('codebook.openDeepWiki')?.()
  // The LLM Wiki view reads the Wiki at activation, and once more after its watcher stands. A test arranges its holds on the Wiki's reads only after those, so the view never takes a hold meant for a run; a test that holds a step at open wants the loading state and waits itself.
  if ((options.holdAtOpen ?? []).length === 0) await untilFirstViewRead()
  return {
    chatRequests,
    executedCommands,
    executedCommandCalls,
    notices,
    warnings,
    errors,
    offeredActions,
    confirmations,
    confirmationDetails,
    progressTitles,
    statusBarTexts,
    skillCalls,
    outputLines,
    outputShownCount: (): number => outputShown,
    skillStepsStartedCount: (): number => skillStepsStarted,
    async runCommand(name: string, ...args: unknown[]): Promise<void> {
      const command = commands.get(name)
      if (!command) throw new Error(`The window registered no ${name}.`)
      await command(...args)
    },
    llmWiki: {
      rows: () =>
        (treeProvider?.getChildren() ?? []).map((id) => {
          const item = treeProvider?.getTreeItem(id) ?? {}
          const icon = item.iconPath
          return {
            id,
            label: String(item.label),
            description: item.description as string | undefined,
            tooltip: item.tooltip as string | undefined,
            iconId:
              typeof icon === 'object' && icon !== null && 'id' in icon
                ? String(icon.id)
                : undefined,
            command: item.command as FakeLlmWikiRow['command'],
            contextValue: item.contextValue as string | undefined,
            accessibleName: (
              item.accessibilityInformation as { label: string } | undefined
            )?.label,
          }
        }),
      message: () => treeMessage,
      contextKeys,
      treeChangeCount: () => treeChangeCount,
      renderLog: () => [...renderLog],
      whenIdle: async () => llmWikiView?.whenIdle(),
      setVisible(isVisible: boolean): void {
        isViewShown = isVisible
        for (const listener of [...visibilityListeners])
          listener({ visible: isVisible })
      },
    },
    reportFileEvent: (kind, fsPath, reportedAs): void =>
      fileWatching.report(kind, fsPath, reportedAs),
    liveWatcherCount: () => fileWatching.liveWatcherCount(),
    watchedPatterns: () =>
      fileWatching.watched.map(({ base, pattern }) => ({ base, pattern })),
    clipboard,
    grantTrust(): void {
      isTrusted = true
      for (const listener of [...trustListeners]) listener()
    },
    closeFolder(): void {
      isFolderOpen = false
    },
    reopenFolder(): void {
      isFolderOpen = true
    },
    visibleStatusBarTexts: (): string[] =>
      statusBarEntries
        .filter((entry) => entry.isShown)
        .map((entry) => entry.text),
    looks,
    markerChanges,
    openWorkspace(nextProjectRoot: string): void {
      openedWorkspace = nextProjectRoot
    },
    openDocument(path: string, scheme = 'file'): void {
      for (const listener of [...documentOpenListeners])
        listener({ uri: { scheme, fsPath: path } })
    },
    openTerminal(): void {
      for (const listener of [...terminalOpenListeners]) listener()
    },
    runTerminalCommand(commandLine: string): void {
      for (const listener of [...terminalCommandListeners])
        listener({ execution: { commandLine: { value: commandLine } } })
    },
    signListenerCount: (): number =>
      documentOpenListeners.length +
      terminalOpenListeners.length +
      terminalCommandListeners.length,
    async clickUpdate(): Promise<void> {
      if (!handleUri) throw new Error('The window registered no URI handler.')
      await handleUri({
        path: '/update',
        query: new URLSearchParams({ root: projectRoot }).toString(),
      })
    },
    async runUpdateCommand(): Promise<void> {
      const command = commands.get('codebook.updateDeepWiki')
      if (!command) throw new Error('The window registered no update command.')
      await command()
    },
    status(): WikiUpdateStatus {
      if (!readUpdateStatus)
        throw new Error('The browser reader was not opened in this window.')
      return readUpdateStatus()
    },
    setOutputSetting(value: string): void {
      outputSetting = value
      for (const listener of [...configurationListeners])
        listener({
          affectsConfiguration: (id) => id === 'codebook.wikiOutputDirectory',
        })
    },
    setFreshness(next: WikiFreshness): void {
      freshness = next
    },
    breakPublishTokenRead(message: string | undefined): void {
      publishTokenReadFailure = message
    },
    hold: makeHold,
    close: async (): Promise<void> => {
      await boundary.deactivate()
      // The editor disposes the extension's subscriptions after deactivate; the LLM Wiki view's watcher and timers end there.
      for (const subscription of contextSubscriptions) subscription.dispose()
    },
  }
}
