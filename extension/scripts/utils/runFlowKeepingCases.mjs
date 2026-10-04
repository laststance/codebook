/**
 * Runs the Reader DOM flow and answers the cases it collected, also when a step of the flow throws.
 *
 * Why: the flow runs as one call of the browser CLI. When a step threw (a control that is not there, a wait that passed its limit), the call ended without a result, so the report named no case at all and one missing control read like a failure of the harness.
 * Called by `study-bootstrap-qa.mjs`, which writes this function's text into the file the browser CLI runs; it must therefore stay free of imports and outer variables.
 *
 * @param flow - The flow; it gets the page, its options and the lists it adds its cases and page errors to.
 * @param page - The browser page the CLI hands over.
 * @param options - What the flow needs; handed through unchanged.
 * @returns The collected cases and page errors. After a throw the cases end with one failed case that names the last case before the stop and carries the thrown error.
 *
 * @example
 * await runFlowKeepingCases(async (page, options, collected) => {
 *   collected.cases.push({ name: 'first paint', actual: 'Loading study…', passed: true })
 *   throw new Error('Timeout 5000ms exceeded')
 * }, page, {})
 * // => { cases: [{ name: 'first paint', … passed: true }, { name: 'the flow stopped after the case "first paint"', actual: 'Error: Timeout 5000ms exceeded', passed: false }], errors: [] }
 */
export async function runFlowKeepingCases(flow, page, options) {
  const collected = { cases: [], errors: [] }
  try {
    await flow(page, options, collected)
  } catch (error) {
    const lastCase = collected.cases.at(-1)
    // The stop is a case of its own, so the report says what passed before it and where it happened.
    collected.cases.push({
      name: lastCase
        ? `the flow stopped after the case "${lastCase.name}"`
        : 'the flow stopped before its first case',
      actual: String(error),
      passed: false,
    })
  }
  return collected
}
