import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ChromeExtensionHistoryWriter } from './chromeExtensionHistoryWriter'
import {
  EXTENSION_HISTORY_FRAMES_DIRECTORY,
  EXTENSION_HISTORY_PIN_RESERVE_BYTES,
  EXTENSION_HISTORY_PIN_RESERVE_FRAMES,
  IMAGE_BASE64_LIMIT_CHARS,
  MAX_RECORDING_FRAMES,
  MAX_RECORDING_PENDING_BYTES,
  MAX_RECORDING_PNG_BYTES,
  PRIVATE_DIRECTORY_MODE,
  RECORDING_SAMPLE_INTERVAL_MS,
} from './constants'
import { HistoryReserveReachedError } from './nodeHistoryJournalWriter'
import { sha256 } from './runtimeSupport/utils/sha256'
import { atomicPrivateBytes } from './utils/atomicPrivateBytes'
import { readPngDimensions } from './utils/readPngDimensions'
import { removeTemporaryFrameBlobs } from './utils/removeTemporaryFrameBlobs'

/** What {@link ExtensionHistoryFrameWriter.offer} did with a frame: `ignored` is a second pin for one pause. */
export type ExtensionFrameOffer =
  'queued' | 'sampled-away' | 'dropped' | 'ignored'

/** The frame budget of one history; a test names a smaller one to reach it. */
export type ExtensionFrameBudget = {
  frames: number
  pngBytes: number
  pinReserveFrames: number
  pinReserveBytes: number
}

/** The production budget: the browser recording's bounds with the room kept for pins. */
const EXTENSION_FRAME_BUDGET: ExtensionFrameBudget = {
  frames: MAX_RECORDING_FRAMES,
  pngBytes: MAX_RECORDING_PNG_BYTES,
  pinReserveFrames: EXTENSION_HISTORY_PIN_RESERVE_FRAMES,
  pinReserveBytes: EXTENSION_HISTORY_PIN_RESERVE_BYTES,
}

/** One frame as the viewport or the run hands it over. */
type OfferedFrame = {
  data: string
  kind: 'stream' | 'pin'
  pauseId?: string
  capturedAtMs: number
}

/**
 * Stores a chrome-extension run's surface frames in its history's own folder, `frames/<sha256>.png`, and appends each frame's journal entry once its blob is durable.
 * Why: the live screencast must never wait for a disk, so {@link ExtensionHistoryFrameWriter.offer} only samples, checks the budgets and a bounded byte queue and enqueues; one serial queue writes each unique blob under a temporary name, flushes and renames it, and only then appends the `frame` entry (the order {@link RecordingWriter} keeps), deduplicating by hash.
 * Sampling is trailing-edge safe: the latest frame skipped by the sampling interval is kept pending and recorded when its interval elapses, before a pin, or when the history finalizes, so the last painted state of a burst is always recorded.
 * Budgets: {@link MAX_RECORDING_FRAMES} frames and {@link MAX_RECORDING_PNG_BYTES} of blobs, of which {@link EXTENSION_HISTORY_PIN_RESERVE_FRAMES} frames and {@link EXTENSION_HISTORY_PIN_RESERVE_BYTES} bytes only pins may use. The first stream frame a budget refuses ends the stream (the filmstrip reads incomplete); pins go on.
 * Created by {@link ChromeExtensionHistoryRecorder}; fed by the viewport's recording observer and by the run's pinned pause screenshots.
 * @example const frames = new ExtensionHistoryFrameWriter(writer); frames.offer({ data, kind: 'stream', capturedAtMs: 40 })
 */
export class ExtensionHistoryFrameWriter {
  private chain: Promise<void> = Promise.resolve()
  private pendingBytes = 0
  private lastStreamMs = -Infinity
  private readonly knownHashes = new Set<string>()
  private readonly pinnedPauses = new Set<string>()
  /** Pauses whose pin the run handed over, whatever became of it. */
  private readonly requestedPins = new Set<string>()
  /** Pauses whose pin frame entry is durable in the journal. */
  private readonly storedPins = new Set<string>()
  private frameCount = 0
  private blobBytes = 0
  private accepting = true
  /** Whether the queue was abandoned after its drain deadline: queued frames not yet started are not written. */
  private isAbandoned = false
  /** The latest stream frame the sampling interval skipped; recorded unless a newer one supersedes it. */
  private trailing?: OfferedFrame
  private trailingTimer?: ReturnType<typeof setTimeout>
  /** Whether a budget or the journal's reserve ended the stream frames; pins still go on. */
  private isStreamEnded = false
  /** Whether a stream frame was lost (a full queue, a budget, a failed store); the seal then names the filmstrip. */
  isIncomplete = false
  /** Why the first frame failed to be stored, kept for the log. */
  failure?: unknown

