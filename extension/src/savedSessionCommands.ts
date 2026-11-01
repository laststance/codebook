import { basename } from 'node:path'

import type * as vscode from 'vscode'

import {
  REMOVE_SAVED_SESSION_COMMAND,
  SAVED_SESSION_ACTIONS_COMMAND,
  SAVED_SESSION_STATUS_PRIORITY,
  SET_UP_SAVED_SESSION_COMMAND,
  SIGN_IN_STOP_RUN_BOUND_MS,
  type SignInRequiredReason,
} from './constants'
import type { DevelopmentServerAdapterName } from './developmentServerAdapter'
import { signInPathSchema } from './repositoryConfigSchemas'
import type { StudyEnvironment } from './runtime'
import type {
  SavedSessionEntry,
  SavedSessionManagerPort,
  SavedSessionRemoval,
} from './runtimeSupport/savedSessionSetupTypes'
import { launchSignInBrowser } from './runtimeSupport/signInBrowser'
import {
  SavedSessionSetup,
  type SavedSessionSetupUi,
  type SetupPhase,
} from './savedSessionSetup'
import { discoverSignInPaths } from './utils/discoverSignInPaths'
import {
  savedSessionStatusText,
  type SavedSessionStatusInput,
} from './utils/savedSessionStatusText'
import type { NoticeSeverity } from './utils/showPlainNotice'

/** The slice of the editor API the commands use; the real `vscode` satisfies it and a test supplies a small stand-in. */
export interface SavedSessionEditor {
  window: {
    createStatusBarItem(
      id: string,
      alignment: number,
      priority: number,
    ): SavedSessionStatusItem
    onDidChangeWindowState(listener: (state: { focused: boolean }) => void): {
      dispose(): void
    }
    showQuickPick<Item extends string | { label: string }>(
      items: readonly Item[],
      options?: { title?: string },
    ): Thenable<Item | undefined>
    showInputBox(options: {
      title?: string
      prompt?: string
      validateInput?: (value: string) => string | undefined
    }): Thenable<string | undefined>
    showWarningMessage(
      message: string,
      options: { modal: true; detail?: string },
      ...items: string[]
    ): Thenable<string | undefined>
  }
  commands: { executeCommand(command: string): Thenable<unknown> }
  StatusBarAlignment: { Right: number }
}

/** The members of the status bar item the commands touch. */
export type SavedSessionStatusItem = Pick<
  vscode.StatusBarItem,
  'text' | 'tooltip' | 'command' | 'name' | 'show' | 'hide' | 'dispose'
>

/** The editor effects the saved-session commands act through, bound by {@link activate}. */
export interface SavedSessionCommandOptions {
  /** The editor API, passed in (never imported) so tests load this module with a stand-in, as {@link registerLlmWikiCommands} does. */
  editor: SavedSessionEditor
  store: SavedSessionManagerPort
  register(
    command: string,
    handler: (...commandArguments: unknown[]) => unknown,
  ): vscode.Disposable
  showNotice<Action extends string>(
    severity: NoticeSeverity,
    message: string,
    ...actions: Action[]
  ): Thenable<Action | undefined>
  output: Pick<vscode.LogOutputChannel, 'info' | 'error' | 'show'> | undefined
  /** Starts the agent server's environment when needed and returns it. */
  ensureEnvironment(): Promise<StudyEnvironment>
  /** Stops the run with this service run id; resolves after its cleanup. */
  stopRun(runId: string): Promise<void>
  /** The workspace repository's root; throws when the window has no usable workspace. */
  workspaceRoot(): string
  /** Test seam: how long Stop run and remove waits; the product uses {@link SIGN_IN_STOP_RUN_BOUND_MS}. */
  stopRunBoundMs?: number
}

/** What {@link installSavedSessions} hands back to the extension. */
export interface InstalledSavedSessions {
  disposables: vscode.Disposable[]
  /** Shows the one notice (DES-3) of a run that needs a saved session and sets the status item's "needed" state. */
  showSignInRequired(reason: SignInRequiredReason): void
  /** Closes an open setup as the window closes and releases what it holds. */
  dispose(): Promise<void>
}

const SIGN_IN_REQUIRED_NOTICES: Record<
  SignInRequiredReason,
  (repositoryName: string) => string
