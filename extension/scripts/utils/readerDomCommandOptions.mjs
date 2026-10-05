/** How long one call of the browser CLI may take. */
const COMMAND_TIMEOUT_MS = 30_000
/** How long the call that runs the whole flow may take: every case of the check, with its viewport changes and screenshots, runs inside this one call, and the job that runs it ends after ten minutes. */
const FLOW_TIMEOUT_MS = 300_000
/** How much one call of the browser CLI may print: 4 MiB, above the report of every case with the values it read. */
const COMMAND_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024

/**
 * Gives the limits of one call of the browser CLI in the Reader DOM check, so the one call that runs the whole flow is not ended by the limit of a single browser command.
 *
 * Called by `study-bootstrap-qa.mjs` for every `playwright-cli` call it starts; the result is the options object of `execFile`.
 *
 * @param label - The script's name for the call (`open`, `video-start`, `flow`, `close`, …); it is also the name of the call's log file.
 * @returns `{ timeout, maxBuffer }`
 * - `flow`: 300,000 ms
 * - any other label: 30,000 ms
 * - `maxBuffer` is 4 MiB for every call
 *
 * @example
 * readerDomCommandOptions('flow') // => { timeout: 300000, maxBuffer: 4194304 }
 * readerDomCommandOptions('open') // => { timeout: 30000, maxBuffer: 4194304 }
 */
export function readerDomCommandOptions(label) {
  return {
    // Only the call that runs the whole flow gets the flow's limit.
    timeout: label === 'flow' ? FLOW_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
  }
}
