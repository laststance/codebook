import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import {
  NODE_SERVER_OUTPUT_ROOT_HOLD_MS,
  PROCESS_OUTPUT_EVENT_LIMIT_CHARS,
  PROCESS_OUTPUT_LIMIT_BYTES,
} from '../constants'
import { NANOSECONDS_PER_MILLISECOND } from '../runtimeSupport/constants'

import { createOutputRedactor } from './createOutputRedactor'
import { createRootHidingStage } from './createRootHidingStage'
import type { RootHoldTimer } from './createRootHidingStage'
import { keepUtf8Tail } from './keepUtf8Tail'
import type { CauseRoots } from './sanitizeCause'

/** One stamped chunk of an owned process's output, already redacted: its order, its time since the launch, its channel and its text (at most {@link PROCESS_OUTPUT_EVENT_LIMIT_CHARS} characters). */
export type ProcessOutputEvent = {
  sequence: number
  elapsedMs: number
  channel: 'stdout' | 'stderr'
  text: string
}

/** How {@link captureProcessOutput} stamps, delivers and bounds an owned process's output. */
export type ProcessOutputOptions = {
  /** `process.hrtime.bigint()` at the launch; each event's `elapsedMs` counts from it. */
  startedAt: bigint
  /** Receives each stamped chunk at once, in arrival order; its promise settles when the chunk is durable. */
  onOutput?: (event: ProcessOutputEvent) => void | Promise<void>
  /** The most bytes delivered but not yet settled; beyond it the capture fails with `overflowMessage` instead of buffering. */
  pendingLimitBytes: number
  /** The failure's message when undelivered output passes `pendingLimitBytes`. */
  overflowMessage: string
  /** The failure message's start when a delivery rejects, before its cause. */
  failurePrefix: string
  /** The window's private roots; when given, every channel hides them statefully before anything is redacted, cut, delivered or kept, so a root split over two chunks is still hidden. The raw announcement is unaffected. */
  privateRoots?: CauseRoots
  /** Runs a callback once after a delay and returns its canceller; the timed release of text held for a possible root uses it. Defaults to an unref'd real timer; tests inject a hand-driven one. */
  scheduleRootRelease?: RootHoldTimer['schedule']
}

/** Real-timer {@link RootHoldTimer}`.schedule`: unref'd so a pending release never keeps the process alive. */
const scheduleWithRealTimer: RootHoldTimer['schedule'] = (
  callback,
  delayMs,
) => {
  const timeout = setTimeout(callback, delayMs)
  timeout.unref()
  return (): void => clearTimeout(timeout)
}

/** The captured output of one owned process. */
export type ProcessOutputCapture = {
  /** The first {@link PROCESS_OUTPUT_LIMIT_BYTES} of raw output, where the inspector announces itself; never published. */
  announcement(): string
  /** The last {@link PROCESS_OUTPUT_LIMIT_BYTES} of redacted output. */
  tail(): string
  /** Settles once every delivered chunk settled. */
  settled(): Promise<void>
  /** The capture's first failure, if any. */
  failure(): Error | undefined
}

/**
 * Captures an owned process's stdout and stderr: each channel is decoded as UTF-8 and redacted statefully ({@link createOutputRedactor}) before anything is cut, then kept as a bounded tail and handed over as stamped events of at most {@link PROCESS_OUTPUT_EVENT_LIMIT_CHARS} characters, in arrival order.
 * The raw start of the output is kept apart, only to read the inspector's announcement.
 * Called by {@link watchOwnedProcess} for the test or server an owned launcher spawned.
 * @param child - The spawned process's output streams.
 * @param options - Stamping, delivery and bounds ({@link ProcessOutputOptions}).
 * @returns The capture's announcement, tail, settlement and failure ({@link ProcessOutputCapture}).
 * @example
 * const capture = captureProcessOutput(child, { startedAt: process.hrtime.bigint(), onOutput, pendingLimitBytes: 1_048_576, overflowMessage: 'Node server output capture failed: output outpaced its delivery.', failurePrefix: 'Node server output capture failed' })
 * capture.tail() // => 'fixture listening on 127.0.0.1:4100\n'
 */
