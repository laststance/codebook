import { lstat } from 'node:fs/promises'

import { z } from 'zod'

import {
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS,
  WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS,
  WIKI_UPDATE_MARKER_WRITE_GRACE_MS,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
} from '../constants'

import { canJudgeOwnerHere } from './canJudgeOwnerHere'
import { currentStorageOwner } from './currentStorageOwner'
import { isProcessGone } from './isProcessGone'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { StorageOwnerIdentity } from './readRecordedOwner'
import { readWikiRegularFile } from './readWikiRegularFile'

/** What a running Wiki update writes beside the output folder: who runs it and since when. */
const wikiUpdateMarkerSchema = z.object({
  /** Process id of the extension host that runs the update. */
  pid: z.number().int().positive(),
  /** Random id of the editor window's activation; two windows of one test process share a pid, never this. */
  windowId: z.string().min(1),
  host: z.enum(['vscode', 'cursor']),
  /** When the run started (epoch milliseconds). */
  startedAtMs: z.number(),
  /** Set on the reservation a stopped VS Code watch leaves in place of its run's marker: when the watch ended (epoch milliseconds). The chat may still publish until the watch bound after it; absent while the run lasts. */
  watchEndedAtMs: z.number().optional(),
  /** The two pseudonyms of the machine the update runs on ({@link deriveMachineKeys}); the marker lies in the learner's project folder and never names the computer. Absent in a marker of 0.2.29.0. */
  machineKey: z.string().min(1).optional(),
  hostKey: z.string().min(1).optional(),
  /** The kernel's id of the boot the update runs under, where the system publishes one; a boot written in another form is read as none. */
  boot: z
    .object({ id: z.string().min(1) })
    .optional()
    .catch(undefined),
  /** When the extension host's process began ({@link readProcessStart}); absent in a marker of 0.2.29.0 and in one of a window whose start could not be read. */
  processStart: z.string().min(1).optional(),
})

/** The marker of a Wiki update that is running in some editor window, or the reservation its stopped watch left. */
export type WikiUpdateMarker = z.infer<typeof wikiUpdateMarkerSchema>

/** A marker file that has no readable content yet: another window created it a moment ago (epoch milliseconds) and is writing it. @example const starting: WikiUpdateMarkerBeingWritten = { beingWrittenSinceMs: 1790000000000 } */
export type WikiUpdateMarkerBeingWritten = { beingWrittenSinceMs: number }

/**
 * What one look at the marker file found, by its kind, so that a caller removes only what the look read as nobody's:
 * `none` (no entry at the marker's path), `unowned` (a marker nobody's update owns), `being-written` (a file whose content another window is writing right now) and `live` (another window's running update, or the reservation its stopped watch left).
 * @example const look: WikiUpdateMarkerLook = { kind: 'live', heldBy: { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 } }
 */
export type WikiUpdateMarkerLook =
  | { kind: 'none' }
  | { kind: 'unowned' }
  | { kind: 'being-written'; heldBy: WikiUpdateMarkerBeingWritten }
  | { kind: 'live'; heldBy: WikiUpdateMarker }

/** What a look judges a marker's owner by: the identity of this process, the reader of the start of the process that has the owner's id now, and the present (epoch milliseconds). */
export type WikiUpdateMarkerJudgement = {
  identity: StorageOwnerIdentity
  readStart: ProcessStartReader
  nowMs: number
}

/**
 * Parses the bytes of a marker file; called by {@link readLiveWikiUpdateMarker} for the file it found.
 * @param bytes - The bytes of `<output>.update-run.json`.
 * @returns The marker, or `undefined` for bytes that are no JSON or do not have the marker's shape.
 * @example
 * parseWikiUpdateMarker(Buffer.from('{"pid":4242,"windowId":"3f6c","host":"vscode","startedAtMs":1790000000000}'))
 * // => { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 }
 */
function parseWikiUpdateMarker(bytes: Buffer): WikiUpdateMarker | undefined {
  let content: unknown
  try {
    content = JSON.parse(bytes.toString('utf8'))
  } catch {
    return undefined
  }
  const marker = wikiUpdateMarkerSchema.safeParse(content)
  return marker.success ? marker.data : undefined
}

