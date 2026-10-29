import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createExtensionSourceCheck } from '../utils/createExtensionSourceCheck'

/** Makes a workspace with one pinned file and the check over it. */
async function pinnedFile(context: {
  after: (hook: () => Promise<void>) => void
}) {
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-source-check-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  const path = join(workspace, 'popup.js')
  await writeFile(path, 'let a = 1\n')
  const pinnedHashes = {
    [path]: createHash('sha256').update('let a = 1\n').digest('hex'),
  }
  return { workspace, path, pinnedHashes }
}

// Value: protects=ER20: nothing differing passes, a changed disk file is SOURCE_CHANGED naming the file, and an open unsaved buffer with other text is too; fails_when=a change goes unnoticed or the sentence differs; no_claim=the debugger's own calls of the check
test('refuses a changed disk file and an unsaved buffer, and passes unchanged sources', async (context) => {
  // Arrange
  const { workspace, path, pinnedHashes } = await pinnedFile(context)
  const buffer = { text: 'let a = 1\n' }
  const check = createExtensionSourceCheck({
    pinnedHashes,
    workspace,
    documents: () => [
      { uri: { scheme: 'file', fsPath: path }, getText: () => buffer.text },
    ],
  })
  // Act
  await check()
  buffer.text = 'let a = 2\n'
  const unsaved = await check().then(
    () => undefined,
    (error: unknown) => error as Error,
  )
  buffer.text = 'let a = 1\n'
  await writeFile(path, 'let a = 3\n')
  const onDisk = await check().then(
    () => undefined,
    (error: unknown) => error as Error,
  )
  // Assert
  assert.equal(unsaved?.message, 'popup.js changed after the run started.')
  assert.equal(onDisk?.message, 'popup.js changed after the run started.')
  assert.equal(Reflect.get(unsaved ?? {}, 'code'), 'SOURCE_CHANGED')
})

// Value: protects=ER20: an editor's line-end normalization alone is no change; fails_when=a CRLF buffer of the same text refuses; no_claim=other encodings
test('treats the editor’s line-end normalization as no change', async (context) => {
  // Arrange
  const { workspace, path, pinnedHashes } = await pinnedFile(context)
  const check = createExtensionSourceCheck({
    pinnedHashes,
    workspace,
    documents: () => [
      { uri: { scheme: 'file', fsPath: path }, getText: () => 'let a = 1\r\n' },
    ],
  })
  // Act
  const outcome = await check().then(
    () => 'passed',
    () => 'refused',
  )
  // Assert
  assert.equal(outcome, 'passed')
})
