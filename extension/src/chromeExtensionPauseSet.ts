import type {
  ExtensionContinueArguments,
  ExtensionPauseState,
  ExtensionPauseView,
} from './chromeExtensionDebugger'

/** One open pause, mutable while its capture runs. */
export type ExtensionPause = Omit<ExtensionPauseView, 'continueArguments'> & {
  /** Set once a continue claimed the pause, so a second continue is stale. */
  resuming: boolean
  /** Settles when the capture ended, whatever its outcome. */
  captureDone: Promise<void>
}

/**
 * The pauses of one extension run keyed by session and thread, so several contexts can be paused at once and continuing one never invalidates another (ER16).
 * Created by the debugger of a chrome-extension run; read by the run resource (through the debugger) and by the action executor ({@link ExtensionPauseState}).
 *
 * @example
 * const set = new ExtensionPauseSet()
 * const pause = set.open({ sessionId: 's1', threadId: 1, ... })
 * set.find({ participant: 'extension', sessionId: 's1', threadId: 1, generation: pause.generation }) // => pause
 */
export class ExtensionPauseSet implements ExtensionPauseState {
  private readonly pauses = new Map<string, ExtensionPause>()
  private readonly listeners = new Set<() => void>()
  private counter = 0

  /**
   * Opens a pause and gives it the next generation.
   * @param input - The pause without its generation and bookkeeping.
   * @returns The stored pause.
   */
  open(
    input: Omit<ExtensionPause, 'generation' | 'resuming' | 'captureDone'> & {
      captureDone?: Promise<void>
    },
  ): ExtensionPause {
    const pause: ExtensionPause = {
      ...input,
      generation: ++this.counter,
      resuming: false,
      captureDone: input.captureDone ?? Promise.resolve(),
    }
    this.pauses.set(this.keyOf(pause.sessionId, pause.threadId), pause)
    this.notify()
    return pause
  }

  /**
   * Finds the pause that continue arguments name.
   * @param args - The arguments copied from the run resource.
   * @returns The pause, or `undefined` when the pause ended or a newer one replaced it (stale).
   */
  find(args: ExtensionContinueArguments): ExtensionPause | undefined {
    const pause = this.pauses.get(this.keyOf(args.sessionId, args.threadId))
    return pause?.generation === args.generation ? pause : undefined
  }

  /** Whether this very pause is still open, for capture checks. */
  isCurrent(pause: ExtensionPause): boolean {
    return (
      this.pauses.get(this.keyOf(pause.sessionId, pause.threadId)) === pause
    )
  }

  /**
   * Closes the pauses of a thread, or of every thread of the session, that ran on.
   * @param sessionId - The session whose threads ran on.
   * @param threadId - One thread, or `undefined` for every thread of the session.
   * @returns The pauses that ended.
   */
  close(sessionId: string, threadId?: number): ExtensionPause[] {
    const ended = [...this.pauses.values()].filter(
      (pause) =>
        pause.sessionId === sessionId &&
        (threadId === undefined || pause.threadId === threadId),
    )
    for (const pause of ended)
      this.pauses.delete(this.keyOf(pause.sessionId, pause.threadId))
    if (ended.length > 0) this.notify()
    return ended
  }

  /** Every open pause, oldest first. */
  list(): ExtensionPause[] {
    return [...this.pauses.values()]
  }

  /** Tells listeners a pause changed (a capture ended). */
  notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  isPaused(): boolean {
    return this.pauses.size > 0
  }

  hasDeclaredPause(): boolean {
    return this.list().some((pause) => pause.kind === 'declared')
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private keyOf(sessionId: string, threadId: number): string {
    return `${sessionId}:${threadId}`
  }
}

/**
 * Builds the run-resource view of a pause, with continue arguments for a declared one only.
 * @param pause - The stored pause.
 * @returns A plain copy that later changes of the pause never alter.
 * @example
 * viewOfPause(pause).continueArguments // => { participant: 'extension', sessionId: 's1', threadId: 1, generation: 3 }
 */
export function viewOfPause(pause: ExtensionPause): ExtensionPauseView {
  const { resuming: _resuming, captureDone: _captureDone, ...view } = pause
  return pause.kind === 'declared'
    ? {
        ...view,
        continueArguments: {
          participant: 'extension',
          sessionId: pause.sessionId,
          threadId: pause.threadId,
          generation: pause.generation,
        },
      }
    : view
}
