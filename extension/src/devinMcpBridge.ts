import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  CONNECTION_DESCRIPTOR_SUFFIX,
  DEVIN_CONNECT_FLOOR_MS,
  DEVIN_DESCRIPTOR_LIMIT_BYTES,
} from './constants'
import { runCursorMcpBridge } from './cursorMcpBridge'
import { connectionSchema } from './utils/connectionSchema'
import { currentStorageOwner } from './utils/currentStorageOwner'
import { isDescriptorOwnerGone } from './utils/evidenceInUseElsewhere'
import { isLoopbackMcpUrl } from './utils/isLoopbackMcpUrl'
import { isSameStorageMachine } from './utils/isSameStorageMachine'
import type { DescriptorExpectation } from './utils/readBridgeDescriptor'
import {
  recordedOwnerSchema,
  type StorageOwnerIdentity,
} from './utils/readRecordedOwner'
import { readWikiRegularFile } from './utils/readWikiRegularFile'
import { realOrSame } from './utils/realOrSame'

/** Selected Codebook instance of one Devin Desktop window; carries no credential. */
export interface DevinDescriptorSelection {
  descriptorPath: string
  instanceId: string
  workspace: string
  /** The loopback endpoint the descriptor names (no credential): the connection goes to exactly this url. */
  url: string
  /** Whether Codebook wrote `devinChat: true`: this window's AI chat setup matches the workspace. */
  devinChat: boolean
}

/** Polling limits of {@link selectDevinDescriptor}; `identity` names the machine and boot by which a descriptor's owner is judged, {@link currentStorageOwner} unless a test names its own. */
export interface DevinSelectOptions {
  timeoutMs?: number
  intervalMs?: number
  identity?: StorageOwnerIdentity
  /** Descriptor files that did not answer; they are not chosen again. */
  excludedPaths?: ReadonlySet<string>
  /** Resolves a workspace to its real path; {@link realOrSame} unless a test names its own (for example one that never answers). */
  resolveWorkspace?: (path: string) => Promise<string>
}

/** Polling defaults: Codebook may still be activating when Devin starts the bridge. */
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_INTERVAL_MS = 250
/** Least time one workspace resolution may take once the startup deadline has passed, so a healthy local folder still resolves for the one look a late selection makes. */
const WORKSPACE_RESOLVE_FLOOR_MS = 200
/** How long the bridge waits before it asks a busy or restarting server again. */
const TRANSIENT_RETRY_PAUSE_MS = 200

/** A descriptor of this agent folder with the process id it names, read without its token. */
type DevinCandidate = DevinDescriptorSelection & {
  pid: number
  modifiedAtMs: number
}

/**
 * Reads one connection descriptor as a candidate of this machine; called by {@link readCandidates} for each file of the agent folder.
 * The file is read as a regular file of at most {@link DEVIN_DESCRIPTOR_LIMIT_BYTES} that is never followed as a link and never waited on, so a pipe cannot hold the scan. A descriptor whose owner is not positively this machine (another machine sharing the home folder, or a build that names none) and one whose endpoint is not loopback are skipped.
 * @param descriptorPath - The `<instanceId>.connection.json` file.
 * @param identity - The machine and boot of this process.
 * @returns The candidate without its token, or `undefined` for a file that must not be used.
 * @example
 * await readCandidate('/storage/agent/instance.connection.json', identity) // => { instanceId, workspace, pid, ... }
 */
async function readCandidate(
  descriptorPath: string,
  identity: StorageOwnerIdentity,
): Promise<DevinCandidate | undefined> {
  const file = await readWikiRegularFile(
    descriptorPath,
    undefined,
    DEVIN_DESCRIPTOR_LIMIT_BYTES,
  )
  if (!file) return undefined
  try {
    const raw: unknown = JSON.parse(file.bytes.toString('utf8'))
    const parsed = connectionSchema.parse(raw),
      owner = recordedOwnerSchema.parse(raw)
    // Only a descriptor that positively names this machine can be this window's.
    if (
      owner.hostname === undefined ||
      !isSameStorageMachine(owner, identity) ||
      !isLoopbackMcpUrl(parsed.url)
    )
      return undefined
    return {
      descriptorPath,
      instanceId: parsed.instanceId,
      workspace: parsed.workspace,
      url: parsed.url,
      devinChat: (raw as { devinChat?: unknown }).devinChat === true,
      pid: owner.pid,
      modifiedAtMs: file.modifiedAtMs,
    }
  } catch {
    // A descriptor being written or from another version is skipped, never reported (it may hold a credential).
    return undefined
  }
}

