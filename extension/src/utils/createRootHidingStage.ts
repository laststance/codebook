import { OUTPUT_REDACTION_HOLD_LIMIT_CHARS } from '../constants'

import { createRootHider, privateRootSpellings } from './sanitizeCause'
import type { CauseRoots } from './sanitizeCause'

/** One channel's streaming root hider: feed text to `write`, call `end` once at the stream's end. */
export type RootHidingStage = {
  /** Returns the text, private roots hidden, that is safe to release now. */
  write(text: string): string
  /** Releases whatever is still held, roots hidden, and cancels the timed release. */
  end(): string
}

/** How a stage releases held text when its channel goes quiet: injected so tests drive time by hand and the logic stays pure. */
export type RootHoldTimer = {
  /** How long the channel may stay silent before the held text is released. */
  holdMs: number
  /** Runs `callback` once after `delayMs`; returns a function that cancels it. */
  schedule(callback: () => void, delayMs: number): () => void
  /** Receives the text of a timed release, roots hidden, in order after everything `write` returned. */
  release(text: string): void
}

/** A root's spelling in the form {@link normalizeForPrefix} compares, with the words that replace it. */
type PlaceholderSpelling = { normalized: string; placeholder: string }

/** Compares paths the way Windows roots match: without case and with any run of separators as one. */
function normalizeForPrefix(text: string): string {
  return text.toLowerCase().replace(/[\\/]+/g, '/')
}

/** Says whether a character is a path separator of either kind. */
function isSeparator(character: string | undefined): boolean {
  return character === '/' || character === '\\'
}

/**
 * Finds where the longest tail of a text starts that still normalizes to fewer than `limit` characters, so the hold window counts in the space the spellings are compared in (doubled separators collapse).
 * Called by {@link createRootHidingStage} on every write.
 * @param text - The text whose tail is measured.
 * @param limit - The normalized length a held run must stay under.
 * @returns The index where that tail starts.
 * @example earliestHoldStart('C:\\\\Users\\\\a', 8) // => 3, where 'Users\\\\a' (7 characters once collapsed) begins
 */
function earliestHoldStart(text: string, limit: number): number {
  let normalizedLength = 0
  let start = text.length
  while (start > 0) {
    // A separator directly before another one adds nothing: the run collapses to one.
    const adds =
      isSeparator(text[start - 1]) && isSeparator(text[start]) ? 0 : 1
    if (normalizedLength + adds >= limit) break
    normalizedLength += adds
    start--
  }
  return start
}

/**
 * Makes the stateful root hider of one output channel, so a private root split over two chunks is hidden whole before the output is cut, joined or stored.
 * Only a trailing run that is still a beginning of some root's spelling (a complete root included, until the next character shows whether a boundary follows) waits for the next text (at most the longest root's length, counted after separator runs collapse); anything else is released at once, so output keeps its order and time around a debugger stop. With a `timer`, held text of a channel that stays silent for `holdMs` is released through `timer.release`: hidden as the root's placeholder when it already shows part of a private name (past the folder every user shares), otherwise as typed. Called by {@link captureProcessOutput} for each channel when the run names its private roots.
 * @param roots - The private roots of the run's window.
 * @param timer - Optional timed release; without it held text waits for more output or {@link RootHidingStage.end}.
 * @returns A fresh {@link RootHidingStage}; one per channel, never shared.
 * @example
 * const stage = createRootHidingStage({ storage: [], home: '/Users/ada' })
 * stage.write('at /Users/') + stage.write('ada/app\n') + stage.end() // => 'at ~/app\n'
 */
