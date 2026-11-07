import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

// Value: protects=a same-context sibling is compiled without wrapper text, so the line and column V8 reports (and coverage offsets) equal the file's own; fails_when=the sibling is wrapped in a function-expression string on its first line, which shifts every first-line column; why_new=Cycle 0094 task 13 (c8 lost the function records of the split modules because of the wrapper); seam=a real temporary folder and the real vm module; no_claim=coverage output itself
test('a same-context sibling reports its first-line error at the column of its own file', async (context) => {
  // Arrange
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-load-module-')),
  )
  context.after(() => removeTestFolder(folder))
  const mainFile = join(folder, 'main.js')
  const siblingFile = join(folder, 'sibling.js')
  await writeFile(
    mainFile,
    'module.exports = { read: () => require("./sibling").stack }\n',
  )
  // `new Error` starts at column 17 of line 1 (1-based) of this file.
  await writeFile(siblingFile, 'exports.stack = new Error("x").stack\n')

  // Act
  const loaded = await loadModule<{ read: () => string }>(
    mainFile,
    {},
    {},
    { './sibling': siblingFile },
  )
  const stack = loaded.read()

  // Assert
  assert.match(stack, new RegExp(`${siblingFile}:1:17\\)?\\n`))
})
