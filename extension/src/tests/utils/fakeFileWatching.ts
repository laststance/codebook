import { isAbsolute, relative, sep } from 'node:path'

/** Stands in for `vscode.RelativePattern`: the watched folder and the glob under it. */
export class FakeRelativePattern {
  constructor(
    readonly base: string,
    readonly pattern: string,
  ) {}
}

type FileListener = (file: { fsPath: string }) => void
type FileEventKind = 'change' | 'create' | 'delete'

/** One watcher the product created and has not disposed: what it watches, and the listeners it still has for each kind of event. */
type LiveWatcher = {
  pattern: FakeRelativePattern
  listeners: Record<FileEventKind, Set<FileListener>>
}

/**
 * Tells {@link createFakeFileWatching} whether a reported file lies under a watcher's folder, so a file outside it is not delivered.
 * @param base - The watched folder.
 * @param fsPath - The reported file.
 * @returns `true` for a path below the folder; `false` for the folder itself, a path beside or above it, and a path of another drive.
 * @example
 * isUnderFolder('/repo', '/repo/src/a.ts') // => true
 * isUnderFolder('/repo', '/repository/a.ts') // => false
 */
function isUnderFolder(base: string, fsPath: string): boolean {
  const fromBase = relative(base, fsPath)
  return (
    fromBase !== '' &&
    !isAbsolute(fromBase) &&
    fromBase !== '..' &&
    !fromBase.startsWith(`..${sep}`)
  )
}

/**
 * Stands in for `vscode.workspace.createFileSystemWatcher` in tests that activate the extension, so a test can report a file event the way the editor does.
 *
 * Why: the opened Wiki watches the project's files; a `vscode` stub without a watcher cannot open it.
 * Used by the tests that run "Codebook: Open LLM Wiki in Browser"; a test that reports nothing takes only `createFileSystemWatcher`.
 *
 * As in the editor, a listener whose registration was disposed gets no further event although its watcher lives on, and a watcher gets only the files under its folder. The glob under that folder is not evaluated: every file below the folder is delivered.
 *
 * @returns `createFileSystemWatcher` for the stub's `workspace`; `watched` (the pattern of every watcher created so far); `report` (fires one event of a kind at the listeners of every watcher that is not disposed and whose folder contains the file; `reportedAs` is the spelling the listeners get when the editor spells the path in another case or drive letter than the folder check does); `liveWatcherCount`.
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
  report(kind: FileEventKind, fsPath: string, reportedAs?: string): void
  liveWatcherCount(): number
} {
  const watched: FakeRelativePattern[] = []
  const liveWatchers = new Set<LiveWatcher>()
  return {
    createFileSystemWatcher(pattern) {
      watched.push(pattern)
      const watcher: LiveWatcher = {
        pattern,
        listeners: { change: new Set(), create: new Set(), delete: new Set() },
      }
      liveWatchers.add(watcher)
      const listen =
        (kind: FileEventKind) =>
        (listener: FileListener): { dispose(): void } => {
          watcher.listeners[kind].add(listener)
          return {
            dispose(): void {
              watcher.listeners[kind].delete(listener)
            },
          }
        }
      return {
        onDidChange: listen('change'),
        onDidCreate: listen('create'),
        onDidDelete: listen('delete'),
        dispose(): void {
          liveWatchers.delete(watcher)
        },
      }
    },
    watched,
    report(kind, fsPath, reportedAs = fsPath): void {
      for (const watcher of liveWatchers) {
        // A watcher hears only of files under the folder it watches.
        if (!isUnderFolder(watcher.pattern.base, fsPath)) continue
        for (const listener of watcher.listeners[kind])
          listener({ fsPath: reportedAs })
      }
    },
    liveWatcherCount: () => liveWatchers.size,
  }
}