  constructor(
    private readonly writer: ChromeExtensionHistoryWriter,
    private readonly budget: ExtensionFrameBudget = EXTENSION_FRAME_BUDGET,
  ) {}

  /**
   * Samples one frame and enqueues it; never awaits and never throws.
   * @param frame - The base64 PNG of the frame, its kind, the pause it pins (for a pin) and when it was received on the run clock.
   * @returns `sampled-away` for a stream frame inside the sampling interval (kept as the trailing frame; no failure), `ignored` for a second pin of one pause, `dropped` when the history no longer accepts it, a budget or the full queue refuses it or it is unusable, `queued` otherwise.
   * @example frames.offer({ data: pngBase64, kind: 'stream', capturedAtMs: 120 }) // => 'queued'
   */
  offer(frame: OfferedFrame): ExtensionFrameOffer {
    if (frame.kind === 'pin' && frame.pauseId !== undefined)
      this.requestedPins.add(frame.pauseId)
    if (!this.accepting) return 'dropped'
    if (frame.kind === 'pin') {
      // The pin's moment is after every frame already seen, so the pending one is recorded first.
      this.flushTrailing()
      if (frame.pauseId === undefined) return 'dropped'
      if (this.pinnedPauses.has(frame.pauseId)) return 'ignored'
      return this.admit(frame)
    }
    if (this.isStreamEnded) return 'dropped'
    if (frame.capturedAtMs - this.lastStreamMs < RECORDING_SAMPLE_INTERVAL_MS) {
      this.keepTrailing(frame)
      return 'sampled-away'
    }
    // This frame supersedes the one the interval skipped.
    this.clearTrailing()
    return this.admit(frame)
  }

