import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { DEVIN_DESCRIPTOR_LIMIT_BYTES } from '../constants'
import { checkDevinBridgeReceipts as realCheckDevinBridgeReceipts } from '../utils/checkDevinBridgeReceipts'
import * as realReadDescriptorText from '../utils/readDescriptorText'
import type { PrivateJsonState } from '../utils/readPrivateJsonState'
import { readReceiptState } from '../utils/readReceiptState'
import { createPathReadGate } from '../utils/shareReceiptRead'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

const WINDOWS_MODES = 'Windows reports mode 0o666 for every file'
/** U+FFFD, the character a byte that is no UTF-8 decodes to; built from its code point so no formatter writes it as raw text. */
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd)

/** Makes a storage folder with an agent folder, removed after the test. */
async function arrangeStorage(context: TestContext): Promise<string> {
  const storage = await mkdtemp(join(tmpdir(), 'receipt-state-'))
  context.after(() => removeTestFolder(storage))
  await mkdir(join(storage, 'agent'))
  await mkdir(join(storage, 'devin-skill'))
  await mkdir(join(storage, 'devin-mcp'))
  return storage
}

/** Writes a private file with the given text. */
async function writePrivate(path: string, text: string): Promise<void> {
  await writeFile(path, text, { mode: 0o600 })
}

/** SHA-256 of a text's UTF-8 bytes, as a publish record names the bytes of a receipt. */
function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Writes the three files the bridge's check reads, each standing for the installation `installation-a`. */
async function writeStandingSetup(storage: string): Promise<string> {
  await writePrivate(
    join(storage, 'devin-skill', 'receipt.json'),
    JSON.stringify({ installed: true }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'receipt.json'),
    JSON.stringify({ installed: true, installationId: 'installation-a' }),
  )
  const descriptorPath = join(storage, 'agent', 'x.connection.json')
  await writePrivate(
    descriptorPath,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      instanceId: '11111111-1111-4111-8111-111111111111',
      devinSetupInstallation: 'installation-a',
    }),
  )
  return descriptorPath
}

/**
 * Loads {@link readReceiptState} so that one receipt read fails with the given error code, the way a file shortage or an input error would.
 * @param code - The `code` of the error the bounded read throws.
 */
async function loadWithFailingRead(code: string) {
  const failingRead = () =>
    Promise.reject(Object.assign(new Error('read failed'), { code }))
  return loadModule<{ readReceiptState: typeof readReceiptState }>(
    resolve(__dirname, '../utils/readReceiptState.js'),
    {
      './readPrivateJsonState': await loadModule(
        resolve(__dirname, '../utils/readPrivateJsonState.js'),
        {
          './readDescriptorText': {
            ...realReadDescriptorText,
            readDescriptorBytes: failingRead,
          },
        },
      ),
    },
  )
}

/** The MCP receipt every scripted read answers: installed for `installation-b`, with the hash of its bytes. */
const SCRIPTED_RECEIPT: PrivateJsonState = {
  state: 'read',
  value: { installed: true, installationId: 'installation-b' },
  sha256: 'hash of the bytes at receipt.json',
}

/** A publish record whose note says that receipt.json is unverified and names other bytes than the scripted receipt's. */
const SCRIPTED_NOTED_RECORD: PrivateJsonState = {
  state: 'read',
  value: {
    targetPath: '/home/lume/.config/devin/mcp_config.json',
    createdFile: false,
    retiresReceipt: {
      sha256: 'hash of the record setup moved aside',
      receiptUnverified: true,
    },
  },
  sha256: 'hash of the bytes at the publish record',
}

/** A name that holds no file. */
const SCRIPTED_EMPTY_NAME: PrivateJsonState = {
  state: 'removed',
  reason: 'missing',
}

/**
 * Loads {@link readReceiptState} over a bounded read that answers `/storage/devin-mcp/receipt.json` with {@link SCRIPTED_RECEIPT} unless the script names it, and each read of the publish record's two names and the receipt's dropping name from a script, so a test can place a step of the config module between two of those reads.
 * Scripted answers and the inode lookup bind to the full path of each name beside that receipt: a read or lookup of the same-named file in another folder answers nothing from the script and is recorded in `unexpectedAccesses`, which every test asserts empty, so a product bug that reads the right name in the wrong folder never passes.
 * @param script - Per bare name (`receipt.json`, `receipt.json.codebook-dropping`, `receipt.json.codebook-dropping-note`, `pending.json`, `pending.json.codebook-dropping`), what its reads answer in turn; the last answer repeats; `receipt.json` left out answers {@link SCRIPTED_RECEIPT}, and any other name left out answers {@link SCRIPTED_EMPTY_NAME}.
 * @param lookupErrorCode - When given, the `code` of the error the inode lookup of the dropping name throws, the way an emptied name (`ENOENT`) or an input error (`EIO`) would.
 * @returns The loaded reader, with the `unexpectedAccesses` that every read or lookup off the scripted receipt's folder records.
 */
async function loadWithScriptedRecordReads(
  script: Record<string, PrivateJsonState[]>,
  lookupErrorCode?: string,
) {
  const readsOf = new Map<string, number>()
  const unexpectedAccesses: string[] = []
  const loaded = await loadModule<{
    readReceiptState: typeof readReceiptState
  }>(resolve(__dirname, '../utils/readReceiptState.js'), {
    'node:fs/promises': {
      // Scripted notes name inode 43 of the receipt's dropping name at its full path; every other name proves nothing.
      lstat: (path: string) => {
        if (path !== '/storage/devin-mcp/receipt.json.codebook-dropping') {
          unexpectedAccesses.push(path)
          return Promise.resolve({ ino: 0n })
        }
        if (lookupErrorCode !== undefined)
          return Promise.reject(
            Object.assign(new Error('lookup failed'), {
              code: lookupErrorCode,
            }),
          )
        return Promise.resolve({ ino: 43n })
      },
    },
    './readPrivateJsonState': {
      readPrivateJsonState: (path: string): Promise<PrivateJsonState> => {
        const name = basename(path)
        // The script's names sit beside `/storage/devin-mcp/receipt.json` only: the same-named file anywhere else is no scripted read.
        if (path !== join('/storage/devin-mcp', name)) {
          unexpectedAccesses.push(path)
          return Promise.resolve(SCRIPTED_EMPTY_NAME)
        }
        // The receipt stands unless the script reads it otherwise.
        if (name === 'receipt.json' && script[name] === undefined)
          return Promise.resolve(SCRIPTED_RECEIPT)
        const answers = script[name] ?? [SCRIPTED_EMPTY_NAME]
        const count = readsOf.get(name) ?? 0
        readsOf.set(name, count + 1)
        return Promise.resolve(
          answers[Math.min(count, answers.length - 1)] ?? SCRIPTED_EMPTY_NAME,
        )
      },
    },
  })
  return { ...loaded, unexpectedAccesses }
}

