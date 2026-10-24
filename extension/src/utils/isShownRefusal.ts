import { withoutErrorName } from './withoutErrorName'

/**
 * Says whether the presentation reason already shows a refusal as its whole sentence, so the Study pane does not tell it again as an error row; asked by the pane's `arrange` action in {@link StudyWorkspace} (F406).
 * A reason that merely contains a short or empty cause shows no such refusal, so only the whole sentence counts.
 * @param reason - The presentation reason, as the string form of an error, or `undefined` when none is shown.
 * @param cause - The refusal's own text, without its error name.
 * @returns `true` when the reason, without its error name, is exactly the cause and the cause is not empty.
 * @example
 * isShownRefusal('Error: Close that tab.', 'Close that tab.') // => true
 * isShownRefusal('Error: Close that tab.', '') // => false
 */
export function isShownRefusal(
  reason: string | undefined,
  cause: string,
): boolean {
  return cause !== '' && withoutErrorName(reason ?? '') === cause
}
