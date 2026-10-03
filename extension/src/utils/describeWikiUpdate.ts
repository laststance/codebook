import type { WikiUpdateStatus } from './wikiUpdateRun'

/**
 * Writes the sentence the browser Wiki shows under its freshness label for one update state.
 *
 * Why: the page must say running, result, failure or kept-site in plain words. The function is embedded into the served page script with `toString()`, so it must stay free of imports and outer variables.
 * Trigger: the reader page calls it with each `api/update-status` answer.
 *
 * @param status - Update run state from the extension.
 * @param formatTime - Turns an ISO timestamp into the learner's local time; the page uses the browser's locale.
 * @returns The sentence, or an empty string for an idle state (nothing to show).
 *
 * @example
 * ```ts
 * describeWikiUpdate({ state: 'cancelled', finishedAt: '2026-10-03T12:00:00.000Z', outputDirectory: '.codebook/wiki' })
 * // => 'Update cancelled. The last usable site is kept. Output: .codebook/wiki'
 * ```
 */
export function describeWikiUpdate(
  status: WikiUpdateStatus,
  formatTime: (isoTimestamp: string) => string = (isoTimestamp) =>
    new Date(isoTimestamp).toLocaleTimeString(),
): string {
  if (status.state === 'idle') return ''
  const place = ' Output: ' + status.outputDirectory
  if (status.state === 'running')
    return (
      'Updating LLM Wiki… started ' +
      formatTime(status.startedAt) +
      ' in ' +
      (status.host === 'cursor' ? 'Cursor' : 'VS Code') +
      '. The current site stays readable.' +
      place
    )
  if (status.state === 'succeeded')
    return (
      'Updated to ' +
      status.identity +
      '. Reload this page to read the new pages.' +
      place
    )
  if (status.state === 'already-current')
    return 'Already current. Nothing to update.' + place
  if (status.state === 'failed')
    return (
      'Update failed: ' +
      status.reason +
      ' The last usable site is kept.' +
      place
    )
  if (status.state === 'cancelled')
    return 'Update cancelled. The last usable site is kept.' + place
  if (status.state === 'timed-out')
    return (
      'Update not finished in time. The last usable site is kept; a later publish shows as current here.' +
      place
    )
  return (
    'Update stopped: your file would be overwritten (' +
    status.paths.join(', ') +
    '). Nothing was replaced.' +
    place
  )
}
