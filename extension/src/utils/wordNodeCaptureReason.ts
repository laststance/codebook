import {
  HIGH_SURROGATE_FIRST_UNIT,
  HIGH_SURROGATE_LAST_UNIT,
  NODE_CAPTURE_REASON_LIMIT_CHARS,
} from '../constants'

import { stripTerminalControls } from './stripTerminalControls'

/**
 * Words why a test replay's capture is interrupted or partial for the Study section, so the learner reads the reason in the String catalog's words (DS14) on one line; called by {@link projectNodeTestSection} for each Study message of such a replay.
 * The stored reason comes from the store or from an error, so it may hold line breaks, control characters and the word "Node"; this keeps one short line without them.
 * @param reason - The history's stored reason, absent for a complete capture.
 * @returns The reason on one line (terminal, C1 and bidirectional controls removed, line breaks and runs of blanks collapsed, cut at {@link NODE_CAPTURE_REASON_LIMIT_CHARS} characters with an ellipsis), with "Node test history" and "Node history" read as "test replay" (their plurals as "test replays") and the first letter capitalized; `undefined` for no reason or an empty one.
 * @example
 * wordNodeCaptureReason('Interrupted Node history after its verified prefix: Error: EIO') // => 'Interrupted test replay after its verified prefix: Error: EIO'
 * wordNodeCaptureReason(undefined) // => undefined
 */
export function wordNodeCaptureReason(
  reason: string | undefined,
): string | undefined {
  const words = stripTerminalControls(reason ?? '')
    // ANSI sequences, C1 and bidirectional controls are gone (F288); the line breaks and tabs left become a blank.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\bNode (?:test )?histor(y|ies)\b/gi, (_match, ending: string) =>
      ending === 'y' ? 'test replay' : 'test replays',
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) return undefined
  const sentence = `${words.charAt(0).toUpperCase()}${words.slice(1)}`
  if (sentence.length <= NODE_CAPTURE_REASON_LIMIT_CHARS) return sentence
  // The cut falls between characters: a high surrogate left at its end goes, whether its pair follows or it stands alone (F288, F330).
  let cut = NODE_CAPTURE_REASON_LIMIT_CHARS - 1
  const lastUnit = sentence.charCodeAt(cut - 1)
  if (
    lastUnit >= HIGH_SURROGATE_FIRST_UNIT &&
    lastUnit <= HIGH_SURROGATE_LAST_UNIT
  )
    cut--
  return `${sentence.slice(0, cut)}…`
}
