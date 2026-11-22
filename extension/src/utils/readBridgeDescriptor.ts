import { setTimeout as sleep } from 'node:timers/promises'

import type { z } from 'zod'

import { connectionSchema } from './connectionSchema'
import { isLoopbackMcpUrl } from './isLoopbackMcpUrl'
import { readDescriptorText } from './readDescriptorText'
import { readMarkedInstallation } from './readMarkedInstallation'
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
  /** The installation id the descriptor's `devinSetupInstallation` mark named at selection; a descriptor re-marked for another installation since is refused. Not compared when left out. */
  devinSetupInstallation?: string
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
  devinSetupInstallation: string | undefined
} {
  try {
    const raw: unknown = JSON.parse(text)
    const owner = recordedOwnerSchema.safeParse(raw)
    return {
      descriptor: connectionSchema.parse(raw),
      pid: owner.success ? owner.data.pid : undefined,
      devinChat: (raw as { devinChat?: unknown }).devinChat === true,
      devinSetupInstallation: readMarkedInstallation(raw),
    }
  } catch {
    // The parsers' messages quote the input; the file may hold a token.
    throw new Error(DESCRIPTOR_UNREADABLE_MESSAGE)
  }
}

/**
 * Bounds an async step by the caller's startup budget; called by {@link readBridgeDescriptor} around the whole read and check, the workspace's real-path lookup included, so a file system that stops answering ends the attempt in time.
 * @param timeoutMs - The budget; unbounded when left out.
 * @param work - Starts the step; called once, at once.
 * @returns What `work` resolves with.
 * @throws What `work` throws; an error when the budget ends first.
 * @example
 * await within(3_000, () => readDescriptorText('/agent/x.connection.json'))
 */
async function within<T>(
  timeoutMs: number | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (timeoutMs === undefined) return work()
  const timer = new AbortController()
  try {
    return await Promise.race([
      work(),
      sleep(timeoutMs, undefined, { signal: timer.signal }).then(() => {
        throw new Error('Codebook connection did not finish in time.')
      }),
    ])
  } finally {
    timer.abort()
  }
}

/** The one sentence for a descriptor that is no longer the one the selection validated, whichever field changed; it holds no descriptor content. */
const DESCRIPTOR_CHANGED_MESSAGE =
  'Codebook connection descriptor changed after it was selected.'

/**
 * The refusal for a descriptor that differs from the selection only in its mark (`devinChat`, `devinSetupInstallation`), as when setup marks it again while the bridge connects; thrown by {@link readBridgeDescriptor}, and told apart from any other change by the Devin bridge's connection, which selects the descriptor again instead of dropping it.
 * @example
 * // after a mark-only change: error instanceof DescriptorMarkChangedError // => true
 */
export class DescriptorMarkChangedError extends Error {
  constructor() {
    super(DESCRIPTOR_CHANGED_MESSAGE)
    this.name = 'DescriptorMarkChangedError'
  }
}

/**
 * Tells how the descriptor read for a connection differs from the one a bridge's selection validated; called by {@link readBridgeDescriptor} on the one read the transport connects with, so a descriptor rewritten after the selection (another instance, extension host, setup state or port) never receives a request.
 * @param read - The descriptor as {@link parseDescriptorText} parsed it for this connection, with its owner pid and devinChat mark.
 * @param expected - What the selection validated.
 * @param resolveWorkspace - Resolves the descriptor's workspace to the real path the selection compared; called only when the other identity fields still match.
 * @returns `identity` when the instance, pid, endpoint url or workspace differs; `mark` when only `devinChat` or the installation mark differs; `none` when the read is still the validated descriptor.
 * @example
 * await changedSinceSelection({ descriptor, pid: 4242, devinChat: true }, expected, realOrSame) // => 'none'
 */
async function changedSinceSelection(
  read: ReturnType<typeof parseDescriptorText>,
  expected: DescriptorExpectation,
  resolveWorkspace: (path: string) => Promise<string>,
): Promise<'identity' | 'mark' | 'none'> {
  if (
    read.descriptor.instanceId !== expected.instanceId ||
    read.pid !== expected.pid ||
    (expected.url !== undefined && read.descriptor.url !== expected.url) ||
    (await resolveWorkspace(read.descriptor.workspace)) !== expected.workspace
  )
    return 'identity'
  return read.devinChat !== expected.devinChat ||
    (expected.devinSetupInstallation !== undefined &&
      read.devinSetupInstallation !== expected.devinSetupInstallation)
    ? 'mark'
    : 'none'
}

