/**
 * The failure of a Next build discovery whose run budget (bytes read or time) is spent, thrown by {@link readDevelopmentBundle}, {@link spendNextPagesDiscovery} and {@link readNextServerOnlyReason}.
 * {@link readNextServerOnlyReason} tells it from every other failure of a server compile read by this type, never by its message, so an unrelated error that carries the same words establishes nothing instead of ending the run; it rethrows it, and throws a new one when another failure of that read ends past the step's deadline. The name stays `Error`, so `String(error)` reads as before.
 * @example
 * try {
 *   await spendNextPagesDiscovery(cache, '/repo', signal, readStep)
 * } catch (error) {
 *   if (error instanceof DiscoveryBudgetError) String(error) // => 'Error: Build discovery resource limit exceeded'
 * }
 */
export class DiscoveryBudgetError extends Error {
  constructor() {
    super('Build discovery resource limit exceeded')
  }
}
