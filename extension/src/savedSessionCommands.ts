import { basename } from 'node:path'

import type * as vscode from 'vscode'

import {
  REMOVE_SAVED_SESSION_COMMAND,
  REVIEW_SAVED_SESSION_OPERATIONS_COMMAND,
  SAVED_SESSION_ACTIONS_COMMAND,
  SAVED_SESSION_STATUS_PRIORITY,
  SET_UP_SAVED_SESSION_COMMAND,
  SIGN_IN_SETUP_TIMEOUT_MS,
  SIGN_IN_SETUP_WARNING_MS,
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
  SavedSessionView,
} from './runtimeSupport/savedSessionSetupTypes'
import { launchSignInBrowser } from './runtimeSupport/signInBrowser'
import {
  SavedSessionSetup,
  type SavedSessionSetupUi,
  type SetupPhase,
} from './savedSessionSetup'
import { describeMinutes } from './utils/describeMinutes'
import { discoverSignInPaths } from './utils/discoverSignInPaths'
import {
  savedSessionStatusText,
  type SavedSessionStatusInput,
} from './utils/savedSessionStatusText'
import type { NoticeSeverity } from './utils/showPlainNotice'
import { signInRequiredNotice } from './utils/signInRequiredNotice'
import { thrownMessage } from './utils/thrownMessage'

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
  commands: {
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>
  }
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
  /** The run that waits for the learner to confirm its operations again (DES-4); the status item shows it and offers Review operations again. */
  awaitingReview?(): { runId: string; repository: string } | undefined
  /** Test seam: how long Stop run and remove waits; the product uses {@link SIGN_IN_STOP_RUN_BOUND_MS}. */
  stopRunBoundMs?: number
}

/** What {@link installSavedSessions} hands back to the extension. */
export interface InstalledSavedSessions {
  disposables: vscode.Disposable[]
  /** Shows the one notice (DES-3) of a run that needs a saved session and sets the status item's "needed" state, which lasts until the saved session changes after that run (a later run takes it, or a setup or removal changes it). */
  showSignInRequired(reason: SignInRequiredReason): void
  /** Redraws the status item; the extension calls it when the operations review state changes. */
  refresh(): void
  /** Closes an open setup as the window closes and releases what it holds. */
  dispose(): Promise<void>
}

const SET_UP_BUTTON = 'Set Up Saved Session…'
const CLOSE_SETUP_BUTTON = 'Close setup'
/** The status item's first menu entry while a run waits for its operations to be confirmed; the notification's button is {@link REVIEW_AGAIN_LABEL}, a different label. */
const REVIEW_OPERATIONS_AGAIN_LABEL = 'Review operations again'
const ANOTHER_PATH_LABEL = 'Another path…'
const ADAPTER_LABELS: Record<DevelopmentServerAdapterName, string> = {
  'next-dev-webpack': 'Next.js (webpack dev server)',
  'vite-dev': 'Vite dev server',
}

/**
 * A refused run's need for a saved session, which the status item shows until the saved session changes after that run.
 * Set by {@link InstalledSavedSessions.showSignInRequired}; read and dropped by the item's refresh and the store's change listener.
 */
type NeededMark = {
  reason: SignInRequiredReason
  repositoryName: string
  /** The stored session as the first refresh after the refusal read it; a different one later means a setup or a removal changed it, in this window or another. */
  storedKey?: string
  /** Set once the refused run let go of the saved session, so the next store change is a later run, a setup or a removal, not that run's own cleanup. */
  isRunReleased: boolean
}

/**
 * Names the part of a stored session a setup or a removal changes, so the status item can tell that the session changed since a run was refused.
 * @param view - The store's view of the workspace repository.
 * @returns The state and setup time as one string.
 * @example
 * storedSessionKey({ available: true, state: 'saved', setupAt: '2026-11-02T12:10:00.000Z', repositoryName: 'shop', setupOpenHere: false }) // => 'saved 2026-11-02T12:10:00.000Z'
 * storedSessionKey({ available: false, state: 'none', repositoryName: 'shop', setupOpenHere: false })                                        // => 'none '
 */
