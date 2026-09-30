import yauzl from 'yauzl'

import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES } from './packageConstants.mjs'
import { readVsixBytes } from './readVsixBytes.mjs'

/** Reads bounded ordinary ZIP entries for package validation without extracting or executing supplied code. @example const files = await readVsixEntries('/tmp/codebook.vsix') */
export async function readVsixEntries(input) {
  const bytes = Buffer.isBuffer(input) ? input : await readVsixBytes(input)
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error('Expected a regular VSIX within the archive size limit.')
  const archive = await yauzl.fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  const entries = new Map(),
    foldedNames = new Set()
  let expandedBytes = 0
  try {
    for await (const entry of archive.eachEntry()) {
      const name = entry.fileName,
        kind = (entry.externalFileAttributes >>> 16) & 0xf000
      if (
        !name ||
        /[\\\x00-\x1f:]/.test(name) ||
        name
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        name.startsWith('/') ||
        (kind !== 0 && kind !== 0x8000) ||
        entry.externalFileAttributes & 0x10
      )
        throw new Error(`Unsafe archive entry: ${name}`)
      if (foldedNames.has(name.toLowerCase()))
        throw new Error(`Duplicate archive entry: ${name}`)
      foldedNames.add(name.toLowerCase())
      expandedBytes += entry.uncompressedSize
      if (
        foldedNames.size > MAX_ARCHIVE_ENTRIES ||
        expandedBytes > MAX_ARCHIVE_BYTES
      )
        throw new Error('VSIX exceeds the entry or expanded size limit.')
      const chunks = [],
        stream = await archive.openReadStreamPromise(entry)
      let bytes = 0
      for await (const chunk of stream) {
        bytes += chunk.length
        if (bytes > entry.uncompressedSize)
          throw new Error(`Archive entry exceeds its declared size: ${name}`)
        chunks.push(chunk)
      }
      entries.set(name, Buffer.concat(chunks))
    }
    return entries
  } finally {
    archive.close()
  }
}
