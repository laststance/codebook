import { openWithoutFollowing } from './openWithoutFollowing.mjs'
import { MAX_ARCHIVE_BYTES } from './packageConstants.mjs'

/** What a caller reads for an input that is no regular VSIX within the limit. */
const NOT_A_REGULAR_VSIX =
  'Expected a regular VSIX within the archive size limit.'

/**
 * Captures bounded VSIX bytes for {@link readVsixEntries} and package receipts so validation and hashing share one snapshot.
 * A link at the path is refused on every system ({@link openWithoutFollowing}), also on Windows, where the open has no flag for it.
 * @param {string} path - Path of the VSIX.
 * @param {{ O_RDONLY: number, O_NOFOLLOW?: number, O_NONBLOCK?: number }} [openConstants] - The open flags this system defines; `fs.constants` unless a test takes one away.
 * @returns {Promise<Buffer>} The bytes of the whole archive.
 * @throws An error with the code `ELOOP` for a link; "Expected a regular VSIX within the archive size limit." for a folder, a pipe, a device or a larger file; "VSIX size changed while reading. Retry from a stable artifact." for a file that changed meanwhile.
 * @example const bytes = await readVsixBytes('/tmp/codebook.vsix')
 */
export async function readVsixBytes(path, openConstants) {
  const file = await openWithoutFollowing(path, openConstants).catch(
    (error) => {
      // Where the path is looked at first, what is no regular file is refused before the open: the caller reads the sentence it reads where the open succeeds on a folder.
      if (error.code === 'ENOTREG') throw new Error(NOT_A_REGULAR_VSIX)
      throw error
    },
  )
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_ARCHIVE_BYTES)
      throw new Error(NOT_A_REGULAR_VSIX)
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
