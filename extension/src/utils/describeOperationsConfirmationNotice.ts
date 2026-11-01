import { REVIEW_AGAIN_LABEL } from '../constants'
import type { OperationsConfirmationNotice } from '../operationsConfirmationTypes'

/**
 * Words the notification shown after the saved-session operations dialog was declined, timed out, answered too late or confirmed again (DES-4).
 * Called by the environment's `noticeOperationsConfirmation`; pure.
 * @param notice - Which run, repository and outcome.
 * @returns The severity, the message and the button labels (Review again for every refusal, none for a confirmation).
 * @example describeOperationsConfirmationNotice({ runId: 'r', repository: 'shop', kind: 'declined' }).actions // => ['Review again']
 */
export function describeOperationsConfirmationNotice(
  notice: OperationsConfirmationNotice,
): {
  severity: 'warning' | 'information'
  message: string
  actions: readonly string[]
} {
  const { repository } = notice
  const reviewHint = 'Choose Review again to see its operations again.'
  if (notice.kind === 'confirmed')
    return {
      severity: 'information',
      message: `Operations confirmed for ${repository}. Your AI chat can send them now; ask it to continue if it stopped waiting.`,
      actions: [],
    }
  const messages = {
    declined: `Operations not confirmed for ${repository}. Nothing was sent and the run is waiting. ${reviewHint}`,
    'timed-out': `Operations not confirmed for ${repository}: the dialog was not answered in time, so nothing was sent and the run is waiting. ${reviewHint}`,
    'expired-answer': `Operations not confirmed for ${repository}: Codebook had stopped waiting for that dialog, so your answer was not used and nothing was sent. Choose Review again to confirm the operations.`,
  }
  return {
    severity: 'warning',
    message: messages[notice.kind],
    actions: [REVIEW_AGAIN_LABEL],
  }
}