// protects=a receipt that stands being told from the other states; fails_when=an installed receipt answers removed or its fields are lost; no_claim=the bridge's reconnect behavior
test('a receipt that says installed answers installed with its fields', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-a' }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-a' },
  })
})

// Value: protects=while Codebook's publish record beside the MCP receipt notes that a put-back left a file it did not verify at receipt.json, that file never counts as an installed receipt, so neither the window's descriptor mark nor the bridge's check takes the installation it names (Cycle 0149 task 32; CLI passes 1 and 3 Major on devinMcpConfig.test.ts:18789 and :18769); fails_when=the receipt answers installed, or removed with another reason; no_claim=how the note came to be (the test writes the publish record by hand, with the hash of other bytes than the receipt's), and a note left only at the publish record's dropping name by a stopped rewrite (the next setup, refresh or removal puts it back first)
test('an installed MCP receipt answers removed with the reason unverified while its publish record notes that receipt.json is unverified', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: {
        sha256: sha256Of(
          JSON.stringify({ installed: true, installationId: 'installation-a' }),
        ),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unverified',
    receiptPath,
  })
})

// Value: protects=a publish record's note that receipt.json is unverified counts for the bridge and the window's mark also when it names no bytes (`retiresReceipt: { receiptUnverified: true }`, the form a put-back that kept an older version's record leaves, in which only an empty receipt.json passes), as every setup, refresh and removal refuses that file (Cycle 0149 task 40; /ship pass 1 outside voice 10); fails_when=the receipt answers installed, or removed with another reason; no_claim=how the note came to be (the test writes the publish record by hand), and a note whose hash is no string (it never equals the receipt's hash either)
test('an installed MCP receipt answers removed with the reason unverified while its publish record notes receipt.json unverified without naming any bytes', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: { receiptUnverified: true },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unverified',
    receiptPath,
  })
})

// Value: protects=a note that receipt.json is unverified still counts for the bridge and the window's mark while the publish record stands only at its dropping name, as every rewrite or delete of that record leaves it for a moment and a run that stopped inside that step leaves it until the next run puts it back (Cycle 0149 task 39; /ship pass 1 outside voice 9, Codex structured readReceiptState.ts:66, red team 2); fails_when=the empty publish record name reads as no note and the receipt answers installed, or removed with another reason; no_claim=how the record came to stand there (the test writes it by hand), and the config module's own put-back
test('an installed MCP receipt answers removed with the reason unverified while only the dropping name of its publish record holds the note that receipt.json is unverified', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json.codebook-dropping'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: {
        sha256: sha256Of(
          JSON.stringify({ installed: true, installationId: 'installation-a' }),
        ),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unverified',
    receiptPath,
  })
})

// Value: protects=a note that receipt.json is unverified at the publish record's dropping name counts although another file stands at the record's name without it (for example a backup put an older record back after a run stopped inside a rewrite), as the config module then keeps both and goes no further (Cycle 0149 task 39; /ship pass 1 outside voice 9, Codex structured readReceiptState.ts:66); fails_when=the record's name alone decides and the receipt answers installed; no_claim=which of the two files the config module later keeps
test('an installed MCP receipt answers removed with the reason unverified while the dropping name holds that note beside a publish record without it', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
    }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json.codebook-dropping'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: {
        sha256: sha256Of(
          JSON.stringify({ installed: true, installationId: 'installation-a' }),
        ),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unverified',
    receiptPath,
  })
})

// Value: protects=a live rewrite of the publish record that puts the record back at its name between the read of that name and the read of its dropping name never hides its note: both names read empty, so the record's name is read once more and the note found there counts (Cycle 0149 task 39; red team 2, the live-rewrite gap); fails_when=one empty read of the record's name reads as no note and the receipt answers installed; no_claim=real file timing (scripted reads answer the record's name empty, the dropping name empty, then the record's name with the note), and a second rewrite that begins before the third read (the stated residual)
test('an installed MCP receipt answers removed with the reason unverified when a rewrite puts its noted publish record back at its name between the reads of both names', async () => {
  // Arrange
  const { readReceiptState: readWithRewrite, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'pending.json': [SCRIPTED_EMPTY_NAME, SCRIPTED_NOTED_RECORD],
      'pending.json.codebook-dropping': [SCRIPTED_EMPTY_NAME],
    })
  // Act
  const state = await readWithRewrite('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'unverified',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a read of the publish record that fails to look (descriptor exhaustion, EIO) leaves the receipt unknown rather than standing or removed (Cycle 0149 ship review, specialist note on unverifiedVerdictOf); fails_when=the failed read answers installed, so a window marks itself and the bridge connects past a note it could not read, or removed, so a transient failure ends the bridge; no_claim=which codes count as no answer (readPrivateJsonState's own tests); scripted reads answer the record's name with no-answer and the dropping name empty
test('an installed MCP receipt answers no-answer when the read of its publish record fails to look', async () => {
  // Arrange
  const { readReceiptState: readWithFailedRecord, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'pending.json': [{ state: 'no-answer' }],
    })
  // Act
  const state = await readWithFailedRecord('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a note that receipt.json is unverified at the publish record's dropping name outranks a read of the record's name that failed to look (unverifiedVerdictOf's order: a name that keeps the receipt from standing comes before a read that gave no answer), so a window already marked loses its mark and the bridge refuses the receipt, as every setup, refresh and removal refuses that file (Cycle 0149 ship review, the testing reader's note on readReceiptState.ts:166); fails_when=the failed read decides and the receipt answers no-answer, which keeps a window's mark that the note should take away, or the receipt answers installed or removed with another reason; no_claim=real file timing and which codes count as no answer (scripted reads answer the record's name with no-answer and its dropping name with a record whose note names other bytes; readPrivateJsonState's own tests)
test("an installed MCP receipt answers removed with the reason unverified when its publish record's dropping name holds the note although the read of the record's name fails to look", async () => {
  // Arrange
  const { readReceiptState: readWithFailedRecordName, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'pending.json': [{ state: 'no-answer' }],
      'pending.json.codebook-dropping': [SCRIPTED_NOTED_RECORD],
    })
  // Act
  const state = await readWithFailedRecordName(
    '/storage/devin-mcp/receipt.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'unverified',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=the same order with the names swapped: a note that receipt.json is unverified at the publish record's name outranks a read of its dropping name that failed to look, since unverifiedVerdictOf weighs both names alike, so the receipt never stands and no window keeps its mark beside that note (Cycle 0149 ship review, the testing reader's note on readReceiptState.ts:166, its mirrored case); fails_when=the failed read of the dropping name decides and the receipt answers no-answer, or the receipt answers installed or removed with another reason; no_claim=real file timing and which codes count as no answer (scripted reads answer the record's name with a record whose note names other bytes and its dropping name with no-answer; readPrivateJsonState's own tests)
test("an installed MCP receipt answers removed with the reason unverified when its publish record holds the note although the read of that record's dropping name fails to look", async () => {
  // Arrange
  const { readReceiptState: readWithFailedDroppingName, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'pending.json': [SCRIPTED_NOTED_RECORD],
      'pending.json.codebook-dropping': [{ state: 'no-answer' }],
    })
  // Act
  const state = await readWithFailedDroppingName(
    '/storage/devin-mcp/receipt.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'unverified',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a publish record that stands but cannot be read as a record (here no JSON) keeps the receipt from standing, since Codebook cannot tell that no note stands there (Cycle 0149 ship review, specialist note on unverifiedVerdictOf); fails_when=the unreadable record reads as no note and the receipt answers installed; no_claim=the other unreadable forms (a link, too large), which take the same branch
test('an installed MCP receipt answers removed with the reason unverified when its publish record is no JSON', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-a' }),
  )
  await writePrivate(join(storage, 'devin-mcp', 'pending.json'), '{ not json')
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unverified',
    receiptPath,
  })
})

// Value: protects=a publish record whose text parses as JSON but is no object keeping the receipt from standing, as the config module's parseRecord refuses that file as unreadable whatever its JSON shape, so the bridge's check and the window's mark never disagree with the config's refusal by reading it as a record without a note (Cycle 0149, CodeRabbit finding R11); fails_when=the JSON value that is no object reads as no note and the receipt answers installed, or removed with another reason; no_claim=an object without the note (it still reads as no note, its own test), and how such a file came to stand there (the test writes it by hand)
for (const [shape, text] of [
  ['null', 'null'],
  ['an array', '[1]'],
  ['a number', '42'],
] as const)
  test(`an installed MCP receipt answers removed with the reason unverified when its publish record is ${shape}`, async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
    await writePrivate(
      receiptPath,
      JSON.stringify({ installed: true, installationId: 'installation-a' }),
    )
    await writePrivate(join(storage, 'devin-mcp', 'pending.json'), text)
    // Act
    const state = await readReceiptState(receiptPath)
    // Assert
    assert.deepEqual(state, {
      state: 'removed',
      reason: 'unverified',
      receiptPath,
    })
  })

// Value: protects=a publish record that is an object without the unverified note still reading as no note, so a settled record of a write or removal in progress never keeps the receipt from standing (Cycle 0149, CodeRabbit finding R11's kept path); fails_when=the object without the note reads as unverified and the receipt answers removed; no_claim=whether that object is a record of the config module's own shape (the reader never checks the other fields, which are the config module's)
test('an installed MCP receipt answers installed while its publish record is an object that carries no note', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-a' }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-a' },
  })
})

