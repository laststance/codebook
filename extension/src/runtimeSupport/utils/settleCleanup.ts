/** Attempts each caller-bounded release during teardown, preserving errors without skipping later resources. @example await settleCleanup([{ description: 'tab', release: () => closeTab() }]) // [] */
export async function settleCleanup(
  steps: { description: string; release: () => unknown }[],
): Promise<string[]> {
  const failures: string[] = []
  // Independent resources still need release when an earlier operation times out or throws.
  for (const step of steps) {
    try {
      await step.release()
    } catch (error) {
      failures.push(`${step.description}: ${String(error)}`)
    }
  }
  return failures
}
