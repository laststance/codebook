import type { NodeScriptConfiguration } from '../nodeScriptConfigSchemas'

import { prepareNodeServerStudy } from './prepareNodeServerStudy'

/**
 * Pins a node-script run's declared stops to the exact retained article revision before anything is spawned, so a stop whose citation or file changed is refused while nothing runs.
 * Called by {@link StudyService} as the first asynchronous step of a node-script preparation, after the workspace trust check; it shares {@link prepareNodeServerStudy}'s pinning and only names the run a script in its refusals.
 * @param configuration - The strictly parsed node-script configuration.
 * @param books - The workspace's retained articles.
 * @param control - Shared cancellation and preparation deadline.
 * @param now - The clock the deadline is compared with.
 * @returns The configuration, its SHA-256, and the article node's descriptor with the cited sources at their retained revision.
 * @throws What {@link prepareNodeServerStudy} throws.
 * @example
 * const { descriptor } = await prepareNodeScriptStudy(configuration, books, { signal, deadlineAt })
 */
export function prepareNodeScriptStudy(
  configuration: NodeScriptConfiguration,
  books: Parameters<typeof prepareNodeServerStudy>[1],
  control: Parameters<typeof prepareNodeServerStudy>[2],
  now = Date.now,
) {
  return prepareNodeServerStudy(
    configuration,
    books,
    control,
    now,
    'Node script',
  )
}