// Value: protects=a publish record that others can read keeps the MCP receipt from standing with that record's own reason and path, so the setup can name that file with the mode-600 repair instead of saying only that the setup changed (Cycle 0149 ship review, native adversarial note 3); fails_when=the answer is removed with the reason unverified, or names no record, or the receipt answers installed; no_claim=Windows modes, the sentence itself (devinSetupRefusalSentence's tests)
test(
  'an installed MCP receipt answers removed with the reason not-private naming its publish record when others can read that record',
  { skip: process.platform === 'win32' && WINDOWS_MODES },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
    const recordPath = join(storage, 'devin-mcp', 'pending.json')
    await writePrivate(
      receiptPath,
      JSON.stringify({ installed: true, installationId: 'installation-a' }),
    )
    await writePrivate(
      recordPath,
      JSON.stringify({
        targetPath: '/home/lume/.config/devin/mcp_config.json',
        createdFile: false,
      }),
    )
    await chmod(recordPath, 0o644)
    // Act
    const state = await readReceiptState(receiptPath)
    // Assert
    assert.deepEqual(state, {
      state: 'removed',
      reason: 'not-private',
      receiptPath,
      recordPath,
    })
  },
)

// Value: protects=only the MCP entry's receipt is weighed against a publish record: the skill's receipt stands on its own whatever file stands beside it (Cycle 0149 ship review, specialist note on the folder guard of unverifiedVerdictOf); fails_when=a pending.json beside the skill receipt makes it answer removed; no_claim=the MCP receipt, and why such a file stands there (the config module writes none in that folder)
test('an installed skill receipt answers installed although a file beside it notes receipt.json unverified', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-skill', 'receipt.json')
  await writePrivate(receiptPath, JSON.stringify({ installed: true }))
  await writePrivate(
    join(storage, 'devin-skill', 'pending.json'),
    JSON.stringify({
      retiresReceipt: {
        sha256: sha256Of('other bytes'),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: { installed: true },
  })
})

// Value: protects=the note that receipt.json is unverified passes the very bytes it names, as every setup, refresh and removal does (Cycle 0149 task 32, the same rule as the config module's), so the old record put back with those bytes still stands for the bridge; fails_when=that receipt answers anything but installed with its fields; no_claim=how the note came to be (the test writes the publish record by hand with the hash of the receipt's own bytes)
test('an installed MCP receipt that holds the very bytes its publish record names answers installed although that record notes receipt.json unverified', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const receiptText = JSON.stringify({
    installed: true,
    installationId: 'installation-a',
  })
  await writePrivate(receiptPath, receiptText)
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: {
        sha256: sha256Of(receiptText),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-a' },
  })
})

// Value: protects=the bridge judges the very bytes a publish record's note names by the file's own bytes, as the config module hashes them, so the old record put back byte for byte stands again although one of its strings holds a byte that is no UTF-8 (Cycle 0149 task 41; /ship pass 1 outside voice 11, Codex structured readPrivateJsonState.ts:78); fails_when=the receipt answers removed (the hash of the decoded text, where that byte became U+FFFD, differs from the bytes' hash); no_claim=how such bytes came to be (the test writes them by hand), and what a setup, refresh or removal says about them
test('an installed MCP receipt whose string holds a byte that is no UTF-8 answers installed while its publish record notes receipt.json unverified with the hash of those very bytes', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const receiptBytes = Buffer.concat([
    Buffer.from(
      '{"installed":true,"installationId":"installation-a","label":"',
    ),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ])
  await writeFile(receiptPath, receiptBytes, { mode: 0o600 })
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: {
        sha256: createHash('sha256').update(receiptBytes).digest('hex'),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: {
      installed: true,
      installationId: 'installation-a',
      label: REPLACEMENT_CHARACTER,
    },
  })
})

