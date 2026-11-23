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
  DEVIN_BRIDGE_RECONNECT_CHECKS_HANGING_MAX,
  DEVIN_BRIDGE_REFUSAL_EXIT_MS,
  DEVIN_BRIDGE_SCAN_WAIT_MS,
  DEVIN_CONNECT_FLOOR_MS,
  DEVIN_DESCRIPTOR_LIMIT_BYTES,
} from './constants'
import { runCursorMcpBridge } from './cursorMcpBridge'
import {
  checkDevinBridgeReceipts,
  type DevinBridgeBinding,
  type DevinBridgeReceiptsAnswer,
} from './utils/checkDevinBridgeReceipts'
import { connectionSchema } from './utils/connectionSchema'
import { currentStorageOwner } from './utils/currentStorageOwner'
import { isDescriptorOwnerGone } from './utils/evidenceInUseElsewhere'
import { isFileDescriptorExhaustion } from './utils/isFileDescriptorExhaustion'
import { isLoopbackMcpUrl } from './utils/isLoopbackMcpUrl'
import { isSameStorageMachine } from './utils/isSameStorageMachine'
import {
  DescriptorMarkChangedError,
  DescriptorShortageError,
  type DescriptorExpectation,
} from './utils/readBridgeDescriptor'
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

/** What a workspace lookup answered: `path` is the resolved real path, or the spelling the descriptor wrote when the resolver failed. */
interface WorkspaceResolution {
  path: string
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
  /** `true` while the scan waits for its candidates; set to `false` when it returns, so a candidate that finishes later never takes a kept answer meant for the next live scan. */
  isActive: boolean
  /** How many candidates of this scan wait on each workspace's lookup; taken out of {@link DevinSelectState.waitingScans} when the scan ends, so a scan that returned never hides a late answer. */
  ownWaiting: Map<string, number>
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
  // An ended scan neither joins a lookup nor takes a kept answer: its wait would never be given back.
  if (!scan.isActive) return undefined
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
          return { path }
        },
        // A failed resolution is judged as written by the scans waiting now, never kept.
        () => ({ path: workspace }),
      ),
  )
  if (!lookup) return undefined
  adjustWaiting(scan, workspace, 1)
  try {
    return (await answerWithin(lookup, scan.scanDeadline - Date.now()))?.path
  } finally {
    // A scan that ended while this candidate waited already gave its waits back when it ended.
    if (scan.isActive) adjustWaiting(scan, workspace, -1)
  }
}

/**
 * Changes how many candidates wait on a workspace's lookup, in the scan's own count and in the shared one; called by {@link resolveWorkspaceForScan} and {@link releaseWaiting}.
 * @param scan - The scan whose candidate starts or stops waiting.
 * @param workspace - The workspace path the lookup is about.
 * @param delta - `1` when a candidate starts waiting, `-1` when it stops.
 * @example
 * adjustWaiting(scan, '/repo', 1) // => state.waitingScans.get('/repo') grows by one
 */
function adjustWaiting(
  scan: ScanContext,
  workspace: string,
  delta: number,
): void {
  scan.ownWaiting.set(workspace, (scan.ownWaiting.get(workspace) ?? 0) + delta)
  scan.state.waitingScans.set(
    workspace,
    (scan.state.waitingScans.get(workspace) ?? 0) + delta,
  )
}

/**
 * Gives back every wait a scan still holds when it ends, so a lookup that answers later is kept for the next scan; called by {@link scanDescriptors}.
 * @param scan - The scan that ended.
 * @example
 * releaseWaiting(scan) // => scan.ownWaiting.size === 0
 */
