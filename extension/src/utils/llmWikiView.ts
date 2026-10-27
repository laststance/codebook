import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import type * as vscode from 'vscode'

import {
  CODEBOOK_HOST_CONTEXT_KEY,
  LLM_WIKI_POLL_MS,
  LLM_WIKI_REFRESH_DEBOUNCE_MS,
  LLM_WIKI_STATE_CONTEXT_KEY,
  LLM_WIKI_VIEW_ID,
  SET_CONTEXT_COMMAND,
  WIKI_OUTPUT_DIRECTORY_SETTING,
} from '../constants'

import { chooseWikiWatchFolder } from './chooseWikiWatchFolder'
import { comparableFilePath } from './comparableFilePath'
import { describeWikiWatch } from './describeWikiWatch'
import { failureKeyOf } from './failureKeyOf'
import {
  LLM_WIKI_ERROR_ROW,
  LLM_WIKI_LOADING_ROW,
  LLM_WIKI_RUN_ROW_IDS,
  LLM_WIKI_WAITING_ROW_IDS,
  readLlmWikiViewState,
  type LlmWikiFreshness,
  type LlmWikiRow,
  type LlmWikiViewFacts,
  type LlmWikiViewModel,
} from './readLlmWikiViewState'

type ReadyFacts = Extract<LlmWikiViewFacts, { kind: 'ready' }>

/** What the view asks of the window, each as a closure of the extension's activation. */
export type LlmWikiViewOptions = {
  /** The editor's API; the view uses its tree, watcher and context-key surfaces only. */
  editor: Pick<
    typeof vscode,
    | 'commands'
    | 'EventEmitter'
    | 'RelativePattern'
    | 'ThemeIcon'
    | 'TreeItem'
    | 'TreeItemCollapsibleState'
    | 'window'
    | 'workspace'
  >
  /** The editor host, set as the context key the welcome content is chosen by. */
  host: 'vscode' | 'cursor'
  /** Reads the facts the rows are made of, without the freshness check ({@link readLlmWikiViewFacts}). */
  readFacts: () => Promise<LlmWikiViewFacts>
  /** Runs the freshness check of the Wiki in the project and folder the shown facts name, so a setting that changed meanwhile cannot make it inspect another Wiki. */
  readFreshness: (location: {
    projectRoot: string
    outputDirectory: string
  }) => Promise<LlmWikiFreshness>
  /** Finds the nearest folder at or above the Wiki output that exists ({@link findNearestExistingAncestor}). */
  findWatchedFolder: (outputDirectory: string) => Promise<string>
  /** Subscribes to changes of this window's run state and to the end of each attempt to change its run marker (removal, or turn into a reservation); returns the unsubscribe function. */
  onRunChange: (listener: () => void) => () => void
  /** Tells the learner that a Wiki was published after a run was stopped or a watch ended. */
  tellPublished: (outputLabel: string) => void
  /** Writes a failure to Output › Codebook, where the error row sends the learner. */
  recordFailure: (message: string, cause: unknown) => void
  /** The trailing debounce of event-driven refreshes (ms). */
  debounceMs?: number
  /** The poll interval while a run row is shown (ms). */
  pollMs?: number
}

/** The view as the extension's wiring and its commands use it. */
export type LlmWikiView = {
  /** Reads the state now and shows it; resolves once the rows are shown (not the freshness check). It never rejects: a read that fails shows the error row. */
  refresh(): Promise<void>
  /** Asks for a refresh after the debounce; many calls inside it become one read. Production reaches it through the editor's events only; tests call it to stand in for one. */
  requestRefresh(): void
  /** Resolves once no debounced refresh is waiting (it has fired or was never scheduled) and no read and no freshness check is under way. Only tests call it, to wait for the view to settle, so a test proves an absent read without a fixed sleep. */
  whenIdle(): Promise<void>
  /** The row with this id as it is shown now. */
  findRow(rowId: string): LlmWikiRow | undefined
  dispose(): void
}

