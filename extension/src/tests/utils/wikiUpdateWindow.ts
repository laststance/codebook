import { resolve } from 'node:path'

import * as constants from '../../constants'
import { readDeepWikiManifest } from '../../deepWikiReader'
import type * as ExtensionModule from '../../extension'
import {
  inspectDeepWikiFreshness,
  type WikiFreshness,
} from '../../utils/inspectDeepWikiFreshness'
import { listWikiCandidates } from '../../utils/listWikiCandidates'
import { readWikiPublishToken } from '../../utils/readWikiPublishToken'
import { readWikiWatchStamp } from '../../utils/readWikiWatchStamp'
import { waitForWikiChatAnswer } from '../../utils/waitForWikiChatAnswer'
import { waitForWikiPublish } from '../../utils/waitForWikiPublish'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { assertConstantsReadBy } from './assertConstantsReadBy'
import { keepLocalAddress, parseFakeUri } from './fakeEditorAddresses'
import { createFakeFileWatching, FakeRelativePattern } from './fakeFileWatching'
import { listenTo } from './listenTo'
import { loadModule } from './loadModule'

/** The Cancel button of one progress notification the window showed. */
export type CancellableProgress = {
  cancel(): void
}

type UriHandler = (uri: { path: string; query: string }) => Promise<void>

/** A document the fake editor reports as opened: only the address the extension looks at. */
type FakeTextDocument = { uri: { scheme: string; fsPath: string } }

/** Names of the extension's numeric constants, the ones a test may replace by a shorter value. */
type NumericConstantName = {
  [Name in keyof typeof constants]: (typeof constants)[Name] extends number
    ? Name
    : never
}[keyof typeof constants]

