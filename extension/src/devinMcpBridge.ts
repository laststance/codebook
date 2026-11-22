import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { CONNECTION_DESCRIPTOR_SUFFIX } from './constants'
import { runCursorMcpBridge } from './cursorMcpBridge'
import { connectionSchema } from './utils/connectionSchema'
import { currentStorageOwner } from './utils/currentStorageOwner'
import {
  isDescriptorOwnerGone,
  namesNoMachine,
} from './utils/evidenceInUseElsewhere'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from './utils/readRecordedOwner'

/** Selected Codebook instance of one Devin Desktop window; carries no credential. */
export interface DevinDescriptorSelection {
  descriptorPath: string
  instanceId: string
  workspace: string
}

/** Polling limits of {@link selectDevinDescriptor}; `identity` names the machine and boot by which a descriptor's owner is judged, {@link currentStorageOwner} unless a test names its own. */
export interface DevinSelectOptions {
  timeoutMs?: number
  intervalMs?: number
  identity?: StorageOwnerIdentity
  /** Descriptor files that did not answer; they are not chosen again. */
  excludedPaths?: ReadonlySet<string>
}

/** Polling defaults: Codebook may still be activating when Devin starts the bridge. */
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_INTERVAL_MS = 250

/** Resolves a path to its real path, or keeps it when it cannot be resolved (for example a closed folder). */
async function realOrSame(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/** Reads every connection descriptor of the agent folder without keeping its token. */
async function readCandidates(
  agentDir: string,
): Promise<
  Array<DevinDescriptorSelection & { pid: unknown; modifiedAtMs: number }>
> {
  let names: string[]
  try {
    names = (await readdir(agentDir)).filter((name) =>
      name.endsWith(CONNECTION_DESCRIPTOR_SUFFIX),
    )
  } catch {
    return []
  }
  const candidates: Awaited<ReturnType<typeof readCandidates>> = []
  for (const name of names) {
    const descriptorPath = join(agentDir, name)
    try {
      const raw: unknown = JSON.parse(await readFile(descriptorPath, 'utf8'))
      const parsed = connectionSchema.parse(raw)
      candidates.push({
        descriptorPath,
        instanceId: parsed.instanceId,
        workspace: parsed.workspace,
        pid: (raw as { pid?: unknown }).pid,
        modifiedAtMs: (await stat(descriptorPath)).mtimeMs,
      })
    } catch {
      // A descriptor being written or from another version is skipped, never reported (it may hold a credential).
    }
  }
  return candidates
}

/**
 * Says whether a descriptor was left by a window that no longer runs, so a crashed window's descriptor never wins over the fresh one of the window being opened.
 * A descriptor that names no machine (a build up to 0.2.28, which has no Devin Desktop bridge) is kept, as its owner can only be judged by a process id the bridge's own tests invent.
 * @param descriptorPath - The `<instanceId>.connection.json` file.
 * @param identity - The machine and boot of this process, see {@link isDescriptorOwnerGone}.
 * @returns `true` when {@link isDescriptorOwnerGone} judges the owner gone; `false` otherwise, also for an unreadable or machine-less descriptor.
 * @example
 * await isLeftByGoneWindow('/storage/agent/instance.connection.json', identity) // => true after its window was killed
 */
async function isLeftByGoneWindow(
  descriptorPath: string,
  identity: StorageOwnerIdentity,
): Promise<boolean> {
  const owner = await readRecordedOwner(descriptorPath)
  if (!owner || namesNoMachine(owner)) return false
  return isDescriptorOwnerGone(descriptorPath, identity)
}

/** Keeps the descriptors whose workspace has the same real path as `realCwd`, whose owner still runs and, when known, whose pid is the extension host's; newest first, by file time then instance id. */
async function matchDescriptors(
  agentDir: string,
  realCwd: string,
  extHostPid: number,
  identity: StorageOwnerIdentity,
  excludedPaths: ReadonlySet<string>,
): Promise<DevinDescriptorSelection[]> {
  const matches: Array<DevinDescriptorSelection & { modifiedAtMs: number }> = []
  for (const { pid, ...selection } of await readCandidates(agentDir)) {
    const isSameWorkspace = (await realOrSame(selection.workspace)) === realCwd
    if (
      isSameWorkspace &&
      pid === extHostPid &&
      !excludedPaths.has(selection.descriptorPath) &&
      !(await isLeftByGoneWindow(selection.descriptorPath, identity))
    )
      matches.push(selection)
  }
  // Newest first, ties by instance id: the order never depends on the folder's listing order.
  matches.sort(
    (first, second) =>
      second.modifiedAtMs - first.modifiedAtMs ||
      first.instanceId.localeCompare(second.instanceId),
  )
  return matches.map(({ descriptorPath, instanceId, workspace }) => ({
    descriptorPath,
    instanceId,
    workspace,
  }))
}

/**
 * Picks this Devin Desktop window's Codebook instance among the agent folder's descriptors.
 *
 * Called by {@link runDevinMcpBridge} when Devin starts the stdio bridge. A descriptor matches when its
 * workspace has the same real path as `cwd`, its `pid` is the extension host's and its owner still runs
 * (a descriptor a crashed window left behind is skipped). Polling continues until exactly one live match
 * remains; at the deadline several live matches resolve to the newest descriptor file (ties by instance
 * id), never by folder listing order.
 *
 * @param agentDir - Folder holding `*.connection.json` descriptors.
 * @param cwd - Working folder Devin starts the bridge in.
 * @param extHostPid - Extension host process id Devin exports; the window's identity.
 * @param options - Polling limits (defaults 15 000 ms in total, every 250 ms), the identity judging owners and descriptors to leave out.
 * @returns The match without its token, or undefined when none appears in time.
 */
export async function selectDevinDescriptor(
  agentDir: string,
  cwd: string,
  extHostPid: number,
  options: DevinSelectOptions = {},
): Promise<DevinDescriptorSelection | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS,
    deadline = Date.now() + timeoutMs,
    realCwd = await realOrSame(cwd),
    identity = options.identity ?? (await currentStorageOwner())
  for (;;) {
    const matches = await matchDescriptors(
      agentDir,
      realCwd,
      extHostPid,
      identity,
      options.excludedPaths ?? new Set(),
    )
    if (matches.length === 1) return matches[0]
    // Several live matches: keep polling for the one fresh descriptor; at the deadline take the newest.
    if (Date.now() >= deadline) return matches[0]
    await sleep(intervalMs)
  }
}

