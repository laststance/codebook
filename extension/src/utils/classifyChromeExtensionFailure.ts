import type { ChromeExtensionView } from '../runtime'

import type { ChromeExtensionFailureKind } from './describeChromeExtensionStatus'

/**
 * Picks the DR10 next-step kind of a failed run from one rule, so the status item and the Application view never show different lines for one failure.
 * Called by {@link describeChromeExtensionViewStatus} and by the run when it hands a failure to the viewport.
 * @param view - The run's view; its `extension` is set once the browser held the extension.
 * @param code - The error code of the failure.
 * @returns `before-launch` for a failure before the extension launched or for an unsupported Chrome version (also raised at launch); otherwise `ended`.
 * @example
 * classifyChromeExtensionFailure(view, 'CHROME_VERSION_UNSUPPORTED') // => 'before-launch'
 */
export function classifyChromeExtensionFailure(
  view: Pick<ChromeExtensionView, 'extension'>,
  code: string,
): ChromeExtensionFailureKind {
  return view.extension === undefined || code === 'CHROME_VERSION_UNSUPPORTED'
    ? 'before-launch'
    : 'ended'
}