/** What the view remembers of the last ready read, kept across reads that are not ready, so a publication after a removed and restored folder still counts as late. */
type LateWatch = {
  outputDirectory: string
  /** Whether a reservation or a stopped generation was shown. */
  wasWaiting: boolean
  /** The publisher's receipt of the last read. */
  publication: string | undefined
  /** When the manifest was written, as the last read saw it. */
  manifestWrittenAtMs: number | undefined
}

/** The editor's file watcher as the view holds it. */
type HeldWatcher = {
  folder: string
  outputDirectory: string
  dispose: () => void
}

/**
 * Names the publication a cached freshness answer belongs to, so the answer of an older Wiki is never shown for a newer one.
 * @param facts - The ready facts.
 * @returns The folder and the publisher's receipt.
 * @example freshnessKeyOf(facts) // => '/repo/.codebook/wiki|abc@1'
 */
function freshnessKeyOf(facts: ReadyFacts): string {
  return `${facts.outputDirectory}|${facts.publication ?? ''}`
}

/**
 * Creates the LLM Wiki tree view: its data provider, its context keys, and the triggers that read its state again (this window's run, the Wiki files, the setting, trust, visibility and a poll while a run row is shown).
 *
 * Why: the Activity Bar needs one place that shows the generated site's state and its next step; the rows are one pure function of one record of facts ({@link readLlmWikiViewState}), and this module only reads, compares and shows.
 * Trigger: `activate()` in `extension.ts` creates it once per window when the editor offers tree views.
 *
 * A refresh fires a tree change only when the rows, the message or the state actually changed, so a read with nothing new is silent for screen readers and never moves focus. Any failure of one read shows the error row and is recorded once while the error row stands; no refresh rejects.
 *
 * @param options - The editor API and the window's closures ({@link LlmWikiViewOptions}).
 * @returns The view's handle ({@link LlmWikiView}).
 * @example
 * const view = createLlmWikiView({ editor: vscode, host: 'vscode', readFacts, readFreshness, findWatchedFolder, onRunChange, tellPublished, recordFailure })
 * await view.refresh()
 */
