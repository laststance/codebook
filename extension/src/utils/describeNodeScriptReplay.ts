import type { NodeScriptHistorySummary } from '../nodeScriptHistoryTypes'

import { describeServerRowStatus } from './describeNodeServerReplay'

/**
 * Words how a script run ended for a Saved studies row: its exit code, or the kind of end when it has none.
 * @param summary - The history's summary as the library reads it.
 * @returns `exit code 0`, `exit code unknown`, `ended by a signal`, `stopped`, `ended at a limit`, `no end recorded` for a finished history without an `end`, or an empty text while it records.
 * @example describeScriptEnd({ endKind: 'exited', exitCode: 3, … }) // => 'exit code 3'
 */
export function describeScriptEnd(
  summary: Pick<
    NodeScriptHistorySummary,
    'endKind' | 'exitCode' | 'verification' | 'status'
  >,
): string {
  switch (summary.endKind) {
    case 'exited':
      return summary.exitCode === undefined || summary.exitCode === null
        ? 'exit code unknown'
        : `exit code ${summary.exitCode}`
    case 'signal':
      return 'ended by a signal'
    case 'stopped':
      return 'stopped'
    case 'limit':
      return 'ended at a limit'
    case undefined:
      return summary.verification === 'verified' &&
        summary.status !== 'recording'
        ? 'no end recorded'
        : ''
  }
}

/**
 * Words one Saved studies row of a script history: it leads with the saved learning title (else the question), then `Script replay · <entry> → <end> · <k> of <m> stops`, then its status, so two replays of one script are told apart by what they explain. A partial run is a row like a complete one, with its missing parts named by the status.
 * Called by the Study workspace for each script history of the library and by the notices that name one.
 * @param summary - The history's summary as the library reads it.
 * @returns The row's outcome text.
 * @example describeScriptReplayRow(summary) // => 'Counting items · Script replay · scripts/count.mjs → exit code 0 · 2 of 3 stops · Partial: Declared stop 3 was not reached.'
 */
export function describeScriptReplayRow(
  summary: NodeScriptHistorySummary,
): string {
  const end = describeScriptEnd(summary)
  return `${summary.title ?? summary.question} · Script replay · ${summary.entry}${end ? ` → ${end}` : ''} · ${summary.reachedStopCount} of ${summary.declaredStopCount} stops · ${describeServerRowStatus(summary)}`
}
