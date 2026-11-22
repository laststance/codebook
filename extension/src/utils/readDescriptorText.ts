import type { FileHandle } from 'node:fs/promises'

import { DEVIN_DESCRIPTOR_LIMIT_BYTES } from '../constants'

import { openWithoutFollowing } from './openWithoutFollowing'
import { readUpToLimit } from './readUpToLimit'

/** The one sentence for a descriptor that is no private regular file (a link, a pipe, a device, readable by others). */
const DESCRIPTOR_NOT_PRIVATE_MESSAGE =
  'Codebook connection descriptor is not a private regular file.'

/**
 * Checks through the open handle that the descriptor is a private regular file within {@link DEVIN_DESCRIPTOR_LIMIT_BYTES}, then reads it; called by {@link readDescriptorText}.
 * @param file - The descriptor opened by {@link openWithoutFollowing}.
 * @returns The file's text.
 * @throws An error with {@link DESCRIPTOR_NOT_PRIVATE_MESSAGE} for anything but a regular file private to its owner; an error naming the size limit for a larger file, also one that grew past it while read.
 * @example
 * await readOpenedDescriptor(file) // => '{"url":"..."}'
 */
async function readOpenedDescriptor(file: FileHandle): Promise<string> {
  const status = await file.stat()
  if (!status.isFile() || (status.mode & 0o077) !== 0)
    throw new Error(DESCRIPTOR_NOT_PRIVATE_MESSAGE)
  const bytes =
    status.size > DEVIN_DESCRIPTOR_LIMIT_BYTES
      ? undefined
      : await readUpToLimit(file, status.size, DEVIN_DESCRIPTOR_LIMIT_BYTES)
  if (!bytes)
    throw new Error(
      `Codebook connection descriptor is larger than ${DEVIN_DESCRIPTOR_LIMIT_BYTES} bytes.`,
    )
  return bytes.toString('utf8')
}

/**
 * Opens the descriptor once, without following a link and without waiting on a pipe, and reads it through that one handle; so the file checked is the file read; called by {@link readBridgeDescriptor} for a bridge's connection and by {@link setDescriptorDevinChat} for the mark update, so neither can hang on a pipe or read a huge file.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @returns The file's text.
 * @throws {@link DESCRIPTOR_NOT_PRIVATE_MESSAGE} for a link or another file the path came to hold; what {@link readOpenedDescriptor} throws; the file system's error when the path cannot be opened.
 * @example
 * await readDescriptorText('/agent/x.connection.json') // => '{"url":"..."}'
 */
export async function readDescriptorText(
  descriptorPath: string,
): Promise<string> {
  const file = await openWithoutFollowing(descriptorPath).catch(
    (error: unknown) => {
      const { code } = error as { code?: unknown }
      // A link (ELOOP) or a file other than the one looked at is no private regular file.
      if (code === 'ELOOP' || code === 'ENOTREG' || code === 'EREPLACED')
        throw new Error(DESCRIPTOR_NOT_PRIVATE_MESSAGE)
      throw error
    },
  )
  try {
    return await readOpenedDescriptor(file)
  } finally {
    await file.close().catch(() => undefined)
  }
}
