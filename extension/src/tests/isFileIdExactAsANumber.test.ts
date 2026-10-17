import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import type * as IsFileIdExactAsANumberModule from './utils/isFileIdExactAsANumber'
import {
  FILE_ID_NOT_EXACT_AS_A_NUMBER,
  isFileIdExactAsANumber,
} from './utils/isFileIdExactAsANumber'
import { loadModule } from './utils/loadModule'

// Value: protects=the tests that expect an ownership record to keep device and inode as numbers (the Cursor skill's and the Cursor MCP catalog's), on a volume that gives the test's file an id above 2^53; fails_when=such a test fails although the product rightly records decimal text there, or skips without saying why; why_new=Cycle 0046 row 153: the skill's test had no such skip; seam=node:fs/promises of the loaded helper, whose files have ids above 2^53
test('a test of a record with numbers learns that its file’s id is above 2^53, and skips with a reason that says so', async () => {
  // Arrange: one file, asked through a file system whose ids are above 2^53 and through the real one.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-file-id-exact-'))
  const filePath = join(folder, 'a-file')
  await writeFile(filePath, 'x')
  const { isFileIdExactAsANumber: isExactWithLargeIds } = await loadModule<
    typeof IsFileIdExactAsANumberModule
  >(resolve(__dirname, './utils/isFileIdExactAsANumber.js'), {
    'node:fs/promises': fileSystemWithLargeFileIds(),
  })
  try {
    // Act
    const answers = {
      withAnIdAbove2To53: await isExactWithLargeIds(filePath),
      reasonOfTheSkip: FILE_ID_NOT_EXACT_AS_A_NUMBER,
    }

    // Assert
    assert.deepEqual(answers, {
      withAnIdAbove2To53: false,
      reasonOfTheSkip:
        'this file system gave the test’s file an id above 2^53, which a number does not hold exactly: the cases of large file ids cover it',
    })
    // The real file system's answer depends on the volume: it is a yes or a no, never an error.
    assert.equal(typeof (await isFileIdExactAsANumber(filePath)), 'boolean')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
