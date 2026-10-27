import type { LlmWikiViewOptions } from '../../utils/llmWikiView'

import { createFakeFileWatching, FakeRelativePattern } from './fakeFileWatching'
import { listenTo } from './listenTo'

/** One row of the fake tree as a test reads it. */
export type FakeTreeRow = {
  id: string
  label: string
  description: string | undefined
  tooltip: string | undefined
}

/**
 * Stands in for the editor surface of {@link createLlmWikiView} (tree view, context keys, events, file watcher), so a test drives the view's read loop without the extension's activation.
 *
 * Why: the host harness reaches the view through the whole extension; the read-loop tests need to hold its closures open and count their calls, which only the view's own options allow.
 * Used by the read-loop tests of the LLM Wiki view.
 *
 * @param fakeOptions - `readsRootInsideCreateTreeView` makes the editor read the provider's root children synchronously inside `createTreeView`, as an editor that renders at once could.
 * @returns `editor` (to pass as the view's editor), `rows` (the tree as shown now), `message` (the tree view's message), `renderLog` (`getChildren` for each root read and `message:<text>` for each message write, in order), `contextKeys`, `files` (the fake file watching, to report events), `setVisible`, `fireConfigurationChange`.
 * @example
 * const fake = createFakeLlmWikiEditor()
 * const view = createLlmWikiView({ editor: fake.editor, host: 'vscode', … })
 * fake.rows().map((row) => row.id) // => ['wiki', 'output']
 */