/** Reads every usable connection descriptor of the agent folder without keeping its token. */
async function readCandidates(
  agentDir: string,
  identity: StorageOwnerIdentity,
): Promise<DevinCandidate[]> {
  let names: string[]
  try {
    names = (await readdir(agentDir)).filter((name) =>
      name.endsWith(CONNECTION_DESCRIPTOR_SUFFIX),
    )
  } catch {
    return []
  }
  const candidates: DevinCandidate[] = []
  for (const name of names) {
    const candidate = await readCandidate(join(agentDir, name), identity)
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

/**
 * Resolves a workspace to its real path within a time budget; called by {@link matchDescriptors} and {@link selectDevinDescriptor} so a mount that never answers cannot hold the selection past its startup deadline.
 * @param resolveWorkspace - The resolver, {@link realOrSame} unless a test names its own.
 * @param path - The workspace folder to resolve.
 * @param deadline - Epoch milliseconds at which the startup window ends.
 * @returns The real path, or `undefined` when the resolver did not answer within the remaining budget (never less than {@link WORKSPACE_RESOLVE_FLOOR_MS}).
 * @example
 * await resolveWithinBudget(realOrSame, '/repo', Date.now() + 15_000) // => '/repo'
 */
async function resolveWithinBudget(
  resolveWorkspace: (path: string) => Promise<string>,
  path: string,
  deadline: number,
): Promise<string | undefined> {
  const budgetMs = Math.max(WORKSPACE_RESOLVE_FLOOR_MS, deadline - Date.now())
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs)
  })
  try {
    return await Promise.race([resolveWorkspace(path), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/** Keeps the descriptors whose pid is the extension host's, whose owner still runs and whose workspace has the same real path as `realCwd`; newest first, by file time then instance id. The cheap fields are judged first, so another window's descriptor never has its workspace resolved; a workspace that does not answer before `deadline` skips that descriptor. */
async function matchDescriptors(
  agentDir: string,
  realCwd: string,
  extHostPid: number,
  identity: StorageOwnerIdentity,
  excludedPaths: ReadonlySet<string>,
  resolveWorkspace: (path: string) => Promise<string>,
  deadline: number,
): Promise<DevinDescriptorSelection[]> {
  const matches: Array<DevinDescriptorSelection & { modifiedAtMs: number }> = []
  for (const { pid, ...selection } of await readCandidates(
    agentDir,
    identity,
  )) {
    // Cheap fields first: another window's descriptor is dropped before any file system lookup.
    if (
      pid !== extHostPid ||
      excludedPaths.has(selection.descriptorPath) ||
      (await isDescriptorOwnerGone(selection.descriptorPath, identity))
    )
      continue
    const realWorkspace = await resolveWithinBudget(
      resolveWorkspace,
      selection.workspace,
      deadline,
    )
    if (realWorkspace === realCwd) matches.push(selection)
  }
  // Newest first, ties by instance id: the order never depends on the folder's listing order.
  matches.sort(
    (first, second) =>
      second.modifiedAtMs - first.modifiedAtMs ||
      first.instanceId.localeCompare(second.instanceId),
  )
  return matches.map(
    ({ descriptorPath, instanceId, workspace, url, devinChat }) => ({
      descriptorPath,
      instanceId,
      workspace,
      url,
      devinChat,
    }),
  )
}

/**
 * Picks this Devin Desktop window's Codebook instance among the agent folder's descriptors.
 *
 * Called by {@link runDevinMcpBridge} when Devin starts the stdio bridge. A descriptor matches when its
 * workspace has the same real path as `cwd`, its `pid` is the extension host's and its owner still runs
 * (a descriptor a crashed window left behind is skipped). Polling continues until one live match
 * appears; with several live matches the newest descriptor file is taken at once (ties by instance
 * id), never by folder listing order, and never after waiting for a single one.
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
    resolveWorkspace = options.resolveWorkspace ?? realOrSame,
    // A working folder that does not answer in time is compared as written, like one that does not resolve.
    realCwd =
      (await resolveWithinBudget(resolveWorkspace, cwd, deadline)) ?? cwd,
    identity = options.identity ?? (await currentStorageOwner())
  for (;;) {
    const matches = await matchDescriptors(
      agentDir,
      realCwd,
      extHostPid,
      identity,
      options.excludedPaths ?? new Set(),
      resolveWorkspace,
      deadline,
    )
    // Matches come newest first, so several live ones resolve to the newest without waiting.
    if (matches.length > 0) return matches[0]
    if (Date.now() >= deadline) return undefined
    await sleep(intervalMs)
  }
}

/**
 * Says whether a failed connection is the Codebook server being busy or restarting, which a later attempt at the same descriptor can overcome; called by {@link runDevinMcpBridge}.
 * @param error - What {@link runCursorMcpBridge} threw.
 * @returns `true` for HTTP 429 (the server's sessions are full), ECONNREFUSED or ECONNRESET, also as the cause of a wrapping error; `false` otherwise.
 * @example
 * isTransientFailure(Object.assign(new Error('x'), { code: 429 })) // => true
 */
function isTransientFailure(error: unknown): boolean {
  let current: unknown = error
  // The network error sits one or two causes below fetch's TypeError.
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const { code } = current as { code?: unknown }
    if (code === 429 || code === 'ECONNREFUSED' || code === 'ECONNRESET')
      return true
    current = current.cause
  }
  return false
}

/**
 * Reads the extension host process id Devin Desktop exports, the window's identity; called by {@link runDevinMcpBridge}.
 * @param env - Environment of the bridge process.
 * @returns The positive integer in `WINDSURF_EXT_HOST_PID`, or `undefined` when it is unset or not one.
 * @example
 * extensionHostPidOf({ WINDSURF_EXT_HOST_PID: '4242' }) // => 4242
 * extensionHostPidOf({})                                 // => undefined
 */
function extensionHostPidOf(env: NodeJS.ProcessEnv): number | undefined {
  const pid = Number(env.WINDSURF_EXT_HOST_PID)
  return env.WINDSURF_EXT_HOST_PID && Number.isInteger(pid) && pid > 0
    ? pid
    : undefined
}

/**
 * Ends the bridge with one fixed line on stderr and exit code 1; called by {@link runDevinMcpBridge} for every refusal.
 * @param line - The recovery sentence, without a line break and without descriptor contents.
 * @example
 * refuse('Codebook is not running for /repo in this Devin Desktop window. ...')
 */
function refuse(line: string): void {
  process.stderr.write(`${line}\n`)
  process.exitCode = 1
}

/**
 * Names what the selection of one descriptor validated, so {@link runCursorMcpBridge} connects only with a descriptor that still says the same; called by {@link runDevinMcpBridge} for each selection.
 * @param selection - The descriptor chosen by {@link selectDevinDescriptor}.
 * @param pid - The extension host process id the selection matched.
 * @param realCwd - The real path of the bridge's working folder, which the selection matched against the descriptor's workspace.
 * @returns The instance id, the pid, the workspace real path, the exact endpoint url and `devinChat: true` (a selection without it is refused before any connection).
 * @example
 * devinDescriptorExpectation(selection, 4242, '/repo') // => { instanceId: '1111…', pid: 4242, workspace: '/repo', devinChat: true, url: selection.url }
 */
export function devinDescriptorExpectation(
  selection: DevinDescriptorSelection,
  pid: number,
  realCwd: string,
): DescriptorExpectation {
  return {
    instanceId: selection.instanceId,
    pid,
    workspace: realCwd,
    devinChat: true,
    url: selection.url,
  }
}

/**
 * Connects the bridge to one selected instance within the remaining startup budget; called by {@link runDevinMcpBridge}.
 * A failure is not reported: the error may hold credential fragments.
 * The attempt gets at least {@link DEVIN_CONNECT_FLOOR_MS}, also when the deadline has nearly passed, so the bridge's total time can exceed the startup window by that floor.
 * @param selection - The descriptor chosen by {@link selectDevinDescriptor}.
 * @param deadline - When the startup wait ends (epoch milliseconds).
 * @param expected - What the selection validated ({@link devinDescriptorExpectation}).
 * @returns `connected` once the transport is up; `busy` after a pause when the server answered 429 or refused or reset the connection and time remains; `dropped` for any other failure (a handshake that does not finish in time included) and when no time remains.
 * @example
 * await connectOnce(selection, Date.now() + 15_000, expected) // => 'connected'
 */
async function connectOnce(
  selection: DevinDescriptorSelection,
  deadline: number,
  expected: DescriptorExpectation,
): Promise<'connected' | 'busy' | 'dropped'> {
  try {
    await runCursorMcpBridge(
      selection.descriptorPath,
      Math.max(DEVIN_CONNECT_FLOOR_MS, deadline - Date.now()),
      expected,
    )
    process.stderr.write(
      `Codebook bridge: instance ${selection.instanceId}, workspace ${selection.workspace}\n`,
    )
    return 'connected'
  } catch (error) {
    const remaining = deadline - Date.now()
    if (!isTransientFailure(error) || remaining <= 0) return 'dropped'
    await sleep(Math.min(TRANSIENT_RETRY_PAUSE_MS, remaining))
    return 'busy'
  }
}

/**
 * The one recovery line for a bridge that found no instance of its window in time; called by {@link runDevinMcpBridge}.
 * @param cwd - Working folder of the bridge process.
 * @returns The sentence, without a line break and without descriptor contents.
 * @example
 * notRunningLine('/repo') // => 'Codebook is not running for /repo in this Devin Desktop window. ...'
 */
function notRunningLine(cwd: string): string {
  return `Codebook is not running for ${cwd} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`
}

/**
 * Says whether a connection attempt may start now, so the time after the startup deadline is bounded by one attempt however many descriptors match; called by {@link runDevinMcpBridge} before each attempt.
 * @param deadline - When the startup wait ends (epoch milliseconds).
 * @param lateAttempt - Whether the one attempt allowed after the deadline was already taken; set here when it is taken now.
 * @returns `true` before the deadline, and once after it; `false` for any later attempt.
 * @example
 * mayStartAttempt(Date.now() - 1, { isSpent: false }) // => true, and the state is now spent
 */
function mayStartAttempt(
  deadline: number,
  lateAttempt: { isSpent: boolean },
): boolean {
  if (Date.now() < deadline) return true
  if (lateAttempt.isSpent) return false
  lateAttempt.isSpent = true
  return true
}

/**
 * Bridges Devin Desktop's stdio MCP transport to this window's Codebook instance.
 *
 * Started by the bridge entry file from the `mcp_config.json` entry Set Up AI Chat writes.
 *
 * Without a usable `WINDSURF_EXT_HOST_PID` the bridge cannot tell its window from another window of the same folder, so it selects nothing, writes one line and exits 1.
 * A descriptor of this window that lacks `devinChat: true` means AI chat is not set up here: one line, exit 1, at once.
 * Each connection attempt (the descriptor read and the whole handshake) is bounded by the remaining startup deadline, but never by less than {@link DEVIN_CONNECT_FLOOR_MS}: the bridge's total time can exceed the 15 s startup window by that floor, and after the deadline at most one more attempt starts in total, however many descriptors remain. The connection reads the descriptor again and refuses it when it is no longer the one selected (see {@link devinDescriptorExpectation}). A chosen descriptor whose server fails is dropped and the deadline keeps running for a fresh one; a busy or restarting server (HTTP 429, ECONNREFUSED, ECONNRESET) is asked again after a short pause until the deadline. Nothing reaches stdout (the MCP channel) before the transport is up, and no message holds the token.
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
  const pid = extensionHostPidOf(env)
  // No window identity: refuse rather than guess among windows of one folder.
  if (pid === undefined)
    return refuse(
      'Codebook cannot tell which Devin Desktop window started this bridge: WINDSURF_EXT_HOST_PID is not set. Reload the window; if this stays, Devin Desktop changed how it starts MCP servers.',
    )
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    excludedPaths = new Set<string>(),
    // The working folder's lookup spends the same startup window, so a mount that never answers cannot hold the bridge before its first selection; one that does not answer is compared as written, as the selection does.
    realCwd =
      (await resolveWithinBudget(
        options.resolveWorkspace ?? realOrSame,
        cwd,
        deadline,
      )) ?? cwd
  const lateAttempt = { isSpent: false }
  for (;;) {
    // The newest live descriptor is taken at once, so a fresh instance replaces a restarting one.
    const selection = await selectDevinDescriptor(agentDir, cwd, pid, {
      ...options,
      excludedPaths,
      timeoutMs: Math.max(0, deadline - Date.now()),
    })
    // No match in time: one fixed recovery line, no descriptor contents.
    if (!selection) return refuse(notRunningLine(cwd))
    // This window runs Codebook but its AI chat setup is for another folder or missing: nothing to wait for.
    if (!selection.devinChat)
      return refuse(
        `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${cwd}. Run Codebook: Set Up AI Chat here, then reload the window.`,
      )
    // Once the deadline has passed only one more attempt may start in total, however many descriptors remain.
    if (!mayStartAttempt(deadline, lateAttempt))
      return refuse(notRunningLine(cwd))
    const outcome = await connectOnce(
      selection,
      deadline,
      devinDescriptorExpectation(selection, pid, realCwd),
    )
    if (outcome === 'connected') return
    if (outcome === 'dropped') excludedPaths.add(selection.descriptorPath)
  }
}
