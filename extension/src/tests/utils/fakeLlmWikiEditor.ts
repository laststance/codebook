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
    /** Models the extension host's `ExtHostTreeView`: tree changes and message writes feed one leading 200 ms debounce whose emission sends the message, then refreshes the root (`emissions()` records each). Uses `setTimeout`, so a test enables mock timers and ticks 200 ms. */
    modelsExtensionHostDebounce?: boolean
  } = {},
) {
  const renderLog: string[] = []
  /** What each emission of the modelled extension host's debounce carried. */
  const emissions: Array<{
    hasMessage: boolean
    message: string | undefined
    refreshesRoot: boolean
  }> = []
  /** What the modelled debounce has merged since its last emission. */
  let pending = { hasMessage: false, refreshesRoot: false }
  let debounceHandle: NodeJS.Timeout | undefined
  let debounceCalls = 0
  const emit = (carried: typeof pending): void => {
    emissions.push({
      hasMessage: carried.hasMessage,
      message: carried.hasMessage ? shownMessage : undefined,
      refreshesRoot: carried.refreshesRoot,
    })
    // The handler sends the message first, then refreshes the root (`$getChildren`).
    if (carried.refreshesRoot) provider?.getChildren()
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
    /** The emissions of the modelled extension host's debounce so far ({@link createFakeLlmWikiEditor} option `modelsExtensionHostDebounce`). */
    emissions: () => emissions.map((emission) => ({ ...emission })),
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
