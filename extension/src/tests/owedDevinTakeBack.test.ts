import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as OwedDevinTakeBackModule from '../utils/owedDevinTakeBack'
import { readOwedDevinTakeBack } from '../utils/owedDevinTakeBack'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

/**
 * Makes a global storage folder whose `devin-setup/take-back.json` holds `text`, as a failed Devin Desktop setup's take-back leaves it.
 * @param context - The test, which removes the folder afterwards.
 * @param text - The record's bytes; `undefined` leaves no record.
 * @returns The storage folder.
 * @example await storageWithRecord(context, '{"schemaVersion":1,"generation":"g1"}')
 */
async function storageWithRecord(
  context: { after: (callback: () => Promise<void>) => void },
  text: string | undefined,
): Promise<string> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'codebook-owed-'))
  context.after(() => removeTestFolder(storageRoot))
  await mkdir(join(storageRoot, 'devin-setup'), { recursive: true })
  if (text !== undefined)
    await writeFile(join(storageRoot, 'devin-setup', 'take-back.json'), text, {
      mode: 0o600,
    })
  return storageRoot
}

// Value: protects=only a missing record reads as nothing owed, so a setup or refresh goes on only when no failed setup's entry is still to be taken back (Cycle 0146 /ship pass 2, red-team 1); fails_when=the look answers something else for a storage without a record, so every setup refuses; no_claim=what setup does with the answer (devinChatOnboarding tests)
test('a look for an owed Devin take-back finds nothing owed where no record is', async (context) => {
  // Arrange
  const storageRoot = await storageWithRecord(context, undefined)
  // Act
  const look = await readOwedDevinTakeBack(storageRoot)
  // Assert
  assert.deepEqual(look, { state: 'none' })
})

// Value: protects=a private record of the owed take-back names the failed setup's generation, so the next run takes back that entry and nothing newer (Cycle 0146 /ship pass 2, red-team 1); fails_when=the generation is lost or another one is read; no_claim=the removal by that generation (devinMcpConfig tests)
test('a look for an owed Devin take-back names the generation its private record holds', async (context) => {
  // Arrange
  const storageRoot = await storageWithRecord(
    context,
    '{"schemaVersion":1,"generation":"generation-of-a-failed-setup"}',
  )
  // Act
  const look = await readOwedDevinTakeBack(storageRoot)
  // Assert
  assert.deepEqual(look, {
    state: 'owed',
    generation: 'generation-of-a-failed-setup',
  })
})

// Value: protects=a record whose bytes are no record of this shape is no proof that nothing is owed, so setup refuses instead of adopting an entry that record may name, and the answer names the file (Cycle 0146 /ship pass 2, red-team 1); fails_when=an unusable record reads as nothing owed; no_claim=the sentence setup shows (devinChatOnboarding tests)
test('a look for an owed Devin take-back whose record has another shape does not know whether one is owed', async (context) => {
  // Arrange
  const storageRoot = await storageWithRecord(
    context,
    '{"schemaVersion":2,"generation":"generation-of-a-failed-setup"}',
  )
  // Act
  const look = await readOwedDevinTakeBack(storageRoot)
  // Assert
  assert.deepEqual(look, {
    state: 'unknown',
    recordPath: join(storageRoot, 'devin-setup', 'take-back.json'),
  })
})

// Value: protects=a record that others can read is no proof that nothing is owed (Cycle 0146 /ship pass 2, red-team 1); fails_when=a record restored with another mode reads as nothing owed; no_claim=Windows, which judges no mode bits (the read's own tests)
test(
  'a look for an owed Devin take-back whose record others can read does not know whether one is owed',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const storageRoot = await storageWithRecord(
      context,
      '{"schemaVersion":1,"generation":"generation-of-a-failed-setup"}',
    )
    await chmod(join(storageRoot, 'devin-setup', 'take-back.json'), 0o644)
    // Act
    const look = await readOwedDevinTakeBack(storageRoot)
    // Assert
    assert.deepEqual(look, {
      state: 'unknown',
      recordPath: join(storageRoot, 'devin-setup', 'take-back.json'),
    })
  },
)

// Value: protects=a read of the record that gets no answer (descriptor exhaustion, EIO) is no proof that nothing is owed (Cycle 0146 /ship pass 2, red-team 1); fails_when=a read that only failed to look reads as nothing owed, so a setup adopts the failed setup's entry and a later look takes it out; no_claim=which codes count as no answer (readPrivateJsonState's own tests); the stand-in read answers no-answer
test('a look for an owed Devin take-back whose read gets no answer does not know whether one is owed', async () => {
  // Arrange
  const owedTakeBack = await loadModule<typeof OwedDevinTakeBackModule>(
    resolve(__dirname, '../utils/owedDevinTakeBack.js'),
    {
      './readPrivateJsonState': {
        readPrivateJsonState: async () => ({ state: 'no-answer' }),
      },
    },
  )
  // Act
  const look = await owedTakeBack.readOwedDevinTakeBack('/storage')
  // Assert
  // A copy of this realm: the loaded module's object has another realm's prototype.
  assert.deepEqual(structuredClone(look), {
    state: 'unknown',
    recordPath: join('/storage', 'devin-setup', 'take-back.json'),
  })
})
