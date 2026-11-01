import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EXTENSION_HISTORY_FRAMES_DIRECTORY,
  EXTENSION_HISTORY_REASON_CODES,
  EXTENSION_REPLAY_FRAME_CACHE_SIZE,
} from './constants'
import { sha256 } from './runtimeSupport/utils/sha256'

/** What loading a frame answers: its PNG as base64, or the reason it cannot be shown (its blob is missing, unreadable or does not match the journal). */
export type ExtensionFrameLoad =
  | { ok: true; base64: string }
  | { ok: false; code: typeof EXTENSION_HISTORY_REASON_CODES.frameDamaged }

/** The part of a journal `frame` entry a load verifies the blob against. */
export type ExtensionFrameIdentity = { hash: string; byteLength: number }

/**
 * Loads an Extension replay's frames lazily by hash and keeps at most {@link EXTENSION_REPLAY_FRAME_CACHE_SIZE} decoded frames, the least recently shown leaving first.
 * Why: a recording holds up to thousands of frames; the replay reads one when a moment shows it. A blob that is missing, unreadable or whose bytes differ from the journal's hash or length shows as damaged for that frame only, and is not cached, so the next moment is unaffected.
 * Created by the Study workspace per opened Extension replay; read by the selection of each moment.
 * @example const cache = new ExtensionReplayFrameCache(directory); const loaded = await cache.load({ hash, byteLength })
 */
export class ExtensionReplayFrameCache {
  private readonly frames = new Map<string, string>()
  private readonly loading = new Map<string, Promise<ExtensionFrameLoad>>()

  /**
   * @param historyDirectory - The history's folder; frames resolve only inside its `frames` folder.
   * @param read - Reads a blob's bytes; a test names its own.
   */
  constructor(
    private readonly historyDirectory: string,
    private readonly read: (path: string) => Promise<Buffer> = (path) =>
      readFile(path),
  ) {}

  /** How many decoded frames are kept now. @example cache.size // => 3 */
  get size(): number {
    return this.frames.size
  }

  /**
   * Loads one frame, from memory when kept.
   * @param frame - The frame's hash and byte length from its journal entry.
   * @returns The frame's PNG, or `ok: false` with the damaged-frame code; never rejects.
   * @example await cache.load({ hash, byteLength: 120 }) // => { ok: true, base64: 'iVBOR…' }
   */
  load(frame: ExtensionFrameIdentity): Promise<ExtensionFrameLoad> {
    const kept = this.frames.get(frame.hash)
    if (kept !== undefined) {
      // A frame shown again becomes the most recent.
      this.frames.delete(frame.hash)
      this.frames.set(frame.hash, kept)
      return Promise.resolve({ ok: true, base64: kept })
    }
    const running = this.loading.get(frame.hash)
    if (running) return running
    const started = this.readVerified(frame).finally(() => {
      this.loading.delete(frame.hash)
    })
    this.loading.set(frame.hash, started)
    return started
  }

  /** Reads a blob and checks it against the journal; keeps it when it matches. */
  private async readVerified(
    frame: ExtensionFrameIdentity,
  ): Promise<ExtensionFrameLoad> {
    const damaged = {
      ok: false,
      code: EXTENSION_HISTORY_REASON_CODES.frameDamaged,
    } as const
    // The hash names the file: only a SHA-256 hex digest resolves, so no path leaves the frames folder.
    if (!/^[0-9a-f]{64}$/.test(frame.hash)) return damaged
    try {
      const bytes = await this.read(
        join(
          this.historyDirectory,
          EXTENSION_HISTORY_FRAMES_DIRECTORY,
          `${frame.hash}.png`,
        ),
      )
      if (bytes.byteLength !== frame.byteLength || sha256(bytes) !== frame.hash)
        return damaged
      const base64 = bytes.toString('base64')
      this.frames.set(frame.hash, base64)
      // The least recently shown frame leaves once the bound is passed.
      for (const oldest of this.frames.keys()) {
        if (this.frames.size <= EXTENSION_REPLAY_FRAME_CACHE_SIZE) break
        this.frames.delete(oldest)
      }
      return { ok: true, base64 }
    } catch {
      return damaged
    }
  }
}
