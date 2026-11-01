import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { EXTENSION_REPLAY_FRAME_CACHE_SIZE } from '../constants'
import { ExtensionReplayFrameCache } from '../extensionReplayFrameCache'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { pngOf } from './utils/chromeExtensionHistoryFixture'

/** Makes a history folder holding the given frames as blobs and removes it when the test ends. */
async function folderWith(context: TestContext, salts: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-frame-cache-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'frames'))
  const frames = []
  for (const salt of salts) {
    const bytes = pngOf(720, 640, salt)
    const hash = sha256(bytes)
    await writeFile(join(directory, 'frames', `${hash}.png`), bytes)
    frames.push({ hash, byteLength: bytes.byteLength, bytes })
  }
  return { directory, frames }
}

// protects=a frame loads by its hash and is answered from memory the second time, and more than the bound leaves the least recently shown one; fails_when=every show reads the disk, or the cache grows past the bound; no_claim=the webview's decoding
test('frames load lazily once and at most the bound stay decoded', async (context) => {
  // Arrange
  const { directory, frames } = await folderWith(
    context,
    Array.from(
      { length: EXTENSION_REPLAY_FRAME_CACHE_SIZE + 2 },
      (_, index) => `f${index}`,
    ),
  )
  let reads = 0
  const cache = new ExtensionReplayFrameCache(directory, async (path) => {
    reads++
    return readFile(path)
  })

  // Act
  await cache.load(frames[0]!)
  await cache.load(frames[0]!)
  for (const frame of frames) await cache.load(frame)
  const readsBeforeReturn = reads
  // Frame 0 left when the tenth frame arrived, so showing it again reads it again.
  await cache.load(frames[0]!)

  // Assert
  assert.equal(EXTENSION_REPLAY_FRAME_CACHE_SIZE, 8)
  assert.equal(cache.size, 8)
  assert.equal(readsBeforeReturn, 10)
  assert.equal(reads, 11)
})

// protects=a blob that is missing, truncated or not the journal's bytes shows as damaged for that frame only and the next frame still loads; fails_when=a damaged blob fails the replay, is cached as good, or shows another frame; no_claim=a real disk fault
test('a missing or altered blob is damaged for that frame only', async (context) => {
  // Arrange
  const { directory, frames } = await folderWith(context, ['a', 'b'])
  await writeFile(
    join(directory, 'frames', `${frames[0]!.hash}.png`),
    Buffer.from('altered'),
  )
  const cache = new ExtensionReplayFrameCache(directory)
  const absent = { hash: sha256('never written'), byteLength: 10 }

  // Act
  const altered = await cache.load(frames[0]!)
  const missing = await cache.load(absent)
  const intact = await cache.load(frames[1]!)

  // Assert
  assert.deepEqual(altered, {
    ok: false,
    code: 'EXTENSION_HISTORY_FRAME_DAMAGED',
  })
  assert.deepEqual(missing, {
    ok: false,
    code: 'EXTENSION_HISTORY_FRAME_DAMAGED',
  })
  assert.equal(intact.ok, true)
  assert.equal(cache.size, 1)
})

// protects=a hash that is no SHA-256 digest never resolves to a path, so a forged journal cannot read outside the frames folder; fails_when=a hash with path separators is read; no_claim=the journal's own schema refusal
test('a hash that is not a digest is refused without reading any file', async (context) => {
  // Arrange
  const { directory } = await folderWith(context, [])
  let reads = 0
  const cache = new ExtensionReplayFrameCache(directory, async () => {
    reads++
    return Buffer.alloc(0)
  })

  // Act
  const loaded = await cache.load({ hash: '../../secret', byteLength: 0 })

  // Assert
  assert.equal(loaded.ok, false)
  assert.equal(reads, 0)
})
