import { dirname, join, relative, sep } from 'node:path'

import type * as vscode from 'vscode'

import {
  CODEBOOK_HOST_CONTEXT_KEY,
  LLM_WIKI_POLL_MS,
  LLM_WIKI_REFRESH_DEBOUNCE_MS,
  LLM_WIKI_STATE_CONTEXT_KEY,
  LLM_WIKI_VIEW_ID,
  WIKI_MANIFEST_FILE,
  WIKI_OUTPUT_DIRECTORY_SETTING,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
  WIKI_PUBLISH_LOCK_SUFFIX,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
} from '../constants'

import { comparableFilePath } from './comparableFilePath'
import { escapeGlobCharacters } from './escapeGlobCharacters'
import {
  LLM_WIKI_ERROR_ROW,
  LLM_WIKI_LOADING_ROW,
  readLlmWikiViewState,
  type LlmWikiFreshness,
  type LlmWikiRow,
  type LlmWikiViewFacts,
  type LlmWikiViewModel,
} from './readLlmWikiViewState'

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
  /** Runs the freshness check of the published Wiki. */
  readFreshness: () => Promise<LlmWikiFreshness>
  /** Finds the nearest folder at or above the Wiki output that exists ({@link findNearestExistingAncestor}). */
  findWatchedFolder: (outputDirectory: string) => Promise<string>
  /** Subscribes to changes of this window's run state; returns the unsubscribe function. */
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
  /** Reads the state now and shows it; resolves once the rows are shown (not the freshness check). */
  refresh(): Promise<void>
  /** Asks for a refresh after the debounce; many calls inside it become one read. */
  requestRefresh(): void
  /** Resolves once no read and no freshness check is under way. */
  whenIdle(): Promise<void>
  /** The row with this id as it is shown now. */
  findRow(rowId: string): LlmWikiRow | undefined
  /** The facts of the last read, for commands that act on the shown folder. */
  lastFacts(): LlmWikiViewFacts | undefined
  dispose(): void
}

/** Rows whose presence means a run is shown, so the view reads its state again on a timer. */
const RUN_ROW_IDS = new Set(['run', 'elsewhere', 'reservation'])

/** The files that tell the view a run or a publish changed the folder, as the paths below the output folder's parent. */
const WATCHED_SUFFIXES = [
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
  WIKI_PUBLISH_LOCK_SUFFIX,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
] as const

/**
 * Names the files whose events refresh the view: the manifest inside the output folder and the three markers beside it.
 * @param outputDirectory - The resolved Wiki folder.
 * @returns The four absolute paths.
 * @example watchedFilesOf('/repo/.codebook/wiki') // => ['/repo/.codebook/wiki/codebook-wiki.json', '/repo/.codebook/wiki.update-run.json', …]
 */
function watchedFilesOf(outputDirectory: string): string[] {
  return [
    join(outputDirectory, WIKI_MANIFEST_FILE),
    ...WATCHED_SUFFIXES.map((suffix) => `${outputDirectory}${suffix}`),
  ]
}

/**
 * Makes a glob, relative to the watched folder, that matches the four watched files and nothing else.
 * @param watchedFolder - The nearest existing folder at or above the output.
 * @param outputDirectory - The resolved Wiki folder.
 * @returns A glob such as `wiki{/codebook-wiki.json,.update-run.json,…}` with forward slashes; glob characters in the folder names are put in brackets ({@link escapeGlobCharacters}).
 * @example globOfWatchedFiles('/repo/.codebook', '/repo/.codebook/wiki') // => 'wiki{/codebook-wiki.json,.update-run.json,.publish-lock.json,.publish-journal.json}'
 */
function globOfWatchedFiles(
  watchedFolder: string,
  outputDirectory: string,
): string {
  const outputFromFolder = relative(watchedFolder, outputDirectory)
    .split(sep)
    .join('/')
  const endings = [`/${WIKI_MANIFEST_FILE}`, ...WATCHED_SUFFIXES]
  return `${escapeGlobCharacters(outputFromFolder)}{${endings.join(',')}}`
}

