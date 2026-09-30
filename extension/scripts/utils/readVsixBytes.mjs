import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { MAX_ARCHIVE_BYTES } from './packageConstants.mjs'

/** Captures bounded VSIX bytes for {@link readVsixEntries} and package receipts so validation and hashing share one snapshot. @example const bytes = await readVsixBytes('/tmp/codebook.vsix') */
export async function readVsixBytes(path) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_ARCHIVE_BYTES)
      throw new Error('Expected a regular VSIX within the archive size limit.')
    // One extra byte detects growth without allowing an unbounded allocation or read.
    const bytes = Buffer.alloc(metadata.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== metadata.size)
      throw new Error(
        'VSIX size changed while reading. Retry from a stable artifact.',
      )
    return bytes.subarray(0, offset)
  } finally {
    await file.close()
  }
}
