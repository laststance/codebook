import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { readJsonPage } from './readJsonPage'
import { withKnownNodeHistory } from './withKnownNodeHistory'

/**
 * Tells whether a history resource suffix names the learning material, with or without a page cursor.
 * @param suffix - What follows the history id in the URI.
 * @returns `true` for `learning-material` and `learning-material/pages/…`.
 * @example isLearningMaterialSuffix('learning-material') // => true
 */
export function isLearningMaterialSuffix(suffix: string | undefined): boolean {
  return (
    suffix === 'learning-material' ||
    Boolean(suffix?.startsWith('learning-material/pages/'))
  )
}

/**
 * Answers the learning-material resource of a server or extension history: the saved material, or revision 0 with `not-saved` before the first save.
 * Called by the server and the extension history readers for a suffix {@link isLearningMaterialSuffix} accepts.
 * @param store - The profile's store.
 * @param studyId - The history's study id.
 * @param suffix - The `learning-material` suffix, with its optional page cursor.
 * @returns The material's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder.
 * @example await readLearningMaterialResource(store, studyId, 'learning-material')
 */
export async function readLearningMaterialResource(
  store: Pick<NodeTestHistoryStore, 'holdsHistoryFolder'> & {
    readLearningMaterial(studyId: string): Promise<unknown>
  },
  studyId: string,
  suffix: string,
): Promise<ResourceContent> {
  const material = await withKnownNodeHistory(store, studyId, () =>
    store.readLearningMaterial(studyId),
  )
  return readJsonPage(
    `codebook://node-history/${studyId}/learning-material`,
    material ?? {
      studyId,
      revision: 0,
      status: 'not-saved',
      content: undefined,
    },
    suffix.startsWith('learning-material/pages/')
      ? suffix.slice('learning-material/'.length)
      : undefined,
  )
}
