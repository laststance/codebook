import { resolve } from 'node:path'

import type { TextDocument } from 'vscode'

import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import { StudyError } from '../errors'

import { normalizeNativeSourceText } from './normalizeNativeSourceText'

/**
 * Refuses a run while the editor holds other text for a cited source than the article cites, because the editor's debugger shows that text at a pause while the run executes the saved file; it opens, saves, reverts and closes no learner tab.
 * Called by {@link ConfiguredBrowserRun} before its first effect and at every input, pause and continue boundary, and by {@link OwnedNodeTestRun} before its test is listed or launched. Codebook starts its debuggers without saving, so nothing else brings such a document and its file together.
 * @param root - The opened repository's folder; the sources' paths are relative to it.
 * @param sources - The article's text of every source the selected node cites.
 * @param documents - The editor's open documents (`vscode.workspace.textDocuments`); a document of another scheme than `file` is never a cited source.
 * @returns Nothing when no open document of a cited source differs from the cited text. A document that is only marked as modified, or that differs in a byte order mark or in line ends alone, differs in nothing.
 * @throws A {@link StudyError} `SOURCE_CHANGED` that names the first cited source whose open document differs and says what the learner and the agent do.
 * @example
 * assertConfiguredSourceDocuments('/repository', [{ path: 'src/theme.ts', text: 'const a = 1\n' }], [
 *   { uri: { scheme: 'file', fsPath: '/repository/src/theme.ts' }, getText: () => 'const a = 2\n' },
 * ])
 * // throws SOURCE_CHANGED 'The cited source src/theme.ts is open in the editor with text that differs from the text the article cites, ...'
 */
export function assertConfiguredSourceDocuments(
  root: string,
  sources: readonly Pick<
    ConfiguredDescriptor['sources'][number],
    'path' | 'text'
  >[],
  documents: readonly {
    uri: Pick<TextDocument['uri'], 'scheme' | 'fsPath'>
    getText: TextDocument['getText']
  }[],
): void {
  const citedSources = new Map(
    sources.map((source) => [resolve(root, source.path), source]),
  )
  for (const document of documents) {
    if (document.uri.scheme !== 'file') continue
    const source = citedSources.get(resolve(document.uri.fsPath))
    // Native text models normalize encoding markers and line endings; disk verification still seals the original bytes.
    if (
      source !== undefined &&
      normalizeNativeSourceText(document.getText()) !==
        normalizeNativeSourceText(source.text)
    )
      throw new StudyError(
        'SOURCE_CHANGED',
        `The cited source ${source.path} is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.`,
      )
  }
}
