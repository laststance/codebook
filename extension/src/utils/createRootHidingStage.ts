import { hidePrivateRoots, privateRootSpellings } from './sanitizeCause'
import type { CauseRoots } from './sanitizeCause'

/** One channel's streaming root hider: feed text to `write`, call `end` once at the stream's end. */
export type RootHidingStage = {
  /** Returns the text, private roots hidden, that is safe to release now. */
  write(text: string): string
  /** Releases whatever is still held, roots hidden. */
  end(): string
}

/** Compares paths the way Windows roots match: without case and with any run of separators as one. */
function normalizeForPrefix(text: string): string {
  return text.toLowerCase().replace(/[\\/]+/g, '/')
}

/**
 * Makes the stateful root hider of one output channel, so a private root split over two chunks is hidden whole before the output is cut, joined or stored.
 * Only a trailing run that is still a proper beginning of some root's spelling waits for the next text (at most the longest root's length); anything else is released at once, so output keeps its order and time around a debugger stop. Called by {@link captureProcessOutput} for each channel when the run names its private roots.
 * @param roots - The private roots of the run's window.
 * @returns A fresh {@link RootHidingStage}; one per channel, never shared.
 * @example
 * const stage = createRootHidingStage({ storage: [], home: '/Users/ada' })
 * stage.write('at /Users/') + stage.write('ada/app\n') + stage.end() // => 'at ~/app\n'
 */
export function createRootHidingStage(roots: CauseRoots): RootHidingStage {
  const spellings = privateRootSpellings(roots).flatMap((spelling) => {
    const normalized = normalizeForPrefix(spelling)
    // A Windows long-path prefix may stand before the drive.
    return [normalized, `/?/${normalized}`]
  })
  const longest = Math.max(0, ...spellings.map((spelling) => spelling.length))
  let held = ''

  /** Says whether a run is a proper beginning of some root spelling, so more text could complete it. */
  const mayBecomeRoot = (run: string): boolean => {
    const normalized = normalizeForPrefix(run)
    return spellings.some(
      (spelling) =>
        spelling.length > normalized.length && spelling.startsWith(normalized),
    )
  }

  const write = (text: string): string => {
    const combined = held + text
    const hiddenWhole = hidePrivateRoots(combined, roots)
    const earliest = Math.max(0, combined.length - longest + 1)
    for (let start = earliest; start < combined.length; start++) {
      const run = combined.slice(start)
      if (!mayBecomeRoot(run)) continue
      const releasedHidden = hidePrivateRoots(combined.slice(0, start), roots)
      // A cut inside a root that is already complete would split it: such a start is no hold point.
      if (releasedHidden + hidePrivateRoots(run, roots) !== hiddenWhole)
        continue
      held = run
      return releasedHidden
    }
    held = ''
    return hiddenWhole
  }

  const end = (): string => {
    const rest = held
    held = ''
    return hidePrivateRoots(rest, roots)
  }

  return { write, end }
}