// Value: protects=a file at receipt.json whose bytes differ from the ones a publish record's note names stays unverified for the bridge although both decode to the same text (a byte that is no UTF-8 where the named record held an encoded U+FFFD), as the config module, which hashes the bytes, refuses it (Cycle 0149 task 41; /ship pass 1 outside voice 11, Codex structured readPrivateJsonState.ts:78); fails_when=the receipt answers installed; no_claim=how such bytes came to be (the test writes them by hand)
test('an installed MCP receipt answers removed with the reason unverified when its bytes differ from the ones its publish record names but decode to the same text', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const namedBytes = Buffer.from(
    `{"installed":true,"installationId":"installation-a","label":"${REPLACEMENT_CHARACTER}"}`,
  )
  const standingBytes = Buffer.concat([
    Buffer.from(
      '{"installed":true,"installationId":"installation-a","label":"',
    ),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ])
  await writeFile(receiptPath, standingBytes, { mode: 0o600 })
  await writePrivate(
    join(storage, 'devin-mcp', 'pending.json'),
    JSON.stringify({
      targetPath: '/home/lume/.config/devin/mcp_config.json',
      createdFile: false,
      retiresReceipt: {
        sha256: createHash('sha256').update(namedBytes).digest('hex'),
        receiptUnverified: true,
      },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unverified',
    receiptPath,
  })
})

// protects=a removal being observed as removed with its reason; fails_when=a missing receipt answers no-answer, so a removed setup is never seen; no_claim=other absences such as ENOTDIR
test('a receipt that is not there answers removed with the reason missing', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, { state: 'removed', reason: 'missing', receiptPath })
})

// Value: protects=a bridge check or a window's mark that lands while Codebook rewrites or deletes its record of the entry, which it moves to receipt.json.codebook-dropping first so that receipt.json stands empty for a moment, reads that record there, so a connected bridge whose setup stands never ends with the not-set-up line and a window never unmarks itself in that moment (Cycle 0149 ship review, specialist testing note on readReceiptState.ts:154); fails_when=the empty receipt.json alone decides and the receipt answers removed with the reason missing, or the fields of the record at the dropping name are lost; no_claim=real file timing (the test writes the dropping note naming the record's inode and bytes, then the record at the dropping name and nothing at receipt.json, as the move leaves them; pass 3's red team 2 made that note a condition), which file the config module's next run keeps there
test('an MCP receipt that Codebook holds at its dropping name while receipt.json is empty answers installed with its fields', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const recordText = JSON.stringify({
    installed: true,
    installationId: 'installation-a',
  })
  await writePrivate(`${receiptPath}.codebook-dropping`, recordText)
  // The note Codebook writes before its move names the moved record's inode and bytes.
  const { ino } = await stat(`${receiptPath}.codebook-dropping`, {
    bigint: true,
  })
  await writePrivate(
    `${receiptPath}.codebook-dropping-note`,
    JSON.stringify({
      moved: { ino: ino.toString(), sha256: sha256Of(recordText) },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-a' },
  })
})

// Value: protects=a copy of Codebook's record of the entry with the same bytes at another inode, which a backup or sync tool put at the receipt's dropping name beside the move's note, never stands for that record: the note names the moved file's inode as well as its bytes, and both must match before the reader treats the file there as the receipt while receipt.json is empty (Cycle 0149 release-head review, CodeRabbit minor on readReceiptState); fails_when=the copy answers installed instead of the empty receipt.json answering removed with the reason missing; no_claim=a file whose inode cannot be looked up after it was read, and how such a copy came to stand there (the test writes it and the note by hand)
test('an MCP receipt answers removed with the reason missing when the dropping note names the same bytes at another inode than the file at its dropping name', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const recordText = JSON.stringify({
    installed: true,
    installationId: 'installation-a',
  })
  await writePrivate(`${receiptPath}.codebook-dropping`, recordText)
  const { ino } = await stat(`${receiptPath}.codebook-dropping`, {
    bigint: true,
  })
  await writePrivate(
    `${receiptPath}.codebook-dropping-note`,
    JSON.stringify({
      moved: { ino: (ino + 1n).toString(), sha256: sha256Of(recordText) },
    }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, { state: 'removed', reason: 'missing', receiptPath })
})

// Value: protects=a rewrite of Codebook's record of the entry that publishes its new record and deletes the old one between the read of receipt.json and the read of its dropping name never reads as a removal: both names read empty, so receipt.json is read once more and the record found there stands (Cycle 0149 ship review, specialist testing note; task 39's three-read rule for the publish record); fails_when=one empty read of receipt.json decides and the receipt answers removed with the reason missing; no_claim=real file timing (scripted reads answer receipt.json empty, its dropping name empty, then receipt.json with the record), and a second rewrite or a delete that begins before the third read (the stated residual)
test('an MCP receipt that a rewrite publishes between the reads of receipt.json and its dropping name answers installed', async () => {
  // Arrange
  const { readReceiptState: readWithRewrite, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME, SCRIPTED_RECEIPT],
      'receipt.json.codebook-dropping': [SCRIPTED_EMPTY_NAME],
    })
  // Act
  const state = await readWithRewrite('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-b' },
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a read of the receipt's dropping name that fails to look (descriptor exhaustion, EIO) while receipt.json reads empty leaves the receipt unknown, since Codebook may hold its record there at that moment, so a transient failure never ends a connected bridge (Cycle 0149 ship review, specialist testing note); fails_when=the empty receipt.json decides and the receipt answers removed with the reason missing; no_claim=which codes count as no answer (readPrivateJsonState's own tests); scripted reads answer receipt.json empty and its dropping name with no-answer
test('an MCP receipt answers no-answer when receipt.json is empty and the read of its dropping name fails to look', async () => {
  // Arrange
  const { readReceiptState: readWithFailedDropping, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME],
      'receipt.json.codebook-dropping': [{ state: 'no-answer' }],
    })
  // Act
  const state = await readWithFailedDropping('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a file at the receipt's dropping name that is no record (here no JSON) never stands for Codebook's record of the entry: the empty receipt.json still answers removed with the reason missing (Cycle 0149 ship review, specialist testing note); fails_when=that file answers for the receipt, as installed, unparsable or no-answer; no_claim=the other unreadable forms (a link, too large, a mode others can read), which take the same branch
test('an MCP receipt answers removed with the reason missing when receipt.json is empty and its dropping name holds no record', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(`${receiptPath}.codebook-dropping`, 'not json')
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, { state: 'removed', reason: 'missing', receiptPath })
})

