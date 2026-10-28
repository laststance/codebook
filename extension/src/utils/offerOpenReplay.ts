import type { NodeLearningSaveHost } from '../nodeLearningSave'

import {
  NODE_LEARNING_SAVE_ACTION,
  type NodeLearningSaveText,
} from './describeNodeLearningSave'

/**
 * Shows the notice that ends a Save and, when the learner clicks Open replay, opens the saved replay; a rejected notice or open is reported, never dropped.
 * Called by the Save of a test run and the Save of a server run after their history was read.
 * @param host - The editor's notice and open.
 * @param severity - How the notice is shown.
 * @param notice - Its words and actions.
 * @param studyId - The replay Open replay opens.
 * @param report - Receives a rejected notice or open.
 * @example offerOpenReplay(host, 'warning', notice, studyId, (error) => this.logFailure(studyId, 'save:open-replay', error))
 */
export function offerOpenReplay(
  host: Pick<NodeLearningSaveHost, 'notify' | 'open'>,
  severity: 'information' | 'warning',
  notice: NodeLearningSaveText,
  studyId: string,
  report: (error: unknown) => void,
): void {
  void host
    .notify(severity, notice.text, notice.actions ?? [])
    .then((action) => {
      if (action === NODE_LEARNING_SAVE_ACTION.openReplay)
        return host.open(studyId)
    })
    .catch(report)
}
