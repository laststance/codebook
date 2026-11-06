/** How the leader of a WXT build process ended: an exit code or the signal that ended it. */
export type WxtBuildExit = {
  code: number | null
  signal: NodeJS.Signals | null
}

/** What {@link buildWxtExtension} asks a {@link WxtBuildSpawner} to start. */
export type WxtBuildSpawnRequest = {
  /** The external Node's absolute path. */
  executable: string
  /** The Node arguments, script included. */
  arguments: readonly string[]
  /** The folder the process starts in (the project root, so `wxt` resolves from it). */
  cwd: string
  /** Receives each raw chunk of output, per channel. */
  onOutput(text: string, channel: 'stdout' | 'stderr'): void
}

/** One started build process and its tree, as the build step sees it. */
export type WxtBuildProcess = {
  /** Settles when the leader has exited; it never rejects (a failed start is an exit with no code). */
  exited: Promise<WxtBuildExit>
  /** Delivers a signal to the whole tree (process group, or `taskkill /T` on Windows). */
  signalTree(signal: 'SIGTERM' | 'SIGKILL'): void
  /** Settles when no member of the tree is left; it never rejects. */
  treeGone: Promise<void>
  /** Whether no member of the tree is left right now. */
  isTreeGone(): boolean
}

/** Starts the build process; production uses {@link createWxtBuildSpawner}, tests pass a fake. */
export type WxtBuildSpawner = (request: WxtBuildSpawnRequest) => WxtBuildProcess

/** Time as the build step reads it. */
export type WxtBuildClock = {
  nowMs(): number
  /** Resolves after the delay or at the abort, whichever is first; never rejects. */
  delay(delayMs: number, signal: AbortSignal): Promise<void>
}

/** The external Node as {@link resolveExternalNode} returns it, or none when it could not be resolved. */
export type WxtBuildNode = { executable: string; version: string } | undefined

/** What {@link buildWxtExtension} needs to build one WXT project. */
export type WxtBuildInput = {
  /** The Git repository root (the tracked-file check runs from it). */
  repositoryRoot: string
  /** The real path of `extensionRoot`, inside the repository. */
  projectRoot: string
  /** The run's private folder; the build goes to `wxt-build/` inside it. */
  privateFolder: string
  node: WxtBuildNode
  signal: AbortSignal
  clock?: WxtBuildClock
  spawner?: WxtBuildSpawner
}

/** The outcome of a build step that was not refused. */
export type WxtBuildResult =
  | {
      kind: 'built'
      /** The folder to load as an unpacked extension (`<outDir>/chrome-mv3-dev`). */
      loadRoot: string
      wxtVersion: string
      durationMs: number
    }
  /** The caller's signal ended the build and the tracked files are verified unchanged; the caller maps this to its stop error. */
  | { kind: 'cancelled' }
