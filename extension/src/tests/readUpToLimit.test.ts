import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readUpToLimit, type ReadableAtPosition } from '../utils/readUpToLimit'

/**
 * A file handle over `content` whose reads return at most `bytesPerRead` bytes, as a slow or pipe-like file does.
 * It records the buffer each read was handed.
 */
function createShortReadFile(
  content: Buffer,
  bytesPerRead: number,
): { file: ReadableAtPosition; buffersSeen: Buffer[] } {
  const buffersSeen: Buffer[] = []
  const file: ReadableAtPosition = {
    read: async (buffer, offset, length, position) => {
      buffersSeen.push(buffer)
      const bytesRead = Math.min(
        bytesPerRead,
        length,
        content.length - position,
      )
      content.copy(buffer, offset, position, position + bytesRead)
      return { bytesRead }
    },
  }
  return { file, buffersSeen }
}

// protects: a bounded file read stays one allocation however many short reads the file answers with / fails_when: every short read gets a new buffer, so a 1 MiB file read 4 KiB at a time keeps about 129 MiB alive / no_claim: real file system read sizes
test('reads a file returned in many short reads into one buffer', async () => {
  // Arrange
  const content = Buffer.alloc(40, 'a')
  content.write('hello', 0)
  const { file, buffersSeen } = createShortReadFile(content, 4)

  // Act
  const bytes = await readUpToLimit(file, 40, 100)

  // Assert
  assert.equal(bytes?.toString(), `hello${'a'.repeat(35)}`)
  assert.equal(buffersSeen.length, 11)
  assert.equal(new Set(buffersSeen).size, 1)
})

// protects: the limit still refuses a file that grew past it after its stat / fails_when: the byte past the limit is not noticed when reads are short / no_claim: real file growth timing
test('refuses a file longer than the limit when its reads are short', async () => {
  // Arrange
  const { file } = createShortReadFile(Buffer.alloc(30, 'b'), 7)

  // Act
  const bytes = await readUpToLimit(file, 10, 20)

  // Assert
  assert.equal(bytes, undefined)
})

// protects: a file exactly at the limit is returned whole / fails_when: the work buffer is one byte short, so the end of file is never read / no_claim: none
test('returns a file whose size equals the limit', async () => {
  // Arrange
  const { file } = createShortReadFile(Buffer.alloc(20, 'c'), 6)

  // Act
  const bytes = await readUpToLimit(file, 20, 20)

  // Assert
  assert.equal(bytes?.length, 20)
})

// protects: a small file under a large limit reserves no more than one chunk / fails_when: every read reserves the whole limit, so a 200-byte Wiki metadata file takes 64 MiB / no_claim: real allocator behaviour
test('reads a small file under a large limit into a buffer of one chunk', async () => {
  // Arrange
  const content = Buffer.alloc(200, 'd')
  const { file, buffersSeen } = createShortReadFile(content, 4096)

  // Act
  const bytes = await readUpToLimit(file, 200, 67_108_864)

  // Assert
  assert.equal(bytes?.length, 200)
  assert.equal(buffersSeen[0]?.length, 65_536)
})

// protects: a file that grew past its stat size is still read whole, with memory near its size / fails_when: a growth loses bytes already read, or the buffer jumps to the whole limit / no_claim: real file growth timing
test('reads a file that grew past its stat size by doubling one buffer', async () => {
  // Arrange
  const content = Buffer.alloc(153_600, 'e')
  content.write('start', 0)
  content.write('end', 153_597)
  const { file, buffersSeen } = createShortReadFile(content, 32_768)

  // Act
  const bytes = await readUpToLimit(file, 10, 1_048_576)

  // Assert
  assert.equal(bytes?.length, 153_600)
  assert.equal(bytes?.subarray(0, 5).toString(), 'start')
  assert.equal(bytes?.subarray(153_597).toString(), 'end')
  assert.deepEqual(
    [...new Set(buffersSeen)].map((buffer) => buffer.length),
    [65_536, 131_072, 262_144],
  )
})