> = {
  'no-saved-session': (name) => `This run needs a saved session for ${name}.`,
  'setup-not-finished': (name) =>
    `The last setup for ${name} was closed without Done, so runs do not use it.`,
  'redirected-to-sign-in': (name) =>
    `The saved session for ${name} may have expired. Set it up again.`,
  'session-cookie-only': (name) =>
    `${name} keeps its sign-in only while the browser stays open, so a saved session cannot keep it.`,
}
const SET_UP_BUTTON = 'Set Up Saved Session…'
const ANOTHER_PATH_LABEL = 'Another path…'
const ADAPTER_LABELS: Record<DevelopmentServerAdapterName, string> = {
  'next-dev-webpack': 'Next.js (webpack dev server)',
  'vite-dev': 'Vite dev server',
}

/** Words a removal that did not delete, for the notice. */
function refusalNotice(
  removal: Exclude<
    SavedSessionRemoval,
    { outcome: 'removed' | 'run-in-this-window' }
  >,
  name: string,
): string {
  switch (removal.outcome) {
    case 'in-use-elsewhere':
      return `The saved session for ${name} is in use by a run in another window. Stop that run there, then remove it again.`
    case 'setup-open':
      return `Setup for ${name} is open. Choose Done or Close setup first, then remove it.`
    case 'refused-path':
      return `Codebook did not remove the saved session for ${name}: its folder is not a saved-session folder.`
    case 'partly-removed':
      return `Codebook removed part of the saved session for ${name}: ${removal.cause}. Remove it again.`
  }
}

/**
 * Registers Set Up Saved Session…, Remove Saved Session… and the status item's menu, and keeps the status item current.
 * Why it exists: the saved session is the learner's own sign-in kept per repository; these commands are the only way to create or delete it, and the item is the only place that says when it was set up.
 * Called once by {@link activate}; the store comes from lane A1 and is a fake in tests.
 * @param options - The store, the editor effects and the hooks into the agent server's environment and stop.
 * @returns The disposables to push, {@link InstalledSavedSessions.showSignInRequired} for refused runs, and `dispose` for the window closing.
 * @example
 * const saved = installSavedSessions({ editor: vscode, store, register: registerCommand, showNotice, output, ensureEnvironment, stopRun, workspaceRoot: requireWorkspace })
 * context.subscriptions.push(...saved.disposables)
 */