/**
 * Reads the private connection descriptor a bridge connects with and refuses any that is not the one its caller validated; called by {@link runCursorMcpBridge} once per connection, so the token goes only to the url checked here.
 * The file is opened once without following links and without blocking, checked through that handle (regular, private to the owner, at most the descriptor size cap) and read from it, so a path swapped after the selection cannot be read.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param expected - What the Devin Desktop bridge's selection validated; Cursor's bridge passes none and takes any valid descriptor.
 * @param timeoutMs - The startup budget the read and the checks may use together, the workspace's real-path lookup included; unbounded when left out.
 * @param resolveWorkspace - Resolves the descriptor's workspace to its real path; {@link realOrSame} unless a test names its own.
 * @returns The connection fields of the descriptor read.
 * @throws When the file is not a private regular file within the size limit, is not a valid descriptor ({@link DESCRIPTOR_UNREADABLE_MESSAGE}), names a url that is not Codebook's loopback endpoint, differs from `expected` (its exact url included), or the budget ends first; a {@link DescriptorMarkChangedError} when only the mark differs.
 * @example
 * await readBridgeDescriptor('/agent/x.connection.json', { instanceId, pid: 4242, workspace: '/repo', devinChat: true, url }, 3_000)
 */
export async function readBridgeDescriptor(
  descriptorPath: string,
  expected?: DescriptorExpectation,
  timeoutMs?: number,
  resolveWorkspace: (path: string) => Promise<string> = realOrSame,
): Promise<BridgeDescriptor> {
  // The read and every check after it, the workspace's real-path lookup included, spend one startup budget.
  return within(timeoutMs, async () => {
    const parsed = parseDescriptorText(await readDescriptorText(descriptorPath))
    // The token goes only to the url checked here, from the one read the transport uses: a descriptor replaced after a bridge chose it cannot redirect it.
    assertLoopbackEndpoint(parsed.descriptor.url)
    // The descriptor read for this connection must still be the one the selection validated, at the exact endpoint it validated.
    await assertUnchangedSinceSelection(parsed, expected, resolveWorkspace)
    return parsed.descriptor
  })
}

/**
 * Refuses a descriptor whose url is not Codebook's loopback MCP endpoint, so the token it holds never goes elsewhere; called by {@link readBridgeDescriptor} on the one read a connection uses.
 * @param url - The descriptor's endpoint url.
 * @throws When the url is not a loopback MCP endpoint.
 * @example
 * assertLoopbackEndpoint(descriptor.url) // returns for Codebook's own loopback endpoint, throws for any other url
 */
function assertLoopbackEndpoint(url: string): void {
  if (!isLoopbackMcpUrl(url))
    throw new Error(
      'Codebook connection descriptor is not a loopback endpoint.',
    )
}

/**
 * Refuses the descriptor read for a connection when it is no longer the one the bridge's selection validated; called by {@link readBridgeDescriptor}, and a no-op when the caller validated nothing (`expected` absent).
 * @param read - The descriptor as {@link parseDescriptorText} parsed it for this connection.
 * @param expected - What the selection validated, or nothing.
 * @param resolveWorkspace - Resolves the descriptor's workspace to its real path.
 * @throws A {@link DescriptorMarkChangedError} when only the mark changed; an error with {@link DESCRIPTOR_CHANGED_MESSAGE} when the instance, pid, url or workspace changed.
 * @example
 * await assertUnchangedSinceSelection(read, undefined, realOrSame) // returns, nothing to compare
 */
async function assertUnchangedSinceSelection(
  read: ReturnType<typeof parseDescriptorText>,
  expected: DescriptorExpectation | undefined,
  resolveWorkspace: (path: string) => Promise<string>,
): Promise<void> {
  if (expected === undefined) return
  const change = await changedSinceSelection(read, expected, resolveWorkspace)
  if (change === 'mark') throw new DescriptorMarkChangedError()
  if (change === 'identity') throw new Error(DESCRIPTOR_CHANGED_MESSAGE)
}
