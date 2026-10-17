import { runFlowKeepingCases } from './runFlowKeepingCases.mjs'

/**
 * Writes the text of the file the browser CLI loads to run the Reader DOM flow: one function of the page that runs the flow inside {@link runFlowKeepingCases}, so a step that throws ends as one failed case after the cases that passed instead of a call without a result.
 *
 * Why a text: the flow and its fixtures exceed the size a single command argument may have on Linux (E2BIG), so they reach `run-code` as a file (`--filename`). `run-code` wraps the file's text in parentheses and calls the function outside Node's module system: the text is one expression without a closing semicolon, the flow and the keeper are written into it as their source, and the options as JSON.
 * Called by `study-bootstrap-qa.mjs` once per run, before it opens the browser.
 *
 * @param flow - The flow, `(page, options, collected) => …`; it may use only its three arguments and what it defines itself.
 * @param options - What the flow needs; it must survive `JSON.stringify`.
 * @returns The file's text: `async (page) => (<keeper>)(<flow>, page, <options>)` and a line end.
 *
 * @example
 * readerDomFlowText(async (page, options, collected) => { collected.cases.push({ name: options.kind, passed: true }) }, { kind: 'context' })
 * // => 'async (page) => (async function runFlowKeepingCases(flow, page, options) {…})(async (page, options, collected) => {…}, page, {"kind":"context"})\n'
 */
export function readerDomFlowText(flow, options) {
  return `async (page) => (${runFlowKeepingCases.toString()})(${flow.toString()}, page, ${JSON.stringify(options)})\n`
}
