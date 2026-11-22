import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  CONNECTION_DESCRIPTOR_SUFFIX,
  DEVIN_BRIDGE_CWD_LOOKUP_MS,
  DEVIN_BRIDGE_CWD_LOOKUPS_PENDING_MAX,
  DEVIN_BRIDGE_DESCRIPTOR_READ_RETRIES_MAX,
  DEVIN_BRIDGE_DESCRIPTOR_READ_RETRY_MS,
  DEVIN_BRIDGE_DESCRIPTOR_READS_MAX,
  DEVIN_BRIDGE_HEADER_NAME,
  DEVIN_BRIDGE_HEADER_VALUE,
  DEVIN_BRIDGE_RECONNECT_CHECK_MS,
  DEVIN_BRIDGE_REFUSAL_EXIT_MS,
  DEVIN_BRIDGE_SCAN_WAIT_MS,
  DEVIN_CONNECT_FLOOR_MS,
  DEVIN_DESCRIPTOR_LIMIT_BYTES,
} from './constants'
import { runCursorMcpBridge } from './cursorMcpBridge'
import { connectionSchema } from './utils/connectionSchema'
import { currentStorageOwner } from './utils/currentStorageOwner'
import { isDescriptorOwnerGone } from './utils/evidenceInUseElsewhere'
import { hasDevinBridgeReceipts } from './utils/hasDevinBridgeReceipts'
import { isFileDescriptorExhaustion } from './utils/isFileDescriptorExhaustion'
import { isLoopbackMcpUrl } from './utils/isLoopbackMcpUrl'
import { isSameStorageMachine } from './utils/isSameStorageMachine'
import type { DescriptorExpectation } from './utils/readBridgeDescriptor'
import { readMarkedInstallation } from './utils/readMarkedInstallation'
import {
  recordedOwnerSchema,
  type StorageOwnerIdentity,
} from './utils/readRecordedOwner'
import { readWikiRegularFile } from './utils/readWikiRegularFile'
import { realOrSame } from './utils/realOrSame'
import { resolveRealPath } from './utils/resolveRealPath'
import {
  createSlotLimit,
  runWithinSlotLimit,
  type SlotLimit,
} from './utils/runWithinSlotLimit'

/** Selected Codebook instance of one Devin Desktop window; carries no credential. */
export interface DevinDescriptorSelection {
  descriptorPath: string
  instanceId: string
  workspace: string
  /** The loopback endpoint the descriptor names (no credential): the connection goes to exactly this url. */
  url: string
  /** Whether Codebook wrote `devinChat: true`: this window's AI chat setup matches the workspace. */
  devinChat: boolean
  /** The installation id the descriptor's mark names, so the connection can refuse a descriptor re-marked for another installation. */
  devinSetupInstallation?: string
}

