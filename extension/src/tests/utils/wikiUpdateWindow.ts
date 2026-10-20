import { resolve } from 'node:path'
import { setTimeout as sleepFor } from 'node:timers/promises'

import * as constants from '../../constants'
import { readDeepWikiManifest } from '../../deepWikiReader'
import type * as ExtensionModule from '../../extension'
import { claimWikiUpdateMarker } from '../../utils/claimWikiUpdateMarker'
import { findWikiUpdateStartBlock } from '../../utils/findWikiUpdateStartBlock'
import {
  inspectDeepWikiFreshness,
  type WikiFreshness,
} from '../../utils/inspectDeepWikiFreshness'
import { listWikiCandidates } from '../../utils/listWikiCandidates'
import { readWikiPublishToken } from '../../utils/readWikiPublishToken'
import { readWikiWatchStamp } from '../../utils/readWikiWatchStamp'
import { startWikiChatUpdate } from '../../utils/startWikiChatUpdate'
import { waitForWikiPublish } from '../../utils/waitForWikiPublish'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { assertConstantsReadBy } from './assertConstantsReadBy'
import { keepLocalAddress, parseFakeUri } from './fakeEditorAddresses'
import { createFakeFileWatching, FakeRelativePattern } from './fakeFileWatching'
import { listenTo } from './listenTo'
import { loadModule } from './loadModule'

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

