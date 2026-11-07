/** How the leader of a build process ended: an exit code or the signal that ended it. */
export type BuildProcessExit = {
  code: number | null
  signal: NodeJS.Signals | null
}

/** What a build step (the WXT build, the library build) asks a {@link BuildSpawner} to start. */
export type BuildSpawnRequest = {
  /** The absolute path of the program to start (the external Node or a package manager). */
  executable: string
  /** The program's arguments. */
  arguments: readonly string[]
  /** The folder the process starts in. */
  cwd: string
  /** The complete environment of the build process; nothing else is inherited from the extension host. */
  environment: NodeJS.ProcessEnv
  /** Receives each raw chunk of output, per channel. */
  onOutput(text: string, channel: 'stdout' | 'stderr'): void
}

/** One started build process and its tree, as a build step sees it. */
export type BuildProcess = {
  /** Settles when the leader has exited; it never rejects (a failed start is an exit with no code). */
  exited: Promise<BuildProcessExit>
  /** Delivers a signal to the whole tree (process group, or `taskkill /T` on Windows). */
  signalTree(signal: 'SIGTERM' | 'SIGKILL'): void
  /** Settles when no member of the tree is left; it never rejects. */
  treeGone: Promise<void>
  /** Whether no member of the tree is left right now. */
  isTreeGone(): boolean
}

/** Starts the build process; production uses {@link createBuildSpawner}, tests pass a fake. */
export type BuildSpawner = (request: BuildSpawnRequest) => BuildProcess

/** Time as a build step reads it. */
export type BuildClock = {
  nowMs(): number
  /** Resolves after the delay or at the abort, whichever is first; never rejects. */
  delay(delayMs: number, signal: AbortSignal): Promise<void>
}
