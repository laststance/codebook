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