export function createRootHidingStage(
  roots: CauseRoots,
  timer?: RootHoldTimer,
): RootHidingStage {
  const withLongPath = (spelling: string): string[] => {
    const normalized = normalizeForPrefix(spelling)
    // A Windows long-path prefix may stand before the drive.
    return [normalized, `/?/${normalized}`]
  }
  const spellings = privateRootSpellings(roots).flatMap(withLongPath)
  // Claimed in this order when several kinds share a spelling: storage, workspace, home.
  const kinds: [string, readonly string[]][] = [
    ['<storage>', roots.storage],
    ['<workspace>', [roots.workspace ?? []].flat()],
    ['~', [roots.home ?? []].flat()],
  ]
  const placeholderSpellings: PlaceholderSpelling[] = kinds.flatMap(
    ([placeholder, kindRoots]) =>
      privateRootSpellings({ storage: kindRoots })
        .flatMap(withLongPath)
        .map((normalized) => ({ normalized, placeholder })),
  )
  const longest = Math.max(0, ...spellings.map((spelling) => spelling.length))
  // Compiled once: every chunk hides several slices of its text.
  const hidePrivateRoots = createRootHider(roots)
  let held = ''
  /** How many leading characters of the held text a timed release already let out (as typed, or as a root placeholder when `emittedAsPlaceholder`): the next text is matched together with them, so a root finished by it hides the rest of its name. */
  let emittedCount = 0
  let emittedAsPlaceholder = false
  let cancelRelease: (() => void) | undefined

  /** Says whether a run is a beginning of some root spelling (or one whole), so more text could still change what it means. */
  const mayBecomeRoot = (run: string): boolean => {
    const normalized = normalizeForPrefix(run)
    return spellings.some(
      (spelling) =>
        spelling.length >= normalized.length && spelling.startsWith(normalized),
    )
  }

  /** Words a quiet channel's held text: a root it completes is hidden; a start that shows part of a private name (past the root's parent folder) reads as that root's placeholder; a shared folder stays as typed. */
  const failClosed = (rest: string): string => {
    const hidden = hidePrivateRoots(rest)
    if (hidden !== rest) return hidden
    const normalized = normalizeForPrefix(rest)
    const revealing = placeholderSpellings.find(
      ({ normalized: spelling }) =>
        spelling.startsWith(normalized) &&
        normalized.length > spelling.lastIndexOf('/') + 1,
    )
    return revealing ? revealing.placeholder : rest
  }

  const stopTimer = (): void => {
    cancelRelease?.()
    cancelRelease = undefined
  }

  /**
   * Drops from a hidden text the start that was already let out, so a timed release's text is never delivered twice and a root it finishes is hidden from its own start.
   * @param source - The typed text the output was made from; its first `emittedCount` characters were already released.
   * @param output - `source` with its roots hidden.
   * @param emittedCount - How many leading characters of `source` were already released.
   * @param placeholderShown - Whether that release was a root placeholder instead of the typed characters.
   * @returns What is still to deliver.
   */
  const withoutEmitted = (
    source: string,
    output: string,
    emittedCount: number,
    placeholderShown: boolean,
  ): string => {
    if (emittedCount === 0) return output
    // Where the output stops matching the typed text inside the released start: a root completed there is hidden from its own start.
    let common = 0
    while (
      common < emittedCount &&
      common < output.length &&
      output[common] === source[common]
    )
      common++
    const straddles = common < emittedCount
    const remainder = output.slice(straddles ? common : emittedCount)
    if (!straddles || !placeholderShown) return remainder
    // The start was let out as a placeholder already: do not repeat it.
    const leading = ['<storage>', '<workspace>', '~'].find((words) =>
      remainder.startsWith(words),
    )
    return leading ? remainder.slice(leading.length) : remainder
  }

  /** Holds and releases `combined` (the held text plus the new text) as one stream position. */
  const holdAndRelease = (combined: string): string => {
    const hiddenWhole = hidePrivateRoots(combined)
    // The window is bounded in the characters the spellings are compared in, so doubled separators cannot push a root's start out of it.
    // The raw held length is capped too: endless separators collapse in the comparison space and would otherwise grow the held text without bound.
    const earliest = Math.max(
      earliestHoldStart(combined, longest),
      combined.length - OUTPUT_REDACTION_HOLD_LIMIT_CHARS,
    )
    for (let start = earliest; start < combined.length; start++) {
      const run = combined.slice(start)
      if (!mayBecomeRoot(run)) continue
      const releasedHidden = hidePrivateRoots(combined.slice(0, start))
      // A cut inside a root that is already complete would split it: such a start is no hold point.
      if (releasedHidden + hidePrivateRoots(run) !== hiddenWhole) continue
      held = run
      // A held run whose channel then stays silent is released by time, so a quiet server's last line is not stuck.
      if (timer)
        cancelRelease = timer.schedule(() => {
          cancelRelease = undefined
          const rest = held
          if (!rest) return
          const shown = failClosed(rest)
          const stillMayGrow = hidePrivateRoots(rest) === rest
          // What an earlier timed release let out is never delivered again, typed text or a placeholder, as write and end do.
          const delivered = withoutEmitted(
            rest,
            shown,
            emittedCount,
            emittedAsPlaceholder,
          )
          if (stillMayGrow) {
            // No root was completed: the start stays held (already released), so more text that finishes the root is hidden (fail closed).
            emittedCount = rest.length
            emittedAsPlaceholder = emittedAsPlaceholder || shown !== rest
          } else {
            held = ''
            emittedCount = 0
          }
          if (delivered) timer.release(delivered)
        }, timer.holdMs)
      return releasedHidden
    }
    held = ''
    return hiddenWhole
  }

  /**
   * Hides one write; when the text finishes a root whose beginning a timed release already let out, the root's placeholder follows what was released (`/Users/` then `ada/app/x` reads `/Users/<workspace>/x`), so no character of the name is released.
   */
  const write = (text: string): string => {
    // New output restarts the silence the timed release waits for.
    stopTimer()
    const emitted = emittedCount
    const combined = held + text
    const output = holdAndRelease(combined)
    // The held start moved forward by what was released; what is still held was let out only up to the old count.
    emittedCount = Math.max(0, emitted - (combined.length - held.length))
    if (held === '') emittedCount = 0
    const delivered = withoutEmitted(
      combined,
      output,
      emitted,
      emittedAsPlaceholder,
    )
    if (emittedCount === 0) emittedAsPlaceholder = false
    return delivered
  }

  const end = (): string => {
    stopTimer()
    const rest = held
    const emitted = emittedCount
    const wasPlaceholder = emittedAsPlaceholder
    held = ''
    emittedCount = 0
    emittedAsPlaceholder = false
    // The end words a held start as a timed release would: a start that already shows part of a name ends as its root's placeholder.
    return withoutEmitted(rest, failClosed(rest), emitted, wasPlaceholder)
  }

  return { write, end }
}
