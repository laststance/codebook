import { StudyError } from '../errors'
import {
  nodeTestConfigSchema,
  type NodeTestConfiguration,
} from '../nodeTestConfigSchemas'
import type { RepositoryBookStore } from '../repositoryBook'
import type { RepositorySourceService } from '../repositorySource'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { pinCitedBookNode } from './pinCitedBookNode'
import { requireNodeTestTitles } from './requireNodeTestTitles'

/** Pins a Node test's checked source stops to the exact retained article revision before an owned test can launch. Called during Node profile preparation. @param input - Validated test and citation intent. @param books - Current workspace's retained articles. @param control - Shared cancellation and preparation deadline. @example await prepareNodeTestStudy(config, books, { signal, deadlineAt }) */
export async function prepareNodeTestStudy(
  input: NodeTestConfiguration,
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
        'Node test preparation expired or was cancelled before test input.',
      )
  }
  assertActive()
  const configuration = nodeTestConfigSchema.parse(input)
  // Refuse a retired or missing test identity before a history exists for this run.
  requireNodeTestTitles(configuration)
  const descriptor = await pinCitedBookNode(
    configuration,
    books,
    control,
    'Node test',
    assertActive,
  )
  return {
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    descriptor,
  }
}