/**
 * Says whether a run's marker is older than any run can be; called by {@link isLiveMarkerOfAnotherWindow} before the marker's owner is looked at, so a marker whose owner cannot be judged here stops counting at a known time.
 * Limit: the bound allows the clocks of the writer and the reader to differ by {@link WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS}; a clock that moves further during an update, or a computer asleep for longer, can let a second update start beside a running one.
 * @param marker - The marker beside the Wiki.
 * @param nowMs - The present (epoch milliseconds).
 * @returns `true` for a marker of a run (no `watchEndedAtMs`) that started longer ago than the host's longest run plus {@link WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS} and the clock tolerance: the Cursor agent's bound, or the chat's opening and the watch's bound in VS Code. `false` otherwise, also for every reservation of a stopped watch, which the caller weighs against the watch bound.
 * @example
 * isRunMarkerExpired({ pid: 4242, windowId: '3f6c', host: 'cursor', startedAtMs: 0 }, 1_261_000) // => true
 * isRunMarkerExpired({ pid: 4242, windowId: '3f6c', host: 'cursor', startedAtMs: 0 }, 1_260_000) // => false
 */
function isRunMarkerExpired(marker: WikiUpdateMarker, nowMs: number): boolean {
  const longestRunMs =
    marker.host === 'cursor'
      ? WIKI_CURSOR_UPDATE_TIMEOUT_MS
      : WIKI_CHAT_OPEN_TIMEOUT_MS + WIKI_UPDATE_WATCH_TIMEOUT_MS
  return (
    marker.watchEndedAtMs === undefined &&
    nowMs >
      marker.startedAtMs +
        longestRunMs +
        WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS +
        WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS
  )
}

/**
 * Says whether a marker was written under the boot this process runs under, where the system names its boots; called by {@link isVerifiedLiveOwner}.
 * Why: a process start that counts from the boot (Linux) can repeat after a restart, with the same process id, so there only a marker of this boot is verified by its start.
 * @param marker - The marker beside the Wiki.
 * @param identity - The identity of this process.
 * @returns `true` where this process knows no kernel boot id (a start there is a time of day), and for a marker that records this boot's id; `false` for a marker of another boot or without one.
 * @example
 * isRecordedUnderThisBoot({ pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 0, boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } }) // => false
 */
function isRecordedUnderThisBoot(
  marker: WikiUpdateMarker,
  identity: StorageOwnerIdentity,
): boolean {
  const ownBoot = identity.boot
  return !(ownBoot && 'id' in ownBoot) || marker.boot?.id === ownBoot.id
}

/**
 * Says whether a marker's owner can be proven to run here at all, before its process start is read; called by {@link isVerifiedLiveOwner}.
 * @param marker - The marker beside the Wiki.
 * @param identity - The identity of this process.
 * @returns `true` when this process can judge the owner ({@link canJudgeOwnerHere}), the marker is of this boot ({@link isRecordedUnderThisBoot}) and a process has the owner's id; `false` otherwise.
 * @example
 * mayOwnerBeVerifiedHere({ pid: process.pid, windowId: '3f6c', host: 'vscode', startedAtMs: 0, hostKey: 'd195d36bd79da7df', processStart: 'linux:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux:200' }) // => true
 */
function mayOwnerBeVerifiedHere(
  marker: WikiUpdateMarker,
  identity: StorageOwnerIdentity,
): boolean {
  return (
    canJudgeOwnerHere(marker, identity) &&
    isRecordedUnderThisBoot(marker, identity) &&
    !isProcessGone(marker.pid)
  )
}

/**
 * Says whether the marker's owner is proven to run on this machine now: the process that has its id began when the marker says; called by {@link mayMarkerOwnerRun} before the marker's start time is weighed, so a clock that was set back during an update does not unseat the running window.
 * @param marker - The marker beside the Wiki.
 * @param judgement - The identity of this process and the reader of process starts.
 * @returns `true` when the owner can be verified here ({@link mayOwnerBeVerifiedHere}) and the start of the process that has its id equals the recorded one; `false` otherwise, also when that start cannot be read.
 * @example
 * await isVerifiedLiveOwner({ pid: process.pid, windowId: '3f6c', host: 'vscode', startedAtMs: 0, hostKey: 'd195d36bd79da7df', processStart: 'linux:100' }, { identity: { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux:100' }, readStart: async () => 'linux:100', nowMs: 0 }) // => true
 */
async function isVerifiedLiveOwner(
  marker: WikiUpdateMarker,
  { identity, readStart }: WikiUpdateMarkerJudgement,
): Promise<boolean> {
  const { pid, processStart } = marker
  if (processStart === undefined || !mayOwnerBeVerifiedHere(marker, identity))
    return false
  const liveStart = await readStart(pid, { expectedStart: processStart })
  return liveStart === processStart
}

