import { resolve } from 'node:path'

import * as constants from '../../constants'
import { readDeepWikiManifest } from '../../deepWikiReader'
import type * as ExtensionModule from '../../extension'
import type { WikiFreshness } from '../../utils/inspectDeepWikiFreshness'
import { listWikiCandidates } from '../../utils/listWikiCandidates'
import { waitForWikiPublish } from '../../utils/waitForWikiPublish'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { loadModule } from './loadModule'

/** The Cancel button of one progress notification the window showed. */
export type CancellableProgress = {
  cancel(): void
}

type UriHandler = (uri: { path: string; query: string }) => Promise<void>

/** Names of the extension's numeric constants, the ones a test may replace by a shorter value. */
type NumericConstantName = {
  [Name in keyof typeof constants]: (typeof constants)[Name] extends number
    ? Name
    : never
}[keyof typeof constants]

/** An awaited step of an update's start that a test can keep open: the freshness inspection among the start checks, or VS Code's chat command. */
export type HeldUpdateStep = 'freshness-inspection' | 'chat-open'

/**
 * Opens an editor window (the real extension with a stubbed `vscode`) on a project whose Wiki already exists, and records everything the learner would see of an update.
 *
 * Why: the update flow spans the URI handler, the command, the run state and the notifications; the tests need one window that records all of them while the Wiki folder on disk stays real.
 * Used by the Wiki update flow tests.
 *
 * @param options.projectRoot - Canonical folder the window has open.
 * @param options.outputSetting - Value of `codebook.wikiOutputDirectory`; `.codebook/wiki` when omitted.
 * @param options.cursor - Whether the host is Cursor (the agent runs through its CLI) instead of VS Code (chat plus watch).
 * @param options.chatFails - Makes VS Code's chat command throw.
 * @param options.cursorAgent - What the Cursor agent does; it gets the project, the prompt, the run's abort signal and the bound the run would stop it at.
 * @param options.cancellable - Collects the Cancel button of each progress notification; the window shows the notification and records its title also when omitted.
 * @param options.declineConfirmation - Makes the learner dismiss the modal confirmation of the browser's update link.
 * @param options.watchClock - Clock and sleep handed to the watch, so a test can pass the 15 minute bound without waiting.
 * @param options.openReader - Whether to open the browser reader first, which the state snapshot needs; true when omitted.
 * @param options.constants - Replaces numeric constants of the extension (the grace a closing window gives the Cursor agent, the Cursor run's two-second look interval, a bound), so a test need not wait for them.
 * @param options.chooseAction - Presses a button of a notification: it gets the notification's text and its button labels and returns the label to press; no button is pressed when omitted.
 * @param options.workspaceState - The window's workspace state; two windows opened with the same map are one window before and after a reload.
 * @returns What the window showed (chat requests, notifications by severity, the buttons each notification offered, confirmations, progress titles), how often its looks listed the candidates, the two update entries, the state snapshot, `openWorkspace` (makes the window answer another folder as its opened project from then on), `hold` (keeps one awaited step of the next start open until `release()`, so a test can close the window in the middle of it) and `close`.
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
  chatFails?: boolean
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
  chooseAction?: (message: string, actions: string[]) => string | undefined
  workspaceState?: Map<string, unknown>
}): Promise<{
  chatRequests: Array<{ name: string; query: string }>
  notices: string[]
  warnings: string[]
  errors: string[]
  offeredActions: Array<{ message: string; actions: string[] }>
  confirmations: string[]
  progressTitles: string[]
  looks: { candidateListings: number }
  openWorkspace(nextProjectRoot: string): void
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
  const confirmations: string[] = []
  const progressTitles: string[] = []
  const looks = { candidateListings: 0 }
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../../extension.js'),
    {
      vscode: {
        ProgressLocation: { Notification: 15 },
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          executeCommand: async (name: string, argument?: unknown) => {
            if (options.chatFails) throw new Error('Chat is unavailable')
            await passHold('chat-open')
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
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => outputSetting }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        env: {
          ...(options.cursor ? { appName: 'Cursor' } : {}),
          openExternal: async () => true,
        },
        Uri: { parse: (value: string) => ({ value }) },
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
            messageOptions?: { modal?: boolean } | string,
            ...choices: string[]
          ) => {
            if (typeof messageOptions === 'string')
              return showNotification(warnings, message, [
                messageOptions,
                ...choices,
              ])
            if (!messageOptions?.modal)
              return showNotification(warnings, message, [])
            confirmations.push(message)
            return Promise.resolve(
              options.declineConfirmation ? undefined : choices[0],
            )
          },
          showErrorMessage: (message: string, ...actions: string[]) =>
            showNotification(errors, message, actions),
          // A real editor always has it, so every test runs the product's notification path; only collecting the Cancel buttons is optional.
          withProgress,
        },
      },
      './environment': { requireWorkspace: () => openedWorkspace },
      ...(options.constants
        ? { './constants': { ...constants, ...options.constants } }
        : {}),
      // The real listing runs; the window only counts how often a look parsed the candidates.
      './utils/listWikiCandidates': {
        listWikiCandidates: (outputDirectory: string) => {
          looks.candidateListings += 1
          return listWikiCandidates(outputDirectory)
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
        inspectDeepWikiFreshness: async () => {
          await passHold('freshness-inspection')
          return freshness
        },
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
    progressTitles,
    looks,
    openWorkspace(nextProjectRoot: string): void {
      openedWorkspace = nextProjectRoot
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
