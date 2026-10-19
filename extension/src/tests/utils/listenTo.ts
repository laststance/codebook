/**
 * Registers one listener of a fake editor event and hands back its disposable, as an editor's event does; called by the fake editor of {@link openWikiUpdateWindow} for each event the extension listens to.
 * A disposable removes its own listener and nothing else: a second dispose finds the listener gone and leaves the others in place.
 * @param listeners - The listeners of one event, which the fake editor calls when a test fires the event.
 * @param listener - The listener to add.
 * @returns The disposable that takes this listener out of the list again.
 * @example
 * const registration = listenTo(terminalOpenListeners, onTerminalOpened)
 * registration.dispose() // terminalOpenListeners no longer holds onTerminalOpened
 */
export function listenTo<Listener>(
  listeners: Listener[],
  listener: Listener,
): { dispose(): void } {
  listeners.push(listener)
  return {
    dispose(): void {
      const registeredAt = listeners.indexOf(listener)
      // A listener that is no longer listed has no place to take out: -1 would name the last listener.
      if (registeredAt !== -1) listeners.splice(registeredAt, 1)
    },
  }
}