// Value: protects=only the MCP entry's receipt, which Codebook's config module moves through a dropping name, is read there: a removed skill receipt stays removed beside any file at its own dropping name (Cycle 0149 ship review, specialist testing note); fails_when=the skill receipt answers installed from that file; no_claim=the skill module's own writes, which never use that name
test('a skill receipt that is not there answers removed with the reason missing although a receipt stands at its dropping name', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-skill', 'receipt.json')
  await writePrivate(
    `${receiptPath}.codebook-dropping`,
    JSON.stringify({ installed: true }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, { state: 'removed', reason: 'missing', receiptPath })
})

// Value: protects=a record at the receipt's dropping name stands for Codebook's record of the entry only while the dropping note Codebook writes before every move of that record names it, the rule every setup, refresh and removal follows (they refuse such a file as one a backup or sync tool may have put there), so a stale or restored file at that private name never marks a window or connects the bridge (Cycle 0149 ship review pass 3, red team 2 on readReceiptState.ts:109); fails_when=the record at the dropping name answers installed without any note beside it; no_claim=real files (scripted reads answer receipt.json empty, its dropping name with an installed record and its note's name empty), the inode the config module's run start also checks
test('an MCP receipt answers removed with the reason missing when receipt.json is empty and its dropping name holds a record that no dropping note names', async () => {
  // Arrange
  const { readReceiptState: readWithUnnotedDropping, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME],
      'receipt.json.codebook-dropping': [
        {
          state: 'read',
          value: { installed: true, installationId: 'installation-a' },
          sha256: 'hash of the bytes at the dropping name',
        },
      ],
    })
  // Act
  const state = await readWithUnnotedDropping('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'missing',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a dropping note that names other bytes than the file at the receipt's dropping name (a backup or sync tool replaced the moved record there, or the note is an older move's) proves nothing, so that file never stands for Codebook's record of the entry, as every setup, refresh and removal refuses it (Cycle 0149 ship review pass 3, red team 2); fails_when=the file at the dropping name answers installed beside a note that names other bytes; no_claim=real files (scripted reads), the inode the config module's run start also checks
test('an MCP receipt answers removed with the reason missing when receipt.json is empty and the dropping note names other bytes than the record at its dropping name', async () => {
  // Arrange
  const { readReceiptState: readWithOtherNote, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME],
      'receipt.json.codebook-dropping': [
        {
          state: 'read',
          value: { installed: true, installationId: 'installation-a' },
          sha256: 'hash of the bytes at the dropping name',
        },
      ],
      'receipt.json.codebook-dropping-note': [
        {
          state: 'read',
          value: { moved: { ino: '43', sha256: 'hash of another record' } },
          sha256: 'hash of the bytes at the dropping note',
        },
      ],
    })
  // Act
  const state = await readWithOtherNote('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'missing',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a dropping note of another shape than the config module's (here its moved version without the inode that module's schema requires) proves nothing, so the reader refuses what every setup, refresh and removal refuses, also when it names the very bytes at the dropping name (Cycle 0149 ship review pass 3, red team 2); fails_when=the record at the dropping name answers installed beside a note that module reads as no note; no_claim=real files (scripted reads), every other shape that module refuses (its schema's other fields take the same parse)
test('an MCP receipt answers removed with the reason missing when receipt.json is empty and the note beside its dropping name lacks the inode of the move', async () => {
  // Arrange
  const { readReceiptState: readWithShapelessNote, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME],
      'receipt.json.codebook-dropping': [
        {
          state: 'read',
          value: { installed: true, installationId: 'installation-a' },
          sha256: 'hash of the bytes at the dropping name',
        },
      ],
      'receipt.json.codebook-dropping-note': [
        {
          state: 'read',
          value: {
            moved: { sha256: 'hash of the bytes at the dropping name' },
          },
          sha256: 'hash of the bytes at the dropping note',
        },
      ],
    })
  // Act
  const state = await readWithShapelessNote('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'missing',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a record that Codebook moved to the receipt's dropping name, with the dropping note it wrote before the move naming that record's bytes, still answers for the receipt while receipt.json is empty, so a bridge check or a window's mark that lands while Codebook rewrites or deletes its record of the entry keeps finding the setup as it stood (Cycle 0149 ship review pass 3, red team 2; pass 2's specialist testing note); fails_when=the noted record answers removed or no-answer, or its fields are lost; no_claim=real files (scripted reads), the inode the config module's run start also checks
test('an MCP receipt that Codebook holds at its dropping name answers installed with its fields while the dropping note names those very bytes', async () => {
  // Arrange
  const { readReceiptState: readWithNotedDropping, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME],
      'receipt.json.codebook-dropping': [
        {
          state: 'read',
          value: { installed: true, installationId: 'installation-a' },
          sha256: 'hash of the bytes at the dropping name',
        },
      ],
      'receipt.json.codebook-dropping-note': [
        {
          state: 'read',
          value: {
            moved: {
              ino: '43',
              sha256: 'hash of the bytes at the dropping name',
            },
          },
          sha256: 'hash of the bytes at the dropping note',
        },
      ],
    })
  // Act
  const state = await readWithNotedDropping('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-a' },
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a read of the dropping note that fails to look (descriptor exhaustion, EIO) while receipt.json reads empty and its dropping name holds a record leaves the receipt unknown, since that note may name the record, so a transient failure neither ends a connected bridge nor unmarks a window (Cycle 0149 ship review pass 3, red team 2); fails_when=the record at the dropping name answers installed without its note being read, or the receipt answers removed; no_claim=which codes count as no answer (readPrivateJsonState's own tests); scripted reads
test('an MCP receipt answers no-answer when receipt.json is empty, its dropping name holds a record and the read of the dropping note fails to look', async () => {
  // Arrange
  const { readReceiptState: readWithFailedNote, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME],
      'receipt.json.codebook-dropping': [
        {
          state: 'read',
          value: { installed: true, installationId: 'installation-a' },
          sha256: 'hash of the bytes at the dropping name',
        },
      ],
      'receipt.json.codebook-dropping-note': [{ state: 'no-answer' }],
    })
  // Act
  const state = await readWithFailedNote('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a lookup of the moved record's inode that fails to look (EIO and the like) leaving the receipt unknown rather than missing: the file at the dropping name may be the very record the dropping note names, so neither a window's mark nor the bridge's check ever reads an uninspectable setup as deleted (Cycle 0149 release-head review, CodeRabbit minor on readReceiptState); fails_when=the failed lookup reads as a record no note names, receipt.json is read once more and the receipt answers removed with the reason missing; no_claim=which failure codes count as an observed absence (ENOENT and ENOTDIR, their own tests); scripted reads answer receipt.json empty, its dropping name with the record the note names, and the lookup fails with EIO
test("an MCP receipt answers no-answer when receipt.json is empty, its dropping name holds a record the dropping note names and the lookup of that record's inode fails to look", async () => {
  // Arrange
  const { readReceiptState: readWithFailedLookup, unexpectedAccesses } =
    await loadWithScriptedRecordReads(
      {
        'receipt.json': [SCRIPTED_EMPTY_NAME],
        'receipt.json.codebook-dropping': [
          {
            state: 'read',
            value: { installed: true, installationId: 'installation-a' },
            sha256: 'hash of the bytes at the dropping name',
          },
        ],
        'receipt.json.codebook-dropping-note': [
          {
            state: 'read',
            value: {
              moved: {
                ino: '43',
                sha256: 'hash of the bytes at the dropping name',
              },
            },
            sha256: 'hash of the bytes at the dropping note',
          },
        ],
      },
      'EIO',
    )
  // Act
  const state = await readWithFailedLookup('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a record that is gone from the receipt's dropping name by the lookup of its inode (a delete finished, or a put-back took it back, between the read of its bytes and that lookup) still reading as a record the note no longer names, so receipt.json is read once more and decides — here empty, so the receipt answers removed with the reason missing, the one missing answer a lookup may lead to (Cycle 0149 release-head review, CodeRabbit minor on readReceiptState: the kept ENOENT boundary); fails_when=the observed absence answers no-answer although the lookup proved the record gone, which keeps no window marked but holds every bridge check unknown beside a finished removal; no_claim=real file timing (scripted reads answer receipt.json empty twice and its dropping name with the record, the lookup reports ENOENT)
test("an MCP receipt answers removed with the reason missing when receipt.json stays empty and the lookup of the moved record's inode reports ENOENT", async () => {
  // Arrange
  const { readReceiptState: readWithEmptiedName, unexpectedAccesses } =
    await loadWithScriptedRecordReads(
      {
        'receipt.json': [SCRIPTED_EMPTY_NAME],
        'receipt.json.codebook-dropping': [
          {
            state: 'read',
            value: { installed: true, installationId: 'installation-a' },
            sha256: 'hash of the bytes at the dropping name',
          },
        ],
        'receipt.json.codebook-dropping-note': [
          {
            state: 'read',
            value: {
              moved: {
                ino: '43',
                sha256: 'hash of the bytes at the dropping name',
              },
            },
            sha256: 'hash of the bytes at the dropping note',
          },
        ],
      },
      'ENOENT',
    )
  // Act
  const state = await readWithEmptiedName('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'missing',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=the re-read of receipt.json that decides once the lookup of the moved record's inode observes its dropping name empty with ENOENT: a rewrite that published its new record and finished deleting the old one before that lookup reads as installed with the new record, never as the removal the first empty read of receipt.json would answer — the stays-empty test above cannot tell that re-read from its skip, since its scripted last answer repeats (Cycle 0149 release-head review minors, the ENOENT boundary's re-read proof); fails_when=receipt.json is not read once more after the observed absence, so the receipt answers removed with the reason missing although its new record stands; no_claim=real file timing (scripted reads answer receipt.json empty, its dropping name with the record the note names, then receipt.json with the new record, and the lookup reports ENOENT), a second rewrite or a delete that moves the new record before that last read (the stated residual)
test("an MCP receipt that a rewrite publishes before the lookup of the moved record's inode reports ENOENT answers installed with the new record", async () => {
  // Arrange
  const { readReceiptState: readWithRepublishedReceipt, unexpectedAccesses } =
    await loadWithScriptedRecordReads(
      {
        'receipt.json': [SCRIPTED_EMPTY_NAME, SCRIPTED_RECEIPT],
        'receipt.json.codebook-dropping': [
          {
            state: 'read',
            value: { installed: true, installationId: 'installation-a' },
            sha256: 'hash of the bytes at the dropping name',
          },
        ],
        'receipt.json.codebook-dropping-note': [
          {
            state: 'read',
            value: {
              moved: {
                ino: '43',
                sha256: 'hash of the bytes at the dropping name',
              },
            },
            sha256: 'hash of the bytes at the dropping note',
          },
        ],
      },
      'ENOENT',
    )
  // Act
  const state = await readWithRepublishedReceipt(
    '/storage/devin-mcp/receipt.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-b' },
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a lookup of the moved record's inode that observes no directory at the dropping name (ENOTDIR, the other observed absence removedReasonOf knows) reading as the same emptied name as ENOENT: no file can stand there, so receipt.json is read once more and decides rather than the receipt staying unknown beside a finished removal (Cycle 0149 release-head review, CodeRabbit minor on readReceiptState: the kept ENOENT boundary, its sibling code); fails_when=the observed absence answers no-answer although no record can stand at that name; no_claim=real file timing (scripted reads answer receipt.json empty twice and its dropping name with the record, the lookup reports ENOTDIR)
test("an MCP receipt answers removed with the reason missing when receipt.json stays empty and the lookup of the moved record's inode reports ENOTDIR", async () => {
  // Arrange
  const { readReceiptState: readWithNoDirectory, unexpectedAccesses } =
    await loadWithScriptedRecordReads(
      {
        'receipt.json': [SCRIPTED_EMPTY_NAME],
        'receipt.json.codebook-dropping': [
          {
            state: 'read',
            value: { installed: true, installationId: 'installation-a' },
            sha256: 'hash of the bytes at the dropping name',
          },
        ],
        'receipt.json.codebook-dropping-note': [
          {
            state: 'read',
            value: {
              moved: {
                ino: '43',
                sha256: 'hash of the bytes at the dropping name',
              },
            },
            sha256: 'hash of the bytes at the dropping note',
          },
        ],
      },
      'ENOTDIR',
    )
  // Act
  const state = await readWithNoDirectory('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'removed',
    reason: 'missing',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=the re-read of receipt.json that decides once the lookup of the moved record's inode observes no directory at its dropping name (ENOTDIR, the other observed absence): a rewrite that published its new record and finished deleting the old one before that lookup reads as installed with the new record on this sibling code too, never as the removal the first empty read of receipt.json would answer — the stays-empty test above cannot tell that re-read from its skip, since its scripted last answer repeats (Cycle 0149 release-head review minors, the ENOENT boundary's re-read proof, its sibling code); fails_when=receipt.json is not read once more after the observed absence, so the receipt answers removed with the reason missing although its new record stands; no_claim=real file timing (scripted reads answer receipt.json empty, its dropping name with the record the note names, then receipt.json with the new record, and the lookup reports ENOTDIR), a second rewrite or a delete that moves the new record before that last read (the stated residual)
test("an MCP receipt that a rewrite publishes before the lookup of the moved record's inode reports ENOTDIR answers installed with the new record", async () => {
  // Arrange
  const { readReceiptState: readWithRepublishedReceipt, unexpectedAccesses } =
    await loadWithScriptedRecordReads(
      {
        'receipt.json': [SCRIPTED_EMPTY_NAME, SCRIPTED_RECEIPT],
        'receipt.json.codebook-dropping': [
          {
            state: 'read',
            value: { installed: true, installationId: 'installation-a' },
            sha256: 'hash of the bytes at the dropping name',
          },
        ],
        'receipt.json.codebook-dropping-note': [
          {
            state: 'read',
            value: {
              moved: {
                ino: '43',
                sha256: 'hash of the bytes at the dropping name',
              },
            },
            sha256: 'hash of the bytes at the dropping note',
          },
        ],
      },
      'ENOTDIR',
    )
  // Act
  const state = await readWithRepublishedReceipt(
    '/storage/devin-mcp/receipt.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-b' },
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// Value: protects=a rewrite of Codebook's record of the entry that publishes its new record, deletes the old one at the dropping name and then its dropping note between the read of the dropping name and the read of that note never reads as a removal: the note no longer names the old record, so receipt.json is read once more and the new record found there stands (Cycle 0149 ship review pass 3, red team 2; the three-read rule of pass 2's specialist testing note); fails_when=the empty first read of receipt.json decides and the receipt answers removed with the reason missing, or the old record at the dropping name answers in place of the new one; no_claim=real file timing (scripted reads answer receipt.json empty, its dropping name with the old record, its note's name empty, then receipt.json with the new record), a second rewrite or a delete that moves the new record before that last read (the stated residual)
test('an MCP receipt that a rewrite publishes between the reads of its dropping name and the dropping note answers installed with the new record', async () => {
  // Arrange
  const { readReceiptState: readWithFinishedRewrite, unexpectedAccesses } =
    await loadWithScriptedRecordReads({
      'receipt.json': [SCRIPTED_EMPTY_NAME, SCRIPTED_RECEIPT],
      'receipt.json.codebook-dropping': [
        {
          state: 'read',
          value: { installed: true, installationId: 'installation-a' },
          sha256: 'hash of the bytes at the dropping name',
        },
      ],
      'receipt.json.codebook-dropping-note': [SCRIPTED_EMPTY_NAME],
    })
  // Act
  const state = await readWithFinishedRewrite('/storage/devin-mcp/receipt.json')
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-b' },
  })
  assert.deepEqual(unexpectedAccesses, [])
})

// protects=a removed skill receipt (installed false) counting as removed; fails_when=it answers installed; no_claim=the MCP receipt
test('a receipt that says installed false answers removed with the reason uninstalled', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-skill', 'receipt.json')
  await writePrivate(receiptPath, JSON.stringify({ installed: false }))
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'uninstalled',
    receiptPath,
  })
})

// protects=an invalid receipt text counting as removed; fails_when=it answers no-answer or throws; no_claim=a JSON value that is an array (same branch)
test('a receipt whose text is no JSON answers removed with the reason unparsable', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(receiptPath, '{ not json')
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unparsable',
    receiptPath,
  })
})

// protects=an oversized receipt counting as removed by its code; fails_when=the refusal is judged by its message and answers no-answer; no_claim=a file that grows while read
test('a receipt larger than the limit answers removed with the reason oversized', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(receiptPath, 'x'.repeat(DEVIN_DESCRIPTOR_LIMIT_BYTES + 1))
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'oversized',
    receiptPath,
  })
})

// protects=a receipt others can read counting as removed by its code; fails_when=it answers no-answer; no_claim=Windows modes
test(
  'a receipt that others can read answers removed with the reason not-private',
  { skip: process.platform === 'win32' && WINDOWS_MODES },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
    await writePrivate(receiptPath, JSON.stringify({ installed: true }))
    await chmod(receiptPath, 0o644)
    // Act
    const state = await readReceiptState(receiptPath)
    // Assert
    assert.deepEqual(state, {
      state: 'removed',
      reason: 'not-private',
      receiptPath,
    })
  },
)

// protects=a linked receipt counting as removed; fails_when=a link answers no-answer or is followed; no_claim=other non-regular files
test('a receipt that is a link answers removed with the reason not-regular', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const targetPath = join(storage, 'target.json')
  await writePrivate(targetPath, JSON.stringify({ installed: true }))
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  if (!(await createLinkIfAllowed(targetPath, receiptPath)))
    return context.skip(LINK_NOT_ALLOWED)
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'not-regular',
    receiptPath,
  })
})

// protects=a receipt this user may not read counting as removed; fails_when=it answers no-answer; no_claim=running as root (which can read anything; the test then skips)
test(
  'a receipt this user may not read answers removed with the reason permission',
  {
    skip:
      (process.platform === 'win32' && WINDOWS_MODES) ||
      (process.getuid?.() === 0 && 'root reads every file'),
  },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
    await writePrivate(receiptPath, JSON.stringify({ installed: true }))
    await chmod(receiptPath, 0o000)
    // Act
    const state = await readReceiptState(receiptPath)
    // Assert
    assert.deepEqual(state, {
      state: 'removed',
      reason: 'permission',
      receiptPath,
    })
  },
)

for (const code of ['EMFILE', 'ENFILE', 'EIO'])
  // protects=a failed read never counting as a removal; fails_when=any read failure other than an observed absence answers removed; no_claim=the bridge's handling of no answer
  test(`a receipt read that fails with ${code} answers no-answer`, async () => {
    // Arrange
    const { readReceiptState: readWithFailure } =
      await loadWithFailingRead(code)
    // Act
    const state = await readWithFailure('/storage/devin-mcp/receipt.json')
    // Assert
    // The module ran in its own realm, so its answer is compared by its JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
      state: 'no-answer',
      receiptPath: '/storage/devin-mcp/receipt.json',
    })
  })

// protects=a replacement race counting as no answer, not as a removal of the setup; fails_when=EREPLACED answers removed; no_claim=the real replacement
test('a receipt read that reports EREPLACED answers no-answer', async () => {
  // Arrange
  const { readReceiptState: readWithFailure } =
    await loadWithFailingRead('EREPLACED')
  // Act
  const state = await readWithFailure('/storage/devin-mcp/receipt.json')
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
})

// protects=Windows EPERM and EACCES (seen while a file is replaced or scanned) counting as no answer, and as permission elsewhere; fails_when=Windows answers removed/permission, or another system answers no-answer; no_claim=real Windows errors
for (const code of ['EPERM', 'EACCES'])
  test(`a receipt read that fails with ${code} answers no-answer on win32 and permission on linux`, async () => {
    // Arrange
    const { readReceiptState: readWithFailure } =
      await loadWithFailingRead(code)
    // Act
    const states = [
      await readWithFailure('/storage/devin-mcp/receipt.json', 'win32'),
      await readWithFailure('/storage/devin-mcp/receipt.json', 'linux'),
    ]
    // Assert
    assert.deepEqual(JSON.parse(JSON.stringify(states)), [
      { state: 'no-answer', receiptPath: '/storage/devin-mcp/receipt.json' },
      {
        state: 'removed',
        reason: 'permission',
        receiptPath: '/storage/devin-mcp/receipt.json',
      },
    ])
  })

// protects=the bridge's check passing for a standing setup; fails_when=the three reads disagree on a setup that stands; no_claim=a removal
test('the bridge check answers stands when the mark and both receipts name one installation', async (context) => {
  // Arrange
  const descriptorPath = await writeStandingSetup(await arrangeStorage(context))
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, { answer: 'stands' })
})

// protects=a removal naming the receipt it was seen on; fails_when=the answer lacks the reason or the path; no_claim=the bridge's line
test('the bridge check answers removed with the skill receipt after a removal took it out', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  const skillPath = join(storage, 'devin-skill', 'receipt.json')
  await writePrivate(skillPath, JSON.stringify({ installed: false }))
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, {
    answer: 'removed',
    reason: 'uninstalled',
    path: skillPath,
  })
})

