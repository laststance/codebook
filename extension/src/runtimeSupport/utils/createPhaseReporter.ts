import type {
  ExtensionPhaseReporter,
  ExtensionPreparationPhase,
} from '../../chromeExtensionContracts'

/**
 * Wraps an optional `onPhase` callback so a phase start is reported with its monotonic elapsed time and a failing callback never breaks the work it observes.
 * Called by the owned launch and the debugger at the start of each preparation phase; the run lifecycle's journal is the callback (CR15).
 * @param onPhase - The callback; without one the returned reporter does nothing.
 * @param startedAtMs - The `performance.now()` reading the elapsed time counts from; now when omitted.
 * @returns A function that reports one phase start.
 * @example
 * const report = createPhaseReporter((name, elapsedMs) => journal(name, elapsedMs))
 * report('launching') // journals ('launching', 0)
 */
export function createPhaseReporter(
  onPhase: ExtensionPhaseReporter | undefined,
  startedAtMs: number = performance.now(),
): (name: ExtensionPreparationPhase) => void {
  return (name): void => {
    try {
      onPhase?.(name, Math.max(0, performance.now() - startedAtMs))
    } catch {
      // The journal is an observer; its failure must not fail the launch.
    }
  }
}