/** An awaited step of an update that a test can keep open: the freshness inspection among the start checks, VS Code's chat command, one listing of the candidates (the next listing after `hold` is kept open once it has read the folder; later ones pass), or a read of the publish token (the start checks read it and so does the end of a run, so a hold set after the start keeps the end open). */
export type HeldUpdateStep =
  | 'freshness-inspection'
  | 'chat-open'
  | 'candidate-listing'
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
 * @param options.chatReply - What VS Code's chat command resolves with once it took the request, as it does with `blockOnResponse` when the chat's response completed or waits for a confirmation; a reply at once (`{}`) when omitted. A promise that never settles is a chat that never answers.
 * @param options.chatAnswerClock - Sleep handed to the wait for the chat's first answer, so a test can pass its 30 second bound without waiting.
 * @param options.cursorAgent - What the Cursor agent does; it gets the project, the prompt, the run's abort signal and the bound the run would stop it at.
 * @param options.cancellable - Collects the Cancel button of each progress notification; the window shows the notification and records its title also when omitted.
 * @param options.declineConfirmation - Makes the learner dismiss the modal confirmation of the browser's update link.
 * @param options.watchClock - Clock and sleep handed to the watch, so a test can pass the 15 minute bound without waiting.
 * @param options.openReader - Whether to open the browser reader first, which the state snapshot needs; true when omitted.
 * @param options.constants - Replaces numeric constants of the extension (the grace a closing window gives the Cursor agent, the Cursor run's two-second look interval, a bound), so a test need not wait for them. The replacement reaches `extension.ts` itself and no module it requires (a utility that reads the same constant keeps the real value), so a constant `extension.ts` never reads is refused ({@link assertConstantsReadBy}).
 * @param options.chooseAction - Presses a button of a notification: it gets the notification's text and its button labels and returns the label to press, or a promise of it for a press that comes later; no button is pressed when omitted.
 * @param options.workspaceState - The window's workspace state; two windows opened with the same map are one window before and after a reload.
 * @param options.publishTokenReadFails - Makes the read of the publish token among the start checks reject with this message.
 * @param options.openWikiFails - Makes the command that opens the browser Wiki (the button "Open LLM Wiki" of a notification runs it) reject with this message.
 * @param options.realFreshnessCheck - Runs the real freshness check against the project on disk instead of answering what `setFreshness` was given.
 * @returns What the window showed (chat requests, notifications by severity, the buttons each notification offered, confirmations with their detail text, progress titles), how often its looks read the watch stamp and listed the candidates, the two update entries, the state snapshot, `openWorkspace` (makes the window answer another folder as its opened project from then on), `hold` (keeps one awaited step of the next start open until `release()`, so a test can close the window in the middle of it) `openDocument`, `openTerminal` and `runTerminalCommand` (what the editor reports when the chat reads a file, opens a terminal or runs a command there) and `close`.
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
  publishTokenReadFails?: string
  realFreshnessCheck?: boolean
  openWikiFails?: string
}): Promise<{
  chatRequests: Array<{ name: string; query: string }>
  notices: string[]
  warnings: string[]
  errors: string[]
  offeredActions: Array<{ message: string; actions: string[] }>
  confirmations: string[]
  confirmationDetails: string[]
  progressTitles: string[]
  looks: { candidateListings: number; stampReads: number }
  openWorkspace(nextProjectRoot: string): void
  openDocument(path: string): void
  openTerminal(): void
  runTerminalCommand(): void
  clickUpdate(): Promise<void>
  runUpdateCommand(): Promise<void>
  status(): WikiUpdateStatus
  setFreshness(freshness: WikiFreshness): void
  hold(step: HeldUpdateStep): { started: Promise<void>; release(): void }
  close(): Promise<void>
}> {
  const { projectRoot } = options
  const outputSetting = options.outputSetting ?? '.codebook/wiki'
  let handleUri: UriHandler | undefined
  let readUpdateStatus: (() => WikiUpdateStatus) | undefined
  // The Wiki is stale until a test says otherwise; a current one ends the click as "already current".
  let freshness: WikiFreshness = {
    status: 'changed',
    changedPaths: ['src/a.ts'],
    addedPaths: [],
  }
  const chatRequests: Array<{ name: string; query: string }> = []
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
  const terminalCommandListeners: Array<() => void> = []
  const confirmations: string[] = []
  const confirmationDetails: string[] = []
  const progressTitles: string[] = []
  const looks = { candidateListings: 0, stampReads: 0 }
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
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          executeCommand: async (name: string, argument?: unknown) => {
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
            await passHold('chat-open')
            const isChatRequest = name === 'workbench.action.chat.open'
            chatRequests.push({
              name,
              query:
                typeof argument === 'object' &&
                argument !== null &&
                'query' in argument &&
                typeof argument.query === 'string'
                  ? argument.query
                  : '',
            })
            // The chat's reply, as `blockOnResponse` returns it; every other command returns nothing.
            if (!isChatRequest) return undefined
            return options.chatReply ? options.chatReply() : {}
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => outputSetting }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          onDidOpenTextDocument: (
            listener: (document: FakeTextDocument) => void,
          ) => listenTo(documentOpenListeners, listener),
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
          onDidStartTerminalShellExecution: (listener: () => void) =>
            listenTo(terminalCommandListeners, listener),
          // A real editor always has it, so every test runs the product's notification path; only collecting the Cancel buttons is optional.
          withProgress,
        },
      },
      './environment': { requireWorkspace: () => openedWorkspace },
      ...(options.constants
        ? { './constants': { ...constants, ...options.constants } }
        : {}),
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
      // The real stamp is read; the window only counts the looks of a watch or of a Cursor run.
      './utils/readWikiWatchStamp': {
        readWikiWatchStamp: (outputDirectory: string) => {
          looks.stampReads += 1
          return readWikiWatchStamp(outputDirectory)
        },
      },
      './utils/readWikiPublishToken': {
        readWikiPublishToken: async (outputDirectory: string) => {
          if (options.publishTokenReadFails !== undefined)
            throw new Error(options.publishTokenReadFails)
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
      // The real wait for the chat's answer runs; only its sleep is replaced by the test's clock when one is given.
      './utils/waitForWikiChatAnswer': {
        waitForWikiChatAnswer: (
          answerOptions: Parameters<typeof waitForWikiChatAnswer>[0],
        ) =>
          waitForWikiChatAnswer({
            ...answerOptions,
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
        workspaceState.set(key, value)
      },
    },
  })
  // The reader serves the update state, so the browser tab must be open first.
  if (options.openReader ?? true)
    await commands.get('codebook.openDeepWiki')?.()
  return {
    chatRequests,
    notices,
    warnings,
    errors,
    offeredActions,
    confirmations,
    confirmationDetails,
    progressTitles,
    looks,
    openWorkspace(nextProjectRoot: string): void {
      openedWorkspace = nextProjectRoot
    },
    openDocument(path: string): void {
      for (const listener of [...documentOpenListeners])
        listener({ uri: { scheme: 'file', fsPath: path } })
    },
    openTerminal(): void {
      for (const listener of [...terminalOpenListeners]) listener()
    },
    runTerminalCommand(): void {
      for (const listener of [...terminalCommandListeners]) listener()
    },
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
    setFreshness(next: WikiFreshness): void {
      freshness = next
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
