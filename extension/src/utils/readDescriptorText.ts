import type { FileHandle } from 'node:fs/promises'

import { DEVIN_DESCRIPTOR_LIMIT_BYTES } from '../constants'

import { openWithoutFollowing } from './openWithoutFollowing'
import { readUpToLimit } from './readUpToLimit'

/** The `code` of the error {@link readDescriptorBytes} and {@link readDescriptorText} throw for a regular file that others can read (group or other bits set, off Windows). */
export const DESCRIPTOR_NOT_PRIVATE_CODE = 'EDESCRIPTORNOTPRIVATE'

/** The `code` of the error {@link readDescriptorBytes} and {@link readDescriptorText} throw for a path that holds no regular file (a link, a pipe, a device, a folder); a mode change cannot help there. */
export const DESCRIPTOR_NOT_REGULAR_CODE = 'EDESCRIPTORNOTREGULAR'

/** The `code` of the error {@link readDescriptorBytes} and {@link readDescriptorText} throw for a file larger than {@link DEVIN_DESCRIPTOR_LIMIT_BYTES}, also one that grew past it while read. */
export const DESCRIPTOR_TOO_LARGE_CODE = 'EDESCRIPTORTOOLARGE'

/**
 * Builds the error of a refusal with its `code`, so a caller tells the refusal by the code and never by the words of the message; called by {@link readOpenedDescriptor} and {@link readDescriptorBytes}.
 * @param code - {@link DESCRIPTOR_NOT_PRIVATE_CODE}, {@link DESCRIPTOR_NOT_REGULAR_CODE} or {@link DESCRIPTOR_TOO_LARGE_CODE}.
 * @param message - The sentence of the error.
 * @returns The error, not thrown yet.
 * @example
 * throw descriptorRefusal(DESCRIPTOR_TOO_LARGE_CODE, 'Too large.')
 */
function descriptorRefusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** The one sentence for a descriptor that is no private regular file (a link, a pipe, a device, readable by others). */
const DESCRIPTOR_NOT_PRIVATE_MESSAGE =
  'Codebook connection descriptor is not a private regular file.'

/**
 * Checks through the open handle that the descriptor is a private regular file within {@link DEVIN_DESCRIPTOR_LIMIT_BYTES}, then reads its bytes; called by {@link readDescriptorBytes}.
 * The owner-only permission bits are checked off Windows only: Windows reports every regular file as mode 0o666, so the check would refuse each descriptor there; the regular-file check, the no-follow open and the size limit still apply.
 * @param file - The descriptor opened by {@link openWithoutFollowing}.
 * @param platform - The platform whose file modes are judged; tests pass one to cover each system.
 * @returns The file's bytes as read, undecoded.
 * @throws An error with the code {@link DESCRIPTOR_NOT_REGULAR_CODE} for anything but a regular file, and one with {@link DESCRIPTOR_NOT_PRIVATE_CODE} for a regular file others can read; an error with the code {@link DESCRIPTOR_TOO_LARGE_CODE} for a larger file, also one that grew past it while read.
 * @example
 * await readOpenedDescriptor(file) // => <Buffer 7b 22 75 72 6c ...>
 */
async function readOpenedDescriptor(
  file: FileHandle,
  platform: NodeJS.Platform,
): Promise<Buffer> {
  const status = await file.stat()
  // Windows has no owner-only mode bits to judge, so only a non-regular file is refused there.
  if (!status.isFile())
    throw descriptorRefusal(
      DESCRIPTOR_NOT_REGULAR_CODE,
      DESCRIPTOR_NOT_PRIVATE_MESSAGE,
    )
  const isReadableByOthers = platform !== 'win32' && (status.mode & 0o077) !== 0
  if (isReadableByOthers)
    throw descriptorRefusal(
      DESCRIPTOR_NOT_PRIVATE_CODE,
      DESCRIPTOR_NOT_PRIVATE_MESSAGE,
    )
  const bytes =
    status.size > DEVIN_DESCRIPTOR_LIMIT_BYTES
      ? undefined
      : await readUpToLimit(file, status.size, DEVIN_DESCRIPTOR_LIMIT_BYTES)
  if (!bytes)
    throw descriptorRefusal(
      DESCRIPTOR_TOO_LARGE_CODE,
      `Codebook connection descriptor is larger than ${DEVIN_DESCRIPTOR_LIMIT_BYTES} bytes.`,
    )
  return bytes
}

/**
 * Opens a private file once, without following a link and without waiting on a pipe, and reads its bytes through that one handle, so the file checked is the file read; called by {@link readDescriptorText} and by {@link readPrivateJsonState}, which hashes the bytes themselves, so its digest of one of Codebook's records equals the one the config module writes of that file's bytes, also where they are no valid UTF-8.
 * @param descriptorPath - The private file: a connection descriptor, or one of Codebook's records in its global storage.
 * @param platform - The platform whose file modes are judged; callers leave it to default to this process's platform.
 * @returns The file's bytes, undecoded.
 * @throws An error with the code {@link DESCRIPTOR_NOT_REGULAR_CODE} for a link or another non-regular file; what {@link readOpenedDescriptor} throws; the file system's error when the path cannot be opened, also `EREPLACED` (the path was replaced between the look and the open, a race that says nothing about the file, so callers read it as no answer).
 * @example
 * await readDescriptorBytes('/storage/devin-mcp/receipt.json') // => <Buffer 7b 22 69 6e ...>
 */
export async function readDescriptorBytes(
  descriptorPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<Buffer> {
  const file = await openWithoutFollowing(descriptorPath).catch(
    (error: unknown) => {
      const { code } = error as { code?: unknown }
      // A link (ELOOP) or another non-regular file (ENOTREG) is no regular file; EREPLACED is a race and surfaces as it is.
      if (code === 'ELOOP' || code === 'ENOTREG')
        throw descriptorRefusal(
          DESCRIPTOR_NOT_REGULAR_CODE,
          DESCRIPTOR_NOT_PRIVATE_MESSAGE,
        )
      throw error
    },
  )
  try {
    return await readOpenedDescriptor(file, platform)
  } finally {
    await file.close().catch(() => undefined)
  }
}

/**
 * Reads the descriptor's text through {@link readDescriptorBytes}, so neither caller can hang on a pipe or read a huge file; called by {@link readBridgeDescriptor} for a bridge's connection and by {@link setDescriptorDevinChat} for the mark update.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param platform - The platform whose file modes are judged; callers leave it to default to this process's platform.
 * @returns The file's text, decoded as UTF-8.
 * @throws What {@link readDescriptorBytes} throws.
 * @example
 * await readDescriptorText('/agent/x.connection.json') // => '{"url":"..."}'
 */
export async function readDescriptorText(
  descriptorPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  return (await readDescriptorBytes(descriptorPath, platform)).toString('utf8')
}