export function createFakeLlmWikiEditor(
  fakeOptions: {
    readsRootInsideCreateTreeView?: boolean
    /** Models the extension host's `ExtHostTreeView`: tree changes and message writes feed one leading 200 ms debounce. An emission sends the message synchronously (`$setMessage`) and only queues the refresh (`refreshQueue.then`, a microtask here); the refresh then makes the main thread read the root children (`$refresh`, then `$getChildren` back), and a message written during that read is a new emission. `hostLog()` records emissions and root reads in order. Uses `setTimeout`, so a test enables mock timers, ticks 200 ms and awaits a microtask. */
    modelsExtensionHostDebounce?: boolean
  } = {},
) {
  const renderLog: string[] = []
  /** What the modelled extension host did, in order: `emit message(<text>)` and/or `+refresh` for each emission of its debounce, `root-read` and `root-return` around each root read the refresh caused. */
  const hostLog: string[] = []
  /** What the modelled debounce has merged since its last emission. */
  let pending = { hasMessage: false, refreshesRoot: false }
  let debounceHandle: NodeJS.Timeout | undefined
  let debounceCalls = 0
  const emit = (carried: typeof pending): void => {
    // The handler sends the message first, synchronously, and only queues the refresh.
    hostLog.push(
      `emit ${[
        carried.hasMessage ? `message(${shownMessage ?? 'none'})` : undefined,
        carried.refreshesRoot ? 'refresh' : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(' + ')}`,
    )
    if (carried.refreshesRoot)
      queueMicrotask(() => {
        // The main thread's `$getChildren` back to the extension host.
        hostLog.push('root-read')
        const ids = provider?.getChildren() ?? []
        hostLog.push(`root-return(${ids.join(',')})`)
      })
  }
  /** `Event.debounce(merge, 200, true)`: the first event of a quiet period is emitted at once with its own data, later ones merge into one emission when 200 ms pass without an event. */
  const feedDebounce = (event: Partial<typeof pending>): void => {
    if (!fakeOptions.modelsExtensionHostDebounce) return
    debounceCalls += 1
    pending = {
      hasMessage: pending.hasMessage || event.hasMessage === true,
      refreshesRoot: pending.refreshesRoot || event.refreshesRoot === true,
    }
    if (debounceHandle === undefined) {
      const leading = pending
      pending = { hasMessage: false, refreshesRoot: false }
      emit(leading)
    }
    clearTimeout(debounceHandle)
    debounceHandle = setTimeout(() => {
      const trailing = pending
      const didMerge = debounceCalls > 1
      pending = { hasMessage: false, refreshesRoot: false }
      debounceHandle = undefined
      debounceCalls = 0
      if (didMerge) emit(trailing)
    }, 200)
    debounceHandle.unref()
  }
  let shownMessage: string | undefined
  const files = createFakeFileWatching()
  const contextKeys: Record<string, unknown> = {}
  const configurationListeners: Array<
    (event: { affectsConfiguration: (id: string) => boolean }) => void
  > = []
  const visibilityListeners: Array<(event: { visible: boolean }) => void> = []
  let isViewShown = true
  let provider:
    | {
        getChildren(element?: string): string[]
        getTreeItem(id: string): Record<string, unknown>
      }
    | undefined
  const editorStub = {
    commands: {
      executeCommand: async (
        name: string,
        key?: string,
        value?: unknown,
      ): Promise<void> => {
        if (name === 'setContext' && key !== undefined) contextKeys[key] = value
      },
    },
    EventEmitter: class {
      readonly #listeners: Array<() => void> = []
      readonly event = (listener: () => void) =>
        listenTo(this.#listeners, listener)
      fire(): void {
        for (const listener of [...this.#listeners]) listener()
      }
      dispose(): void {}
    },
    RelativePattern: FakeRelativePattern,
    ThemeIcon: class {
      constructor(readonly id: string) {}
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
    TreeItemCollapsibleState: { None: 0 },
    window: {
      createTreeView: (
        _id: string,
        treeOptions: {
          treeDataProvider: NonNullable<typeof provider> & {
            onDidChangeTreeData?: (listener: () => void) => unknown
          }
        },
      ) => {
        const viewProvider = treeOptions.treeDataProvider
        provider = {
          getChildren(element) {
            if (element === undefined) renderLog.push('getChildren')
            return viewProvider.getChildren(element)
          },
          getTreeItem: (id) => viewProvider.getTreeItem(id),
        }
        viewProvider.onDidChangeTreeData?.(() =>
          feedDebounce({ refreshesRoot: true }),
        )
        if (fakeOptions.readsRootInsideCreateTreeView) provider.getChildren()
        return {
          get message(): string | undefined {
            return shownMessage
          },
          set message(text: string | undefined) {
            shownMessage = text
            renderLog.push(`message:${text}`)
            feedDebounce({ hasMessage: true })
          },
          get visible(): boolean {
            return isViewShown
          },
          onDidChangeVisibility: (
            listener: (event: { visible: boolean }) => void,
          ) => listenTo(visibilityListeners, listener),
          dispose(): void {},
        }
      },
    },
    workspace: {
      createFileSystemWatcher: files.createFileSystemWatcher,
      onDidChangeConfiguration: (
        listener: (typeof configurationListeners)[number],
      ) => listenTo(configurationListeners, listener),
      onDidGrantWorkspaceTrust: () => ({ dispose(): void {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
    },
  }
  return {
    // The stub implements the surface the view uses; the full editor API is far larger.
    editor: editorStub as unknown as LlmWikiViewOptions['editor'],
    rows: (): FakeTreeRow[] =>
      (provider?.getChildren() ?? []).map((id) => {
        const item = provider?.getTreeItem(id) ?? {}
        return {
          id,
          label: String(item.label),
          description: item.description as string | undefined,
          tooltip: item.tooltip as string | undefined,
        }
      }),
    contextKeys,
    files,
    /** What the modelled extension host did so far ({@link createFakeLlmWikiEditor} option `modelsExtensionHostDebounce`). */
    hostLog: () => [...hostLog],
    /** The message the tree view shows now. */
    message: (): string | undefined => shownMessage,
    /** What the fake tree did, in order: `getChildren` for each root read and `message:<text>` for each message write. */
    renderLog: (): string[] => [...renderLog],
    /** Shows or hides the view as the learner expands or collapses it, and reports it to the view. */
    setVisible(isVisible: boolean): void {
      isViewShown = isVisible
      for (const listener of [...visibilityListeners])
        listener({ visible: isVisible })
    },
    fireConfigurationChange(): void {
      for (const listener of [...configurationListeners])
        listener({ affectsConfiguration: () => true })
    },
  }
}
