/** One named step of a run {@link runStepsWithinBudget} answers for: the name a lapse reports, and the work. */
export interface BudgetedStep<StepName extends string> {
  name: StepName
  /** The step's work; a step that must not stop the steps after it catches its own failure. */
  run: () => Promise<unknown>
}

/**
 * Runs steps in order under one budget and reports the step still pending when the budget passes, without cutting it, so a command can answer while a storage that stops answering keeps the work running until it settles; called by the Devin Desktop setup's take-back and its removal.
 * The timer starts with the first step and stops when the last one settled or a step rejected; it fires at most once.
 * @param steps - The steps, run one after another.
 * @param budgetMs - How long the steps may take before `onLapse` hears of it.
 * @param onLapse - Hears the name of the step pending when the budget passed; it must not throw (it runs from a timer).
 * @returns Resolves once every step settled; the work goes on after a lapse.
 * @throws The first step rejection; the steps after it do not run.
 * @example
 * await runStepsWithinBudget([{ name: 'saved setup', run: restore }, { name: 'MCP entry', run: takeBack }], 10_000, (step) => lapsed.resolve(step)) // onLapse('MCP entry') when the entry removal is pending at 10 s
 */
export async function runStepsWithinBudget<StepName extends string>(
  steps: readonly BudgetedStep<StepName>[],
  budgetMs: number,
  onLapse: (pendingStepName: StepName) => void,
): Promise<void> {
  let pendingStepName: StepName | undefined
  const budget = setTimeout(() => {
    // The timer is cleared once the steps ended, so a step is always pending here.
    if (pendingStepName !== undefined) onLapse(pendingStepName)
  }, budgetMs)
  try {
    // One step at a time: the next starts only after the one before settled.
    for (const step of steps) {
      pendingStepName = step.name
      await step.run()
    }
  } finally {
    clearTimeout(budget)
  }
}
