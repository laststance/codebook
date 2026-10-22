import type { NodeTestOutputUpdate } from '../../utils/installNodeTestOutput'

/** The entities the Application document's text is escaped with ({@link escapeHtml}), `&amp;` last so an escaped entity is read once. */
const ENTITIES: [string, string][] = [
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&amp;', '&'],
]

/**
 * Reads the recorded test output that the Application pane shows, so a test matches what the learner reads there (Design 3, EN3): the latest in-place update when it is newer than the written document, else the document's own lines; used by the Study workspace's test replay tests.
 * @param harness - The Study workspace harness, which records the Application pane's updates and keeps its panels.
 * @returns The shown output lines joined by line feeds; empty without a test replay document or output.
 * @example shownTestOutput(harness) // => 'output 21\noutput 22'
 */
export function shownTestOutput(harness: {
  applicationOutputs(): NodeTestOutputUpdate[]
  nativePanels(): { kind: string; webview: { html: string } }[]
}): string {
  const document =
    harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')?.webview.html ??
    ''
  // The document starts its update script with the generation it was written at.
  const written = Number(/\)\(api, (\d+), \{/.exec(document)?.[1] ?? -1)
  const update = harness.applicationOutputs().at(-1)
  if (update && update.generation > written)
    return update.view.lines.map((line) => line.text).join('\n')
  return Array.from(
    document.matchAll(/<span class="output-text">([^<]*)<\/span>/g),
    (match) =>
      ENTITIES.reduce(
        (text, [entity, character]) => text.replaceAll(entity, character),
        match[1] ?? '',
      ),
  ).join('\n')
}
