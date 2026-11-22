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
  /** The lookups still running from earlier selections of one bridge ({@link createDevinSelectState}); a new one when absent. */
  state?: DevinSelectState
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

/**
 * Waits for a promise for at most `budgetMs`, so one lookup that never answers cannot hold the selection; called by {@link scanDescriptors} and {@link selectDevinDescriptor}.
 * The promise is not cancelled: a file system request cannot be, so it keeps running after the bound.
 * @param pending - The lookup; it must not reject.
 * @param budgetMs - How long the caller may wait; zero or less takes the answer only when it is already there.
 * @returns What the lookup answered, or `undefined` when the bound passed first.
 * @example
 * await answerWithin(realOrSame('/repo'), 200) // => '/repo', or undefined for a mount that never answers
 */
async function answerWithin<Answer>(
  pending: Promise<Answer>,
  budgetMs: number,
): Promise<Answer | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(0, budgetMs))
  })
  try {
    return await Promise.race([pending, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/** Lookups that have not answered yet, one per key, so the polls of one selection never pile up several requests for one path on libuv's four-thread pool. */
type InFlightLookups<Answer> = Map<string, Promise<Answer | undefined>>

/**
 * Returns the lookup already running for `key`, or starts one when `mayStart`; called by {@link scanDescriptors} for descriptor reads and workspace lookups.
 * The entry is removed when the lookup settles, so a later poll looks again and sees a changed file; a rejection becomes `undefined`.
 * @param lookups - The running lookups of one kind.
 * @param key - The path the lookup is about.
 * @param mayStart - Whether a new lookup may start now; `false` after the scan's deadline.
 * @param start - Starts the lookup.
 * @returns The shared promise, or `undefined` when none runs and none may start.
 * @example
 * sharedLookup(lookups, '/repo', true, () => realOrSame('/repo')) // the same promise until it settles
 */
function sharedLookup<Answer>(
  lookups: InFlightLookups<Answer>,
  key: string,
  mayStart: boolean,
  start: () => Promise<Answer | undefined>,
): Promise<Answer | undefined> | undefined {
  const running = lookups.get(key)
  if (running || !mayStart) return running
  const lookup: Promise<Answer | undefined> = start()
    .catch(() => undefined)
    .finally(() => {
      if (lookups.get(key) === lookup) lookups.delete(key)
    })
  lookups.set(key, lookup)
  return lookup
}

/** What one selection remembers across its polls: the lookups still running (descriptor reads and workspace lookups). */
export interface DevinSelectState {
  reads: InFlightLookups<DevinCandidate>
  workspaces: InFlightLookups<string>
}

/**
 * Makes the memory one bridge keeps across its selections; called by {@link selectDevinDescriptor} when the caller names none, and by {@link runDevinMcpBridge} once per bridge.
 * @returns Empty lookups.
 * @example
 * createDevinSelectState().reads.size // => 0
 */
export function createDevinSelectState(): DevinSelectState {
  return { reads: new Map(), workspaces: new Map() }
}

/** A descriptor candidate that was read and is being judged: `match` answers with the selection when the candidate is this window's. */
interface EvaluatedCandidate {
  modifiedAtMs: number
  instanceId: string
  match: Promise<DevinDescriptorSelection | undefined>
}

/** What one scan of the agent folder judges candidates by. */
interface ScanContext {
  realCwd: string
  extHostPid: number
  identity: StorageOwnerIdentity
  excludedPaths: ReadonlySet<string>
  resolveWorkspace: (path: string) => Promise<string>
  /** No new lookup starts after this instant. */
  scanDeadline: number
  state: DevinSelectState
}

/**
 * Judges one candidate: its pid, its exclusion, its owner and, last, its workspace's real path; called by {@link startCandidate} as soon as the candidate is read.
 * The cheap fields are judged first, so another window's descriptor never has its workspace resolved. It never rejects.
 * @param candidate - The candidate read from one descriptor.
 * @param scan - What the scan judges by.
 * @returns The selection without its credential when the candidate is this window's, else `undefined` (also when the workspace did not answer before the scan's deadline).
 * @example
 * await evaluateCandidate(candidate, scan) // => { descriptorPath, instanceId, ... } or undefined
 */
async function evaluateCandidate(
  candidate: DevinCandidate,
  scan: ScanContext,
): Promise<DevinDescriptorSelection | undefined> {
  const { descriptorPath, instanceId, workspace, url, devinChat } = candidate
  try {
    if (
      candidate.pid !== scan.extHostPid ||
      scan.excludedPaths.has(descriptorPath) ||
      (await isDescriptorOwnerGone(descriptorPath, scan.identity))
    )
      return undefined
    const lookup = sharedLookup(
      scan.state.workspaces,
      workspace,
      Date.now() < scan.scanDeadline,
      () => scan.resolveWorkspace(workspace),
    )
    if (!lookup) return undefined
    const realWorkspace = await answerWithin(
      lookup,
      scan.scanDeadline - Date.now(),
    )
    return realWorkspace === scan.realCwd
      ? { descriptorPath, instanceId, workspace, url, devinChat }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads one descriptor and starts judging it at once; called by {@link scanDescriptors} for each file, all together.
 * @param descriptorPath - The `<instanceId>.connection.json` file.
 * @param scan - What the scan judges by.
 * @returns The candidate's order keys and its pending judgement, or `undefined` for a file that must not be used.
 * @example
 * await startCandidate('/storage/agent/instance.connection.json', scan) // => { modifiedAtMs, instanceId, match }
 */
async function startCandidate(
  descriptorPath: string,
  scan: ScanContext,
): Promise<EvaluatedCandidate | undefined> {
  const candidate = await sharedLookup(
    scan.state.reads,
    descriptorPath,
    true,
    () => readCandidate(descriptorPath, scan.identity),
  )
  if (!candidate) return undefined
  return {
    modifiedAtMs: candidate.modifiedAtMs,
    instanceId: candidate.instanceId,
    match: evaluateCandidate(candidate, scan),
  }
}

/**
 * Finds the newest live descriptor of this window in the agent folder within one scan; called by {@link selectDevinDescriptor} at each poll.
 * One grace per scan: `scanDeadline` is the startup deadline, or {@link WORKSPACE_RESOLVE_FLOOR_MS} after the scan began when the deadline has passed, and no lookup starts after it. Every descriptor is read and judged concurrently under it, so a read or lookup that never answers costs this scan at most that deadline, whatever their number, and never holds a healthy candidate. The candidates that answered are taken newest first by file time, ties by instance id, never by listing order.
 * @param agentDir - Folder holding `*.connection.json` descriptors.
 * @param scan - What the scan judges by, without its `scanDeadline`.
 * @param deadline - The startup deadline (epoch milliseconds).
 * @returns The newest match without its token, or `undefined` when none answered in time.
 * @example
 * await scanDescriptors('/storage/agent', scan, Date.now() + 15_000) // => the newest selection of this window
 */
async function scanDescriptors(
  agentDir: string,
  scan: Omit<ScanContext, 'scanDeadline'>,
  deadline: number,
): Promise<DevinDescriptorSelection | undefined> {
  const scanDeadline = Math.max(
      deadline,
      Date.now() + WORKSPACE_RESOLVE_FLOOR_MS,
    ),
    context = { ...scan, scanDeadline }
  const names = await answerWithin(
    readdir(agentDir).then(
      (listed) =>
        listed.filter((name) => name.endsWith(CONNECTION_DESCRIPTOR_SUFFIX)),
      () => [],
    ),
    scanDeadline - Date.now(),
  )
  const started = await Promise.all(
    (names ?? []).map((name) =>
      answerWithin(
        startCandidate(join(agentDir, name), context),
        scanDeadline - Date.now(),
      ),
    ),
  )
  // Newest first, ties by instance id: the order never depends on the folder's listing order.
  const ordered = started
    .filter((entry) => entry !== undefined)
    .sort(
      (first, second) =>
        second.modifiedAtMs - first.modifiedAtMs ||
        first.instanceId.localeCompare(second.instanceId),
    )
  // Judgements run concurrently; taking them in order returns as soon as the newest possible match answered.
  for (const entry of ordered) {
    const match = await answerWithin(entry.match, scanDeadline - Date.now())
    if (match) return match
  }
  return undefined
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
      (await answerWithin(
        resolveWorkspace(cwd),
        Math.max(WORKSPACE_RESOLVE_FLOOR_MS, deadline - Date.now()),
      )) ?? cwd,
    identity = options.identity ?? (await currentStorageOwner()),
    state = options.state ?? createDevinSelectState()
  for (;;) {
    // The scan returns the newest live match, so several live ones resolve to the newest without waiting.
    const match = await scanDescriptors(
      agentDir,
      {
        realCwd,
        extHostPid,
        identity,
        excludedPaths: options.excludedPaths ?? new Set(),
        resolveWorkspace,
        state,
      },
      deadline,
    )
    if (match) return match
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
 * Without a usable `WINDSURF_EXT_HOST_PID` the bridge cannot tell its window from another window of the same folder, so it selects nothing and returns one refusal line.
 * A descriptor of this window that lacks `devinChat: true` means AI chat is not set up here: one refusal line, at once.
 * The function never writes the line and never ends the process: an imported function must not end its caller, and a lookup that never answers would keep the process alive anyway. The bridge entry file writes the line and exits 1 from the write's callback.
 * Each connection attempt (the descriptor read and the whole handshake) is bounded by the remaining startup deadline, but never by less than {@link DEVIN_CONNECT_FLOOR_MS}: the bridge's total time can exceed the 15 s startup window by that floor, and after the deadline at most one more attempt starts in total, however many descriptors remain. The connection reads the descriptor again and refuses it when it is no longer the one selected (see {@link devinDescriptorExpectation}). A chosen descriptor whose server fails is dropped and the deadline keeps running for a fresh one; a busy or restarting server (HTTP 429, ECONNREFUSED, ECONNRESET) is asked again after a short pause until the deadline. Nothing reaches stdout (the MCP channel) before the transport is up, and no message holds the token.
 *
 * @param agentDir - Folder holding the window instances' connection descriptors.
 * @param cwd - Working folder of the bridge process; the window's workspace.
 * @param env - Environment; `WINDSURF_EXT_HOST_PID` names the extension host.
 * @param options - Polling limits of {@link selectDevinDescriptor}; tests shorten them.
 * @returns
 * - `undefined` once the transport is connected
 * - the one refusal line (no line break, no descriptor contents) when the bridge refuses; the caller writes it and exits 1
 */
export async function runDevinMcpBridge(
  agentDir: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  options: DevinSelectOptions = {},
): Promise<string | undefined> {
  const pid = extensionHostPidOf(env)
  // No window identity: refuse rather than guess among windows of one folder.
  if (pid === undefined)
    return 'Codebook cannot tell which Devin Desktop window started this bridge: WINDSURF_EXT_HOST_PID is not set. Reload the window; if this stays, Devin Desktop changed how it starts MCP servers.'
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    excludedPaths = new Set<string>(),
    // The working folder's lookup spends the same startup window, so a mount that never answers cannot hold the bridge before its first selection; one that does not answer is compared as written, as the selection does.
    realCwd =
      (await answerWithin(
        (options.resolveWorkspace ?? realOrSame)(cwd),
        Math.max(WORKSPACE_RESOLVE_FLOOR_MS, deadline - Date.now()),
      )) ?? cwd,
    state = createDevinSelectState()
  const lateAttempt = { isSpent: false }
  for (;;) {
    // The newest live descriptor is taken at once, so a fresh instance replaces a restarting one.
    const selection = await selectDevinDescriptor(agentDir, cwd, pid, {
      ...options,
      excludedPaths,
      state,
      timeoutMs: Math.max(0, deadline - Date.now()),
    })
    // No match in time: one fixed recovery line, no descriptor contents.
    if (!selection) return notRunningLine(cwd)
    // This window runs Codebook but its AI chat setup is for another folder or missing: nothing to wait for.
    if (!selection.devinChat)
      return `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${cwd}. Run Codebook: Set Up AI Chat here, then reload the window.`
    // Once the deadline has passed only one more attempt may start in total, however many descriptors remain.
    if (!mayStartAttempt(deadline, lateAttempt)) return notRunningLine(cwd)
    const outcome = await connectOnce(
      selection,
      deadline,
      devinDescriptorExpectation(selection, pid, realCwd),
    )
    if (outcome === 'connected') return undefined
    if (outcome === 'dropped') excludedPaths.add(selection.descriptorPath)
  }
}