function releaseWaiting(scan: ScanContext): void {
  scan.isActive = false
  for (const [workspace, count] of scan.ownWaiting)
    scan.state.waitingScans.set(
      workspace,
      (scan.state.waitingScans.get(workspace) ?? 0) - count,
    )
  scan.ownWaiting.clear()
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
  scan: Omit<
    ScanContext,
    'scanDeadline' | 'takenLateAnswers' | 'isActive' | 'ownWaiting'
  >,
  deadline: number,
): Promise<ScanResult> {
  const scanDeadline = Math.min(
      Math.max(deadline, Date.now() + WORKSPACE_RESOLVE_FLOOR_MS),
      Date.now() + DEVIN_BRIDGE_SCAN_WAIT_MS,
    ),
    context: ScanContext = {
      ...scan,
      scanDeadline,
      takenLateAnswers: new Map(),
      isActive: true,
      ownWaiting: new Map(),
    },
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
    // A candidate still judging after this point belongs to an expired scan.
    releaseWaiting(context)
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
 * @returns `true` for HTTP 429 (the server's sessions are full), ECONNREFUSED, ECONNRESET, or EMFILE and ENFILE met while connecting (this process or the system ran out of file descriptors for the request), also as the cause of a wrapping error; `false` otherwise, a {@link DescriptorShortageError} of the descriptor read included (it carries no code).
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
    // A file shortage while connecting is overcome when other requests free their descriptors; one at the descriptor read arrives as a DescriptorShortageError, which has no code.
    if (isFileDescriptorExhaustion(current)) return true
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
 * Names what the bridge connected for, so its receipts check can tell a setup that was removed from one that was replaced; called by {@link connectOnce} for the first check and for every later one.
 * @param selection - The descriptor chosen by {@link selectDevinDescriptor}.
 * @returns The instance id, the endpoint url and the installation id the selection validated.
 * @example
 * bindingOfSelection(selection) // => { instanceId: '1111…', url: selection.url, installationId: 'f3b1c0de-…' }
 */
function bindingOfSelection(
  selection: DevinDescriptorSelection,
): DevinBridgeBinding {
  return {
    instanceId: selection.instanceId,
    url: selection.url,
    installationId: selection.devinSetupInstallation,
  }
}

/**
 * Runs the receipts check of {@link checkDevinBridgeReceipts} within a time budget; called by {@link connectOnce} before the first connection and by {@link setupCheckBeforeReconnect} before each later one.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @param binding - What the bridge connected for ({@link bindingOfSelection}).
 * @param budgetMs - Longest wait for the check.
 * @returns The check's answer; `undefined` when it did not answer in time; `no-answer` when the check itself threw.
 * @example
 * await receiptsAnswerWithin('/storage/agent/x.connection.json', binding, 3_000) // => { answer: 'stands' }
 */
function receiptsAnswerWithin(
  descriptorPath: string,
  binding: DevinBridgeBinding,
  budgetMs: number,
): Promise<DevinBridgeReceiptsAnswer | undefined> {
  return answerWithin(
    checkDevinBridgeReceipts(descriptorPath, binding).catch(
      (): DevinBridgeReceiptsAnswer => ({ answer: 'no-answer' }),
    ),
    budgetMs,
  )
}

/**
 * Writes a refusal line to stderr and resolves once the write completed or {@link DEVIN_BRIDGE_REFUSAL_EXIT_MS} passed; called by {@link setupCheckBeforeReconnect} so the bridge's cleanup and exit cannot drop the line.
 * @param line - The full line ({@link notSetUpLine} or {@link replacedLine}), with its line break.
 * @returns Resolves after the write callback, or after the bound when a full stderr pipe never calls it back.
 * @example
 * await writeRefusalLine('Codebook is running ...\n')
 */
function writeRefusalLine(line: string): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, DEVIN_BRIDGE_REFUSAL_EXIT_MS)
    process.stderr.write(line, () => {
      clearTimeout(timer)
      done()
    })
  })
}

