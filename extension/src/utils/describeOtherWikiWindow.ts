import type { WikiUpdateMarkerClaim } from './claimWikiUpdateMarker'
import { formatClockTime } from './formatClockTime'

/** What holds a Wiki against this window's start: another window's running update, a marker another window is writing, or a marker another window is changing ({@link claimWikiUpdateMarker}). */
type OtherWikiWindowHolder = Extract<
  WikiUpdateMarkerClaim,
  { heldBy: unknown }
>['heldBy']

/**
 * Words the refusal of a Wiki update's start because another editor window holds the Wiki; nothing overrides it, so the sentence offers no Update anyway.
 *
 * Trigger: the extension's start checks call it for a marker another window is writing at the moment of the look, for another window's running update, and for a claim of the marker that another window won between the look and the write.
 *
 * @param holder - What holds the Wiki.
 * @returns
 * - A marker another window removes or replaces at this moment (it names no run): that a window is starting or ending an update, and to try again in a moment
 * - A marker another window is writing (it names no run yet): that a window is starting an update, and to try again in a moment
 * - Another window's running update: its editor and start time, and to press Update LLM Wiki again once it has finished
 * @example
 * describeOtherWikiWindow({ isMarkerInChange: true })
 * // => 'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.'
 * describeOtherWikiWindow({ pid: 4242, windowId: '3f6c', host: 'cursor', startedAtMs: 1_790_000_000_000 })
 * // => 'Another editor window is updating this Wiki (Cursor, started 14:13). Wait for it to finish, then press Update LLM Wiki again.'
 */
export function describeOtherWikiWindow(holder: OtherWikiWindowHolder): string {
  // A marker another window removes or replaces at this moment names no run.
  if ('isMarkerInChange' in holder)
    return 'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.'
  // A marker another window is writing names no run yet.
  if ('beingWrittenSinceMs' in holder)
    return 'Another editor window is starting an update of this Wiki. Wait a moment and try again.'
  return `Another editor window is updating this Wiki (${holder.host === 'cursor' ? 'Cursor' : 'VS Code'}, started ${formatClockTime(holder.startedAtMs, {})}). Wait for it to finish, then press Update LLM Wiki again.`
}