/**
 * Says whether the process a marker names no longer exists; called by {@link mayMarkerOwnerRun} for a marker that is neither verified nor ahead of the clock.
 * A marker of this build names its machine by pseudonyms and is judged like every owner record ({@link isRecordedOwnerGone}): one of another machine, of another system or pid namespace of this computer, of a Linux window whose pid namespace could not be read, or of a window whose own process start could not be read (its marker records none) is never gone by its process id here and counts until it expires; the last is gone only when it was recorded under another kernel boot id. A marker of 0.2.29.0 names no machine, and its process id is probed here, as that build does.
 * Limit: two computers with one host name look like one, so a process id of the other is probed here.
 * @param marker - The marker beside the Wiki.
 * @param judgement - The identity of this process and the reader of process starts.
 * @returns `true` for an owner of this machine that recorded its process start and whose process id names no process or whose process began at another time than recorded, and for one recorded under another kernel boot; `false` while the owner may run, also one this user may not signal.
 * @example
 * await isMarkerOwnerGone({ pid: 2 ** 22 + 1, windowId: '3f6c', host: 'vscode', startedAtMs: 0 }, judgement) // => true where no such process exists
 */
async function isMarkerOwnerGone(
  marker: WikiUpdateMarker,
  { identity, readStart }: WikiUpdateMarkerJudgement,
): Promise<boolean> {
  // A marker of 0.2.29.0 has no pseudonym of its machine.
  if (marker.machineKey === undefined && marker.hostKey === undefined)
    return isProcessGone(marker.pid)
  return isRecordedOwnerGone(marker, identity, readStart)
}

/**
 * Says whether a marker names a time that lies further ahead than two clocks may differ: its run starts, or the watch of its reservation ended, more than {@link WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS} ahead of now; called by {@link mayMarkerOwnerRun} after the proof of a running owner.
 * Why: a run's marker stops counting when it expires ({@link isRunMarkerExpired}), and a reservation when the watch bound after its end is over, so a time far ahead would count for good. A marker file a repository supplies could then refuse a start with a sentence that names a chat that never existed.
 * @param marker - The marker beside the Wiki.
 * @param nowMs - The present (epoch milliseconds).
 * @returns `true` when `startedAtMs`, or `watchEndedAtMs` where the marker is a reservation, is later than now plus the tolerance; `false` otherwise.
 * @example
 * isFromTooFarAhead({ pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 0, watchEndedAtMs: 4_102_444_800_000 }, 1_790_000_000_000) // => true
 * isFromTooFarAhead({ pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1_790_000_300_000 }, 1_790_000_000_000)                    // => false
 */
function isFromTooFarAhead(marker: WikiUpdateMarker, nowMs: number): boolean {
  const latestTimeMs = Math.max(
    marker.startedAtMs,
    marker.watchEndedAtMs ?? marker.startedAtMs,
  )
  return latestTimeMs > nowMs + WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS
}

/**
 * Keeps a stopped VS Code watch's reservation inside its existing time bound; called by {@link mayMarkerOwnerRun} after the future-clock check, including when its process ended and a reload lost the workspace record.
 * @param marker - The host and stopped-watch time the marker records.
 * @param nowMs - The asking window's current epoch milliseconds.
 * @returns `true` for a stopped VS Code watch before its bound; `false` for a running marker, another host or an expired reservation.
 * @example isStoppedWatchInsideBound({ host: 'vscode', watchEndedAtMs: 1_000 }, 1_001) // => true
 */
function isStoppedWatchInsideBound(
  marker: Pick<WikiUpdateMarker, 'host' | 'watchEndedAtMs'>,
  nowMs: number,
): boolean {
  return (
    marker.host === 'vscode' &&
    marker.watchEndedAtMs !== undefined &&
    nowMs < marker.watchEndedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS
  )
}

/**
 * Says whether the owner of another window's marker may still run, by the rules that look at the owner; called by {@link isLiveMarkerOfAnotherWindow} for a marker that is not expired.
 * The rules, in this order: a marker whose owner is proven to run here counts, whatever its times say ({@link isVerifiedLiveOwner}); a marker whose run starts, or whose stopped watch ended, more than {@link WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS} ahead of now is nobody's ({@link isFromTooFarAhead}: a file a repository supplies cannot refuse every start); a stopped VS Code watch's reservation still inside its bound counts even after the extension host ended, because the reload may have no stored record of that chat; every other marker counts until its owner is gone ({@link isMarkerOwnerGone}).
 * @param marker - The marker beside the Wiki.
 * @param judgement - The identity of this process, the reader of process starts and the present.
 * @returns `true` while the owner may run or a stopped VS Code watch's reservation remains inside its bound; `false` for a marker from too far ahead without a proven owner and for an ended owner without such a reservation.
 * @example
 * await mayMarkerOwnerRun({ pid: 2 ** 22 + 1, windowId: 'other', host: 'vscode', startedAtMs: Date.now() }, judgement) // => false where no such process exists
 */
