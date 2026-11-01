import type { ResourceContent } from '../resources'

import { describeHistoryHeadline } from './describeHistoryHeadline'
import { readJsonPage } from './readJsonPage'
import {
  isLearningMaterialSuffix,
  readLearningMaterialResource,
} from './readLearningMaterialResource'
import { withKnownNodeHistory } from './withKnownNodeHistory'

/** What {@link readHistoryResourceTail} needs of a profile's store. */
type TailStore<Summary> = Parameters<typeof readLearningMaterialResource>[0] & {
  summarize(studyId: string): Promise<Summary | undefined>
}

/**
 * Answers the last two routes of a server or extension history resource: the learning material, and the history's own page with its headline and the profile's verdicts.
 * Called by {@link readServerHistoryResource} and {@link readExtensionHistoryResource} after their events routes did not match.
 * @param input - The store, the study id, the verified history, the URI suffix and how the profile states its verdicts.
 * @returns The resource's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder.
 * @example await readHistoryResourceTail({ store, studyId, history, suffix: undefined, verdicts: (summary) => ({ saved: summary !== undefined }) })
 */
export async function readHistoryResourceTail<Summary>(input: {
  store: TailStore<Summary>
  studyId: string
  history: Parameters<typeof describeHistoryHeadline>[0]
  suffix: string | undefined
  verdicts: (summary: Summary | undefined) => Record<string, unknown>
}): Promise<ResourceContent> {
  const { store, studyId, history, suffix } = input
  if (suffix !== undefined && isLearningMaterialSuffix(suffix))
    return readLearningMaterialResource(store, studyId, suffix)
  const baseUri = `codebook://node-history/${studyId}`
  const summary = await withKnownNodeHistory(store, studyId, () =>
    store.summarize(studyId),
  )
  return readJsonPage(
    baseUri,
    {
      ...describeHistoryHeadline(history),
      ...input.verdicts(summary),
      eventsUri: `${baseUri}/events`,
    },
    suffix,
  )
}