/** Polling limits of {@link selectDevinDescriptor}; `identity` names the machine and boot by which a descriptor's owner is judged, {@link currentStorageOwner} unless a test names its own. */
export interface DevinSelectOptions {
  timeoutMs?: number
  intervalMs?: number
  identity?: StorageOwnerIdentity
  /** Descriptor files that did not answer; they are not chosen again. */
  excludedPaths?: ReadonlySet<string>
  /** Called once the bridge's cleanup has completed after its stdio closed; the entry ends its process there. */
  onClosed?: () => void
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
 * Opens and reads one descriptor file, opening it again after a pause while the process is out of file descriptors; called by {@link readCandidate}.
 * A descriptor shortage is transient (other reads free their descriptors), so it is never answered as an absent file; after {@link DEVIN_BRIDGE_DESCRIPTOR_READ_RETRIES_MAX} attempts the file counts as unreadable for this scan and the next poll asks again.
 * @param descriptorPath - The `<instanceId>.connection.json` file.
 * @returns The file as {@link readWikiRegularFile} read it, or `undefined` for a file that must not be used or could not be opened.
 * @example
 * await readDescriptorFile('/storage/agent/instance.connection.json') // => { bytes, inode, modifiedAtMs }
 */
async function readDescriptorFile(
  descriptorPath: string,
): ReturnType<typeof readWikiRegularFile> {
  for (let attempt = 0; ; attempt += 1) {
    let isShortage = false
    const file = await readWikiRegularFile(
      descriptorPath,
      undefined,
      DEVIN_DESCRIPTOR_LIMIT_BYTES,
      (error) => {
        isShortage = isFileDescriptorExhaustion(error)
      },
    )
    // A shortage is retried after a pause; anything else is the answer.
    if (
      file ||
      !isShortage ||
      attempt >= DEVIN_BRIDGE_DESCRIPTOR_READ_RETRIES_MAX
    )
      return file
    await sleep(DEVIN_BRIDGE_DESCRIPTOR_READ_RETRY_MS)
  }
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
  const file = await readDescriptorFile(descriptorPath)
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
      devinSetupInstallation: readMarkedInstallation(raw),
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

/** What a workspace lookup answered: `didResolve` is `false` when the resolver failed and `path` is the spelling the descriptor wrote. */
interface WorkspaceResolution {
  path: string
  didResolve: boolean
}

/** The lookups of the bridge's working folder: how many have not answered yet and the newest real path one answered. */
interface WorkingFolderLookups {
  pending: number
  answer: string | undefined
  /** Called when a lookup answers, so a scan under way can end and match with the new value. */
  onAnswer: (() => void) | undefined
}

/** The listing of the agent folder: `running` while one is in flight, `settled` once it answered and no scan has taken the names yet. */
interface FolderListing {
  running: Promise<void> | undefined
  settled: string[] | undefined
}

/** What one bridge remembers across its polls: the lookups still running (descriptor reads and workspace lookups) and those of its working folder. */
export interface DevinSelectState {
  reads: InFlightLookups<DevinCandidate>
  /** Bounds how many descriptor files are open at once. */
  readSlots: SlotLimit
  /** The folder listing, shared by the polls: one in flight, and the answer of one that settled between scans. */
  listing: FolderListing
  workspaces: InFlightLookups<WorkspaceResolution>
  /** Scans now waiting for each workspace's lookup; a resolved answer that settles while none waits is kept in `lateWorkspaceAnswers`. */
  waitingScans: Map<string, number>
  /** Real paths that settled after every waiting scan gave up, kept until the next scan for that workspace takes them. */
  lateWorkspaceAnswers: Map<string, string>
  workingFolder: WorkingFolderLookups
}

/**
 * Makes the memory one bridge keeps across its selections; called by {@link selectDevinDescriptor} when the caller names none, and by {@link runDevinMcpBridge} once per bridge.
 * @returns Empty lookups.
 * @example
 * createDevinSelectState().reads.size // => 0
 */
export function createDevinSelectState(): DevinSelectState {
  return {
    reads: new Map(),
    readSlots: createSlotLimit(),
    listing: { running: undefined, settled: undefined },
    workspaces: new Map(),
    waitingScans: new Map(),
    lateWorkspaceAnswers: new Map(),
    workingFolder: { pending: 0, answer: undefined, onAnswer: undefined },
  }
}

/**
 * Gives the working-folder value a selection matches with; called by {@link selectDevinDescriptor} at each poll.
 * While no lookup has answered and fewer than {@link DEVIN_BRIDGE_CWD_LOOKUPS_PENDING_MAX} are pending, a new lookup starts and is waited for at most {@link DEVIN_BRIDGE_CWD_LOOKUP_MS}, so one hanging lookup never spends the startup window and a hung mount holds at most two of libuv's four pool threads. A lookup that answers later still sets the answer for the next poll.
 * @param lookups - The working folder's pending count and newest answer.
 * @param cwd - Working folder as the bridge was started in.
 * @param resolveWorkspace - The resolver, {@link realOrSame} unless a test names its own.
 * @param deadline - The startup deadline (epoch milliseconds).
 * @returns The newest real path a lookup answered, else `cwd` as written.
 * @example
 * await lookUpWorkingFolder(createDevinSelectState().workingFolder, '/link', realOrSame, Date.now() + 15_000) // => '/real'
 */
async function lookUpWorkingFolder(
  lookups: WorkingFolderLookups,
  cwd: string,
  resolveWorkspace: (path: string) => Promise<string>,
  deadline: number,
): Promise<string> {
  if (
    lookups.answer === undefined &&
    lookups.pending < DEVIN_BRIDGE_CWD_LOOKUPS_PENDING_MAX
  ) {
    lookups.pending += 1
    const lookup = resolveWorkspace(cwd)
      .then(
        (real) => {
          lookups.answer = real
          lookups.onAnswer?.()
        },
        () => undefined,
      )
      .finally(() => {
        lookups.pending -= 1
      })
    await answerWithin(
      lookup,
      Math.min(
        DEVIN_BRIDGE_CWD_LOOKUP_MS,
        Math.max(WORKSPACE_RESOLVE_FLOOR_MS, deadline - Date.now()),
      ),
    )
  }
  return lookups.answer ?? cwd
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
  /** Rejects when the path does not resolve; the scan then judges the path as written, once. */
  resolveWorkspace: (path: string) => Promise<string>
  /** No new lookup starts after this instant. */
  scanDeadline: number
  state: DevinSelectState
  /** Late answers this scan took from the state, so every candidate of a workspace in this scan uses the same one. */
  takenLateAnswers: Map<string, string>
}

/**
 * Gives the real path of a candidate's workspace for one scan; called by {@link evaluateCandidate}.
 * The first scan after a late answer takes it from the state, once, and every candidate of that workspace in the scan uses it. Otherwise the shared lookup runs and is waited for until the scan's deadline. A resolved answer that reaches no waiting scan is kept for the next scan, so a slow mount still matches; a failed lookup serves its own scan with the path as written and keeps nothing.
 * @param workspace - The workspace path the descriptor names.
 * @param scan - What the scan judges by.
 * @returns The real path, or `undefined` when none answered in time.
 * @example
 * await resolveWorkspaceForScan('/mnt/slow/repo', scan) // => '/repo' once the lookup answered
 */
async function resolveWorkspaceForScan(
  workspace: string,
  scan: ScanContext,
): Promise<string | undefined> {
  const { state, takenLateAnswers } = scan
  const late = state.lateWorkspaceAnswers.get(workspace)
  if (late !== undefined) {
    // The next scan takes the kept answer, once; its other candidates read it from the scan.
    state.lateWorkspaceAnswers.delete(workspace)
    takenLateAnswers.set(workspace, late)
  }
  const taken = takenLateAnswers.get(workspace)
  if (taken !== undefined) return taken
  const lookup = sharedLookup(
    state.workspaces,
    workspace,
    Date.now() < scan.scanDeadline,
    () =>
      scan.resolveWorkspace(workspace).then(
        (path) => {
          // No scan waits any more: keep the resolved answer for the next scan.
          if (!state.waitingScans.get(workspace))
            state.lateWorkspaceAnswers.set(workspace, path)
          return { path, didResolve: true }
        },
        // A failed resolution is judged as written by the scans waiting now, never kept.
        () => ({ path: workspace, didResolve: false }),
      ),
  )
  if (!lookup) return undefined
  state.waitingScans.set(
    workspace,
    (state.waitingScans.get(workspace) ?? 0) + 1,
  )
  try {
    return (await answerWithin(lookup, scan.scanDeadline - Date.now()))?.path
  } finally {
    state.waitingScans.set(
      workspace,
      (state.waitingScans.get(workspace) ?? 1) - 1,
    )
  }
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
  const {
    descriptorPath,
    instanceId,
    workspace,
    url,
    devinChat,
    devinSetupInstallation,
  } = candidate
  try {
    if (
      candidate.pid !== scan.extHostPid ||
      scan.excludedPaths.has(descriptorPath) ||
      (await isDescriptorOwnerGone(descriptorPath, scan.identity))
    )
      return undefined
    const realWorkspace = await resolveWorkspaceForScan(workspace, scan)
    return realWorkspace === scan.realCwd
      ? {
          descriptorPath,
          instanceId,
          workspace,
          url,
          devinChat,
          devinSetupInstallation,
        }
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
    () =>
      runWithinSlotLimit(
        scan.state.readSlots,
        DEVIN_BRIDGE_DESCRIPTOR_READS_MAX,
        () => readCandidate(descriptorPath, scan.identity),
      ),
  )
  if (!candidate) return undefined
  return {
    modifiedAtMs: candidate.modifiedAtMs,
    instanceId: candidate.instanceId,
    match: evaluateCandidate(candidate, scan),
  }
}

/** One descriptor file of a scan: its order keys once it was read, and the selection once the candidate was judged to be this window's. */
interface ScanEntry {
  order: { modifiedAtMs: number; instanceId: string } | undefined
  selection: DevinDescriptorSelection | undefined
  isDone: boolean
}

/** What one scan of the agent folder answers: the newest match, or that the working folder's value changed meanwhile and the folder must be scanned again with it. */
interface ScanResult {
  selection: DevinDescriptorSelection | undefined
  shouldRescan: boolean
}

/**
 * Orders candidates newest first by file time, ties by instance id, so the order never depends on the folder's listing order; the comparator of {@link newestMatch} and {@link hasPendingNewer}.
 * @param first - Order keys of one candidate.
 * @param second - Order keys of another.
 * @returns Negative when `first` is the newer candidate.
 * @example
 * compareNewestFirst({ modifiedAtMs: 2, instanceId: 'a' }, { modifiedAtMs: 1, instanceId: 'b' }) // => -1
 */
function compareNewestFirst(
  first: NonNullable<ScanEntry['order']>,
  second: NonNullable<ScanEntry['order']>,
): number {
  return (
    second.modifiedAtMs - first.modifiedAtMs ||
    first.instanceId.localeCompare(second.instanceId)
  )
}

/**
 * Finds the newest candidate of a scan that has been judged to be this window's; called by {@link awaitNewestMatch} after each change.
 * @param entries - The scan's entries.
 * @returns The newest matching entry, or `undefined` when none matched yet.
 * @example
 * newestMatch([]) // => undefined
 */
function newestMatch(entries: readonly ScanEntry[]): ScanEntry | undefined {
  let newest: ScanEntry | undefined
  for (const entry of entries) {
    if (!entry.selection || !entry.order) continue
    if (!newest?.order || compareNewestFirst(entry.order, newest.order) < 0)
      newest = entry
  }
  return newest
}

/**
 * Says whether an unfinished candidate is or may be newer than `best`: one whose read has not answered (its file time is unknown) or one that is newer; called by {@link awaitNewestMatch} to decide whether a match may be taken now.
 * @param entries - The scan's entries.
 * @param best - Order keys of the newest match so far.
 * @returns `true` when an unfinished candidate is or may be newer than `best`.
 * @example
 * hasPendingNewer([{ order: undefined, selection: undefined, isDone: false }], best) // => true
 */
function hasPendingNewer(
  entries: readonly ScanEntry[],
  best: NonNullable<ScanEntry['order']>,
): boolean {
  return entries.some(
    (entry) =>
      !entry.isDone &&
      (!entry.order || compareNewestFirst(entry.order, best) < 0),
  )
}

/**
 * Reads and judges one descriptor file for a scan, recording progress in `entry` and calling `notify` at each step; called by {@link scanDescriptors} for every file at once.
 * A read or judgement that does not answer before `waitEndsAt` leaves the entry done without a selection; the unfinished lookup stays in the shared state for the next scan.
 * @param descriptorPath - The `<instanceId>.connection.json` file.
 * @param scan - What the scan judges by.
 * @param entry - The entry to fill.
 * @param notify - Wakes the scan's waiter after each change.
 * @param waitEndsAt - When the scan stops waiting (epoch milliseconds).
 * @example
 * await judgeDescriptorFile(path, scan, entry, notify, Date.now() + 1_000)
 */
async function judgeDescriptorFile(
  descriptorPath: string,
  scan: ScanContext,
  entry: ScanEntry,
  notify: () => void,
  waitEndsAt: number,
): Promise<void> {
  const started = await answerWithin(
    startCandidate(descriptorPath, scan),
    waitEndsAt - Date.now(),
  )
  if (started) {
    entry.order = {
      modifiedAtMs: started.modifiedAtMs,
      instanceId: started.instanceId,
    }
    notify()
    entry.selection = await answerWithin(started.match, waitEndsAt - Date.now())
  }
  entry.isDone = true
  notify()
}

/**
 * Answers a scan that needs no further waiting; called by {@link awaitNewestMatch} before each wait.
 * @param entries - The scan's entries.
 * @param realCwd - The working-folder value the scan matches with.
 * @param folder - The bridge's working-folder lookups.
 * @returns A rescan when the working folder's lookup answered with another value; the newest match when no unfinished candidate could be newer; no selection when every candidate is done without a match; `undefined` while the scan must still wait.
 * @example
 * settledScanResult([], '/repo', { pending: 0, answer: undefined, onAnswer: undefined }) // => { selection: undefined, shouldRescan: false }
 */
function settledScanResult(
  entries: readonly ScanEntry[],
  realCwd: string,
  folder: WorkingFolderLookups,
): ScanResult | undefined {
  // The working folder answered with another value: this scan matches with a stale one.
  if (folder.answer !== undefined && folder.answer !== realCwd)
    return { selection: undefined, shouldRescan: true }
  const best = newestMatch(entries)
  if (best?.order && !hasPendingNewer(entries, best.order))
    return { selection: best.selection, shouldRescan: false }
  if (!best && entries.every((entry) => entry.isDone))
    return { selection: undefined, shouldRescan: false }
  return undefined
}

/**
 * Waits for the newest match of a scan: judgements run concurrently and the newest candidate that answered is taken; called by {@link scanDescriptors}.
 * A match is taken at once when no unfinished candidate could be newer. Once any match exists, unfinished newer candidates are waited for at most {@link WORKSPACE_RESOLVE_FLOOR_MS}. The wait ends at `waitEndsAt` at the latest, and ends early with a rescan when the working folder's lookup answered with another value than the scan matches with.
 * @param entries - The scan's entries, filled by {@link judgeDescriptorFile}.
 * @param realCwd - The working-folder value the scan matches with.
 * @param folder - The bridge's working-folder lookups.
 * @param waitEndsAt - When the scan stops waiting (epoch milliseconds).
 * @param waiter - Holds the function that wakes the wait; the scan's `notify` calls it.
 * @returns The scan's answer.
 * @example
 * await awaitNewestMatch(entries, '/repo', folder, Date.now() + 1_000, waiter) // => { selection, shouldRescan: false }
 */
async function awaitNewestMatch(
  entries: readonly ScanEntry[],
  realCwd: string,
  folder: WorkingFolderLookups,
  waitEndsAt: number,
  waiter: { wake: (() => void) | undefined },
): Promise<ScanResult> {
  let firstMatchAt: number | undefined
  for (;;) {
    const settled = settledScanResult(entries, realCwd, folder)
    if (settled) return settled
    if (newestMatch(entries)) firstMatchAt ??= Date.now()
    const limit =
      firstMatchAt === undefined
        ? waitEndsAt
        : Math.min(waitEndsAt, firstMatchAt + WORKSPACE_RESOLVE_FLOOR_MS)
    // No await sits between the checks above and this promise, so no change is missed.
    const changed = new Promise<true>((resolve) => {
      waiter.wake = (): void => resolve(true)
    })
    const didChange = await answerWithin(changed, limit - Date.now())
    if (!didChange)
      return { selection: newestMatch(entries)?.selection, shouldRescan: false }
  }
}

/**
 * Lists the descriptor files of the agent folder, sharing one listing across polls; called by {@link scanDescriptors} at each poll.
 * A listing that outlasts one scan's wait is not thrown away: it keeps running, the next poll waits for the same one (no second `readdir` starts), and its answer is taken when it arrives, so a slow home folder still yields its descriptors within the startup budget. An answer that arrived between scans is taken at the start of the next one.
 * @param agentDir - Folder holding `*.connection.json` descriptors.
 * @param listing - The bridge's shared listing state.
 * @param scanDeadline - When this scan stops waiting (epoch milliseconds).
 * @returns The descriptor file names, or an empty list when the folder cannot be read or the listing did not answer before `scanDeadline`.
 * @example
 * await listDescriptorNames('/storage/agent', state.listing, Date.now() + 1_000) // => ['<instanceId>.connection.json']
 */
async function listDescriptorNames(
  agentDir: string,
  listing: FolderListing,
  scanDeadline: number,
): Promise<string[]> {
  // An answer that arrived since the last scan is the newest there is.
  if (!listing.settled && !listing.running)
    listing.running = readdir(agentDir)
      .then(
        (listed) => {
          listing.settled = listed.filter((name) =>
            name.endsWith(CONNECTION_DESCRIPTOR_SUFFIX),
          )
        },
        () => {
          listing.settled = []
        },
      )
      .finally(() => {
        listing.running = undefined
      })
  if (listing.running)
    await answerWithin(listing.running, scanDeadline - Date.now())
  const names = listing.settled ?? []
  listing.settled = undefined
  return names
}

/**
 * Finds the newest live descriptor of this window in the agent folder within one scan; called by {@link selectDevinDescriptor} at each poll.
 * The scan waits at most {@link DEVIN_BRIDGE_SCAN_WAIT_MS} (and never past the startup deadline, or {@link WORKSPACE_RESOLVE_FLOOR_MS} after the scan began when the deadline has passed), and no lookup starts after that. Every descriptor is read and judged concurrently ({@link judgeDescriptorFile}), so a read, owner check or lookup that never answers never holds a healthy match: the newest candidate that answered is taken ({@link awaitNewestMatch}), never by listing order. Unfinished reads and lookups stay in the shared state, so the next poll lists the folder again without starting duplicates and sees descriptors written meanwhile.
 * @param agentDir - Folder holding `*.connection.json` descriptors.
 * @param scan - What the scan judges by, without its `scanDeadline`.
 * @param deadline - The startup deadline (epoch milliseconds).
 * @returns The newest match without its token, or `undefined` when none answered in time; `shouldRescan` when the working folder's value changed during the scan.
 * @example
 * await scanDescriptors('/storage/agent', scan, Date.now() + 15_000) // => { selection: <the newest selection of this window>, shouldRescan: false }
 */
async function scanDescriptors(
  agentDir: string,
  scan: Omit<ScanContext, 'scanDeadline' | 'takenLateAnswers'>,
  deadline: number,
): Promise<ScanResult> {
  const scanDeadline = Math.min(
      Math.max(deadline, Date.now() + WORKSPACE_RESOLVE_FLOOR_MS),
      Date.now() + DEVIN_BRIDGE_SCAN_WAIT_MS,
    ),
    context = { ...scan, scanDeadline, takenLateAnswers: new Map() },
    folder = scan.state.workingFolder,
    waiter: { wake: (() => void) | undefined } = { wake: undefined },
    notify = (): void => waiter.wake?.()
  const names = await listDescriptorNames(
    agentDir,
    scan.state.listing,
    scanDeadline,
  )
  const files = names.map((name) => {
    const entry: ScanEntry = {
      order: undefined,
      selection: undefined,
      isDone: false,
    }
    return { path: join(agentDir, name), entry }
  })
  const entries = files.map(({ entry }) => entry)
  folder.onAnswer = notify
  try {
    for (const { path, entry } of files)
      void judgeDescriptorFile(path, context, entry, notify, scanDeadline)
    return await awaitNewestMatch(
      entries,
      scan.realCwd,
      folder,
      scanDeadline,
      waiter,
    )
  } finally {
    folder.onAnswer = undefined
  }
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
 * @returns The match without its token, with `matchedCwd`, the working-folder value it was matched with (the newest real path the lookup answered, else `cwd` as written); the connection check must compare with that same value. Undefined when none appears in time.
 */
export async function selectDevinDescriptor(
  agentDir: string,
  cwd: string,
  extHostPid: number,
  options: DevinSelectOptions = {},
): Promise<(DevinDescriptorSelection & { matchedCwd: string }) | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS,
    deadline = Date.now() + timeoutMs,
    resolveWorkspace = options.resolveWorkspace ?? realOrSame,
    identity = options.identity ?? (await currentStorageOwner()),
    state = options.state ?? createDevinSelectState()
  for (;;) {
    // The newest answer for the working folder, else its spelling as written; a lookup that timed out is asked again at a later poll.
    const matchedCwd = await lookUpWorkingFolder(
      state.workingFolder,
      cwd,
      resolveWorkspace,
      deadline,
    )
    // The scan returns the newest live match, so several live ones resolve to the newest without waiting.
    const scanned = await scanDescriptors(
      agentDir,
      {
        realCwd: matchedCwd,
        extHostPid,
        identity,
        excludedPaths: options.excludedPaths ?? new Set(),
        // A rejecting resolver lets a scan tell a failed lookup from an answer.
        resolveWorkspace: options.resolveWorkspace ?? resolveRealPath,
        state,
      },
      deadline,
    )
    // The working folder answered during the scan: scan again with its value, at once.
    if (scanned.shouldRescan) continue
    if (scanned.selection) return { ...scanned.selection, matchedCwd }
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
    devinSetupInstallation: selection.devinSetupInstallation,
    url: selection.url,
  }
}

/**
 * Runs the receipts check of {@link hasDevinBridgeReceipts} within a time budget; called by {@link connectOnce} before the first connection and by {@link setupCheckBeforeReconnect} before each later one.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @param budgetMs - Longest wait for the check.
 * @returns `true` when the setup stands, `false` when the check answered that it does not, `undefined` when it did not answer in time.
 * @example
 * await receiptsStandWithin('/storage/agent/x.connection.json', 3_000) // => true
 */
function receiptsStandWithin(
  descriptorPath: string,
  budgetMs: number,
): Promise<boolean | undefined> {
  return answerWithin(
    hasDevinBridgeReceipts(descriptorPath).catch(() => false),
    budgetMs,
  )
}

/**
 * Writes the not-set-up line to stderr and resolves once the write completed or {@link DEVIN_BRIDGE_REFUSAL_EXIT_MS} passed; called by {@link setupCheckBeforeReconnect} so the bridge's cleanup and exit cannot drop the line.
 * @param line - The full line, with its line break.
 * @returns Resolves after the write callback, or after the bound when a full stderr pipe never calls it back.
 * @example
 * await writeNotSetUpLine('Codebook is running ...\n')
 */
function writeNotSetUpLine(line: string): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, DEVIN_BRIDGE_REFUSAL_EXIT_MS)
    process.stderr.write(line, () => {
      clearTimeout(timer)
      done()
    })
  })
}