async function mayMarkerOwnerRun(
  marker: WikiUpdateMarker,
  judgement: WikiUpdateMarkerJudgement,
): Promise<boolean> {
  // A running window of this machine is looked at before its times: a clock set back during its update makes them lie ahead.
  if (await isVerifiedLiveOwner(marker, judgement)) return true
  if (isFromTooFarAhead(marker, judgement.nowMs)) return false
  // A stopped watch's reservation stands for its chat, including after a reload lost the workspace record and replaced the extension host.
  if (isStoppedWatchInsideBound(marker, judgement.nowMs)) return true
  return !(await isMarkerOwnerGone(marker, judgement))
}

/**
 * Says whether a marker stands for an update that still counts against the asking window; called by {@link lookAtReadableMarker}.
 * This window's own marker is a leftover, and a run's marker older than any run is nobody's ({@link isRunMarkerExpired}); neither asks for the owner's process. Every other marker follows {@link mayMarkerOwnerRun}, including a stopped VS Code watch's bounded reservation after its process ended.
 * @param marker - The marker beside the Wiki.
 * @param ownWindowId - The asking window's own id.
 * @param judgement - The identity of this process, the reader of process starts and the present.
 * @returns `true` for another window's marker that still counts; `false` for this window's own and for one that is nobody's by the rules above.
 * @example
 * await isLiveMarkerOfAnotherWindow({ pid: process.pid, windowId: 'other', host: 'vscode', startedAtMs: Date.now() }, 'own', judgement) // => true
 */
async function isLiveMarkerOfAnotherWindow(
  marker: WikiUpdateMarker,
  ownWindowId: string,
  judgement: WikiUpdateMarkerJudgement,
): Promise<boolean> {
  if (
    marker.windowId === ownWindowId ||
    isRunMarkerExpired(marker, judgement.nowMs)
  )
    return false
  return mayMarkerOwnerRun(marker, judgement)
}

/**
 * Names what a readable marker is for the asking window, with the owner judged by what the caller named or by the real identity and reader; called by {@link readLiveWikiUpdateMarker}.
 * @param marker - The marker beside the Wiki.
 * @param ownWindowId - The asking window's own id.
 * @param judgement - The present, and the identity and the reader of process starts where the caller named them.
 * @returns `live` with the marker when it still counts ({@link isLiveMarkerOfAnotherWindow}); `unowned` otherwise.
 * @example
 * await lookAtReadableMarker({ pid: process.pid, windowId: 'other', host: 'vscode', startedAtMs: Date.now() }, 'own', { nowMs: Date.now() })
 * // => { kind: 'live', heldBy: { pid: 4242, windowId: 'other', host: 'vscode', startedAtMs: 1790000000000 } }
 */
async function lookAtReadableMarker(
  marker: WikiUpdateMarker,
  ownWindowId: string,
  judgement: Partial<WikiUpdateMarkerJudgement> &
    Pick<WikiUpdateMarkerJudgement, 'nowMs'>,
): Promise<WikiUpdateMarkerLook> {
  const isLive = await isLiveMarkerOfAnotherWindow(marker, ownWindowId, {
    identity: judgement.identity ?? (await currentStorageOwner()),
    readStart: judgement.readStart ?? readProcessStart,
    nowMs: judgement.nowMs,
  })
  return isLive ? { kind: 'live', heldBy: marker } : { kind: 'unowned' }
}

/**
 * Names what an entry at the marker's path is that holds no readable marker: one another window is writing at this moment, or one nobody owns; called by {@link readLiveWikiUpdateMarker} for an empty or unparseable file and by {@link lookAtUnreadableEntry}.
 * Why: a window of 0.2.29.0, and a window on a file system that cannot link, creates the marker and then writes it, so for the time of one write the file is empty. A window that took it for nobody's would remove it and start beside its writer.
 * @param modifiedAtMs - When the entry was last written (epoch milliseconds).
 * @param nowMs - The present (epoch milliseconds).
 * @returns `being-written` for an entry written less than {@link WIKI_UPDATE_MARKER_WRITE_GRACE_MS} ago and not more than {@link WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS} ahead of now; `unowned` for an older one (a killed window left it) and for one written further ahead.
 * @example
 * lookAtMarkerWithoutContent(1_790_000_000_000, 1_790_000_001_000) // => { kind: 'being-written', heldBy: { beingWrittenSinceMs: 1_790_000_000_000 } }
 * lookAtMarkerWithoutContent(1_790_000_000_000, 1_790_000_002_000) // => { kind: 'unowned' }
 */
