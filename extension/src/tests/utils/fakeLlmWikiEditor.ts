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
 * @returns `editor` (to pass as the view's editor), `rows` (the tree as shown now), `contextKeys`, `files` (the fake file watching, to report events), `fireConfigurationChange`.
 * @example
 * const fake = createFakeLlmWikiEditor()
 * const view = createLlmWikiView({ editor: fake.editor, host: 'vscode', … })
 * fake.rows().map((row) => row.id) // => ['wiki', 'output']
 */
export function createFakeLlmWikiEditor() {
  const files = createFakeFileWatching()
  const contextKeys: Record<string, unknown> = {}
  const configurationListeners: Array<
    (event: { affectsConfiguration: (id: string) => boolean }) => void
  > = []
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
        treeOptions: { treeDataProvider: NonNullable<typeof provider> },
      ) => {
        provider = treeOptions.treeDataProvider
        return {
          message: undefined as string | undefined,
          onDidChangeVisibility: () => ({ dispose(): void {} }),
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
    fireConfigurationChange(): void {
      for (const listener of [...configurationListeners])
        listener({ affectsConfiguration: () => true })
    },
  }
}
