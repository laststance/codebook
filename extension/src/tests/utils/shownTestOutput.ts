import type {
  NodeTestOutputOptions,
  NodeTestOutputUpdate,
} from '../../utils/installNodeTestOutput'
import type { NodeTestApplicationView } from '../../utils/projectNodeTestApplication'

/** What starts and ends the options the Application document passes its output script ({@link testOutputHtml}). */
const SCRIPT_OPTIONS_START = ')(api, '
const SCRIPT_OPTIONS_END = ')</script>'

/**
 * Reads the first view a written Application document draws: the `view` of the options its output script takes, as {@link testOutputHtml} writes them.
 * @param document - The document's HTML.
 * @returns The written view; `undefined` for a document without the output script.
 * @example writtenView(panel.webview.html)?.lines // => [{ number: 0, channel: 'stdout', text: 'RUN src/theme.test.ts' }]
 */
function writtenView(document: string): NodeTestApplicationView | undefined {
  const start = document.lastIndexOf(SCRIPT_OPTIONS_START)
  const end = document.lastIndexOf(SCRIPT_OPTIONS_END)
  if (start < 0 || end < start) return undefined
  const options: Pick<NodeTestOutputOptions, 'view'> = JSON.parse(
    document.slice(start + SCRIPT_OPTIONS_START.length, end),
  )
  return options.view
}

/**
 * Reads the recorded test output that the Application pane shows, so a test matches what the learner reads there (Design 3, EN3): the latest in-place update when it is newer than the view the document was written with, else that written view's lines; used by the Study workspace's test replay tests.
 * @param harness - The Study workspace harness, which records the Application pane's updates and keeps its panels.
 * @returns The shown output lines joined by line feeds; empty without a test replay document or output.
 * @example shownTestOutput(harness) // => 'output 21\noutput 22'
 */
export function shownTestOutput(harness: ApplicationHarness): string {
  return (
    shownApplicationView(harness)
      ?.lines.map((line) => line.text)
      .join('\n') ?? ''
  )
}

/** What the harness records of the Application pane: its in-place updates and its panels. */
type ApplicationHarness = {
  applicationOutputs(): NodeTestOutputUpdate[]
  nativePanels(): { kind: string; webview: { html: string } }[]
}

/**
 * Reads the view the Application pane shows: the latest in-place update when it is newer than the view the document was written with, else that written view; used by the Study workspace's test and server replay tests.
 * @param harness - The Study workspace harness.
 * @returns The shown view; `undefined` without a replay document.
 * @example shownApplicationView(harness)?.response?.state // => 'Response 201 · application/json'
 */
export function shownApplicationView(
  harness: ApplicationHarness,
): NodeTestApplicationView | undefined {
  const document =
    harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')?.webview.html ??
    ''
  const written = writtenView(document)
  const update = harness.applicationOutputs().at(-1)
  // A document draws an update only when it is newer than the view it was written with.
  return update && (!written || update.generation > written.generation)
    ? update.view
    : written
}