/**
 * Makes the check the bridge runs before it opens a new upstream session after the first one expired, and when the server refuses a request with 401 or 403; passed by {@link connectOnce} to {@link runCursorMcpBridge} as both its `beforeUpstream` and its `onRefused`.
 * A removal in another window never unmarks this window's descriptor, so the receipts are read again against what the bridge connected for. When the setup was removed the not-set-up line is written to stderr; when the descriptor now names another instance, endpoint or installation ({@link replacedLine}) that line is written instead. Either sets the exit code to 1, and the bridge ends instead of reconnecting.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @param binding - What the bridge connected for ({@link bindingOfSelection}).
 * @param cwd - The bridge's working folder, named by the refusal line.
 * @returns A check resolving `true` when the setup stands and `false` after it wrote the refusal.
 * @throws From the returned check, when {@link DEVIN_BRIDGE_RECONNECT_CHECKS_HANGING_MAX} check (three file reads) already hangs unanswered, when the receipts check does not answer within {@link DEVIN_BRIDGE_RECONNECT_CHECK_MS} or answers `no-answer` (a read failed without telling whether the setup stands): that request fails, no line is written and the bridge stays up for the next one.
 * @example
 * await setupCheckBeforeReconnect('/storage/agent/x.connection.json', binding, '/repo')() // => false once the setup was removed
 */
