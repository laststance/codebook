import { lstat, readFile } from 'node:fs/promises'

import type { z } from 'zod'

import { connectionSchema } from './connectionSchema'
import { isLoopbackMcpUrl } from './isLoopbackMcpUrl'
import { recordedOwnerSchema } from './readRecordedOwner'
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

/**
 * Reads the private connection descriptor a bridge connects with and refuses any that is not the one its caller validated; called by {@link runCursorMcpBridge} once per connection, so the token goes only to the url checked here.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param expected - What the Devin Desktop bridge's selection validated; Cursor's bridge passes none and takes any valid descriptor.
 * @returns The connection fields of the descriptor read.
 * @throws When the file is not a private regular file, is not a valid descriptor ({@link DESCRIPTOR_UNREADABLE_MESSAGE}), names a url that is not Codebook's loopback endpoint, or differs from `expected`.
 * @example
 * await readBridgeDescriptor('/agent/x.connection.json', { instanceId, pid: 4242, workspace: '/repo', devinChat: true })
 */
export async function readBridgeDescriptor(
  descriptorPath: string,
  expected?: DescriptorExpectation,
): Promise<BridgeDescriptor> {
  const identity = await lstat(descriptorPath)
  if (
    !identity.isFile() ||
    identity.isSymbolicLink() ||
    (identity.mode & 0o077) !== 0
  )
    throw new Error(
      'Codebook connection descriptor is not a private regular file.',
    )
  const { descriptor, pid, devinChat } = parseDescriptorText(
    await readFile(descriptorPath, 'utf8'),
  )
  // The token goes only to the url checked here, from the one read the transport uses: a descriptor replaced after a bridge chose it cannot redirect it.
  if (!isLoopbackMcpUrl(descriptor.url))
    throw new Error(
      'Codebook connection descriptor is not a loopback endpoint.',
    )
  // The descriptor read for this connection must still be the one the selection validated.
  if (
    expected &&
    (descriptor.instanceId !== expected.instanceId ||
      pid !== expected.pid ||
      devinChat !== expected.devinChat ||
      (await realOrSame(descriptor.workspace)) !== expected.workspace)
  )
    throw new Error(
      'Codebook connection descriptor changed after it was selected.',
    )
  return descriptor
}
