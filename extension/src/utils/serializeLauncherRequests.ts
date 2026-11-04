/** The tail of each launcher's request chain; a settled tail means the launcher is free. */
const requestChains = new WeakMap<object, Promise<unknown>>()

/**
 * Runs one launcher request only after every earlier request on the same launcher process has finished.
 *
 * Why it exists: the launcher answers over one shared message queue (`nextMessage` shifts a report off for good), so two requests waiting at once can steal each other's answers and the loser times out. Called by {@link requestViteLibraryModules} and {@link awaitViteOptimizerIdle} around their send-and-wait.
 *
 * A failed or timed-out earlier request does not block later ones. A late answer of such a request is skipped by the next waiter, which ignores reports that are not its own.
 *
 * @param app - The started launcher process; requests are ordered per process.
 * @param request - Sends one command and waits for its answer.
 * @returns What the request returned.
 * @throws What the request throws (its own failure only).
 * @example
 * const modules = await serializeLauncherRequests(app, () => sendAndWait())
 */
export async function serializeLauncherRequests<T>(
  app: object,
  request: () => Promise<T>,
): Promise<T> {
  const previous = requestChains.get(app) ?? Promise.resolve()
  // Wait for the previous request whatever its outcome, then run this one.
  const current = previous.then(
    () => request(),
    () => request(),
  )
  requestChains.set(app, current)
  return current
}
