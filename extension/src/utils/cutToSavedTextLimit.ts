import {
  REDACTION_MASK,
  REPLAY_DEBUG_TEXT_LIMIT_CHARS,
  REPLAY_DEBUG_TRUNCATION_MARKER,
} from '../constants'

/**
 * Cuts a masked text to the length the debugger snapshot schema accepts, ending it with {@link REPLAY_DEBUG_TRUNCATION_MARKER}.
 * Why: masking can lengthen a text (`code=x` reads `code=[masked]`), so a saved text that fit before may not after; the snapshot schema (and the replay select that checks it again) rejects a text above {@link REPLAY_DEBUG_TEXT_LIMIT_CHARS}, and the stop could no longer be replayed. The cut comes after masking, never before, so no cut leaves a fragment of a secret that is too short for a shape rule to match. Called by {@link captureReplayDebugSnapshot} for every field it saves and by {@link maskSavedDebugSnapshot} for every preview it masks.
 * @param text - A text already masked.
 * @returns `text` itself when it fits; otherwise its beginning plus the marker, at most {@link REPLAY_DEBUG_TEXT_LIMIT_CHARS} characters. A {@link REDACTION_MASK} the cut would split is dropped whole, so no damaged mask such as `[mas` is saved.
 * @example
 * cutToSavedTextLimit('short') // => 'short'
 * cutToSavedTextLimit('x'.repeat(5_000)).length // => 4_096
 * cutToSavedTextLimit(`${'x'.repeat(4_080)}[masked]${'y'.repeat(20)}`) // => `${'x'.repeat(4_080)}… [truncated]` (the cut at 4,083 would split the mask)
 */
export function cutToSavedTextLimit(text: string): string {
  if (text.length <= REPLAY_DEBUG_TEXT_LIMIT_CHARS) return text
  let keptLength =
    REPLAY_DEBUG_TEXT_LIMIT_CHARS - REPLAY_DEBUG_TRUNCATION_MARKER.length
  // The last mask that starts inside the kept part; if it reaches past the cut, the cut keeps none of it.
  const maskStart = text.lastIndexOf(REDACTION_MASK, keptLength - 1)
  if (maskStart >= 0 && maskStart + REDACTION_MASK.length > keptLength)
    keptLength = maskStart
  return `${text.slice(0, keptLength)}${REPLAY_DEBUG_TRUNCATION_MARKER}`
}
