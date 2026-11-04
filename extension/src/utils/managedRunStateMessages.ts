/** The sentence of a start refused while Codebook releases its managed run. */
export const MANAGED_RUN_RELEASING_MESSAGE =
  'Codebook is releasing its managed run. Read the current run error and retry Stop if cleanup fails.'

/** The sentence of a start refused while Codebook prepares its managed run. */
export const MANAGED_RUN_PREPARING_MESSAGE =
  'Codebook is preparing its managed repository run. Poll the current run; do not stop its process or remove its lock.'

/**
 * Keeps only the managed-run sentences of a readiness `missing` list.
 *
 * Why it exists: a nested Vite start is judged by its own app, yet a managed run that is preparing or releasing blocks it as it blocks the root; the environment writes those sentences into the profile's `missing`. Called by {@link selectedVitePackageStartPrerequisites}.
 *
 * @param missing - A readiness `missing` list.
 * @returns The managed-run sentences in it, in order.
 * @example managedRunStateOf(['Chrome is missing.', MANAGED_RUN_PREPARING_MESSAGE]) // => [MANAGED_RUN_PREPARING_MESSAGE]
 */
export function managedRunStateOf(missing: readonly string[]): string[] {
  return missing.filter(
    (message) =>
      message === MANAGED_RUN_RELEASING_MESSAGE ||
      message === MANAGED_RUN_PREPARING_MESSAGE,
  )
}
