import { resolve } from 'node:path'

import * as constants from '../../constants'
import { readDeepWikiManifest } from '../../deepWikiReader'
import type * as ExtensionModule from '../../extension'
import type { WikiFreshness } from '../../utils/inspectDeepWikiFreshness'
import { waitForWikiPublish } from '../../utils/waitForWikiPublish'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { loadModule } from './loadModule'

/** The Cancel button of one progress notification the window showed. */
export type CancellableProgress = {
  cancel(): void
}

type UriHandler = (uri: { path: string; query: string }) => Promise<void>

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
 * @param options.cursorAgent - What the Cursor agent does; it gets the project, the prompt and the run's abort signal.
 * @param options.cancellable - Collects the Cancel button of each progress notification.
 * @param options.declineConfirmation - Makes the learner dismiss the modal confirmation of the browser's update link.
 * @param options.watchClock - Clock and sleep handed to the watch, so a test can pass the 15 minute bound without waiting.
 * @param options.openReader - Whether to open the browser reader first, which the state snapshot needs; true when omitted.
 * @param options.terminationGraceMs - Replaces the grace a closing window gives the Cursor agent, so a test need not wait five seconds.
 * @returns What the window showed (chat requests, notifications by severity, confirmations, progress titles), the two update entries, the state snapshot and `close`.
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
  ) => Promise<string>
  cancellable?: CancellableProgress[]
  declineConfirmation?: boolean
  watchClock?: {
    now: () => number
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
  }
  openReader?: boolean
  terminationGraceMs?: number
}): Promise<{
  chatRequests: Array<{ name: string; query: string }>
  notices: string[]
  warnings: string[]
  errors: string[]
  confirmations: string[]
  progressTitles: string[]
  clickUpdate(): Promise<void>
  runUpdateCommand(): Promise<void>
  status(): WikiUpdateStatus
  setFreshness(freshness: WikiFreshness): void
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
  const confirmations: string[] = []
  const progressTitles: string[] = []
  const commands = new Map<string, () => Promise<void>>()
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
          showInformationMessage: (message: string) => {
            notices.push(message)
            return Promise.resolve(undefined)
          },
          // A modal warning is the confirmation of the browser link; a plain one is a notification.
          showWarningMessage: (
            message: string,
            messageOptions?: { modal?: boolean },
            ...choices: string[]
          ) => {
            if (!messageOptions?.modal) {
              warnings.push(message)
              return Promise.resolve(undefined)
            }
            confirmations.push(message)
            return Promise.resolve(
              options.declineConfirmation ? undefined : choices[0],
            )
          },
          showErrorMessage: (message: string) => {
            errors.push(message)
            return Promise.resolve(undefined)
          },
          ...(options.cancellable ? { withProgress } : {}),
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      ...(options.terminationGraceMs === undefined
        ? {}
        : {
            './constants': {
              ...constants,
              WIKI_CURSOR_TERMINATION_GRACE_MS: options.terminationGraceMs,
            },
          }),
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
        ) =>
          options.cursorAgent
            ? options.cursorAgent(root, prompt, signal)
            : 'Updated',
      },
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async () => freshness,
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
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  // The reader serves the update state, so the browser tab must be open first.
  if (options.openReader ?? true)
    await commands.get('codebook.openDeepWiki')?.()
  return {
    chatRequests,
    notices,
    warnings,
    errors,
    confirmations,
    progressTitles,
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
    close: (): Promise<void> => boundary.deactivate(),
  }
}
