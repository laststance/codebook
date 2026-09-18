import type { ParticipantSnapshot } from '../inspectParticipant';
import type { StudyItem } from '../profiles';
import { actionExpectations } from './actionExpectations';

/** Freezes pre-mutation values for {@link PairedRun} inspection while browser stops retain the completed response. @example stopExpectations('run', orderItem).orderCount // 0 for the server */
export function stopExpectations(runId: string, item: StudyItem): ParticipantSnapshot['values'] {
  const response = actionExpectations(runId, item.action).selectedResponse;
  if (item.participant === 'browser') return response;
  if ('orderCount' in response) return { ...response, orderCount: 0 };
  return { ...response, cartCount: 0 };
}
