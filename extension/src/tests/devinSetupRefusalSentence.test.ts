import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { devinInstallationReadRefusal } from '../utils/devinInstallationReadRefusal'
import { devinSetupRefusalSentence } from '../utils/devinSetupRefusalSentence'
import { readReceiptState } from '../utils/readReceiptState'
import { readStandingDevinInstallationId } from '../utils/readStandingDevinInstallationId'

import { removeTestFolder } from './utils/removeTestFolder'

const MODE_REPAIR_TEXT = 'Make that file readable only by you (mode 600)'
const CHANGED_SENTENCE =
  'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.'
const UNREADABLE_SENTENCE =
  'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.'
const PERMISSION_SENTENCE =
  'Codebook could not use its record at /storage/devin-skill/receipt.json, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.'
const WINDOWS_MODES = 'Windows reports mode 0o666 for every file'

/** Makes a storage folder with both receipt folders, removed after the test. */
async function arrangeStorage(context: TestContext): Promise<string> {
  const storage = await mkdtemp(join(tmpdir(), 'devin-refusal-'))
  context.after(() => removeTestFolder(storage))
  await mkdir(join(storage, 'devin-skill'))
  await mkdir(join(storage, 'devin-mcp'))
  return storage
}

/** Writes both receipts as installed and private, the MCP one with an installation id. */
async function writeStandingReceipts(storage: string): Promise<void> {
  await writeFile(
    join(storage, 'devin-skill', 'receipt.json'),
    '{"installed":true}',
    { mode: 0o600 },
  )
  await writeFile(
    join(storage, 'devin-mcp', 'receipt.json'),
    '{"installed":true,"installationId":"installation-a"}',
    { mode: 0o600 },
  )
}

// protects=a bridge answer of a permission problem names its file with the mode-600 repair; fails_when=a receipt others can read gets a vague sentence, so the learner cannot repair the file; no_claim=the answers that carry a binding
for (const reason of ['not-private', 'permission'] as const) {
  test(`a ${reason} receipt answer names the file with the mode-600 repair`, () => {
    // Arrange
    const answer = {
      answer: 'removed',
      reason,
      path: '/storage/devin-skill/receipt.json',
    } as const
    // Act
    const sentence = devinSetupRefusalSentence(answer)
    // Assert
    assert.equal(sentence, PERMISSION_SENTENCE)
  })
}

// protects=a record removed for any other reason says the setup changed meanwhile and offers no mode repair; fails_when=a missing or uninstalled record is told to change a file mode; no_claim=the permission reasons
for (const reason of [
  'missing',
  'not-regular',
  'uninstalled',
  'oversized',
  'unparsable',
  'no-mark',
  'another-installation',
] as const) {
  test(`a ${reason} receipt answer says the setup changed meanwhile`, () => {
    // Arrange
    const answer = {
      answer: 'removed',
      reason,
      path: '/storage/devin-skill/receipt.json',
    } as const
    // Act
    const sentence = devinSetupRefusalSentence(answer)
    // Assert
    assert.equal(sentence, CHANGED_SENTENCE)
  })
}

// protects=a descriptor refused as not private or unreadable getting the changed sentence, not the receipt mode repair; fails_when=the learner is told to chmod a descriptor with the receipt sentence; no_claim=receipt answers
for (const reason of ['not-private', 'permission'] as const) {
  test(`a ${reason} descriptor answer says the setup changed meanwhile`, () => {
    // Arrange
    const answer = {
      answer: 'removed',
      reason,
      path: '/storage/agent/x.connection.json',
    } as const
    // Act
    const sentence = devinSetupRefusalSentence(answer)
    // Assert
    assert.equal(sentence, CHANGED_SENTENCE)
  })
}

// protects=an answer of no answer, and a receipt state of no answer, say that the records could not be read and offer no mode repair; fails_when=a read that only failed to look sends the learner to change a file mode; no_claim=the replaced answer
test('a no-answer says the records could not be read, without a mode repair', () => {
  // Arrange
  const bridgeAnswer = { answer: 'no-answer' } as const
  const receiptState = {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  } as const
  // Act
  const sentences = [
    devinSetupRefusalSentence(bridgeAnswer),
    devinSetupRefusalSentence(receiptState),
  ]
  // Assert
  assert.deepEqual(sentences, [UNREADABLE_SENTENCE, UNREADABLE_SENTENCE])
  assert.equal(UNREADABLE_SENTENCE.includes(MODE_REPAIR_TEXT), false)
})

// protects=a standing answer, an installed receipt and a replaced descriptor map to no refusal or to the changed sentence as designed; fails_when=a success is refused, or a replaced setup passes; no_claim=the removed reasons
test('stands and installed give no refusal, replaced says the setup changed', () => {
  // Arrange
  const stands = { answer: 'stands' } as const
  const installed = {
    state: 'installed',
    receipt: { installed: true },
  } as const
  const replaced = { answer: 'replaced' } as const
  // Act
  const sentences = [
    devinSetupRefusalSentence(stands),
    devinSetupRefusalSentence(installed),
    devinSetupRefusalSentence(replaced),
  ]
  // Assert
  assert.deepEqual(sentences, [undefined, undefined, CHANGED_SENTENCE])
})