function setupCheckBeforeReconnect(
  descriptorPath: string,
  binding: DevinBridgeBinding,
  cwd: string,
): () => Promise<boolean> {
  // The timed answer of the receipts read still within its deadline: every request that arrives before the deadline waits on this one result, so a stalled read is started once and costs one timer, however many requests wait on it. After the deadline the answer is dropped, so the next request reads afresh.
  let timedRead: Promise<DevinBridgeReceiptsAnswer | undefined> | undefined,
    ending: Promise<boolean> | undefined,
    // Receipts checks that have not settled (three file reads each): reads cannot be cancelled, so only this many hang at once before a request fails without starting another.
    hangingChecks = 0
  function startTimedRead(): Promise<DevinBridgeReceiptsAnswer | undefined> {
    if (hangingChecks >= DEVIN_BRIDGE_RECONNECT_CHECKS_HANGING_MAX)
      throw new Error('Codebook setup check did not answer.')
    hangingChecks += 1
    const read = checkDevinBridgeReceipts(descriptorPath, binding).catch(
      (): DevinBridgeReceiptsAnswer => ({ answer: 'no-answer' }),
    )
    void read.finally(() => {
      hangingChecks -= 1
    })
    const timed = answerWithin(read, DEVIN_BRIDGE_RECONNECT_CHECK_MS)
    // The read is shared only until its deadline; a later request starts a new one.
    void timed.finally(() => {
      if (timedRead === timed) timedRead = undefined
    })
    return timed
  }
  async function check(): Promise<boolean> {
    // Once the bridge has ended, no later request checks again.
    if (ending) return ending
    timedRead ??= startTimedRead()
    const receipts = await timedRead
    // The refusal may have been claimed by a request that shared this read while this one waited.
    if (ending) return ending
    // No answer in time, or a read that failed to look (a file shortage, EIO): nothing is known, so only this request fails and the bridge stays up.
    if (receipts === undefined || receipts.answer === 'no-answer')
      throw new Error('Codebook setup check did not answer.')
    if (receipts.answer === 'stands') return true
    process.exitCode = 1
    // Claimed in one synchronous step after the read: every request that waited on it awaits this one write, so one line is written and no shutdown runs before it is out.
    ending = writeRefusalLine(
      `${receipts.answer === 'replaced' ? replacedLine(cwd) : notSetUpLine(cwd)}\n`,
    ).then(() => false)
    return ending
  }
  return check
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
 * Before any request it requires the setup receipts of the descriptor's installation ({@link checkDevinBridgeReceipts}), a check bounded by the remaining startup time (at least {@link WORKSPACE_RESOLVE_FLOOR_MS}).
 * @returns `connected` once the transport is up; `stopped` when Devin ended the bridge during the first handshake, or its input stayed at the startup input limit for {@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS} counted from the first attempt that reached it, unless this attempt's own time limit ended first (cut, its session released, `onClosed` called); `not-set-up` after a pause when the descriptor names no installation or the receipts check observed the setup removed; `unverified` after a pause when the receipts check did not answer in time or answered `no-answer`; `replaced` after a pause when the receipts check answered `replaced`; otherwise {@link outcomeOfConnectFailure}'s outcome for a connection that failed, after a pause unless it is `dropped`.
 * @example
 * await connectOnce(selection, Date.now() + 15_000, expected) // => 'connected'
 */
async function connectOnce(
  selection: DevinDescriptorSelection,
  deadline: number,
  expected: DescriptorExpectation,
  onClosed: (() => void) | undefined,
  cwd: string,
): Promise<ConnectOutcome> {
  // A selection without an installation id has no setup to bind: no check can confirm one, so it waits for setup to mark the descriptor and is selected again then.
  const installationId = selection.devinSetupInstallation
  if (!installationId) {
    await pauseBeforeRetry(deadline)
    return 'not-set-up'
  }
  // The last check before an MCP session: the setup the descriptor was marked for must still stand. It is bounded like every other wait: a check that does not answer in time is transient, never a missing setup; one that answered and failed counts like an unmarked descriptor, so the bridge keeps polling until its deadline, then names the missing setup. A check that stands confirms `installationId`, which every later check and the connection's own descriptor read are bound to.
  const binding = bindingOfSelection(selection)
  const receipts = await receiptsAnswerWithin(
    selection.descriptorPath,
    binding,
    Math.max(WORKSPACE_RESOLVE_FLOOR_MS, deadline - Date.now()),
  )
  if (receipts?.answer !== 'stands') {
    await pauseBeforeRetry(deadline)
    return outcomeOfReceipts(receipts)
  }
  // One check for both hooks, so a refusal and an expired session that happen together share its answer and its line.
  const setupCheck = setupCheckBeforeReconnect(
    selection.descriptorPath,
    binding,
    cwd,
  )
  try {
    const served = await runCursorMcpBridge(
      selection.descriptorPath,
      Math.max(DEVIN_CONNECT_FLOOR_MS, deadline - Date.now()),
      // The connection's own read compares with the id the check confirmed.
      { ...expected, devinSetupInstallation: installationId },
      { name: DEVIN_BRIDGE_HEADER_NAME, value: DEVIN_BRIDGE_HEADER_VALUE },
      onClosed,
      setupCheck,
      setupCheck,
    )
    // Devin ended the bridge during the first handshake, which was cut and its session released; `onClosed` already ran, so nothing more starts.
    if (served === 'stopped') return 'stopped'
    process.stderr.write(
      `Codebook bridge: instance ${selection.instanceId}, workspace ${selection.workspace}\n`,
    )
    return 'connected'
  } catch (error) {
    const outcome = outcomeOfConnectFailure(error, deadline - Date.now())
    // Every outcome but a dropped descriptor scans again, after a pause.
    if (outcome !== 'dropped') await pauseBeforeRetry(deadline)
    return outcome
  }
}

/**
 * Names what a failed connection means for the attempt; called by {@link connectOnce} when {@link runCursorMcpBridge} threw.
 * @param error - What the connection threw.
 * @param remainingMs - The startup time left (negative once the deadline passed).
 * @returns `dropped` when no time remains; `remarked` when the connection's descriptor read found only the mark changed ({@link DescriptorMarkChangedError}); `unread` when that read met a file shortage ({@link DescriptorShortageError}); `busy` when the server answered 429, refused or reset the connection, or the request met a file shortage ({@link isTransientFailure}); `dropped` for any other failure (a handshake that does not finish in time included, and a descriptor whose endpoint, instance, pid or workspace changed).
 * @example
 * outcomeOfConnectFailure(new DescriptorShortageError(), 5_000) // => 'unread'
 * outcomeOfConnectFailure(new DescriptorShortageError(), 0)     // => 'dropped'
 */
function outcomeOfConnectFailure(
  error: unknown,
  remainingMs: number,
): 'remarked' | 'unread' | 'busy' | 'dropped' {
  if (remainingMs <= 0) return 'dropped'
  // Setup marked the descriptor again after the check: only its mark changed, so the window is looked up and checked again.
  if (error instanceof DescriptorMarkChangedError) return 'remarked'
  // The read learned nothing about the descriptor, so it is read again, at the endpoint and instance this attempt selected.
  if (error instanceof DescriptorShortageError) return 'unread'
  return isTransientFailure(error) ? 'busy' : 'dropped'
}

/** What one {@link connectOnce} attempt came to; see its `@returns`. */
type ConnectOutcome =
  | 'connected'
  | 'stopped'
  | 'busy'
  | 'dropped'
  | 'not-set-up'
  | 'unverified'
  | 'remarked'
  | 'replaced'
  | 'unread'

/**
 * Waits {@link TRANSIENT_RETRY_PAUSE_MS}, or less when the startup deadline is nearer; called by {@link connectOnce} before every outcome that scans again.
 * @param deadline - When the startup wait ends (epoch milliseconds).
 * @example
 * await pauseBeforeRetry(Date.now() + 15_000)
 */
async function pauseBeforeRetry(deadline: number): Promise<void> {
  const remaining = deadline - Date.now()
  if (remaining > 0) await sleep(Math.min(TRANSIENT_RETRY_PAUSE_MS, remaining))
}

/**
 * Names what a receipts check that did not stand means for the attempt; called by {@link connectOnce}.
 * @param receipts - The check's answer, `undefined` when it did not answer in time.
 * @returns `not-set-up` for an observed removal, `unverified` when nothing was learned (no answer in time or `no-answer`), `replaced` for a descriptor that changed since the selection.
 * @example
 * outcomeOfReceipts({ answer: 'no-answer' }) // => 'unverified'
 */
function outcomeOfReceipts(
  receipts: DevinBridgeReceiptsAnswer | undefined,
): 'not-set-up' | 'unverified' | 'replaced' {
  if (receipts?.answer === 'removed') return 'not-set-up'
  return receipts === undefined || receipts.answer === 'no-answer'
    ? 'unverified'
    : 'replaced'
}

/**
 * The refusal for a connected bridge whose window's setup was replaced by another installation after it connected; written by {@link setupCheckBeforeReconnect}, which then ends the bridge with exit code 1.
 * @param cwd - The bridge's working folder, as Devin Desktop started it.
 * @returns One fixed recovery sentence without descriptor contents; it does not say that AI chat is not set up.
 * @example replacedLine('/repo') // => "Codebook's AI chat setup for /repo changed in this Devin Desktop window after this bridge connected. Reload the window."
 */
function replacedLine(cwd: string): string {
  return `Codebook's AI chat setup for ${cwd} changed in this Devin Desktop window after this bridge connected. Reload the window.`
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
 * Each connection attempt (the descriptor read and the whole handshake) is bounded by the remaining startup deadline, but never by less than {@link DEVIN_CONNECT_FLOOR_MS}: the bridge's total time can exceed the 15 s startup window by that floor, and after the deadline at most one more attempt starts in total, however many descriptors remain. The connection reads the descriptor again and refuses it when it is no longer the one selected (see {@link devinDescriptorExpectation}). A chosen descriptor whose server fails is dropped and the deadline keeps running for a fresh one; a busy or restarting server (HTTP 429, ECONNREFUSED, ECONNRESET, or a file shortage while connecting) is asked again after a short pause until the deadline, at the endpoint the descriptor names by then. A descriptor whose setup mark or receipts the bridge waits for, that was marked again, or whose read met a file shortage (EMFILE, ENFILE) is asked again only with the endpoint and instance it was first selected with. Nothing reaches stdout (the MCP channel) before the transport is up, and no message holds the token.
 * Once its input reached {@link BRIDGE_STARTUP_INPUT_LIMIT_BYTES} the bridge no longer sees Devin close it, so it ends as stopped once {@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS} passed since its first attempt reached that limit, across its retries and also while Devin is still connected; when that wait ends while it waits between two attempts, where no timer runs, it ends as stopped at its next attempt, or, when no attempt follows, with its refusal line (exit code 1) once its startup window ends; an attempt's own time limit or the end of the selection that comes first keeps its outcome, and the one attempt allowed after the deadline can still connect, stop at that wait's end, or fail (Cycle 0147 task 8; Cycle 0147 review round).
 *
 * @param agentDir - Folder holding the window instances' connection descriptors.
 * @param cwd - Working folder of the bridge process; the window's workspace.
 * @param env - Environment; `WINDSURF_EXT_HOST_PID` names the extension host.
 * @param options - Polling limits of {@link selectDevinDescriptor}; tests shorten them.
 * @returns
 * - `undefined` once the transport is connected, or once Devin ended the bridge during its first handshake or its input stayed at the startup input limit for the whole wait (its `onClosed` has run then)
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
    // What the last attempt found, and at which descriptor: a removed setup makes the refusal at the end of the wait name the missing setup, not a missing Codebook.
    wait: BridgeWait = {
      isSetupMissing: false,
      isSetupUnverified: false,
      attemptPath: undefined,
    },
    // The endpoint and instance of each descriptor path an attempt waited on for its setup, its receipts, its mark or a file shortage: a later selection of that path must name the same ones, so a port rewritten during the wait is never accepted for this window.
    pinned = new Map<string, PinnedIdentity>()
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
    // A pinned descriptor that now names another endpoint or instance is not this window's selection any more, whatever its mark says: another descriptor may still connect.
    if (hasPinnedIdentityChanged(pinned, selection)) {
      excludeChangedPin(selection, excludedPaths, wait)
      continue
    }
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
    // Connected, or ended by Devin during the first handshake: nothing is left to try.
    if (outcome === 'connected' || outcome === 'stopped') return undefined
    noteConnectOutcome(outcome, selection, excludedPaths, wait, pinned)
  }
}