/**
 * Makes the check the bridge runs before it opens a new upstream session after the first one expired; passed by {@link connectOnce} to {@link runCursorMcpBridge}.
 * A removal in another window never unmarks this window's descriptor, so the receipts are read again: when the setup no longer stands the not-set-up line is written to stderr and the exit code is set to 1, and the bridge ends instead of reconnecting.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @param cwd - The bridge's working folder, named by the refusal line.
 * @returns A check resolving `true` when the setup stands and `false` after it wrote the refusal.
 * @throws From the returned check, when the receipts read does not answer within {@link DEVIN_BRIDGE_RECONNECT_CHECK_MS}: that request fails and the bridge stays up for the next one.
 * @example
 * await setupCheckBeforeReconnect('/storage/agent/x.connection.json', '/repo')() // => false once the setup was removed
 */
function setupCheckBeforeReconnect(
  descriptorPath: string,
  cwd: string,
): () => Promise<boolean> {
  return async () => {
    const stands = await receiptsStandWithin(
      descriptorPath,
      DEVIN_BRIDGE_RECONNECT_CHECK_MS,
    )
    if (stands === undefined)
      throw new Error('Codebook setup check did not answer in time.')
    if (!stands) {
      process.exitCode = 1
      await writeNotSetUpLine(`${notSetUpLine(cwd)}\n`)
    }
    return stands
  }
}

