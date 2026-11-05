/**
 * The listeners of a node run's view: added by the service, told after every change, and never able to break the run.
 * Used by the node-server run and the node-script run, which both expose {@link NodeServerRuntime.onDidChange}.
 * @example
 * const listeners = new RunChangeListeners()
 * const subscription = listeners.add(() => refresh())
 * listeners.notify() // refresh() ran
 */
export class RunChangeListeners {
  private readonly listeners = new Set<() => void>()

  /**
   * Adds a listener.
   * @param listener - Called after every change.
   * @returns A handle whose `dispose` removes it.
   */
  add(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  /** Tells every listener the view changed; a listener that throws never breaks the run. */
  notify(): void {
    for (const listener of this.listeners)
      try {
        listener()
      } catch {
        // The service's listener failing is its own matter.
      }
  }
}