// protects=a mark is decided only while both receipts stand; fails_when=a window is marked for a setup whose receipt is missing, so the bridge refuses it; no_claim=the other receipt states
test('both receipts standing give the installation id of the entry', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  await writeStandingReceipts(storage)
  // Act
  const installationId = await readStandingDevinInstallationId(storage)
  // Assert
  assert.equal(installationId, 'installation-a')
})

// protects=a receipt of the skill that others can read stops the mark; fails_when=the looser check marks a window the bridge refuses; no_claim=Windows, which reports one mode for every file
test(
  'a skill receipt readable by others gives no installation id',
  { skip: process.platform === 'win32' ? WINDOWS_MODES : false },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    await writeStandingReceipts(storage)
    await chmod(join(storage, 'devin-skill', 'receipt.json'), 0o644)
    // Act
    const installationId = await readStandingDevinInstallationId(storage)
    // Assert
    assert.equal(installationId, undefined)
  },
)

// protects=a missing skill receipt, an uninstalled one and an entry receipt without an installation id each stop the mark; fails_when=any of them still marks the window; no_claim=unreadable files
test('a missing skill receipt, an uninstalled one and an entry receipt without an id give no installation id', async (context) => {
  // Arrange
  const missing = await arrangeStorage(context)
  await writeFile(
    join(missing, 'devin-mcp', 'receipt.json'),
    '{"installed":true,"installationId":"installation-a"}',
    { mode: 0o600 },
  )
  const uninstalled = await arrangeStorage(context)
  await writeStandingReceipts(uninstalled)
  await writeFile(
    join(uninstalled, 'devin-skill', 'receipt.json'),
    '{"installed":false}',
    { mode: 0o600 },
  )
  const withoutId = await arrangeStorage(context)
  await writeStandingReceipts(withoutId)
  await writeFile(
    join(withoutId, 'devin-mcp', 'receipt.json'),
    '{"installed":true}',
    { mode: 0o600 },
  )
  // Act
  const answers = await Promise.all(
    [missing, uninstalled, withoutId].map(readStandingDevinInstallationId),
  )
  // Assert
  assert.deepEqual(answers, [undefined, undefined, undefined])
})

// protects=the installation id refusal offers the mode-600 repair for a receipt others can read and the changed sentence for a missing one; fails_when=a missing receipt is told to change a mode, or a permission problem is not named; no_claim=Windows
test(
  'the installation id refusal repairs a readable-by-others receipt and says the setup changed for a missing one',
  { skip: process.platform === 'win32' ? WINDOWS_MODES : false },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const readable = join(storage, 'devin-mcp', 'receipt.json')
    await writeFile(readable, '{"installed":true,"installationId":"a"}', {
      mode: 0o644,
    })
    await chmod(readable, 0o644)
    const missing = join(storage, 'devin-skill', 'receipt.json')
    // Act
    const sentences = [
      devinInstallationReadRefusal(await readReceiptState(readable), readable),
      devinInstallationReadRefusal(await readReceiptState(missing), missing),
    ]
    // Assert
    assert.deepEqual(sentences, [
      `Codebook could not read the installation id in ${readable}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      CHANGED_SENTENCE,
    ])
  },
)

// protects=a first read of the installation id that gave no answer (for example EMFILE) is told as a read that failed, with no mode instruction, even though the receipt itself is private and holds an id; fails_when=the refusal reads the receipt again, finds it fine and offers the mode-600 repair for a file that needs none; why_new=Cycle 0145 /ship pass 1 finding on devinInstallationReadRefusal; seam=a hand-made no-answer state; no_claim=Windows
test('the installation id refusal asks for a retry, not a mode repair, when the first read gave no answer', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receipt = join(storage, 'devin-mcp', 'receipt.json')
  await writeFile(receipt, '{"installed":true,"installationId":"a"}', {
    mode: 0o600,
  })
  // Act
  const sentence = devinInstallationReadRefusal(
    { state: 'no-answer', receiptPath: receipt },
    receipt,
  )
  // Assert
  assert.equal(sentence, UNREADABLE_SENTENCE)
})

// protects=an installed receipt without an installation id (an older build) keeps the id sentence naming the file; fails_when=the refusal falls to the changed sentence, so the learner is not told which file to refresh; no_claim=other states
test('the installation id refusal names an installed receipt that holds no id', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receipt = join(storage, 'devin-mcp', 'receipt.json')
  await writeFile(receipt, '{"installed":true}', { mode: 0o600 })
  // Act
  const sentence = devinInstallationReadRefusal(
    await readReceiptState(receipt),
    receipt,
  )
  // Assert
  assert.equal(
    sentence,
    `Codebook could not read the installation id in ${receipt}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
  )
})