function lookAtMarkerWithoutContent(
  modifiedAtMs: number,
  nowMs: number,
): WikiUpdateMarkerLook {
  const isBeingWritten =
    modifiedAtMs > nowMs - WIKI_UPDATE_MARKER_WRITE_GRACE_MS &&
    modifiedAtMs <= nowMs + WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS
  return isBeingWritten
    ? { kind: 'being-written', heldBy: { beingWrittenSinceMs: modifiedAtMs } }
    : { kind: 'unowned' }
}

/**
 * Tells a marker path that holds nothing from one that holds an entry no marker can be read from (a link, a folder, a file that cannot be opened or is too large); called by {@link readLiveWikiUpdateMarker} when the marker file could not be read.
 * Why: nothing is removed where no marker is, because another window may write its marker there at that moment; an entry that is in the way and is no marker is still removed as nobody's, so a path a repository supplies cannot refuse every start.
 * @param markerPath - `<output>.update-run.json`.
 * @param nowMs - The present (epoch milliseconds).
 * @returns `none` when no entry is at the path, or the path cannot be inspected; otherwise what the entry's age says ({@link lookAtMarkerWithoutContent}).
 * @example
 * await lookAtUnreadableEntry('/repo/.codebook/wiki.update-run.json', Date.now()) // => { kind: 'none' }
 */
async function lookAtUnreadableEntry(
  markerPath: string,
  nowMs: number,
): Promise<WikiUpdateMarkerLook> {
  const entry = await lstat(markerPath).catch(() => undefined)
  return entry
    ? lookAtMarkerWithoutContent(entry.mtimeMs, nowMs)
    : { kind: 'none' }
}

/**
 * Looks at the marker another editor window's Wiki update left beside the Wiki and names what it found, so a second window does not start a second update of the same Wiki and removes only a marker that is nobody's.
 *
 * Why: each window holds its own run state, and until the first window's agent stages a candidate nothing else on disk shows its run. A marker records its owner's machine by two pseudonyms, its process id, its kernel boot id and its process start, so a marker a killed editor left is told from a running window's even when another process has its id, and a marker of another machine is not judged by a process id of this one.
 * Trigger: the extension reads it when an update starts, before the candidate rule, and {@link claimWikiUpdateMarker} when its exclusive creation finds a marker in the way and again under its claim.
 * Limits: with a window of 0.2.29.0 on the same project folder the marker is judged as that build writes it, by its process id alone. Machines whose clocks differ by more than {@link WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS} are not protected from each other by a marker.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param ownWindowId - The asking window's own id; its own marker is a leftover of a run that already ended and is nobody's.
 * @param judgement - What the owner is judged by; this process's identity ({@link currentStorageOwner}), {@link readProcessStart} and the clock unless a caller or a test names its own.
 * @returns
 * - `live`: another window's marker that still counts ({@link isLiveMarkerOfAnotherWindow}), including a stopped VS Code watch's reservation inside its bound after its process ended; in `heldBy`, with `watchEndedAtMs` for the caller's reservation check
 * - `being-written`: a file without readable content that was written a moment ago, with that time in `heldBy`
 * - `unowned`: this window's own marker, an ended owner's marker without a valid bounded reservation, a run's marker older than any run can be, one whose run starts or whose stopped watch ended too far ahead, and an entry without a readable marker that is older than a write takes
 * - `none`: no entry at the marker's path
 *
 * @example
 * ```ts
 * await readLiveWikiUpdateMarker('/repo/.codebook/wiki', windowId)
 * // => { kind: 'live', heldBy: { pid: 4242, windowId: '3f6c…', host: 'vscode', startedAtMs: 1790000000000, hostKey: 'd195d36bd79da7df', … } }
 * ```
 */
export async function readLiveWikiUpdateMarker(
  outputDirectory: string,
  ownWindowId: string,
  judgement: Partial<WikiUpdateMarkerJudgement> = {},
): Promise<WikiUpdateMarkerLook> {
  const markerPath = outputDirectory + WIKI_UPDATE_RUN_MARKER_SUFFIX
  const nowMs = judgement.nowMs ?? Date.now()
  const markerFile = await readWikiRegularFile(markerPath)
  if (!markerFile) return lookAtUnreadableEntry(markerPath, nowMs)
  const marker = parseWikiUpdateMarker(markerFile.bytes)
  // A file without a marker's content is one being written, or one a killed writer left.
  if (!marker) return lookAtMarkerWithoutContent(markerFile.modifiedAtMs, nowMs)
  return lookAtReadableMarker(marker, ownWindowId, { ...judgement, nowMs })
}