function storedSessionKey(view: SavedSessionView): string {
  return `${view.state} ${view.setupAt ?? ''}`
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
  let needed: NeededMark | undefined
  let shown: { text: string; tooltip: string } | undefined
  const safeRoot = (): string | undefined => {
    try {
      return options.workspaceRoot()
    } catch {
      return undefined
    }
  }
  /** Reads the stored session of the workspace; a store that cannot answer (for example a workspace folder that no longer exists) gives `undefined`, never a guess. */
  const storedView = async (): Promise<SavedSessionView | undefined> => {
    const root = safeRoot()
    return root
      ? await store.describeForUi(root).catch(() => undefined)
      : undefined
  }
  /** Shows a refused run's need while the stored session is the one that run met; once a setup or removal changed it, the need is dropped and the stored session shows. */
  const neededOrStored = (
    view: SavedSessionView | undefined,
  ): SavedSessionStatusInput | undefined => {
    const mark = needed
    if (!mark) return view && { kind: 'view', view }
    // A store that cannot answer tells nothing about a change; its first answer after the refusal fixes the session the run met.
    if (view !== undefined) mark.storedKey ??= storedSessionKey(view)
    if (view === undefined || mark.storedKey === storedSessionKey(view))
      return {
        kind: 'needed',
        reason: mark.reason,
        repositoryName: mark.repositoryName,
      }
    needed = undefined
    return { kind: 'view', view }
  }
  /** What the item shows: the setup of this window, then a run waiting for its operations, then a refused run's need, then the stored session. */
  const statusInput = async (): Promise<
    SavedSessionStatusInput | undefined
  > => {
    if (setup.isActive && setup.phase)
      return { kind: 'setup', phase: setup.phase }
    const awaiting = options.awaitingReview?.()
    if (awaiting) return { kind: 'review', repositoryName: awaiting.repository }
    return neededOrStored(await storedView())
  }
  /** Recomputes the item from {@link statusInput}. */
  let latestRefresh = 0
  const refresh = async (): Promise<void> => {
    // A refresh that started earlier and finishes later must not paint over the newer one.
    const thisRefresh = ++latestRefresh
    const input = await statusInput()
    if (thisRefresh !== latestRefresh) return
    paint(input ? savedSessionStatusText(input) : undefined)
  }
  /**
   * Drops a refused run's need at the first store change after that run let go of the saved session (a later run taking it, a setup or a removal), then redraws.
   * The refused run's own release is not such a change: it only marks the run as released.
   */
  const onStoreChange = (hash: string): void => {
    const mark = needed
    if (mark?.isRunReleased) needed = undefined
    else if (mark)
      void store.whenReleased(hash).then(() => {
        mark.isRunReleased = true
      })
    void refresh()
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
        CLOSE_SETUP_BUTTON,
      ),
    warnClosingSoon: () =>
      showNotice(
        'warning',
        `Setup closes in ${describeMinutes(SIGN_IN_SETUP_TIMEOUT_MS - SIGN_IN_SETUP_WARNING_MS)}. Choose Done if you are signed in.`,
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

  /** Picks the adapter to start: the only ready one, else the learner's choice among the ready ones; with none ready, says what each misses before any lock or folder is taken. */
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
    if (ready.length === 0) {
      const missing = new Set(names.flatMap((name) => adapters[name].missing))
      void showNotice(
        'error',
        `Saved session setup cannot start: no development server is ready. ${[...missing].join(' ')}`,
      )
      return undefined
    }
    if (ready.length === 1) return ready[0]
    const picked = await editor.window.showQuickPick(
      ready.map((name) => ({ label: ADAPTER_LABELS[name], name })),
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

  /** Answers Set Up and the status item while a setup of this window is active: Close setup for a start, a wait notice while it ends, a retry when stuck, else Done and Close setup again. Each answer acts only on the setup that showed its notice. */
  const reofferSetup = async (name: string): Promise<void> => {
    // A notice answered after its setup ended never ends a later setup (outside voice 5).
    const { generation } = setup
    const phase = setup.phase?.phase
    // A stuck setup is retried at once: no notice is shown, so no answer can come late.
    if (phase === 'stuck') return setup.closeSetup('closed')
    // Ending already: Done or Close setup would only wait for the same close.
    if (phase === 'finishing') {
      void showNotice(
        'information',
        `Setup for ${name} is ending: Codebook is closing its browser.`,
      )
      return
    }
    // No browser is open yet, so there is nothing to sign in to and no Done; Close setup stops the start.
    if (phase === 'starting') {
      const choice = await showNotice(
        'information',
        `Codebook is starting ${name} to open its sign-in page.`,
        CLOSE_SETUP_BUTTON,
      )
      return setup.answer(generation, choice)
    }
    return setup.answer(generation, await ui.offerDoneOrClose(name))
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
      ...new Set([...(await store.lastSignInPaths(root)), ...discovered]),
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
    const awaiting = options.awaitingReview?.()
    // A run that waits for its operations to be confirmed comes first (DES-4).
    const picked = await editor.window.showQuickPick([
      ...(awaiting ? [REVIEW_OPERATIONS_AGAIN_LABEL] : []),
      SET_UP_BUTTON,
      'Remove Saved Session…',
    ])
    if (picked === REVIEW_OPERATIONS_AGAIN_LABEL && awaiting)
      await editor.commands.executeCommand(
        REVIEW_SAVED_SESSION_OPERATIONS_COMMAND,
        awaiting.runId,
      )
    else if (picked === SET_UP_BUTTON)
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
    { dispose: store.onDidChange(onStoreChange) },
    { dispose: () => item?.dispose() },
  ]
  void refresh()
  return {
    disposables,
    showSignInRequired: (reason): void => {
      const root = safeRoot()
      const name = root ? basename(root) : 'this repository'
      needed = { reason, repositoryName: name, isRunReleased: false }
      output?.info(`Saved session needed: ${reason}.`)
      void refresh()
      void showNotice(
        'information',
        signInRequiredNotice(reason, name),
        SET_UP_BUTTON,
      )
        .then((pressed) => {
          if (pressed === SET_UP_BUTTON)
            return editor.commands.executeCommand(SET_UP_SAVED_SESSION_COMMAND)
        })
        // A setup started from this notice has no editor surface that shows its failure, so it is shown here.
        .then(undefined, (error: unknown) => {
          void showNotice('error', thrownMessage(error))
        })
    },
    refresh: (): void => void refresh(),
    dispose: (): Promise<void> => setup.dispose(),
  }
}
