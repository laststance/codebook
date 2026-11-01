import { CHOSEN_WHEN_SENT_VALUE, HIDDEN_OPERATION_VALUE } from '../constants'
import type {
  OperationConfirmationFact,
  SavedSessionOperationLine,
} from '../operationsConfirmationTypes'
import type { RepositoryOperation } from '../repositoryConfigSchemas'

/**
 * Resolves each declared operation to the line the saved-session confirmation shows, hiding every secret (ENG-8, DX-1).
 * Called by {@link StudyService} when it builds the confirmation question; pure.
 * @param operations - The declared operations, in order.
 * @param facts - What the page said about each control; `undefined` when the read failed, which never blocks the dialog.
 * @returns One line per operation: a click has no value; a text shows its declared text or `(hidden)` for an ask-learner or secret control; a choose shows the enabled option's visible label, `(hidden)` for a secret select, or `(chosen when sent)`.
 * @example
 * listSavedSessionOperations([{ kind: 'choose', title: 'Customer', selector: '#c', value: 'c1' }], [{ index: 1, found: true, secret: false, optionLabel: 'Alice' }])
 * // => [{ index: 1, kind: 'choose', title: 'Customer', value: 'Alice' }]
 */
export function listSavedSessionOperations(
  operations: readonly RepositoryOperation[],
  facts: readonly OperationConfirmationFact[] | undefined,
): SavedSessionOperationLine[] {
  return operations.map((operation, position) => {
    const index = position + 1
    const base = { index, kind: operation.kind, title: operation.title }
    const fact = facts?.find((entry) => entry.index === index)
    if (operation.kind === 'click') return base
    if (operation.kind === 'text') {
      // An ask-learner secret or a control read as secret never shows its text.
      const isHidden = operation.secret !== undefined || fact?.secret === true
      return {
        ...base,
        value: isHidden ? HIDDEN_OPERATION_VALUE : operation.text,
      }
    }
    return {
      ...base,
      value: fact?.secret
        ? HIDDEN_OPERATION_VALUE
        : (fact?.optionLabel ?? CHOSEN_WHEN_SENT_VALUE),
    }
  })
}
