import { randomUUID } from 'node:crypto'

import type { ConfiguredStudy } from '../../configuredStudySchemas'
import type { LearningLibrary } from '../../learningLibrary'

import { createConfiguredStudy } from './createConfiguredStudy'

/**
 * Saves a second browser study beside the harness's own, under a run of its own, so a Saved studies choice can name a study other than the one shown; used by the test replay composition and open tests that choose another saved study.
 * @param library - The reader's learning library (`await harness.reader.learningStorage()`).
 * @returns The saved study, whose `id` the Saved studies choice names.
 * @example const other = await saveOtherBrowserStudy(await harness.reader.learningStorage())
 */
export async function saveOtherBrowserStudy(
  library: LearningLibrary,
): Promise<ConfiguredStudy> {
  const study = createConfiguredStudy(),
    runId = randomUUID()
  for (const observation of study.observations)
    observation.snapshotUri = observation.snapshotUri.replace(
      study.runId,
      runId,
    )
  study.workspaceKey = library.workspaceKey
  study.runId = runId
  study.id = `${study.instanceId}_${runId}`
  study.savedAt = '2026-09-20T00:00:01.000Z'
  await library.saveStudy(study)
  return study
}
