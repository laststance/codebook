import type { VerdictBudget } from '../../utils/readWithinVerdictBudget'

/**
 * Makes a hit's time budget a test spends by hand, so a read can be held open and the budget ended at the moment the test chooses.
 * @returns The budget, which stays open until `expire` is called.
 * @example
 * const { budget, expire } = manualVerdictBudget()
 * expire() // every read racing the budget now times out
 */
export function manualVerdictBudget(): {
  budget: VerdictBudget
  expire(): void
} {
  let expire: () => void = () => {}
  const expired = new Promise<void>((resolve) => {
    expire = resolve
  })
  return { budget: { expired }, expire: (): void => expire() }
}
