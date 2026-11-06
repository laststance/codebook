import { NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES } from '../constants'

import type { RootHoldTimer } from './createRootHidingStage'
import { maskPartialSecretTail } from './maskPartialSecretTail'

/** What one run knows about its secret values, read at call time so the set can grow while the run's output is captured. */
export type KnownValueMask = {
  /** Masks the run's known secret values in a text; read at call time, so the set can grow during the run. */
  mask(text: string): string
  /** How many characters the longest masked form has, read at call time; Infinity holds everything (a sign-in exchange in progress; its held text is capped at NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES, past which it is dropped and reported); 0 when the run holds no secret. */
  holdback(): number
  /** The expanded masking forms, read at call time; a timed release or the channel's end replaces a held ending that starts one of them with the mask. Omitted when the run holds no secret. */
  forms?(): readonly string[]
  /** Called with the UTF-8 byte count of held text that was dropped instead of published. */
  onWithheld(bytes: number): void
}

/** One channel's streaming known-value masker: feed text to `write`, settle held text with `release`, `drop` or `end`. */
export type KnownValueMaskStage = {
  /** Returns the text, known values masked, that is settled and safe to publish now. */
  write(text: string): string
  /** Re-runs the held text through the current mask and holdback; returns what is settled now (nothing under an infinite holdback). */
  release(): string
  /** Discards the held text and reports its UTF-8 byte count through {@link KnownValueMask.onWithheld} when it is not empty. */
  drop(): void
  /** Ends the channel: the held text is returned masked under a finite holdback, dropped (and reported) under an infinite one. */
  end(): string
}

/** Matches a UTF-16 high surrogate, which must not end a published piece. */
const HIGH_SURROGATE = /[\ud800-\udbff]/

/**
 * Makes the stateful known-value masker of one output channel, so a secret split over two chunks is masked whole before the output is cut, joined or stored.
 * Masks the held text plus the new text and keeps the last `holdback() - 1` characters pending (as {@link launchDevelopmentServer} does for its log); an infinite holdback holds everything. With a `timer`, held text of a channel that stays silent for `holdMs` is released masked through `timer.release` when the holdback is finite. Called by {@link captureProcessOutput} for each channel when the run names its known values.
 * @param known - The run's mask, holdback and withheld report ({@link KnownValueMask}); every member is read at call time.
 * @param timer - Optional timed release; without it held text waits for more output, {@link KnownValueMaskStage.release} or {@link KnownValueMaskStage.end}.
 * @returns A fresh {@link KnownValueMaskStage}; one per channel, never shared.
 * @example
 * const stage = createKnownValueMaskStage({ mask: (text) => text.replaceAll('hunter2', '[masked]'), holdback: () => 7, onWithheld: () => undefined })
 * stage.write('pw hunt') + stage.write('er2 ok\n') + stage.end() // => 'pw [masked] ok\n'
 */
export function createKnownValueMaskStage(
  known: KnownValueMask,
  timer?: RootHoldTimer,
): KnownValueMaskStage {
  // The masked text that is not yet settled: a known value may still continue in the next chunk.
  let held = ''
  let cancelRelease: (() => void) | undefined

  const stopTimer = (): void => {
    cancelRelease?.()
    cancelRelease = undefined
  }

  /** Arms the timed release of the held text; a channel that then stays silent is released by time unless the holdback is infinite. */
  const scheduleTimedRelease = (): void => {
    if (!timer || held === '') return
    cancelRelease = timer.schedule(() => {
      cancelRelease = undefined
      // An infinite holdback releases nothing by time: the exchange decides.
      if (known.holdback() === Number.POSITIVE_INFINITY || held === '') return
      const text = publishable(held)
      held = ''
      if (text) timer.release(text)
    }, timer.holdMs)
  }

  /** Masks held text for publication without waiting for more output: an ending that starts a secret form is masked too, so a value written in two parts far apart leaks no fragment. */
  const publishable = (text: string): string =>
    maskPartialSecretTail(known.mask(text), known.forms?.() ?? [])

  /** Reports and discards the held text. */
  const withhold = (): void => {
    const bytes = Buffer.byteLength(held)
    held = ''
    if (bytes > 0) known.onWithheld(bytes)
  }

  /** Masks `combined` and splits it into the settled start and the pending end. */
  const settle = (combined: string): string => {
    stopTimer()
    const holdback = known.holdback()
    // Everything waits while the run may still learn a value (a sign-in exchange in progress).
    if (holdback === Number.POSITIVE_INFINITY) {
      held = combined
      // Past the cap the held text is dropped and reported; text arriving later is held afresh, so the hold never grows without bound.
      if (Buffer.byteLength(held) > NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES)
        withhold()
      return ''
    }
    const masked = known.mask(combined)
    let settledEnd = Math.max(0, masked.length - Math.max(0, holdback - 1))
    // Never cut between the two halves of a surrogate pair.
    if (
      settledEnd > 0 &&
      settledEnd < masked.length &&
      HIGH_SURROGATE.test(masked.charAt(settledEnd - 1))
    )
      settledEnd--
    held = masked.slice(settledEnd)
    scheduleTimedRelease()
    return masked.slice(0, settledEnd)
  }

  return {
    write: (text) => (text === '' && held === '' ? '' : settle(held + text)),
    release: () => (held === '' ? '' : settle(held)),
    drop: (): void => {
      stopTimer()
      withhold()
    },
    end: () => {
      stopTimer()
      if (known.holdback() === Number.POSITIVE_INFINITY) {
        withhold()
        return ''
      }
      const text = publishable(held)
      held = ''
      return text
    },
  }
}
