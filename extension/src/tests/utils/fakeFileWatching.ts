/** Stands in for `vscode.RelativePattern`: the watched folder and the glob under it. */
export class FakeRelativePattern {
  constructor(
    readonly base: string,
    readonly pattern: string,
  ) {}
}

type FileListener = (file: { fsPath: string }) => void

/**
 * Stands in for `vscode.workspace.createFileSystemWatcher` in tests that activate the extension, so a test can report a file event the way the editor does.
 *
 * Why: the opened Wiki watches the project's files; a `vscode` stub without a watcher cannot open it.
 * Used by the tests that run "Codebook: Open DeepWiki in Browser"; a test that reports nothing takes only `createFileSystemWatcher`.
 *
 * @returns `createFileSystemWatcher` for the stub's `workspace`; `watched` (the pattern of every watcher created so far); `report` (fires one event of a kind at every watcher that is not disposed); `liveWatcherCount`.
 *
 * @example
 * ```ts
 * const files = createFakeFileWatching()
 * // vscode stub: { RelativePattern: FakeRelativePattern, workspace: { createFileSystemWatcher: files.createFileSystemWatcher } }
 * files.report('change', '/repo/src/a.ts')
 * ```
 */
export function createFakeFileWatching(): {
  createFileSystemWatcher(pattern: FakeRelativePattern): {
    onDidChange(listener: FileListener): { dispose(): void }
    onDidCreate(listener: FileListener): { dispose(): void }
    onDidDelete(listener: FileListener): { dispose(): void }
    dispose(): void
  }
  watched: FakeRelativePattern[]
  report(kind: 'change' | 'create' | 'delete', fsPath: string): void
  liveWatcherCount(): number
} {
  const watched: FakeRelativePattern[] = []
  const liveWatchers = new Set<Record<string, FileListener[]>>()
  return {
    createFileSystemWatcher(pattern) {
      watched.push(pattern)
      const listeners: Record<string, FileListener[]> = {
        change: [],
        create: [],
        delete: [],
      }
      liveWatchers.add(listeners)
      const listen =
        (kind: string) =>
        (listener: FileListener): { dispose(): void } => {
          listeners[kind]?.push(listener)
          return { dispose(): void {} }
        }
      return {
        onDidChange: listen('change'),
        onDidCreate: listen('create'),
        onDidDelete: listen('delete'),
        dispose(): void {
          liveWatchers.delete(listeners)
        },
      }
    },
    watched,
    report(kind, fsPath): void {
      for (const listeners of liveWatchers)
        for (const listener of listeners[kind] ?? []) listener({ fsPath })
    },
    liveWatcherCount: () => liveWatchers.size,
  }
}
