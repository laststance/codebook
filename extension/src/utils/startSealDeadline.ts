/** What a seal's deadline settles with when its time passes. */
export const SEAL_DEADLINE_PASSED = Symbol('seal deadline passed')

/**
 * Starts the bound of one seal: `passed` settles with {@link SEAL_DEADLINE_PASSED} when `boundMs` is over, and `cancel` ends the timer once the seal is done.
 * Called by the server and the chrome-extension recorder at their one seal.
 * @param boundMs - How long the seal may take.
 * @returns The promise that settles at the deadline and the function that cancels its timer.
 * @example const deadline = startSealDeadline(10_000); const raced = await Promise.race([seal(), deadline.passed]); deadline.cancel()
 */
export function startSealDeadline(boundMs: number): {
  passed: Promise<typeof SEAL_DEADLINE_PASSED>
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  const passed = new Promise<typeof SEAL_DEADLINE_PASSED>((resolve) => {
    timer = setTimeout(() => resolve(SEAL_DEADLINE_PASSED), boundMs)
    timer.unref()
  })
  return {
    passed,
    cancel: (): void => {
      if (timer) clearTimeout(timer)
    },
  }
}
