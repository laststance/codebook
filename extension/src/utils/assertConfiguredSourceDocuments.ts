import { resolve } from 'node:path'
import type { TextDocument } from 'vscode'
import type { ConfiguredDefinition } from '../configuredStudySchemas'
import { StudyError } from '../errors'
import { normalizeNativeSourceText } from './normalizeNativeSourceText'

/** Rejects mismatched open source buffers before runtime effects/pause/continue, without opening, saving, reverting or closing learner tabs. @example assertConfiguredSourceDocuments(root, definition, workspace.textDocuments) */
export function assertConfiguredSourceDocuments(
  root: string,
  definition: ConfiguredDefinition,
  documents: readonly {
    uri: Pick<TextDocument['uri'], 'scheme' | 'fsPath'>
    getText: TextDocument['getText']
  }[],
): void {
  const sources = new Map(
    definition.descriptor.sources.map((source) => [
      resolve(root, source.path),
      source.text,
    ]),
  )
  for (const document of documents) {
    if (document.uri.scheme !== 'file') continue
    const source = sources.get(resolve(document.uri.fsPath))
    // Native text models normalize encoding markers and line endings; disk verification still seals the original bytes.
    if (
      source !== undefined &&
      normalizeNativeSourceText(document.getText()) !==
        normalizeNativeSourceText(source)
    )
      throw new StudyError(
        'SOURCE_CHANGED',
        'An open cited source document differs from the accepted article. Keep or discard your edits explicitly before a new deliberate study.',
      )
  }
}
