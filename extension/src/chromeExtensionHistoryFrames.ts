import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ChromeExtensionHistoryWriter } from './chromeExtensionHistoryWriter'
import {
  EXTENSION_HISTORY_FRAMES_DIRECTORY,
  IMAGE_BASE64_LIMIT_CHARS,
  MAX_RECORDING_PENDING_BYTES,
  PRIVATE_DIRECTORY_MODE,
  RECORDING_SAMPLE_INTERVAL_MS,
} from './constants'
import { sha256 } from './runtimeSupport/utils/sha256'
import { atomicPrivateBytes } from './utils/atomicPrivateBytes'
import { readPngDimensions } from './utils/readPngDimensions'

/** What {@link ExtensionHistoryFrameWriter.offer} did with a frame. */
export type ExtensionFrameOffer = 'queued' | 'sampled-away' | 'dropped'

/**
 * Stores a chrome-extension run's surface frames in its history's own folder, `frames/<sha256>.png`, and appends each frame's journal entry once its blob is durable.
 * Why: the live screencast must never wait for a disk, so {@link ExtensionHistoryFrameWriter.offer} only samples, checks a bounded byte queue and enqueues; one serial queue writes each unique blob under a temporary name, flushes and renames it, and only then appends the `frame` entry (the order {@link RecordingWriter} keeps), deduplicating by hash.
 * Created by {@link ChromeExtensionHistoryRecorder}; fed by the viewport's recording observer.
 * @example const frames = new ExtensionHistoryFrameWriter(writer); frames.offer({ data, kind: 'stream', capturedAtMs: 40 })
 */
export class ExtensionHistoryFrameWriter {
  private chain: Promise<void> = Promise.resolve()
  private pendingBytes = 0
  private lastStreamMs = -Infinity
  private readonly knownHashes = new Set<string>()
  private accepting = true
  /** Whether a frame was dropped by a full queue or could not be stored; the seal then names the filmstrip. */
  isIncomplete = false
  /** Why the first frame failed to be stored, kept for the log. */
  failure?: unknown

  constructor(private readonly writer: ChromeExtensionHistoryWriter) {}

  /**
   * Samples one frame and enqueues it; never awaits and never throws.
   * @param frame - The base64 PNG of the frame, its kind, the pause it pins (for a pin) and when it was received on the run clock.
   * @returns `sampled-away` for a stream frame inside the sampling interval (no failure), `dropped` when the queue is full or the frame is unusable (the filmstrip then reads incomplete), `queued` otherwise.
   * @example frames.offer({ data: pngBase64, kind: 'stream', capturedAtMs: 120 }) // => 'queued'
   */
  offer(frame: {
    data: string
    kind: 'stream' | 'pin'
    pauseId?: string
    capturedAtMs: number
  }): ExtensionFrameOffer {
    if (!this.accepting) return 'dropped'
    if (
      frame.kind === 'stream' &&
      frame.capturedAtMs - this.lastStreamMs < RECORDING_SAMPLE_INTERVAL_MS
    )
      return 'sampled-away'
    try {
      if (frame.data.length > IMAGE_BASE64_LIMIT_CHARS)
        throw new Error('Recording frame exceeds the encoded byte limit.')
      const bytes = Buffer.from(frame.data, 'base64')
      const { width, height } = readPngDimensions(bytes)
      // Reserved before any I/O, so the queue holds at most the pending bound.
      if (this.pendingBytes + bytes.byteLength > MAX_RECORDING_PENDING_BYTES) {
        this.isIncomplete = true
        return 'dropped'
      }
      if (frame.kind === 'stream') this.lastStreamMs = frame.capturedAtMs
      const hash = sha256(bytes)
      const isNew = !this.knownHashes.has(hash)
      this.knownHashes.add(hash)
      this.pendingBytes += bytes.byteLength
      this.chain = this.chain
        .then(() => this.store(bytes, hash, isNew, width, height, frame))
        .catch((error: unknown) => {
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

  /**
   * Stops taking frames and waits for the queued ones, but only until `timeoutMs`; frames still queued then are lost and the filmstrip reads incomplete.
   * @param timeoutMs - How long the queue may take to drain.
   * @returns Settles when the queue drained or the time passed; never rejects.
   * @example await frames.drain(2_000)
   */
  async drain(timeoutMs: number): Promise<void> {
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
    if (outcome === 'expired') this.isIncomplete = true
  }

  /** Writes the blob when it is new (temporary name, flush, rename), then appends the frame's entry. */
  private async store(
    bytes: Buffer,
    hash: string,
    isNew: boolean,
    width: number,
    height: number,
    frame: { kind: 'stream' | 'pin'; pauseId?: string; capturedAtMs: number },
  ): Promise<void> {
    // After a failed blob no later frame is stored: one of them could name that blob.
    if (this.failure !== undefined) return
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
  }
}