  /**
   * Records the pending trailing frame, stops taking frames and waits for the queued ones, but only until `timeoutMs`; frames still queued then are lost and the filmstrip reads incomplete.
   * @param timeoutMs - How long the queue may take to drain.
   * @returns Settles when the queue drained or the time passed; never rejects.
   * @example await frames.drain(2_000)
   */
  async drain(timeoutMs: number): Promise<void> {
    this.flushTrailing()
    this.accepting = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), timeoutMs)
      timer.unref()
    })
    const outcome = await Promise.race([
      this.chain.then(() => 'drained' as const),
      expired,
    ])
    if (timer) clearTimeout(timer)
    if (outcome === 'expired') {
      this.isIncomplete = true
      this.isAbandoned = true
    }
  }

  /**
   * The pauses whose pinned frame the run handed over and the history did not store: refused by a budget, offered after finalizing, failed to write or still queued at the drain deadline. A second pin for a stored pause is no loss.
   * @returns The pause ids; read after {@link ExtensionHistoryFrameWriter.drain}.
   * @example frames.lostPins() // => new Set(['run:1:page:1'])
   */
  lostPins(): ReadonlySet<string> {
    return new Set(
      [...this.requestedPins].filter(
        (pauseId) => !this.storedPins.has(pauseId),
      ),
    )
  }

  /** Removes the temporary blobs this writer or a crashed one left; called once the history sealed or the queue was abandoned. @example await frames.removeTemporaryBlobs() */
  removeTemporaryBlobs(): Promise<void> {
    return removeTemporaryFrameBlobs(this.writer.historyDirectory)
  }

  /** Keeps the latest skipped stream frame and arms the one timer that records it when the interval after the last recorded frame is over. */
  private keepTrailing(frame: OfferedFrame): void {
    this.trailing = frame
    if (this.trailingTimer !== undefined) return
    const delayMs = Math.max(
      0,
      this.lastStreamMs + RECORDING_SAMPLE_INTERVAL_MS - frame.capturedAtMs,
    )
    this.trailingTimer = setTimeout(() => {
      this.trailingTimer = undefined
      this.flushTrailing()
    }, delayMs)
    this.trailingTimer.unref()
  }

  private clearTrailing(): void {
    if (this.trailingTimer !== undefined) clearTimeout(this.trailingTimer)
    this.trailingTimer = undefined
    this.trailing = undefined
  }

  /** Records the pending trailing frame, if any, ignoring the sampling interval. */
  private flushTrailing(): void {
    const frame = this.trailing
    this.clearTrailing()
    if (frame && this.accepting && !this.isStreamEnded) this.admit(frame)
  }

  /** Checks the budgets, reserves the frame's bytes and enqueues its store. */
  private admit(frame: OfferedFrame): ExtensionFrameOffer {
    const isStream = frame.kind === 'stream'
    try {
      if (frame.data.length > IMAGE_BASE64_LIMIT_CHARS)
        throw new Error('Recording frame exceeds the encoded byte limit.')
      const bytes = Buffer.from(frame.data, 'base64')
      const { width, height } = readPngDimensions(bytes)
      // Reserved before any I/O, so the queue holds at most the pending bound.
      if (this.pendingBytes + bytes.byteLength > MAX_RECORDING_PENDING_BYTES) {
        if (isStream) this.isIncomplete = true
        return 'dropped'
      }
      const hash = sha256(bytes)
      const isNew = !this.knownHashes.has(hash)
      const blobCost = isNew ? bytes.byteLength : 0
      // Stream frames stop short of the room kept for pins.
      const { budget } = this
      const frameLimit = isStream
        ? budget.frames - budget.pinReserveFrames
        : budget.frames
      const byteLimit = isStream
        ? budget.pngBytes - budget.pinReserveBytes
        : budget.pngBytes
      if (
        this.frameCount >= frameLimit ||
        this.blobBytes + blobCost > byteLimit
      ) {
        // The first refusal ends the stream; pins and the rest of the history go on.
        if (isStream) {
          this.isStreamEnded = true
          this.isIncomplete = true
        }
        return 'dropped'
      }
      if (isStream) this.lastStreamMs = frame.capturedAtMs
      else if (frame.pauseId !== undefined) this.pinnedPauses.add(frame.pauseId)
      this.frameCount += 1
      this.blobBytes += blobCost
      this.knownHashes.add(hash)
      this.pendingBytes += bytes.byteLength
      this.chain = this.chain
        .then(() => this.store(bytes, hash, isNew, width, height, frame))
        .catch((error: unknown) => {
          // The journal's reserve ended only the stream frames; the writer is whole.
          if (error instanceof HistoryReserveReachedError) {
            this.isStreamEnded = true
            this.isIncomplete = true
            return
          }
          // The first failure ends the filmstrip; the live run is untouched.
          this.failure ??= error
          this.accepting = false
          this.isIncomplete = true
        })
        .finally(() => {
          this.pendingBytes -= bytes.byteLength
        })
      return 'queued'
    } catch (error) {
      this.failure ??= error
      this.isIncomplete = true
      return 'dropped'
    }
  }

  /** Writes the blob when it is new (temporary name, flush, rename), then appends the frame's entry. */
  private async store(
    bytes: Buffer,
    hash: string,
    isNew: boolean,
    width: number,
    height: number,
    frame: OfferedFrame,
  ): Promise<void> {
    // After a failed blob no later frame is stored: one of them could name that blob. A queue abandoned at the drain deadline writes nothing more.
    if (this.failure !== undefined || this.isAbandoned) return
    if (isNew) {
      const directory = join(
        this.writer.historyDirectory,
        EXTENSION_HISTORY_FRAMES_DIRECTORY,
      )
      await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      await atomicPrivateBytes(join(directory, `${hash}.png`), bytes)
    }
    await this.writer.appendFrame({
      kind: frame.kind,
      ...(frame.pauseId === undefined ? {} : { pauseId: frame.pauseId }),
      hash,
      byteLength: bytes.byteLength,
      width,
      height,
      capturedAtMs: frame.capturedAtMs,
    })
    if (frame.kind === 'pin' && frame.pauseId !== undefined)
      this.storedPins.add(frame.pauseId)
  }
}