/** The endpoint and instance a descriptor had when an attempt at it first waited for its setup, its receipts, its mark or a file shortage. */
interface PinnedIdentity {
  instanceId: string
  url: string
}

/** What the last connection attempt of a bridge's wait found; kept by {@link noteConnectOutcome} and {@link excludeChangedPin}, read by {@link endOfWaitLine}. */
interface BridgeWait {
  /** The last attempt found its descriptor's setup missing or removed. */
  isSetupMissing: boolean
  /** The last attempt could not read the setup records. */
  isSetupUnverified: boolean
  /** The descriptor path of the last attempt, which the two flags are about; `undefined` before the first attempt. */
  attemptPath: string | undefined
}

/**
 * Excludes a pinned descriptor whose endpoint or instance changed, and drops the missing-setup status its own last attempt left; called by {@link runDevinMcpBridge} when {@link hasPinnedIdentityChanged} holds.
 * That status was about the identity just rejected, which the descriptor no longer names (its replacement may be marked), so a wait that ends without another match says Codebook is not running instead of asking for setup. A status another descriptor left stays, as does `isSetupUnverified`: nothing was checked since.
 * @param selection - The pinned descriptor whose identity changed.
 * @param excludedPaths - The descriptors the selection skips from now on; this one is added.
 * @param wait - The wait's state.
 * @example
 * excludeChangedPin(selection, excludedPaths, { isSetupMissing: true, isSetupUnverified: false, attemptPath: selection.descriptorPath })
 * // excludedPaths now holds that path, and the wait's isSetupMissing is false
 */