/** An awaited step of an update that a test can keep open: the freshness inspection among the start checks, VS Code's chat command that carries the request, one listing of the candidates (the next listing after `hold` is kept open once it has read the folder; later ones pass), the wait of the start check before its second look at a publish journal written a moment ago (held, it lasts until the release and no real time), or a read of the publish token (the start checks read it and so does the end of a run, so a hold set after the start keeps the end open). */
export type HeldUpdateStep =
  | 'freshness-inspection'
  | 'chat-open'
  | 'candidate-listing'
  | 'journal-wait'
  | 'publish-token-read'

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
 * @param options.cursorAgent - What the Cursor agent does; it gets the project, the prompt, the run's abort signal and the bound the run would stop it at.
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
 * @returns What the window showed (chat requests, every editor command the extension ran in order (`executedCommands`: its name, and for the chat request the name followed by " with the update request"), notifications by severity, the buttons each notification offered, confirmations with their detail text, progress titles, the text of every status bar entry it showed (`statusBarTexts`) and of those on screen now (`visibleStatusBarTexts`)), how often its looks read the watch stamp (`stampReads` counts the reads that began, `stampReadsDone` those that returned, so a test can wait for a look instead of for an amount of time) and listed the candidates, each change of its own update marker with what it answered (`markerChanges`), the two update entries, the state snapshot, `openWorkspace` (makes the window answer another folder as its opened project from then on), `hold` (keeps one awaited step of the next start open until `release()`, so a test can close the window in the middle of it) `openDocument`, `openTerminal` and `runTerminalCommand` (what the editor reports when a file is opened, by the chat or by the learner, a terminal opens or a command starts there), `signListenerCount` (how many listeners for these events the extension holds) and `close`.
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
}): Promise<{
  chatRequests: Array<{ name: string; query: string }>
  executedCommands: string[]
  notices: string[]
  warnings: string[]
  errors: string[]
  offeredActions: Array<{ message: string; actions: string[] }>
  confirmations: string[]
  confirmationDetails: string[]
  progressTitles: string[]
  statusBarTexts: string[]
  visibleStatusBarTexts(): string[]
  looks: {
    candidateListings: number
    stampReads: number
    stampReadsDone: number
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
  const progressTitles: string[] = []
  const statusBarTexts: string[] = []
  const statusBarEntries: FakeStatusBarEntry[] = []
  const looks = { candidateListings: 0, stampReads: 0, stampReadsDone: 0 }
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
  const commands = new Map<string, () => Promise<void>>()
  const holds = new Map<
    HeldUpdateStep,
    { reached(): void; released: Promise<void> }
  >()
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../../extension.js'),
    {
      vscode: {
        ProgressLocation: { Notification: 15 },
        StatusBarAlignment: { Left: 1, Right: 2 },
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
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
            ].filter(
              (command) => !options.missingEditorCommands?.includes(command),
            ),
          executeCommand: async (name: string, argument?: unknown) => {
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
          onDidOpenTextDocument: (
            listener: (document: FakeTextDocument) => void,
          ) => {
            if (options.signWatchFails !== undefined)
              throw new Error(options.signWatchFails)
            return listenTo(documentOpenListeners, listener)
          },
          // The opened Wiki watches the project's files; these tests report no file event.
          createFileSystemWatcher:
            createFakeFileWatching().createFileSystemWatcher,
        },
        env: {
          ...(options.cursor ? { appName: 'Cursor' } : {}),
          asExternalUri: keepLocalAddress,
          openExternal: async () => true,
        },
        Uri: { parse: parseFakeUri },
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
            return Promise.resolve(
              options.declineConfirmation ? undefined : choices[0],
            )
          },
          showErrorMessage: (message: string, ...actions: string[]) =>
            showNotification(errors, message, actions),
          onDidOpenTerminal: (listener: () => void) =>
            listenTo(terminalOpenListeners, listener),
          onDidStartTerminalShellExecution: (
            listener: (event: FakeShellExecution) => void,
          ) => listenTo(terminalCommandListeners, listener),
          // A real editor always has both, so every test runs the product's own way of showing a run; only collecting their Cancel is optional.
          withProgress,
          createStatusBarItem,
        },
      },
      './environment': { requireWorkspace: () => openedWorkspace },
      ...(options.constants
        ? { './constants': { ...constants, ...options.constants } }
        : {}),
      // The real start check runs; a test that holds its wait at a fresh journal decides when the second look comes, and otherwise the real time passes.
      './utils/findWikiUpdateStartBlock': {
        findWikiUpdateStartBlock: (
          outputDirectory: string,
          projectRoot: string,
        ) =>
          findWikiUpdateStartBlock(outputDirectory, projectRoot, {
            wait: async (delayMs: number) => {
              if (holds.has('journal-wait')) await passHold('journal-wait')
              else await sleepFor(delayMs)
            },
          }),
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
      // The real claim on the marker runs; the window records each change of its marker (its removal, its turn into a stopped watch's reservation) and what that change answered.
      './utils/claimWikiUpdateMarker': {
        claimWikiUpdateMarker: async (
          ...claimed: Parameters<typeof claimWikiUpdateMarker>
        ) => {
          const claim = await claimWikiUpdateMarker(...claimed)
          if (!('release' in claim)) return claim
          return {
            release: () => recordMarkerChange('release', claim.release()),
            reserve: (watchEndedAtMs: number) =>
              recordMarkerChange('reserve', claim.reserve(watchEndedAtMs)),
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
      './utils/readWikiPublishToken': {
        readWikiPublishToken: async (outputDirectory: string) => {
          if (publishTokenReadFailure !== undefined)
            throw new Error(publishTokenReadFailure)
          await passHold('publish-token-read')
          return readWikiPublishToken(outputDirectory)
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
        ) =>
          options.cursorAgent
            ? options.cursorAgent(root, prompt, signal, timeoutMs)
            : 'Updated',
      },
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async (
          ...checked: Parameters<typeof inspectDeepWikiFreshness>
        ) => {
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
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
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
  return {
    chatRequests,
    executedCommands,
    notices,
    warnings,
    errors,
    offeredActions,
    confirmations,
    confirmationDetails,
    progressTitles,
    statusBarTexts,
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
    },
    setFreshness(next: WikiFreshness): void {
      freshness = next
    },
    breakPublishTokenRead(message: string | undefined): void {
      publishTokenReadFailure = message
    },
    hold(step: HeldUpdateStep): { started: Promise<void>; release(): void } {
      let reached = (): void => {}
      let release = (): void => {}
      const started = new Promise<void>((resolveStarted) => {
        reached = resolveStarted
      })
      const released = new Promise<void>((resolveReleased) => {
        release = resolveReleased
      })
      holds.set(step, { reached, released })
      return {
        started,
        release(): void {
          holds.delete(step)
          release()
        },
      }
    },
    close: (): Promise<void> => boundary.deactivate(),
  }
}