export function installSavedSessions(
  options: SavedSessionCommandOptions,
): InstalledSavedSessions {
  const { store, showNotice, output, editor } = options
  let item: SavedSessionStatusItem | undefined
  let needed:
    { reason: SignInRequiredReason; repositoryName: string } | undefined
  let shown: { text: string; tooltip: string } | undefined
  const safeRoot = (): string | undefined => {
    try {
      return options.workspaceRoot()
    } catch {
      return undefined
    }
  }
  /** Recomputes the item from the setup of this window, then a run's need, then the stored session. */
  const refresh = async (): Promise<void> => {
    const root = safeRoot()
    let input: SavedSessionStatusInput | undefined
    if (setup.isActive && setup.phase)
      input = { kind: 'setup', phase: setup.phase }
    else if (needed) input = { kind: 'needed', ...needed }
    else if (root)
      input = {
        kind: 'view',
        view:
          (await store.describeForUi(root).catch(() => undefined)) ??
          unusableView(root),
      }
    const text = input ? savedSessionStatusText(input) : undefined
    paint(text)
  }
  /** Touches the item only for what changed: each write is a message to the status bar. */
  const paint = (text: { text: string; tooltip: string } | undefined): void => {
    if (!text) {
      if (shown) item?.hide()
      shown = undefined
      return
    }
    if (!item) {
      item = editor.window.createStatusBarItem(
        'codebook.savedSession',
        editor.StatusBarAlignment.Right,
        SAVED_SESSION_STATUS_PRIORITY,
      )
      item.name = 'Codebook saved session'
      item.command = SAVED_SESSION_ACTIONS_COMMAND
    }
    if (shown?.text !== text.text) item.text = text.text
    if (shown?.tooltip !== text.tooltip) item.tooltip = text.tooltip
    if (!shown) item.show()
    shown = text
  }
  const unusableView = (root: string) => ({
    available: false,
    state: 'unusable' as const,
    repositoryName: basename(root),
    setupOpenHere: false,
  })
  const ui: SavedSessionSetupUi = {
    showStatus: (phase: SetupPhase | undefined) => {
      if (phase) needed = undefined
      void refresh()
    },
    offerDoneOrClose: (name) =>
      showNotice(
        'information',
        `Sign in to ${name} in the Codebook browser window. This window is not recorded, and Codebook never sees what you type there. When you are signed in, choose Done.`,
        'Done',
        'Close setup',
      ),
    warnClosingSoon: () =>
      showNotice(
        'warning',
        'Setup closes in 2 minutes. Choose Done if you are signed in.',
        'Done',
      ),
    notify: (severity, message, ...actions) =>
      showNotice(severity, message, ...actions),
    log: (level, line) => {
      if (level === 'error') output?.error(line)
      else output?.info(line)
    },
    showLog: () => output?.show(true),
  }
  const setup = new SavedSessionSetup({
    store,
    ui,
    startServer: async (adapter, signInPath, signal) => {
      const environment = await options.ensureEnvironment()
      if (!environment.startSavedSessionServer)
        throw new Error('this editor build cannot start the setup server')
      return environment.startSavedSessionServer(adapter, signInPath, signal)
    },
    launchBrowser: (launchOptions) => launchSignInBrowser(launchOptions),
    clock: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => {
        if (handle !== undefined) clearTimeout(handle as NodeJS.Timeout)
      },
    },
  })

  /** Picks the adapter to start: the only ready one, else the learner's choice. */
  const pickAdapter = async (
    adapters: Extract<
      Awaited<
        ReturnType<NonNullable<StudyEnvironment['savedSessionSetupInputs']>>
      >,
      { ready: true }
    >['adapters'],
  ): Promise<DevelopmentServerAdapterName | undefined> => {
    const names = Object.keys(ADAPTER_LABELS).filter(
      (name): name is DevelopmentServerAdapterName => name in adapters,
    )
    const ready = names.filter((name) => adapters[name].ready)
    if (ready.length === 1) return ready[0]
    const picked = await editor.window.showQuickPick(
      names.map((name) => ({ label: ADAPTER_LABELS[name], name })),
      { title: 'Which development server starts the app?' },
    )
    return picked?.name
  }

  /** Asks where the app signs in; the first item is the last run's or the discovered route. */
  const pickSignInPath = async (
    name: string,
    candidates: readonly string[],
  ): Promise<string | undefined> => {
    const picked = await editor.window.showQuickPick(
      [...candidates, ANOTHER_PATH_LABEL],
      { title: `Saved session for ${name}: where does the app sign in?` },
    )
    if (picked !== ANOTHER_PATH_LABEL) return picked
    return editor.window.showInputBox({
      title: `Saved session for ${name}: where does the app sign in?`,
      prompt: 'A path of the app, for example /login',
      validateInput: (value) =>
        signInPathSchema.safeParse(value).success
          ? undefined
          : 'Use an absolute path of the app, such as /login, without a query.',
    })
  }

  /** Re-offers Done and Close setup for a setup that is open or stuck. */
  const reofferSetup = async (name: string): Promise<void> => {
    if (setup.phase?.phase === 'stuck') return setup.closeSetup('closed')
    const choice = await ui.offerDoneOrClose(name)
    if (choice === 'Done') await setup.done()
    else if (choice === 'Close setup') await setup.closeSetup('closed')
  }

  const setUpCommand = async (): Promise<void> => {
    const root = options.workspaceRoot()
    const name = basename(root)
    if (setup.isActive) return reofferSetup(name)
    const environment = await options.ensureEnvironment()
    const inputs = await environment.savedSessionSetupInputs?.()
    if (!inputs)
      throw new Error('this editor build cannot set up a saved session')
    if (!inputs.ready) {
      void showNotice(
        'error',
        `Saved session setup cannot start: ${inputs.missing.join('; ')}`,
      )
      return
    }
    const adapter = await pickAdapter(inputs.adapters)
    if (!adapter) return
    const discovered = await discoverSignInPaths(
      root,
      adapter,
      new AbortController().signal,
    )
    const candidates = [
      ...new Set([...store.lastSignInPaths(root), ...discovered]),
    ]
    const signInPath = await pickSignInPath(name, candidates)
    if (!signInPath) return
    await setup.start({
      repositoryRoot: root,
      repositoryName: name,
      adapter,
      signInPath,
      knownSignInPaths: candidates,
      chromeExecutable: inputs.chrome.binary,
    })
  }

  /** Waits for the run's cleanup to release the folder, at most the stop bound. */
  const waitForRelease = async (hash: string): Promise<void> => {
    let timer: NodeJS.Timeout | undefined
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(
        resolve,
        options.stopRunBoundMs ?? SIGN_IN_STOP_RUN_BOUND_MS,
      )
    })
    try {
      await Promise.race([store.whenReleased(hash), bound])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Removes one entry, offering Stop run and remove while a run of this window holds it. */
  const removeEntry = async (entry: SavedSessionEntry): Promise<void> => {
    const name = entry.repositoryName
    let removal = await store.remove(entry)
    if (removal.outcome === 'run-in-this-window') {
      const choice = await editor.window.showWarningMessage(
        `A Codebook run is using the saved session for ${name}.`,
        { modal: true },
        'Stop run and remove',
      )
      if (choice !== 'Stop run and remove') return
      await options.stopRun(removal.runId)
      await waitForRelease(entry.hash)
      removal = await store.remove(entry)
    }
    if (removal.outcome === 'removed')
      void showNotice('information', `Saved session for ${name} removed.`)
    else if (removal.outcome === 'run-in-this-window')
      void showNotice(
        'error',
        `The run for ${name} did not release the saved session. Try again once it has stopped.`,
      )
    else void showNotice('error', refusalNotice(removal, name))
  }

  const removeCommand = async (): Promise<void> => {
    const root = options.workspaceRoot()
    const entries = await store.list(root)
    if (entries.length === 0) {
      void showNotice('information', 'There is no saved session to remove.')
      return
    }
    const entry =
      entries.length === 1
        ? entries[0]
        : (
            await editor.window.showQuickPick(
              entries.map((candidate) => ({
                label: candidate.repositoryName,
                description: candidate.state,
                candidate,
              })),
              { title: 'Which saved session do you want to remove?' },
            )
          )?.candidate
    if (!entry) return
    const choice = await editor.window.showWarningMessage(
      `Remove the saved session for ${entry.repositoryName}?`,
      {
        modal: true,
        detail:
          "Codebook deletes its browser folder directly, not to the Trash, because it holds the app's sign-in cookies. Runs then start without it until you set it up again.",
      },
      'Remove',
    )
    if (choice === 'Remove') await removeEntry(entry)
  }

  /** The status item's menu: finish or retry an open setup, or set up and remove. */
  const actionsCommand = async (): Promise<void> => {
    const name = basename(safeRoot() ?? '')
    if (setup.isActive) return reofferSetup(name)
    const picked = await editor.window.showQuickPick([
      SET_UP_BUTTON,
      'Remove Saved Session…',
    ])
    if (picked === SET_UP_BUTTON)
      await editor.commands.executeCommand(SET_UP_SAVED_SESSION_COMMAND)
    else if (picked)
      await editor.commands.executeCommand(REMOVE_SAVED_SESSION_COMMAND)
  }

  const disposables = [
    options.register(SET_UP_SAVED_SESSION_COMMAND, setUpCommand),
    options.register(REMOVE_SAVED_SESSION_COMMAND, removeCommand),
    options.register(SAVED_SESSION_ACTIONS_COMMAND, actionsCommand),
    editor.window.onDidChangeWindowState((state) => {
      if (state.focused) void refresh()
    }),
    { dispose: store.onDidChange(() => void refresh()) },
    { dispose: () => item?.dispose() },
  ]
  void refresh()
  return {
    disposables,
    showSignInRequired: (reason): void => {
      const root = safeRoot()
      const name = root ? basename(root) : 'this repository'
      needed = { reason, repositoryName: name }
      output?.info(`Saved session needed: ${reason}.`)
      void refresh()
      void showNotice(
        'information',
        SIGN_IN_REQUIRED_NOTICES[reason](name),
        SET_UP_BUTTON,
      ).then((pressed) => {
        if (pressed === SET_UP_BUTTON)
          return editor.commands.executeCommand(SET_UP_SAVED_SESSION_COMMAND)
      })
    },
    dispose: (): Promise<void> => setup.dispose(),
  }
}