export function createLlmWikiView(options: LlmWikiViewOptions): LlmWikiView {
  const { editor } = options
  const debounceMs = options.debounceMs ?? LLM_WIKI_REFRESH_DEBOUNCE_MS
  const pollMs = options.pollMs ?? LLM_WIKI_POLL_MS
  const treeChanges = new editor.EventEmitter<void>()
  let model: LlmWikiViewModel = { state: 'other', rows: [LLM_WIKI_LOADING_ROW] }
  // Until the first read ends the welcome content must not show: the state is `loading`.
  let shownState: string | undefined = 'loading'
  let shownKey = JSON.stringify(model)
  /** The ready facts the rows show now; the freshness answer is shown only for these. */
  let shownReadyFacts: ReadyFacts | undefined
  let lateWatch: LateWatch | undefined
  let freshnessCache: { key: string; value: LlmWikiFreshness } | undefined
  let running: Promise<void> | undefined
  let isRereadWanted = false
  /** The one freshness check that runs, with the loop that re-runs it for the requests that came meanwhile. */
  let freshnessLoop: Promise<void> | undefined
  /** The latest facts that ask for a freshness check; requests while one runs coalesce into this one. */
  let freshnessRequest: ReadyFacts | undefined
  let debounceTimer: NodeJS.Timeout | undefined
  /** Settles when the waiting debounce has fired or was dropped; `whenIdle` waits on it. */
  let debounceSettled:
    { promise: Promise<void>; settle: () => void } | undefined
  /** Whether the tree is shown; a hidden view runs no poll and no freshness check. */
  let isViewVisible = true
  /** Whether the last good read showed a run row, so the poll goes on across a failed read's error row. */
  let wasRunShownBeforeError = false
  /** The key ({@link failureKeyOf}) of the last failure recorded in Output, per kind: `read` is cleared when a good model is shown, `freshness` when a freshness check succeeds, so a failure that persists across poll ticks is recorded once and a different one is recorded too. */
  const recordedFailureKeys: Record<'read' | 'freshness', string | undefined> =
    { read: undefined, freshness: undefined }
  /** Whether the tree view handle exists; an editor may read the provider while it is being created. */
  let isTreeViewCreated = false
  /** The message the tree view shows now; the model's next one is written when the tree reads its root children ({@link show}). */
  let appliedMessage: string | undefined
  let pollTimer: NodeJS.Timeout | undefined
  let isDisposed = false
  let isWatcherBroken = false
  let watcher: HeldWatcher | undefined

  void editor.commands.executeCommand(
    SET_CONTEXT_COMMAND,
    CODEBOOK_HOST_CONTEXT_KEY,
    options.host,
  )
  void editor.commands.executeCommand(
    SET_CONTEXT_COMMAND,
    LLM_WIKI_STATE_CONTEXT_KEY,
    'loading',
  )

  const treeView = editor.window.createTreeView<string>(LLM_WIKI_VIEW_ID, {
    treeDataProvider: {
      onDidChangeTreeData: treeChanges.event,
      getChildren: (element) => {
        if (element) return []
        // Task 16 (N56): the message leaves the extension host in the same macrotask as the reply carrying the new rows, so both paint together; see {@link show}.
        // A root read inside createTreeView finds no handle yet (the first model has no message); after dispose nothing is written.
        if (
          isTreeViewCreated &&
          !isDisposed &&
          model.message !== appliedMessage
        ) {
          appliedMessage = model.message
          treeView.message = model.message
        }
        return model.rows.map((row) => row.id)
      },
      getTreeItem: (rowId) => {
        const row = model.rows.find((candidate) => candidate.id === rowId)
        const item = new editor.TreeItem(
          row?.label ?? rowId,
          editor.TreeItemCollapsibleState.None,
        )
        if (!row) return item
        item.id = row.id
        item.description = row.description
        item.tooltip = row.tooltip
        // A string tooltip would be read as the accessible name, so the name is set apart: the label, then the description.
        item.accessibilityInformation = {
          label: row.description
            ? `${row.label}, ${row.description}`
            : row.label,
        }
        item.iconPath = new editor.ThemeIcon(row.icon)
        item.contextValue = row.actions.map((key) => `[${key}]`).join('')
        if (row.command)
          item.command = {
            command: row.command.command,
            title: row.label,
            arguments: row.command.arguments,
          }
        return item
      },
    },
  })

  isTreeViewCreated = true
  // The editor reports whether the view is shown now; a collapsed view runs no poll.
  isViewVisible = treeView.visible

  /**
   * Shows a model: sets the context key and fires one tree change, only for what differs from what is shown.
   *
   * Task 16 (N56): the editor's extension host merges tree changes and message writes through a leading 200 ms debounce (`Event.debounce(merge, 200, true)` in `ExtHostTreeView`). Its handler sends `$setMessage` at once but only queues the refresh, which takes a round trip (`$refresh` to the main thread, `$getChildren` back, then the render) before the rows paint. A message written here, with the change, paints a round trip ahead of the rows (native take of the earlier fix: one frame before); one written in `getChildren` during the leading emission's window goes out 200 ms late (first native take).
   * So a changed message is not written here: the current message is written again (a same-value write that goes out at once and opens the window), and the tree change merges into the trailing emission, which closes the window. The new message is then written in the root `getChildren` the refresh causes, a new leading emission that leaves with the reply carrying the new rows.
   */
  const show = (next: LlmWikiViewModel): void => {
    // A read that finished after dispose shows nothing.
    if (isDisposed) return
    const nextKey = JSON.stringify(next)
    if (nextKey === shownKey && next.state === shownState) return
    const didStateChange = next.state !== shownState
    model = next
    shownKey = nextKey
    shownState = next.state
    if (didStateChange)
      void editor.commands.executeCommand(
        SET_CONTEXT_COMMAND,
        LLM_WIKI_STATE_CONTEXT_KEY,
        next.state,
      )
    // The leading emission carries only this same-value write, which changes nothing on screen; it opens the debounce window so the tree change below merges into the trailing emission.
    if (next.message !== appliedMessage) treeView.message = appliedMessage
    treeChanges.fire()
  }

  /** Keeps the poll timer running exactly while the view is shown and a run row is shown, or the error row follows a read that showed one. */
  const keepPoll = (): void => {
    if (isDisposed) return
    const isRunShown = model.rows.some((row) =>
      LLM_WIKI_RUN_ROW_IDS.has(row.id),
    )
    const isErrorShown = model.rows.some(
      (row) => row.id === LLM_WIKI_ERROR_ROW.id,
    )
    const isPollWanted =
      isViewVisible && (isRunShown || (isErrorShown && wasRunShownBeforeError))
    if (!isPollWanted) {
      clearInterval(pollTimer)
      pollTimer = undefined
      return
    }
    pollTimer ??= setInterval(() => {
      void refresh()
    }, pollMs).unref()
  }

  /** Asks for a refresh after the debounce; the last call always reads. */
  const requestRefresh = (): void => {
    if (isDisposed) return
    clearTimeout(debounceTimer)
    if (!debounceSettled) {
      let settle: () => void = () => {}
      const promise = new Promise<void>((resolve) => {
        settle = resolve
      })
      debounceSettled = { promise, settle }
    }
    debounceTimer = setTimeout(() => {
      // The read starts in this turn, so `whenIdle` sees it as `running` once the debounce is settled.
      void refresh()
      debounceSettled?.settle()
      debounceSettled = undefined
    }, debounceMs)
    debounceTimer.unref()
  }

  /** Stops watching and says why once, so the view refreshes on visibility and its Refresh action only. */
  const watchNothing = (cause: unknown): void => {
    watcher?.dispose()
    watcher = undefined
    // Output › Codebook records the cause once, until a watcher can be made again.
    if (!isWatcherBroken)
      options.recordFailure(
        'The LLM Wiki view could not watch the Wiki folder',
        cause,
      )
    isWatcherBroken = true
  }

  /**
   * Makes the watcher for a folder and a plan, listening to the planned paths in both their spelling and their real-path spelling.
   * @param folder - The folder the watcher stands on.
   * @param realFolder - The same folder with its symbolic links resolved; a symlinked ancestor makes the editor report this spelling, so both are compared.
   * @param plan - What to listen to ({@link describeWikiWatch}).
   * @param outputDirectory - The resolved Wiki folder.
   * @returns The watcher.
   */
  const makeWatcher = (
    folder: string,
    realFolder: string,
    plan: NonNullable<ReturnType<typeof describeWikiWatch>>,
    outputDirectory: string,
  ): HeldWatcher => {
    const fileWatcher = editor.workspace.createFileSystemWatcher(
      new editor.RelativePattern(folder, plan.glob),
    )
    // The editor may spell the drive letter or the case of a path differently, so both sides are compared in one form.
    const watchedPaths = new Set(
      plan.paths.flatMap((path) => [
        comparableFilePath(path),
        comparableFilePath(join(realFolder, relative(folder, path))),
      ]),
    )
    const onEvent = (file: vscode.Uri): void => {
      if (watchedPaths.has(comparableFilePath(file.fsPath))) requestRefresh()
    }
    const subscriptions = [
      fileWatcher.onDidCreate(onEvent),
      fileWatcher.onDidChange(onEvent),
      fileWatcher.onDidDelete(onEvent),
    ]
    return {
      folder,
      outputDirectory,
      dispose: (): void => {
        for (const subscription of subscriptions) subscription.dispose()
        fileWatcher.dispose()
      },
    }
  }

  /**
   * Puts the watcher on the folder {@link chooseWikiWatchFolder} picks (the project root for an output inside the project, so a deleted Wiki folder is seen), and makes it again when that folder or the output changed.
   * @param readyFacts - The facts just read.
   * @returns Whether a new watcher now stands, so the caller reads once more: an event between the read and the registration is in neither.
   */
  const keepWatcher = async (readyFacts: ReadyFacts): Promise<boolean> => {
    const { outputDirectory, projectRoot } = readyFacts
    // The markers lie beside the output folder, so its parent is the first folder to stand on.
    const nearestExistingFolder = await options.findWatchedFolder(
      dirname(outputDirectory),
    )
    // A read that finished after dispose must leave no watcher behind.
    if (isDisposed) return false
    const folder = chooseWikiWatchFolder({
      projectRoot,
      outputDirectory,
      nearestExistingFolder,
      homeDirectory: homedir(),
    })
    const plan =
      folder === undefined
        ? undefined
        : describeWikiWatch(folder, outputDirectory)
    if (folder === undefined || plan === undefined) {
      watchNothing(
        new Error(
          'No folder at or above the Wiki output is both inside the project (or the output’s own parent) and narrow enough to watch.',
        ),
      )
      return false
    }
    // Read before the watcher is looked at, so nothing is awaited between that look and the new watcher.
    const realFolder = await realpath(folder).catch(() => folder)
    if (isDisposed) return false
    if (
      watcher?.folder === folder &&
      watcher.outputDirectory === outputDirectory
    )
      return false
    watcher?.dispose()
    watcher = undefined
    try {
      watcher = makeWatcher(folder, realFolder, plan, outputDirectory)
      isWatcherBroken = false
      return true
    } catch (cause) {
      // Without a watcher the view refreshes on visibility and its Refresh only.
      watchNothing(cause)
      return false
    }
  }

  /**
   * Runs the freshness check for facts and shows its answer, unless the rows now show another Wiki or the window is gone.
   * A failed check shows the unknown label for this read only and is not cached, so the next refresh checks again.
   */
  const checkFreshness = async (target: ReadyFacts): Promise<void> => {
    let value: LlmWikiFreshness
    let didCheckFail = false
    try {
      value = await options.readFreshness({
        projectRoot: target.projectRoot,
        outputDirectory: target.outputDirectory,
      })
    } catch (cause) {
      didCheckFail = true
      value = { status: 'unknown', reason: 'The freshness check failed.' }
      if (!isDisposed)
        recordFailureOnce(
          'freshness',
          'The LLM Wiki view could not check whether the Wiki is current',
          cause,
        )
    }
    const shown = shownReadyFacts
    // The answer belongs to one publication of one folder; a newer read has asked for its own check.
    if (
      isDisposed ||
      !shown?.wiki ||
      freshnessKeyOf(shown) !== freshnessKeyOf(target)
    )
      return
    show(
      readLlmWikiViewState({
        ...shown,
        wiki: { ...shown.wiki, freshness: value },
      }),
    )
    // A check that succeeded and whose answer is shown ends the freshness failure that stood; an answer that could not be shown was not kept, so the next read checks again.
    if (!didCheckFail) {
      freshnessCache = { key: freshnessKeyOf(target), value }
      recordedFailureKeys.freshness = undefined
    }
  }

  /** Asks for a freshness check of the shown Wiki: one runs at a time, and requests meanwhile become one re-run with the latest facts. */
  const requestFreshness = (shown: ReadyFacts): void => {
    freshnessRequest = shown
    freshnessLoop ??= (async () => {
      // The first await keeps the clearing below after the assignment of this loop.
      await Promise.resolve()
      try {
        while (freshnessRequest && !isDisposed) {
          const target = freshnessRequest
          freshnessRequest = undefined
          // A view hidden since the request was queued runs no check; a show reads again and queues a current one.
          if (!isViewVisible) continue
          try {
            await checkFreshness(target)
          } catch (cause) {
            // A check that cannot even be shown must not become an unhandled rejection; it recurs with its own key, so a good read between does not make it new.
            showReadFailure(cause, 'freshness')
          }
        }
      } finally {
        // Cleared in the same turn in which the loop found no request, so no request is left without a loop.
        freshnessLoop = undefined
      }
    })()
  }

  /** Says what makes a publication differ from the one last seen: the receipt, or the time the manifest was written. */
  const hasPublicationChanged = (
    nextFacts: ReadyFacts,
    memory: LateWatch,
  ): boolean =>
    nextFacts.publication !== memory.publication ||
    nextFacts.wiki?.generation.publishedAtMs !== memory.manifestWrittenAtMs

  /** Tells the learner about a Wiki that appeared while a stopped watch's reservation or a failed generation stood. */
  const noteLatePublication = (nextFacts: ReadyFacts): void => {
    // A publication in another folder than the one that was waiting is not a late one.
    if (
      lateWatch?.outputDirectory === nextFacts.outputDirectory &&
      lateWatch.wasWaiting &&
      nextFacts.wiki &&
      hasPublicationChanged(nextFacts, lateWatch)
    )
      options.tellPublished(nextFacts.outputLabel)
  }

  /**
   * Remembers what this read showed for the next one.
   * A read that lands mid-publication (the publisher's new receipt stands while the Wiki is not readable yet) must not replace the receipt, or the read that shows the Wiki compares against the new receipt and tells nothing; the hold lasts only while the read shows no attention row and no run of this window, so a cause that hides the Wiki, or this window's own run (which tells its own end), cannot freeze the memory.
   */
  const rememberPublication = (
    nextFacts: ReadyFacts,
    next: LlmWikiViewModel,
  ): void => {
    const isPublicationPending =
      lateWatch?.outputDirectory === nextFacts.outputDirectory &&
      nextFacts.publication !== undefined &&
      nextFacts.publication !== lateWatch.publication &&
      !nextFacts.wiki
    const isOtherCauseShown = next.rows.some(
      (row) => row.id === 'attention' || row.id === 'run',
    )
    if (isPublicationPending && !isOtherCauseShown) return
    lateWatch = {
      outputDirectory: nextFacts.outputDirectory,
      wasWaiting: next.rows.some((row) => LLM_WIKI_WAITING_ROW_IDS.has(row.id)),
      // A pending publication stays unseen while the rows follow the read.
      publication: isPublicationPending
        ? lateWatch?.publication
        : nextFacts.publication,
      manifestWrittenAtMs: isPublicationPending
        ? lateWatch?.manifestWrittenAtMs
        : nextFacts.wiki?.generation.publishedAtMs,
    }
  }

  /** Adds what the view knows beside the read: whether the watcher is broken, and the cached or `checking` freshness. */
  const withViewState = (readyFacts: ReadyFacts): ReadyFacts => ({
    ...readyFacts,
    ...(isWatcherBroken ? { isWatcherBroken: true as const } : {}),
    ...(readyFacts.wiki
      ? {
          wiki: {
            ...readyFacts.wiki,
            freshness:
              freshnessCache?.key === freshnessKeyOf(readyFacts)
                ? freshnessCache.value
                : { status: 'checking' as const },
          },
        }
      : {}),
  })

  /**
   * Reads the facts and, for a ready read, keeps the watcher; a watcher that is new or moved is followed by one more read, because a publication between the first read and the watcher's registration is in neither.
   * @returns The facts to show; `undefined` when the window was disposed meanwhile.
   */
  const readFactsAndWatch = async (): Promise<LlmWikiViewFacts | undefined> => {
    let read = await options.readFacts()
    if (isDisposed) return undefined
    if (read.kind !== 'ready') return read
    const didWatcherChange = await keepWatcher(read)
    if (isDisposed) return undefined
    if (!didWatcherChange) return read
    // One follow-up read, never a loop: it repeats only when the watcher moved again.
    read = await options.readFacts()
    if (isDisposed) return undefined
    if (read.kind === 'ready' && (await keepWatcher(read)))
      isRereadWanted = true
    return isDisposed ? undefined : read
  }

  /**
   * Records a failure in Output unless it has the key of the one recorded last for its kind.
   * @param kind - `read` for a read or the rows made of it, `freshness` for the freshness check and the showing of its answer.
   * @param message - What failed, for Output.
   * @param cause - What was thrown.
   */
  const recordFailureOnce = (
    kind: 'read' | 'freshness',
    message: string,
    cause: unknown,
  ): void => {
    // The poll reads again across the error row, so the same failure is recorded once; a different failure is recorded too.
    const key = failureKeyOf(cause)
    if (key === recordedFailureKeys[kind]) return
    recordedFailureKeys[kind] = key
    try {
      options.recordFailure(message, cause)
    } catch {
      // A failure that cannot be recorded has nowhere to be told.
    }
  }

  /**
   * Shows the error row for a read that threw anywhere, and records the cause once.
   * @param cause - What was thrown.
   * @param kind - Which kind of failure it is for the once-only record; the freshness stage's own failures keep their own key.
   */
  const showReadFailure = (
    cause: unknown,
    kind: 'read' | 'freshness' = 'read',
  ): void => {
    if (isDisposed) return
    recordFailureOnce(kind, 'The LLM Wiki view could not read its state', cause)
    // lateWatch stays: a publication after one failed read is still a late publication.
    shownReadyFacts = undefined
    show({ state: 'other', rows: [LLM_WIKI_ERROR_ROW] })
    keepPoll()
  }

  /** Shows one read: the rows with the cached or `checking` freshness, then asks for the freshness check apart. */
  const showRead = (read: LlmWikiViewFacts): void => {
    const nextFacts = read.kind === 'ready' ? withViewState(read) : read
    if (nextFacts.kind === 'ready') noteLatePublication(nextFacts)
    const next = readLlmWikiViewState(nextFacts)
    if (nextFacts.kind === 'ready') rememberPublication(nextFacts, next)
    shownReadyFacts = nextFacts.kind === 'ready' ? nextFacts : undefined
    show(next)
    // A good model is shown: the read failure that stood is over, so the next one is recorded again.
    recordedFailureKeys.read = undefined
    wasRunShownBeforeError = next.rows.some((row) =>
      LLM_WIKI_RUN_ROW_IDS.has(row.id),
    )
    keepPoll()
    // No Wiki row shown (an attention cause hides it) means no freshness to read; a hidden view reads it when it is shown again.
    if (
      isViewVisible &&
      nextFacts.kind === 'ready' &&
      nextFacts.wiki &&
      next.rows.some((row) => row.id === 'wiki')
    ) {
      requestFreshness(nextFacts)
    }
  }

  /** One read from the facts to the rows; whatever throws in it shows the error row. */
  const readOnce = async (): Promise<void> => {
    try {
      const read = await readFactsAndWatch()
      if (read) showRead(read)
    } catch (cause) {
      showReadFailure(cause)
    }
  }

  /** Reads now; a read asked for while one runs makes that one read again once, so the last event always shows. */
  function refresh(): Promise<void> {
    if (isDisposed) return Promise.resolve()
    if (running) {
      isRereadWanted = true
      return running
    }
    running = (async () => {
      do {
        isRereadWanted = false
        await readOnce()
      } while (isRereadWanted && !isDisposed)
    })().finally(() => {
      running = undefined
    })
    return running
  }

  const subscriptions: vscode.Disposable[] = [
    treeChanges,
    treeView,
    treeView.onDidChangeVisibility((event) => {
      isViewVisible = event.visible
      // Hidden: no poll and no freshness check, not even one queued before; shown: one read at once (the 1 s debounce is for file events), which restarts the poll and queues a current freshness check.
      if (event.visible) void refresh()
      else {
        freshnessRequest = undefined
        keepPoll()
      }
    }),
    editor.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(WIKI_OUTPUT_DIRECTORY_SETTING))
        requestRefresh()
    }),
    editor.workspace.onDidGrantWorkspaceTrust(() => requestRefresh()),
    editor.workspace.onDidChangeWorkspaceFolders(() => requestRefresh()),
    { dispose: options.onRunChange(requestRefresh) },
  ]
  void refresh()

  return {
    refresh,
    requestRefresh,
    async whenIdle(): Promise<void> {
      while (debounceSettled ?? running ?? freshnessLoop) {
        await Promise.all([debounceSettled?.promise, running, freshnessLoop])
      }
    },
    findRow: (rowId) => model.rows.find((row) => row.id === rowId),
    dispose(): void {
      isDisposed = true
      freshnessRequest = undefined
      clearTimeout(debounceTimer)
      debounceSettled?.settle()
      debounceSettled = undefined
      clearInterval(pollTimer)
      watcher?.dispose()
      for (const subscription of subscriptions) subscription.dispose()
    },
  }
}