// protects=an unmarked descriptor (the window's mark taken away) counting as removed; fails_when=it answers stands or no-answer; no_claim=a mark of another installation
test('the bridge check answers removed with no-mark when the descriptor names no installation', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  await writePrivate(
    descriptorPath,
    JSON.stringify({ url: 'http://127.0.0.1:1/mcp' }),
  )
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, {
    answer: 'removed',
    reason: 'no-mark',
    path: descriptorPath,
  })
})

// protects=the MCP receipt of another installation counting as removed; fails_when=it answers stands; no_claim=a bound check
test('the bridge check answers removed with another-installation when the MCP receipt names another installation', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  const mcpPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    mcpPath,
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, {
    answer: 'removed',
    reason: 'another-installation',
    path: mcpPath,
  })
})

// Value: protects=the bridge's check names the publish record beside the MCP receipt, with that record's reason, when others can read it, so the setup's final check can offer the mode-600 repair for that file (Cycle 0149 ship review, native adversarial note 3); fails_when=the answer names the receipt or the reason unverified, or the check answers stands; no_claim=Windows modes, the setup's sentence
test(
  'the bridge check answers removed with not-private on the publish record when others can read that record',
  { skip: process.platform === 'win32' && WINDOWS_MODES },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const descriptorPath = await writeStandingSetup(storage)
    const recordPath = join(storage, 'devin-mcp', 'pending.json')
    await writePrivate(
      recordPath,
      JSON.stringify({
        targetPath: '/home/lume/.config/devin/mcp_config.json',
        createdFile: false,
      }),
    )
    await chmod(recordPath, 0o644)
    // Act
    const answer = await realCheckDevinBridgeReceipts(descriptorPath)
    // Assert
    assert.deepEqual(answer, {
      answer: 'removed',
      reason: 'not-private',
      path: recordPath,
    })
  },
)

