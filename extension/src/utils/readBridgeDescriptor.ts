import type { FileHandle } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import type { z } from 'zod'

import { DEVIN_DESCRIPTOR_LIMIT_BYTES } from '../constants'

import { connectionSchema } from './connectionSchema'
import { isLoopbackMcpUrl } from './isLoopbackMcpUrl'
import { openWithoutFollowing } from './openWithoutFollowing'
import { recordedOwnerSchema } from './readRecordedOwner'
import { readUpToLimit } from './readUpToLimit'
import { realOrSame } from './realOrSame'

/** What a bridge's caller validated when it selected a descriptor; the descriptor read for the connection must still say the same. */
export interface DescriptorExpectation {
  instanceId: string
  /** The extension host process id the descriptor records. */
  pid: number
  /** The real path of the workspace folder the descriptor names. */
  workspace: string
  /** Whether Codebook wrote `devinChat: true`. */
  devinChat: boolean
  /** The exact endpoint url the selection validated; a descriptor naming any other url (another port included) is refused before a request. */
  url?: string
}

/** A connection descriptor's fields a bridge connects with. */
export type BridgeDescriptor = z.infer<typeof connectionSchema>

/** The one sentence for a descriptor that is no valid JSON of the expected shape: the parser's own message quotes part of the file, which holds a bearer token. */
const DESCRIPTOR_UNREADABLE_MESSAGE =
  'Codebook connection descriptor could not be read.'

/**
 * Parses a descriptor's text into its connection fields, the recorded owner's process id and the `devinChat` flag, without ever putting the text in an error; called by {@link readBridgeDescriptor}.
 * @param text - The descriptor file's content.
 * @returns The connection fields, the recorded pid and whether `devinChat` is `true`.
 * @throws An error with {@link DESCRIPTOR_UNREADABLE_MESSAGE} and no cause when the text is no JSON or lacks a required field.
 * @example
 * parseDescriptorText('{"url":"…"}') // throws Error('Codebook connection descriptor could not be read.')
 */
function parseDescriptorText(text: string): {
  descriptor: BridgeDescriptor
  pid: number | undefined
  devinChat: boolean
} {
  try {
    const raw: unknown = JSON.parse(text)
    const owner = recordedOwnerSchema.safeParse(raw)
    return {
      descriptor: connectionSchema.parse(raw),
      pid: owner.success ? owner.data.pid : undefined,
      devinChat: (raw as { devinChat?: unknown }).devinChat === true,
    }
  } catch {
    // The parsers' messages quote the input; the file may hold a token.
    throw new Error(DESCRIPTOR_UNREADABLE_MESSAGE)
  }
}

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
 * Opens the descriptor once, without following a link and without waiting on a pipe, and reads it through that one handle; called by {@link readBridgeDescriptor}, so the file checked is the file read.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @returns The file's text.
 * @throws {@link DESCRIPTOR_NOT_PRIVATE_MESSAGE} for a link or another file the path came to hold; what {@link readOpenedDescriptor} throws; the file system's error when the path cannot be opened.
 * @example
 * await readDescriptorText('/agent/x.connection.json') // => '{"url":"..."}'
 */
async function readDescriptorText(descriptorPath: string): Promise<string> {
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

/**
 * Bounds {@link readDescriptorText} by the caller's startup budget; called by {@link readBridgeDescriptor}.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param timeoutMs - The budget for the read; unbounded when left out.
 * @returns The file's text.
 * @throws What {@link readDescriptorText} throws; an error when the budget ends first.
 * @example
 * await readDescriptorTextWithin('/agent/x.connection.json', 3_000)
 */
async function readDescriptorTextWithin(
  descriptorPath: string,
  timeoutMs: number | undefined,
): Promise<string> {
  if (timeoutMs === undefined) return readDescriptorText(descriptorPath)
  const timer = new AbortController()
  try {
    return await Promise.race([
      readDescriptorText(descriptorPath),
      sleep(timeoutMs, undefined, { signal: timer.signal }).then(() => {
        throw new Error('Codebook connection did not finish in time.')
      }),
    ])
  } finally {
    timer.abort()
  }
}

/**
 * Reads the private connection descriptor a bridge connects with and refuses any that is not the one its caller validated; called by {@link runCursorMcpBridge} once per connection, so the token goes only to the url checked here.
 * The file is opened once without following links and without blocking, checked through that handle (regular, private to the owner, at most {@link DEVIN_DESCRIPTOR_LIMIT_BYTES}) and read from it, so a path swapped after the selection cannot be read.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param expected - What the Devin Desktop bridge's selection validated; Cursor's bridge passes none and takes any valid descriptor.
 * @param timeoutMs - The startup budget this read may use; unbounded when left out.
 * @returns The connection fields of the descriptor read.
 * @throws When the file is not a private regular file within the size limit, is not a valid descriptor ({@link DESCRIPTOR_UNREADABLE_MESSAGE}), names a url that is not Codebook's loopback endpoint, differs from `expected` (its exact url included), or the budget ends first.
 * @example
 * await readBridgeDescriptor('/agent/x.connection.json', { instanceId, pid: 4242, workspace: '/repo', devinChat: true, url }, 3_000)
 */
export async function readBridgeDescriptor(
  descriptorPath: string,
  expected?: DescriptorExpectation,
  timeoutMs?: number,
): Promise<BridgeDescriptor> {
  const { descriptor, pid, devinChat } = parseDescriptorText(
    await readDescriptorTextWithin(descriptorPath, timeoutMs),
  )
  // The token goes only to the url checked here, from the one read the transport uses: a descriptor replaced after a bridge chose it cannot redirect it.
  if (!isLoopbackMcpUrl(descriptor.url))
    throw new Error(
      'Codebook connection descriptor is not a loopback endpoint.',
    )
  // The descriptor read for this connection must still be the one the selection validated, at the exact endpoint it validated.
  if (
    expected &&
    (descriptor.instanceId !== expected.instanceId ||
      pid !== expected.pid ||
      devinChat !== expected.devinChat ||
      (expected.url !== undefined && descriptor.url !== expected.url) ||
      (await realOrSame(descriptor.workspace)) !== expected.workspace)
  )
    throw new Error(
      'Codebook connection descriptor changed after it was selected.',
    )
  return descriptor
}