/**
 * Installs the saved-session commands when the window has a store, and otherwise registers the same two commands so they answer that saved sessions are unavailable instead of "command not found".
 * Called once by {@link activate}; keeps that branch out of the already large activation function.
 * @param options - As {@link installSavedSessions}, with the store optional.
 * @returns The install, whose `showSignInRequired` does nothing and `dispose` resolves at once when there is no store.
 * @example
 * const saved = installSavedSessionCommands({ editor: vscode, store: undefined, register: registerCommand, showNotice, output, ensureEnvironment, stopRun, workspaceRoot })
 */
export function installSavedSessionCommands(
  options: Omit<SavedSessionCommandOptions, 'store'> & {
    store: SavedSessionManagerPort | undefined
  },
): InstalledSavedSessions {
  const { store, ...rest } = options
  if (store) return installSavedSessions({ ...rest, store })
  const unavailable = (): void => {
    void options.showNotice(
      'warning',
      'Saved sessions are not available in this build of Codebook.',
    )
  }
  return {
    disposables: [
      options.register(SET_UP_SAVED_SESSION_COMMAND, unavailable),
      options.register(REMOVE_SAVED_SESSION_COMMAND, unavailable),
    ],
    showSignInRequired: () => undefined,
    dispose: async (): Promise<void> => undefined,
  }
}
