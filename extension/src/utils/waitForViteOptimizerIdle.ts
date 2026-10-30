/** The part of one discovered dependency the wait reads (Vite's `OptimizedDepInfo`). */
type DiscoveredDependency = { processing?: Promise<void> }

/** The part of Vite's `DevEnvironment.depsOptimizer` the wait reads. */
export type ViteDependencyOptimizer = {
  scanProcessing?: Promise<void>
  metadata: { discovered: Record<string, DiscoveredDependency> }
}

/**
 * Waits until Vite's dependency optimizer has nothing left to process.
 *
 * Why it exists: when the optimizer discovers a dependency late it re-bundles and sends a full page reload. Codebook must write its inputs only after that reload, so the owned launcher reports when the optimizer is idle instead of the extension guessing with a fixed quiet window. Called by the launcher (`viteLauncher.ts`) for each `vite-await-optimizer` command.
 * Awaits the initial scan, then every discovered dependency's `processing` promise, and repeats while a pass found a promise it had not awaited (a dependency discovered while the earlier ones were bundled).
 *
 * @param optimizer - The client environment's `depsOptimizer`; `undefined` when Vite has none (optimizer disabled).
 * @returns Resolves when no unawaited processing promise remains; never rejects, because a failed optimization is Vite's to report.
 * @example
 * await waitForViteOptimizerIdle(server.environments.client.depsOptimizer)
 */
export async function waitForViteOptimizerIdle(
  optimizer: ViteDependencyOptimizer | undefined,
): Promise<void> {
  if (!optimizer) return
  const awaited = new Set<Promise<void>>()
  for (;;) {
    await optimizer.scanProcessing?.catch(() => undefined)
    // Only promises not awaited in an earlier pass count as pending work.
    const pending = Object.values(optimizer.metadata.discovered)
      .map((dependency) => dependency.processing)
      .filter(
        (processing): processing is Promise<void> =>
          processing !== undefined && !awaited.has(processing),
      )
    if (pending.length === 0) return
    await Promise.allSettled(pending)
    for (const processing of pending) awaited.add(processing)
  }
}