// protects=a descriptor re-marked for another installation being told from a removal when the check is bound; fails_when=the bound check answers stands for installation B while the bridge is connected for A; no_claim=the bridge's line
test('the bridge check bound to installation A answers replaced when the descriptor and receipt name B', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  await writePrivate(
    descriptorPath,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      instanceId: '11111111-1111-4111-8111-111111111111',
      devinSetupInstallation: 'installation-b',
    }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'receipt.json'),
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath, {
    instanceId: '11111111-1111-4111-8111-111111111111',
    url: 'http://127.0.0.1:1/mcp',
    installationId: 'installation-a',
  })
  // Assert
  assert.deepEqual(answer, { answer: 'replaced' })
})

// protects=a failed receipt read never reading as a removed setup in the bridge's check; fails_when=the EMFILE of the MCP receipt read answers removed; no_claim=the skill receipt read (same path)
test('the bridge check answers no-answer when a receipt read fails with EMFILE', async () => {
  // Arrange
  const failingModule = await loadModule<{
    checkDevinBridgeReceipts: typeof realCheckDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: () =>
        Promise.resolve({
          state: 'read',
          value: { devinSetupInstallation: 'installation-a' },
        }),
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string) =>
        Promise.resolve({ state: 'no-answer', receiptPath }),
    },
  })
  // Act
  const answer = await failingModule.checkDevinBridgeReceipts(
    '/storage/agent/x.connection.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), { answer: 'no-answer' })
})