/**
 * Creates the LLM Wiki tree view: its data provider, its context keys, and the triggers that read its state again (this window's run, the Wiki files, the setting, trust, visibility and a poll while a run row is shown).
 *
 * Why: the Activity Bar needs one place that shows the generated site's state and its next step; the rows are one pure function of one record of facts ({@link readLlmWikiViewState}), and this module only reads, compares and shows.
 * Trigger: `activate()` in `extension.ts` creates it once per window when the editor offers tree views.
 *
 * A refresh fires a tree change only when the rows, the message or the state actually changed, so a read with nothing new is silent for screen readers and never moves focus.
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
  let facts: LlmWikiViewFacts | undefined
  /** What the last ready read showed, kept across reads that are not ready, so a publication after a removed and restored folder still counts as late. */
  let lateWatch:
    | {
        outputDirectory: string
        wasWaiting: boolean
        publication: string | undefined
      }
    | undefined
  let freshnessCache: { key: string; value: LlmWikiFreshness } | undefined
  let readCount = 0
  let running: Promise<void> | undefined
  let isRereadWanted = false
  let pendingFreshness: Promise<void> | undefined
  let debounceTimer: NodeJS.Timeout | undefined
  let pollTimer: NodeJS.Timeout | undefined
  let isDisposed = false
  let isWatcherBroken = false
  let watcher:
    { folder: string; outputDirectory: string; dispose: () => void } | undefined

  void editor.commands.executeCommand(
    'setContext',
    CODEBOOK_HOST_CONTEXT_KEY,
    options.host,
  )
  void editor.commands.executeCommand(
    'setContext',
    LLM_WIKI_STATE_CONTEXT_KEY,
    'loading',
  )

  const treeView = editor.window.createTreeView<string>(LLM_WIKI_VIEW_ID, {
    treeDataProvider: {
      onDidChangeTreeData: treeChanges.event,
      getChildren: (element) =>
        element ? [] : model.rows.map((row) => row.id),
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

  /** Shows a model: sets the context key, the message and fires one tree change, only for what differs from what is shown. */
  const show = (next: LlmWikiViewModel): void => {
    // A read that finished after dispose shows nothing.
    if (isDisposed) return
    const nextKey = JSON.stringify(next)
    if (nextKey === shownKey && next.state === shownState) return
    const didStateChange = next.state !== shownState
    model = next
    shownKey = nextKey
    shownState = next.state
    treeView.message = next.message
    if (didStateChange)
      void editor.commands.executeCommand(
        'setContext',
        LLM_WIKI_STATE_CONTEXT_KEY,
        next.state,
      )
    treeChanges.fire()
  }

  /** Keeps the poll timer running exactly while a run row is shown. */
  const keepPoll = (): void => {
    if (isDisposed) return
    const isRunShown = model.rows.some((row) => RUN_ROW_IDS.has(row.id))
    if (!isRunShown) {
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
    debounceTimer = setTimeout(() => {
      void refresh()
    }, debounceMs)
    debounceTimer.unref()
  }

  /** Puts the watcher on the nearest existing folder of the output, and makes it again when that folder or the output changed. */
  const keepWatcher = async (outputDirectory: string): Promise<void> => {
    // The markers lie beside the output folder, so its parent is the first folder to stand on.
    const folder = await options.findWatchedFolder(dirname(outputDirectory))
    // A read that finished after dispose must leave no watcher behind.
    if (isDisposed) return
    if (
      watcher?.folder === folder &&
      watcher.outputDirectory === outputDirectory
    )
      return
    watcher?.dispose()
    watcher = undefined
    try {
      const fileWatcher = editor.workspace.createFileSystemWatcher(
        new editor.RelativePattern(
          folder,
          globOfWatchedFiles(folder, outputDirectory),
        ),
      )
      // The editor may spell the drive letter or the case of a path differently, so both sides are compared in one form.
      const watchedFiles = new Set(
        watchedFilesOf(outputDirectory).map((path) => comparableFilePath(path)),
      )
      const onEvent = (file: vscode.Uri): void => {
        if (watchedFiles.has(comparableFilePath(file.fsPath))) requestRefresh()
      }
      const subscriptions = [
        fileWatcher.onDidCreate(onEvent),
        fileWatcher.onDidChange(onEvent),
        fileWatcher.onDidDelete(onEvent),
      ]
      watcher = {
        folder,
        outputDirectory,
        dispose: (): void => {
          for (const subscription of subscriptions) subscription.dispose()
          fileWatcher.dispose()
        },
      }
      isWatcherBroken = false
    } catch (cause) {
      // Without a watcher the view refreshes on visibility and its Refresh only; Output › Codebook records the cause once.
      if (!isWatcherBroken)
        options.recordFailure(
          'The LLM Wiki view could not watch the Wiki folder',
          cause,
        )
      isWatcherBroken = true
    }
  }

  /** Runs the freshness check for the last shown Wiki and shows its answer, unless a newer read replaced it. */
  const checkFreshness = async (
    readNumber: number,
    shownFacts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  ): Promise<void> => {
    const value = await options.readFreshness().catch((): LlmWikiFreshness => ({
      status: 'unknown',
      reason: 'The freshness check failed.',
    }))
    if (readNumber !== readCount || isDisposed || !shownFacts.wiki) return
    freshnessCache = { key: freshnessKeyOf(shownFacts), value }
    show(
      readLlmWikiViewState({
        ...shownFacts,
        wiki: { ...shownFacts.wiki, freshness: value },
      }),
    )
  }

  /** Tells the learner about a Wiki that appeared while a stopped watch's reservation or a failed generation stood. */
  const noteLatePublication = (
    nextFacts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  ): void => {
    // A publication in another folder than the one that was waiting is not a late one.
    if (
      lateWatch?.outputDirectory === nextFacts.outputDirectory &&
      lateWatch.wasWaiting &&
      nextFacts.publication !== undefined &&
      nextFacts.publication !== lateWatch.publication &&
      nextFacts.wiki
    )
      options.tellPublished(nextFacts.outputLabel)
  }

  /**
   * Says whether a read landed mid-publication: the publisher's new receipt stands in the watched folder while the Wiki is not readable yet.
   * Such a read must not replace the memory, or the read that shows the Wiki compares against the new receipt and tells nothing.
   */
  const isPublicationStillPending = (
    nextFacts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  ): boolean =>
    lateWatch?.outputDirectory === nextFacts.outputDirectory &&
    nextFacts.publication !== undefined &&
    nextFacts.publication !== lateWatch.publication &&
    !nextFacts.wiki

  /** Reads the facts; a read that throws shows the error row and answers `undefined`, as does a read that ended after dispose. */
  const readFactsOrShowError = async (): Promise<
    LlmWikiViewFacts | undefined
  > => {
    try {
      const read = await options.readFacts()
      return isDisposed ? undefined : read
    } catch (cause) {
      if (isDisposed) return undefined
      options.recordFailure('The LLM Wiki view could not read its state', cause)
      // lateWatch stays: a publication after one failed read is still a late publication.
      show({ state: 'other', rows: [LLM_WIKI_ERROR_ROW] })
      keepPoll()
      return undefined
    }
  }

  /** Adds what the view knows beside the read: whether the watcher is broken, and the cached or `checking` freshness. */
  const withViewState = (
    readyFacts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  ): Extract<LlmWikiViewFacts, { kind: 'ready' }> => ({
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

  /** One read: the facts, the watcher, the rows with the cached or `checking` freshness, then the freshness check apart. */
  const readOnce = async (): Promise<void> => {
    readCount += 1
    const readNumber = readCount
    let nextFacts = await readFactsOrShowError()
    if (!nextFacts) return
    if (nextFacts.kind === 'ready') {
      await keepWatcher(nextFacts.outputDirectory)
      if (isDisposed) return
      nextFacts = withViewState(nextFacts)
      noteLatePublication(nextFacts)
    }
    facts = nextFacts
    const next = readLlmWikiViewState(nextFacts)
    if (nextFacts.kind === 'ready' && !isPublicationStillPending(nextFacts))
      lateWatch = {
        outputDirectory: nextFacts.outputDirectory,
        wasWaiting: next.rows.some(
          (row) => row.id === 'reservation' || row.id === 'last-attempt',
        ),
        publication: nextFacts.publication,
      }
    show(next)
    keepPoll()
    // No Wiki row shown (an attention cause hides it) means no freshness to read.
    if (
      nextFacts.kind === 'ready' &&
      nextFacts.wiki &&
      next.rows.some((row) => row.id === 'wiki')
    ) {
      const readyFacts = nextFacts
      pendingFreshness = checkFreshness(readNumber, readyFacts).finally(() => {
        pendingFreshness = undefined
      })
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
      if (event.visible) requestRefresh()
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
      while (running ?? pendingFreshness) {
        await Promise.all([running, pendingFreshness])
      }
    },
    findRow: (rowId) => model.rows.find((row) => row.id === rowId),
    lastFacts: () => facts,
    dispose(): void {
      isDisposed = true
      clearTimeout(debounceTimer)
      clearInterval(pollTimer)
      watcher?.dispose()
      for (const subscription of subscriptions) subscription.dispose()
    },
  }
}

/**
 * Names the publication a cached freshness answer belongs to, so the answer of an older Wiki is never shown for a newer one.
 * @param facts - The ready facts.
 * @returns The folder and the publisher's receipt.
 * @example freshnessKeyOf(facts) // => '/repo/.codebook/wiki|abc@1'
 */
function freshnessKeyOf(
  facts: Extract<LlmWikiViewFacts, { kind: 'ready' }>,
): string {
  return `${facts.outputDirectory}|${facts.publication ?? ''}`
}