export function captureProcessOutput(
  child: Pick<ChildProcess, 'stdout' | 'stderr'>,
  options: ProcessOutputOptions,
): ProcessOutputCapture {
  let announcement = '',
    tail = '',
    failure: Error | undefined,
    sequence = 0,
    pendingBytes = 0,
    deliveries = Promise.resolve()
  const enqueue = (
    channel: ProcessOutputEvent['channel'],
    text: string,
  ): void => {
    const deliver = options.onOutput
    if (!deliver) return
    const bytes = Buffer.byteLength(text)
    // Output beyond what may wait for delivery fails the capture instead of buffering it behind slow deliveries.
    if (pendingBytes + bytes > options.pendingLimitBytes) {
      failure ??= new Error(options.overflowMessage)
      return
    }
    pendingBytes += bytes
    const event = {
      sequence: ++sequence,
      elapsedMs:
        Number(process.hrtime.bigint() - options.startedAt) /
        NANOSECONDS_PER_MILLISECOND,
      channel,
      text,
    }
    // Hand the chunk over in the step that stamps it, so a later event cannot overtake it.
    let delivery: Promise<void>
    try {
      delivery = Promise.resolve(deliver(event))
    } catch (cause) {
      delivery = Promise.reject(cause)
    }
    const settled = delivery
      .catch((cause: unknown) => {
        failure ??= new Error(`${options.failurePrefix}: ${String(cause)}`)
      })
      .finally(() => {
        pendingBytes -= bytes
      })
    deliveries = deliveries.then(() => settled)
  }
  const acceptRedacted = (
    channel: ProcessOutputEvent['channel'],
    text: string,
  ): void => {
    if (!text) return
    tail = keepUtf8Tail(tail + text, PROCESS_OUTPUT_LIMIT_BYTES)
    let part = ''
    // Events are cut by characters, never inside a code point.
    for (const character of text) {
      if (failure) return
      if (part.length + character.length > PROCESS_OUTPUT_EVENT_LIMIT_CHARS) {
        enqueue(channel, part)
        part = ''
      }
      part += character
    }
    if (part && !failure) enqueue(channel, part)
  }
  for (const [channel, stream] of [
    ['stdout', child.stdout],
    ['stderr', child.stderr],
  ] as const) {
    if (!stream) continue
    const decoder = new StringDecoder('utf8')
    const redactor = createOutputRedactor()
    // Set once the channel's output is finished (end or close), so a late timed release delivers nothing after the capture settled.
    let channelEnded = false
    const rootStage = options.privateRoots
      ? createRootHidingStage(options.privateRoots, {
          holdMs: NODE_SERVER_OUTPUT_ROOT_HOLD_MS,
          schedule: options.scheduleRootRelease ?? scheduleWithRealTimer,
          // A held start released by time follows the same path as any root-hidden text.
          release: (text) => {
            if (!channelEnded) acceptRedacted(channel, redactor.write(text))
          },
        })
      : undefined
    const accept = (text: string): void => {
      if (text && Buffer.byteLength(announcement) < PROCESS_OUTPUT_LIMIT_BYTES)
        announcement = Buffer.from(announcement + text)
          .subarray(0, PROCESS_OUTPUT_LIMIT_BYTES)
          .toString('utf8')
      // Roots are hidden over a held tail first, so the secret redactor and the event split only ever see hidden text.
      acceptRedacted(
        channel,
        redactor.write(rootStage ? rootStage.write(text) : text),
      )
    }
    stream.on('data', (chunk: Buffer) => {
      if (!channelEnded) accept(decoder.write(chunk))
    })
    // The channel's output is over at `end`; a stream destroyed or closed without `end` is over at `close`. Either way what is held is released once, hidden, so a held root start never stays behind and its timer never fires later.
    const finishChannel = (): void => {
      if (channelEnded) return
      channelEnded = true
      accept(decoder.end())
      // What the root stage held back for a possible root is released, hidden, before the redactor's own end.
      if (rootStage) acceptRedacted(channel, redactor.write(rootStage.end()))
      // What the redactor held back for a possibly incomplete secret is released, redacted, at the channel's end.
      acceptRedacted(channel, redactor.end())
    }
    stream.on('end', finishChannel)
    stream.on('close', finishChannel)
  }
  return {
    announcement: () => announcement,
    tail: () => tail,
    settled: (): Promise<void> => deliveries,
    failure: () => failure,
  }
}