/**
 * Connects the bridge to one selected instance within the remaining startup budget; called by {@link runDevinMcpBridge}.
 * A failure is not reported: the error may hold credential fragments.
 * The attempt gets at least {@link DEVIN_CONNECT_FLOOR_MS}, also when the deadline has nearly passed, so the bridge's total time can exceed the startup window by that floor.
 * @param selection - The descriptor chosen by {@link selectDevinDescriptor}.
 * @param deadline - When the startup wait ends (epoch milliseconds).
 * @param expected - What the selection validated ({@link devinDescriptorExpectation}).
 * @param onClosed - Called once the bridge's cleanup has completed after its stdio closed.
 * @param cwd - The bridge's working folder, named by the refusal a later reconnection ends with.
 * Before any request it requires the setup receipts of the descriptor's installation ({@link hasDevinBridgeReceipts}), a check bounded by the remaining startup time (at least {@link WORKSPACE_RESOLVE_FLOOR_MS}).
 * @returns `connected` once the transport is up; `not-set-up` after a pause when the receipts check answered that the setup does not stand; `busy` after a pause when the receipts check did not answer in time, the server answered 429 or refused or reset the connection, and time remains; `dropped` for any other failure (a handshake that does not finish in time included) and when no time remains.
 * @example
 * await connectOnce(selection, Date.now() + 15_000, expected) // => 'connected'
 */
