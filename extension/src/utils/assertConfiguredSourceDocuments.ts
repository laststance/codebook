import { resolve } from 'node:path';
import type { TextDocument } from 'vscode';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import type { ConfiguredDefinition } from '../configuredStudySchemas';
import { StudyError } from '../errors';

/** Rejects mismatched open source buffers before runtime effects/pause/continue, without opening, saving, reverting or closing learner tabs. @example assertConfiguredSourceDocuments(root, definition, workspace.textDocuments) */
export function assertConfiguredSourceDocuments(root: string, definition: ConfiguredDefinition, documents: readonly Pick<TextDocument, 'uri' | 'getText'>[]): void {
  const hashes = new Map(definition.descriptor.sources.map(source => [resolve(root, source.path), source.hash]));
  for (const document of documents) {
    if (document.uri.scheme !== 'file') continue;
    const hash = hashes.get(resolve(document.uri.fsPath));
    if (hash && sha256(document.getText()) !== hash) throw new StudyError('SOURCE_CHANGED', 'An open cited source document differs from the accepted article. Keep or discard your edits explicitly before a new deliberate study.');
  }
}
