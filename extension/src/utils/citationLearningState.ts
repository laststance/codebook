import type { LearnerProgress, SavedLearnerDecision } from '../learnerSchemas'
import type { BookAnchor } from '../sourceSchemas'

import { citationContext } from './citationContext'

/** Projects exact article understanding from the shared ledger without borrowing primary-only runtime decisions. @example citationLearningState(progress, 'repository/book/node', anchors).understood */
export function citationLearningState(
  progress: LearnerProgress | undefined,
  item: string,
  anchors: readonly BookAnchor[],
) {
  const context = citationContext(anchors),
    latest = new Map<string, SavedLearnerDecision>()
  // Each uncheck supersedes only its complete source context; all prior intents remain stored.
  for (const decision of progress?.decisions ?? []) {
    if (decision.item !== item || decision.context.kind !== 'citations')
      continue
    latest.set(decision.context.hash, decision)
  }
  const current = latest.get(context.hash)
  return {
    known: Boolean(progress),
    context,
    understood: current?.understood === true,
    at: current?.at,
    reviewNeeded:
      current?.understood !== true &&
      [...latest].some(
        ([hash, decision]) => hash !== context.hash && decision.understood,
      ),
    history: [...latest.values()],
  }
}