async function connectOnce(
  selection: DevinDescriptorSelection,
  deadline: number,
  expected: DescriptorExpectation,
  onClosed: (() => void) | undefined,
  cwd: string,
): Promise<'connected' | 'busy' | 'dropped' | 'not-set-up'> {
  // The last check before an MCP session: the setup the descriptor was marked for must still stand. It is bounded like every other wait: a check that does not answer in time is transient, never a missing setup; one that answered and failed counts like an unmarked descriptor, so the bridge keeps polling until its deadline, then names the missing setup.
  const receiptsStand = await receiptsStandWithin(
    selection.descriptorPath,
    Math.max(WORKSPACE_RESOLVE_FLOOR_MS, deadline - Date.now()),
  )
  if (receiptsStand !== true) {
    const remaining = deadline - Date.now()
    if (remaining > 0)
      await sleep(Math.min(TRANSIENT_RETRY_PAUSE_MS, remaining))
    return receiptsStand === undefined ? 'busy' : 'not-set-up'
  }
  try {
    await runCursorMcpBridge(
      selection.descriptorPath,
      Math.max(DEVIN_CONNECT_FLOOR_MS, deadline - Date.now()),
      expected,
      { name: DEVIN_BRIDGE_HEADER_NAME, value: DEVIN_BRIDGE_HEADER_VALUE },
      onClosed,
      setupCheckBeforeReconnect(selection.descriptorPath, cwd),
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
    // One memory for every selection of this bridge: lookups that never answered are not started again beyond two.
    state = createDevinSelectState()
  const lateAttempt = { isSpent: false },
    // True while the last attempt found a selected descriptor's setup removed: the refusal at the end of the wait then names the missing setup, not a missing Codebook.
    wait = { isSetupMissing: false }
  for (;;) {
    // The newest live descriptor is taken at once, so a fresh instance replaces a restarting one.
    const selection = await selectDevinDescriptor(agentDir, cwd, pid, {
      ...options,
      excludedPaths,
      state,
      timeoutMs: Math.max(0, deadline - Date.now()),
    })
    // No match in time: one fixed recovery line, no descriptor contents.
    if (!selection) return endOfWaitLine(cwd, wait)
    // This window runs Codebook but its AI chat setup is for another folder or missing: nothing to wait for.
    if (!selection.devinChat) return notSetUpLine(cwd)
    // Once the deadline has passed only one more attempt may start in total, however many descriptors remain.
    if (!mayStartAttempt(deadline, lateAttempt)) return endOfWaitLine(cwd, wait)
    const outcome = await connectOnce(
      selection,
      deadline,
      // The connection check compares with the working-folder value the selection matched with, never a second lookup of its own.
      devinDescriptorExpectation(selection, pid, selection.matchedCwd),
      options.onClosed,
      cwd,
    )
    if (outcome === 'connected') return undefined
    noteConnectOutcome(outcome, selection.descriptorPath, excludedPaths, wait)
  }
}

/**
 * Records what a failed connection attempt means for the rest of the wait; called by {@link runDevinMcpBridge} after each {@link connectOnce} that did not connect.
 * A dropped descriptor is not selected again. `wait.isSetupMissing` follows the last outcome: set by `not-set-up`, cleared by any other, so a wait that ends after a later attempt was dropped or busy says Codebook is not running.
 * @param outcome - The attempt's outcome.
 * @param descriptorPath - The attempted descriptor.
 * @param excludedPaths - The descriptors the selection skips from now on.
 * @param wait - The wait's state; `isSetupMissing` is whether the last outcome was `not-set-up`.
 * @example noteConnectOutcome('dropped', '/storage/agent/a.connection.json', excludedPaths, wait) // excludedPaths now holds that path
 */
function noteConnectOutcome(
  outcome: 'busy' | 'dropped' | 'not-set-up',
  descriptorPath: string,
  excludedPaths: Set<string>,
  wait: { isSetupMissing: boolean },
): void {
  if (outcome === 'dropped') excludedPaths.add(descriptorPath)
  wait.isSetupMissing = outcome === 'not-set-up'
}

/**
 * The refusal for a window where Codebook runs but this folder's AI chat setup is missing or was removed; returned by {@link runDevinMcpBridge}.
 * @param cwd - The bridge's working folder, as Devin Desktop started it.
 * @returns One fixed recovery sentence without descriptor contents.
 * @example notSetUpLine('/repo') // => 'Codebook is running in this Devin Desktop window, but AI chat is not set up for /repo. Run Codebook: Set Up AI Chat here, then reload the window.'
 */
function notSetUpLine(cwd: string): string {
  return `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${cwd}. Run Codebook: Set Up AI Chat here, then reload the window.`
}

/**
 * The refusal when the bridge's startup window ends without a connection; returned by {@link runDevinMcpBridge}.
 * @param cwd - The bridge's working folder.
 * @param wait - The wait's state: whether a selected descriptor's setup was found removed.
 * @returns {@link notSetUpLine} when a descriptor's setup was removed, else {@link notRunningLine}.
 * @example endOfWaitLine('/repo', { isSetupMissing: true }) // => notSetUpLine('/repo')
 */
function endOfWaitLine(
  cwd: string,
  wait: { readonly isSetupMissing: boolean },
): string {
  return wait.isSetupMissing ? notSetUpLine(cwd) : notRunningLine(cwd)
}