function excludeChangedPin(
  selection: DevinDescriptorSelection,
  excludedPaths: Set<string>,
  wait: BridgeWait,
): void {
  excludedPaths.add(selection.descriptorPath)
  // Only the status this descriptor's own attempt left is about the identity just rejected.
  if (wait.attemptPath === selection.descriptorPath) wait.isSetupMissing = false
}

/**
 * Says whether a selected descriptor that an earlier attempt pinned now names another endpoint or instance; called by {@link runDevinMcpBridge} for each selection, before its mark is looked at.
 * @param pinned - The identities pinned by {@link noteConnectOutcome}, by descriptor path.
 * @param selection - The descriptor just selected.
 * @returns `true` when the path was pinned and the selection's instance id or url differs; `false` otherwise.
 * @example
 * hasPinnedIdentityChanged(new Map(), selection) // => false
 */
function hasPinnedIdentityChanged(
  pinned: ReadonlyMap<string, PinnedIdentity>,
  selection: DevinDescriptorSelection,
): boolean {
  const identity = pinned.get(selection.descriptorPath)
  return (
    identity !== undefined &&
    (identity.instanceId !== selection.instanceId ||
      identity.url !== selection.url)
  )
}

/** The outcomes after which the bridge waits on something other than a busy server (the setup mark, the receipts, a new mark or a file shortage), so a later selection of that descriptor path must keep the endpoint and instance this attempt selected; read by {@link noteConnectOutcome}. */
const PINNING_OUTCOMES: ReadonlySet<ConnectOutcome> = new Set([
  'not-set-up',
  'unverified',
  'remarked',
  'replaced',
  'unread',
])

