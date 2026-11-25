import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as HasDevinEntryReceiptModule from '../utils/hasDevinEntryReceipt'
import { hasDevinEntryReceipt } from '../utils/hasDevinEntryReceipt'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

/** Makes a storage folder with the entry's folder, removed after the test. */
async function arrangeStorage(context: TestContext): Promise<string> {
  const storage = await mkdtemp(join(tmpdir(), 'entry-receipt-'))
  context.after(() => removeTestFolder(storage))
  await mkdir(join(storage, 'devin-mcp'))
  return storage
}

// protects=a record of the entry at its own name counting as left, so the activation refresh never says the setup was removed while it stands; fails_when=a standing record answers absent; no_claim=the dropping name and the race with a rewrite (their own tests)
test('the entry record answers left while it stands at its name', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  await writeFile(join(storage, 'devin-mcp', 'receipt.json'), '{}')
  // Act
  const left = await hasDevinEntryReceipt(storage)
  // Assert
  assert.equal(left, true)
})

// protects=a record of the entry a rewrite or delete holds at its dropping name counting as left, as the presence check's own sentence promises, so a refresh that lands in that moment never says the setup was removed; fails_when=the record at the dropping name answers absent; no_claim=the note the receipt's reader asks beside it (this check runs before the locked refresh that reads it)
test('the entry record answers left while only its dropping name holds it', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  await writeFile(
    join(storage, 'devin-mcp', 'receipt.json.codebook-dropping'),
    '{}',
  )
  // Act
  const left = await hasDevinEntryReceipt(storage)
  // Assert
  assert.equal(left, true)
})

// protects=a removed setup answering absent, so the activation refresh says the setup was removed instead of resolving Node for nothing; fails_when=a missing record answers left; no_claim=a link at the record's name (lstat answers no regular file for it)
test('the entry record answers absent once neither its name nor its dropping name holds it', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  // Act
  const left = await hasDevinEntryReceipt(storage)
  // Assert
  assert.equal(left, false)
})

// Value: protects=a refresh or a receipts check that lands while a rewrite of the entry's record finishes never reads the standing record as removed: the record's name looks empty while the rewrite holds it at the dropping name, and that name looks empty once the rewrite published its new record and dropped the old one, so the record's name is looked at once more and the record found there counts, the three-read rule the receipt's reader (readReceiptOrDropped) and the publish record's verdict (unverifiedVerdictOf) already follow; fails_when=the two empty looks decide and the refresh answers that the setup was removed although its record stands, so the window starts no connection and the learner is told to remove and set up again for nothing (Cycle 0149, CodeRabbit finding R10); no_claim=real file timing (scripted looks answer the record's name missing, the dropping name missing, then the record's name present), and a second rewrite or delete that begins before that last look (the residual the same rule states for the receipt's reader)
test('the entry record answers left when a rewrite publishes it at its name between the looks at both names', async () => {
  // Arrange
  const missing = () =>
    Promise.reject(
      Object.assign(new Error('no such file or directory'), {
        code: 'ENOENT',
      }),
    )
  const present = () => Promise.resolve({ isFile: () => true })
  const receiptPath = join('/storage', 'devin-mcp', 'receipt.json')
  const droppingPath = `${receiptPath}.codebook-dropping`
  const looksAt: string[] = []
  let isRewriteFinished = false
  const scripted = await loadModule<typeof HasDevinEntryReceiptModule>(
    resolve(__dirname, '../utils/hasDevinEntryReceipt.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        lstat: (path: string) => {
          looksAt.push(path)
          // The rewrite holds the record at the dropping name during the first look at the record's name, and finishes while that dropping name is inspected.
          if (path === receiptPath)
            return isRewriteFinished ? present() : missing()
          if (path === droppingPath) isRewriteFinished = true
          return missing()
        },
      },
    },
  )
  // Act
  const left = await scripted.hasDevinEntryReceipt('/storage')
  // Assert
  assert.equal(left, true)
  assert.deepEqual(looksAt, [receiptPath, droppingPath, receiptPath])
})
