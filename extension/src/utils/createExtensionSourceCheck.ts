import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { StudyError } from '../errors'

import { CHROME_EXTENSION_RECOVERY } from './chromeExtensionRecovery'
import { normalizeNativeSourceText } from './normalizeNativeSourceText'

/** One open editor document as the check reads it. */
export type ExtensionSourceDocument = {
  uri: { scheme: string; fsPath: string }
  getText(): string
}

/** What {@link createExtensionSourceCheck} reads; the real file system unless a test names its own. */
export type ExtensionSourceCheckInput = {
  /** SHA-256 per pinned file, keyed by absolute path (ER20). */
  pinnedHashes: Readonly<Record<string, string>>
  /** The opened repository's folder; the refusal names a file relative to it. */
  workspace: string
  /** The editor's open documents (`vscode.workspace.textDocuments`). */
  documents(): readonly ExtensionSourceDocument[]
  readBytes?: (path: string) => Promise<Buffer>
}

/**
 * Makes the check of the executed-source identity of one chrome-extension run (ER20): the disk bytes of every pinned file and the text of every open editor document of a pinned file (an unsaved buffer included) must still be what the run pinned at `starting`.
 * Called by the run's dependencies once the pre-launch checks pinned their hashes; the run and its debugger call the returned check before launch, before each input and click, before and after each capture, before each continue and at each worker restart.
 * @param input - The pinned hashes, the repository folder and the editor's documents.
 * @returns A check that resolves when nothing changed.
 * @throws The check rejects with a {@link StudyError} `SOURCE_CHANGED`, `<file> changed after the run started.`, naming the first file that differs.
 * @example
 * const check = createExtensionSourceCheck({ pinnedHashes, workspace, documents: () => vscode.workspace.textDocuments })
 * await check()
 */
export function createExtensionSourceCheck(
  input: ExtensionSourceCheckInput,
): () => Promise<void> {
  const readBytes = input.readBytes ?? ((path: string) => readFile(path))
  const changedFile = (path: string): StudyError =>
    new StudyError(
      'SOURCE_CHANGED',
      `${relative(input.workspace, path).split('\\').join('/')} changed after the run started.`,
      undefined,
      CHROME_EXTENSION_RECOVERY.sourceChanged,
    )
  return async (): Promise<void> => {
    const diskText = new Map<string, string>()
    for (const [path, pinned] of Object.entries(input.pinnedHashes)) {
      // An unreadable file counts as changed: the pinned bytes cannot be shown to be there.
      const bytes = await readBytes(path).catch(() => undefined)
      if (
        bytes === undefined ||
        createHash('sha256').update(bytes).digest('hex') !== pinned
      )
        throw changedFile(path)
      diskText.set(resolve(path), bytes.toString('utf8'))
    }
    for (const document of input.documents()) {
      if (document.uri.scheme !== 'file') continue
      const path = resolve(document.uri.fsPath)
      const onDisk = diskText.get(path)
      // The editor normalizes encoding marks and line ends; only a real text difference is a change.
      if (
        onDisk !== undefined &&
        normalizeNativeSourceText(document.getText()) !==
          normalizeNativeSourceText(onDisk)
      )
        throw changedFile(path)
    }
  }
}