// protects=a removal seen in a receipt still ending the connected bridge when the descriptor read has no answer (EIO); fails_when=the failed descriptor read answers no-answer first, so a removed MCP receipt is masked and the bridge stays up on repeated refusals; no_claim=a descriptor read that fails while both receipts stand (still no-answer)
test('the bridge check answers removed when the descriptor read fails with EIO but the MCP receipt was read as missing', async () => {
  // Arrange
  const mcpPath = join('/storage', 'devin-mcp', 'receipt.json')
  const maskedModule = await loadModule<{
    checkDevinBridgeReceipts: typeof realCheckDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: () => Promise.resolve({ state: 'no-answer' }),
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string) =>
        Promise.resolve(
          receiptPath === mcpPath
            ? { state: 'removed', reason: 'missing', receiptPath }
            : { state: 'installed', receipt: { installed: true } },
        ),
    },
  })
  // Act
  const answer = await maskedModule.checkDevinBridgeReceipts(
    '/storage/agent/x.connection.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), {
    answer: 'removed',
    reason: 'missing',
    path: mcpPath,
  })
})

// Value: protects=a removal seen in one receipt ending the bridge although the other receipt read never settles; fails_when=the check waits for every read, so every refusal times out and the bridge stays up for a removed setup; no_claim=a stalled read when nothing was observed (it stays pending)
test('the bridge check answers removed at once when the skill receipt read never settles and the MCP receipt was read as missing', async () => {
  // Arrange
  const mcpPath = join('/storage', 'devin-mcp', 'receipt.json')
  const stalledModule = await loadModule<{
    checkDevinBridgeReceipts: typeof realCheckDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: () =>
        Promise.resolve({
          state: 'read',
          value: { devinSetupInstallation: 'installation-a' },
        }),
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string) =>
        receiptPath === mcpPath
          ? Promise.resolve({
              state: 'removed',
              reason: 'missing',
              receiptPath,
            })
          : new Promise(() => {}),
    },
  })
  // Act
  // A gate of its own: the read that never settles would otherwise hold its key in the gate every test of this file shares, and a later read of that path would hang.
  const answer = await within(
    stalledModule.checkDevinBridgeReceipts(
      '/storage/agent/x.connection.json',
      {},
      createPathReadGate(),
    ),
    5_000,
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), {
    answer: 'removed',
    reason: 'missing',
    path: mcpPath,
  })
})
