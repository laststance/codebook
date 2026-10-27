import { StudyError } from '../errors'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import type { RepositoryBookStore } from '../repositoryBook'
import type { RepositorySourceService } from '../repositorySource'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { pinCitedBookNode } from './pinCitedBookNode'

/**
 * Pins a node-server run's declared stops to the exact retained article revision before the server can be launched (D12), so a stop whose citation or file changed is refused while nothing runs.
 * Called by {@link StudyService} as the first asynchronous step of a node-server preparation, after the workspace trust check.
 * @param configuration - The strictly parsed node-server declaration.
 * @param books - The workspace's retained articles.
 * @param control - Shared cancellation and preparation deadline.
 * @param now - The clock the deadline is compared with.
 * @returns The declaration, its SHA-256 as the manifest names it, and the article node's descriptor with the cited sources at their retained revision.
 * @throws `RUNTIME_FAILED` when the preparation expired or was cancelled; what {@link pinCitedBookNode} throws otherwise.
 * @example
 * const { descriptor } = await prepareNodeServerStudy(configuration, books, { signal, deadlineAt })
 */
export async function prepareNodeServerStudy(
  configuration: NodeServerConfiguration,
  books: RepositoryBookStore,
  control: Required<
    NonNullable<Parameters<RepositorySourceService['prepare']>[1]>
  >,
  now = Date.now,
) {
  const assertActive = (): void => {
    if (control.signal.aborted || now() >= control.deadlineAt)
      throw new StudyError(
        'RUNTIME_FAILED',
        'Node server preparation expired or was cancelled before the server started.',
      )
  }
  assertActive()
  const descriptor = await pinCitedBookNode(
    configuration,
    books,
    control,
    'Node server',
    assertActive,
  )
  return {
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    descriptor,
  }
}