/**
 * Records what a failed connection attempt means for the rest of the wait; called by {@link runDevinMcpBridge} after each {@link connectOnce} that did not connect.
 * A dropped descriptor is not selected again. After {@link PINNING_OUTCOMES} it is, but only with the endpoint and instance of the first such attempt (a pin is never overwritten); `busy` pins nothing, so a restarting server is followed to its new port. `wait` follows the last outcome: `isSetupMissing` is set by `not-set-up` and `isSetupUnverified` by `unverified`, each cleared by any other, so a wait that ends after a later attempt was dropped, busy, replaced, remarked or unread says Codebook is not running; `attemptPath` names the attempted descriptor, so {@link excludeChangedPin} can tell whose status it is.
 * @param outcome - The attempt's outcome.
 * @param selection - The attempted descriptor.
 * @param excludedPaths - The descriptors the selection skips from now on.
 * @param wait - The wait's state.
 * @param pinned - The identities later selections of a pinned descriptor path must keep.
 * @example noteConnectOutcome('dropped', selection, excludedPaths, wait, pinned) // excludedPaths now holds that path
 * @example noteConnectOutcome('unread', selection, excludedPaths, wait, pinned) // pinned now holds that path's instance id and url
 */
function noteConnectOutcome(
  outcome: Exclude<ConnectOutcome, 'connected' | 'stopped'>,
  selection: DevinDescriptorSelection,
  excludedPaths: Set<string>,
  wait: BridgeWait,
  pinned: Map<string, PinnedIdentity>,
): void {
  if (outcome === 'dropped') excludedPaths.add(selection.descriptorPath)
  // The first pin of a path stays: every later attempt at it was made with that same identity.
  if (PINNING_OUTCOMES.has(outcome) && !pinned.has(selection.descriptorPath))
    pinned.set(selection.descriptorPath, {
      instanceId: selection.instanceId,
      url: selection.url,
    })
  wait.isSetupMissing = outcome === 'not-set-up'
  wait.isSetupUnverified = outcome === 'unverified'
  wait.attemptPath = selection.descriptorPath
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
 * @param wait - The wait's state: whether the last attempt found a descriptor's setup removed or could not verify it.
 * @returns {@link notSetUpLine} when a descriptor's setup was removed, {@link unverifiedLine} when its receipts could not be read, else {@link notRunningLine}.
 * @example endOfWaitLine('/repo', { isSetupMissing: true, isSetupUnverified: false }) // => notSetUpLine('/repo')
 */
function endOfWaitLine(
  cwd: string,
  wait: Readonly<Pick<BridgeWait, 'isSetupMissing' | 'isSetupUnverified'>>,
): string {
  if (wait.isSetupMissing) return notSetUpLine(cwd)
  return wait.isSetupUnverified ? unverifiedLine(cwd) : notRunningLine(cwd)
}

/**
 * The refusal for a wait that ended while the setup records of a running Codebook could not be read; returned by {@link endOfWaitLine}.
 * @param cwd - The bridge's working folder.
 * @returns One fixed recovery sentence without descriptor contents; it does not say that Codebook is not running.
 * @example unverifiedLine('/repo') // => 'Codebook could not check the AI chat setup for /repo in this Devin Desktop window, because its setup records could not be read. Reload the window to try again.'
 */
function unverifiedLine(cwd: string): string {
  return `Codebook could not check the AI chat setup for ${cwd} in this Devin Desktop window, because its setup records could not be read. Reload the window to try again.`
}
