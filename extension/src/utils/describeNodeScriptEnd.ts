import type { NodeScriptEndEntry } from '../nodeScriptHistorySchemas'

import { stripTerminalControls } from './stripTerminalControls'

/** The words of each limit that can end a script run, as the run's `end` entry names it. */
const SCRIPT_LIMIT_WORDS: Record<
  NonNullable<NodeScriptEndEntry['limit']>,
  string
> = {
  'running-time': 'the running-time limit',
  'run-deadline': 'the run deadline',
  'pause-hold': 'the pause hold',
  'exit-deadline': 'the exit deadline',
}

/**
 * Words how a recorded script run ended, in one short line for the replay's locator, its event list, its status line and the Application pane's end region.
 * Called by the script replay's words ({@link describeServerPosition}, {@link describeServerAnswer}, {@link describeServerEventRow}) and by {@link describeScriptEndRegion}.
 * @param end - The run's `end` entry.
 * @returns `Exited with code <n>`, `Exited (exit code unknown)`, `Ended by signal <name>`, `Stopped by Codebook` or `Ended at <the limit>`.
 * @example describeScriptEndHeadline({ kind: 'exited', exitCode: 0 }) // => 'Exited with code 0'
 */
export function describeScriptEndHeadline(
  end: Pick<NodeScriptEndEntry, 'kind' | 'exitCode' | 'signal' | 'limit'>,
): string {
  switch (end.kind) {
    case 'exited':
      return end.exitCode === undefined || end.exitCode === null
        ? 'Exited (exit code unknown)'
        : `Exited with code ${end.exitCode}`
    case 'signal':
      return `Ended by signal ${stripTerminalControls(end.signal ?? 'unknown')}`
    case 'stopped':
      return 'Stopped by Codebook'
    case 'limit':
      return `Ended at ${end.limit ? SCRIPT_LIMIT_WORDS[end.limit] : 'a limit'}`
  }
}

/** Words a list of declared stop indexes as their numbers, counted from 1. */
function stopNumbers(indexes: readonly number[]): string {
  return indexes.map((index) => index + 1).join(', ')
}

/**
 * Words what the Application pane's end region says at the moment the run's end is reached: the headline and the notes that keep a partial run honest, so a stop that was never reached and a stop that was not observed are never worded alike.
 * @param end - The run's `end` entry.
 * @returns The state line and the note under it, absent when the end has nothing to add.
 * @example describeScriptEndRegion({ kind: 'exited', exitCode: 0, stopsNeverReached: [1], stopsReached: [] }) // => { state: 'Exited with code 0', note: 'Stops never reached: 2.' }
 */
export function describeScriptEndRegion(
  end: Pick<
    NodeScriptEndEntry,
    | 'kind'
    | 'exitCode'
    | 'signal'
    | 'limit'
    | 'exitUnknown'
    | 'stopsNeverReached'
    | 'stopsNotObserved'
    | 'captureBudgetExhausted'
  >,
): { state: string; note?: string } {
  const notes = [
    end.exitUnknown
      ? `Exit code unreadable: ${stripTerminalControls(end.exitUnknown)}.`
      : '',
    end.stopsNeverReached.length
      ? `Stops never reached: ${stopNumbers(end.stopsNeverReached)}.`
      : '',
    // Once the capture budget was spent the later stops' breakpoints were retired, so they are not-observed, never never-reached.
    end.stopsNotObserved?.length
      ? `Stops not observed after the capture budget was spent: ${stopNumbers(end.stopsNotObserved)}.`
      : '',
    end.captureBudgetExhausted && !end.stopsNotObserved?.length
      ? 'The capture budget was spent; later pauses were not recorded.'
      : '',
  ].filter(Boolean)
  return {
    state: describeScriptEndHeadline(end),
    ...(notes.length ? { note: notes.join(' ') } : {}),
  }
}
