/** What an adapter's status report holds that {@link composeAdapterReadiness} folds the shared prerequisites into. */
type ComposableReadiness<Entry extends { missing: string[] }> = {
  missing: string[]
  packages?: Entry[]
}

/**
 * Folds the shared prerequisites and the managed-run state into an adapter's readiness and into each of its `packages` entries.
 *
 * Why it exists: `vite-dev` and `react-scripts-dev` compose their `ready` and `missing` the same way (DX-9), so `codebook_status` and a start judge one rule. Called by the environment's `prerequisites` for each of those adapters.
 *
 * @param adapter - The adapter's own report, with its `packages` in the status answer.
 * @param check - Joins extra gaps with the shared prerequisites: `ready` is true only without any gap.
 * @param managedRunState - The sentence of a preparing or releasing managed run, empty when none is in the way.
 * @returns The report with `ready` and `missing` composed, and every `packages` entry composed the same way.
 * @example composeAdapterReadiness({ ready: true, missing: [], packages: [{ packageRoot: 'a', missing: [] }] }, check, []) // => { ready: …, missing: […], packages: [{ packageRoot: 'a', ready: …, missing: […] }] }
 */
export function composeAdapterReadiness<
  Entry extends { missing: string[] },
  Adapter extends ComposableReadiness<Entry>,
>(
  adapter: Adapter,
  check: (specific: string[]) => { ready: boolean; missing: string[] },
  managedRunState: string[],
): Adapter {
  return {
    ...adapter,
    ...check([...adapter.missing, ...managedRunState]),
    // Each listed app is ready for a start only with the shared prerequisites and no managed run in the way, as the root is.
    ...(adapter.packages
      ? {
          packages: adapter.packages.map((entry) => ({
            ...entry,
            ...check([...entry.missing, ...managedRunState]),
          })),
        }
      : {}),
  }
}
