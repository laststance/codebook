import {
  retainedStudySelectionSchema,
  type RetainedStudy,
  type RetainedStudySelection,
} from '../retainedStudySchemas'

import { describeStudy } from './describeStudy'

/** Retains a valid item within the selected study for history/follow/replay, never borrowing another configured article. @example selectStudy(study, previous).studyId // study.id */
export function selectStudy(
  study: RetainedStudy,
  previous?: RetainedStudySelection,
): RetainedStudySelection {
  const items = describeStudy(study).items
  return retainedStudySelectionSchema.parse({
    studyId: study.id,
    profile: study.profile,
    itemId:
      items.find((item) => item.id === previous?.itemId)?.id ?? items[0]!.id,
    follow: false,
    tab: previous?.tab ?? 'live',
  })
}