/**
 * Bridges Devin Desktop's stdio MCP transport to this window's Codebook instance.
 *
 * Started by the bridge entry file from the `mcp_config.json` entry Set Up AI Chat writes.
 *
 * Without a usable `WINDSURF_EXT_HOST_PID` the bridge cannot tell its window from another window of the same folder, so it selects nothing, writes one line and exits 1.
 * A chosen descriptor whose server does not answer is dropped and the startup deadline keeps running for a fresh one; nothing reaches stdout (the MCP channel) before the transport is up, and no message holds the token.
 *
 * @param agentDir - Folder holding the window instances' connection descriptors.
 * @param cwd - Working folder of the bridge process; the window's workspace.
 * @param env - Environment; `WINDSURF_EXT_HOST_PID` names the extension host.
 * @param options - Polling limits of {@link selectDevinDescriptor}; tests shorten them.
 */
export async function runDevinMcpBridge(
  agentDir: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  options: DevinSelectOptions = {},
): Promise<void> {
  const pid = Number(env.WINDSURF_EXT_HOST_PID)
  // No window identity: refuse rather than guess among windows of one folder.
  if (!env.WINDSURF_EXT_HOST_PID || !Number.isInteger(pid) || pid <= 0) {
    process.stderr.write(
      'Codebook cannot tell which Devin Desktop window started this bridge: WINDSURF_EXT_HOST_PID is not set. Reload the window; if this stays, Devin Desktop changed how it starts MCP servers.\n',
    )
    process.exitCode = 1
    return
  }
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    excludedPaths = new Set<string>()
  for (;;) {
    const selection = await selectDevinDescriptor(agentDir, cwd, pid, {
      ...options,
      timeoutMs: Math.max(0, deadline - Date.now()),
      excludedPaths,
    })
    // No match in time: one fixed recovery line, no descriptor contents.
    if (!selection) {
      process.stderr.write(
        `Codebook is not running for ${cwd} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.\n`,
      )
      process.exitCode = 1
      return
    }
    try {
      await runCursorMcpBridge(selection.descriptorPath)
      process.stderr.write(
        `Codebook bridge: instance ${selection.instanceId}, workspace ${selection.workspace}\n`,
      )
      return
    } catch {
      // The server did not answer before the transport came up (a stale or stopped instance): leave it out and wait for a live one; the error may hold credential fragments, so it is not reported.
      excludedPaths.add(selection.descriptorPath)
    }
  }
}
