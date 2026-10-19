import type { WikiUpdateMarkerClaim } from './claimWikiUpdateMarker'
import { formatClockTime } from './formatClockTime'
import { formatWaitEnd } from './formatWaitEnd'

/** What holds a Wiki against this window's start: another window's running update, a marker another window is writing or that stayed unreadable, or a marker another window is changing ({@link claimWikiUpdateMarker}). */
type OtherWikiWindowHolder = Extract<
  WikiUpdateMarkerClaim,
  { heldBy: unknown }
>['heldBy']

/**
 * Words the refusal of a Wiki update's start because another editor window holds the Wiki; nothing overrides it, so the sentence offers no Update anyway.
 *
 * Trigger: the extension's start checks call it for a marker another window is writing at the moment of the look, for a marker file that stayed unreadable, for another window's running update, and for a claim of the marker that another window won between the look and the write.
 *
 * @param holder - What holds the Wiki.
 * @returns
 * - A marker another window removes or replaces at this moment (it names no run): that a window is starting or ending an update, and to try again in a moment
 * - A marker file that stayed unreadable for longer than a write takes ({@link readLiveWikiUpdateMarker}): that another window may be updating the Wiki, the file, what can make it readable, and the first whole minute at which the refusal ends if the file stays as it is ({@link formatWaitEnd}; the file still counts at its last moment, so that minute is the one after it)
 * - A marker another window is writing (it names no run yet): that a window is starting an update, and to try again in a moment
 * - Another window's running update: its editor and start time, and to press Update LLM Wiki again once it has finished
 * @example
 * describeOtherWikiWindow({ isMarkerInChange: true })
 * // => 'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.'
 * describeOtherWikiWindow({ beingWrittenSinceMs: 1_790_000_000_000, unreadableMarkerPath: '/repo/.codebook/wiki.update-run.json', countsUntilMs: 1_790_001_290_000 })
 * // => 'Another editor window may be updating this Wiki: Codebook cannot read the Wiki’s marker file (/repo/.codebook/wiki.update-run.json), … if the file stays as it is, this refusal ends at 14:35 UTC.' on a host in UTC
 * describeOtherWikiWindow({ pid: 4242, windowId: '3f6c', host: 'cursor', startedAtMs: 1_790_000_000_000 })
 * // => 'Another editor window is updating this Wiki (Cursor, started 14:13). Wait for it to finish, then press Update LLM Wiki again.'
 */
export function describeOtherWikiWindow(holder: OtherWikiWindowHolder): string {
  // A marker another window removes or replaces at this moment names no run.
  if ('isMarkerInChange' in holder)
    return 'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.'
  // A marker file that stayed unreadable past the moment a write takes may stand for a run until its last moment; a refusal for that long names the file and its end.
  if ('unreadableMarkerPath' in holder) {
    // The file still counts at its last moment, so the refusal ends in the millisecond after it.
    const refusalEndsAtMs = holder.countsUntilMs + 1
    return `Another editor window may be updating this Wiki: Codebook cannot read the Wiki’s marker file (${holder.unreadableMarkerPath}), which another program may hold open (as a scanner or an indexer can on Windows) or which this user may not read. Press Update LLM Wiki again once the file can be read; if the file stays as it is, this refusal ends at ${formatWaitEnd(refusalEndsAtMs)}.`
  }
  // A marker another window is writing names no run yet.
  if ('beingWrittenSinceMs' in holder)
    return 'Another editor window is starting an update of this Wiki. Wait a moment and try again.'
  return `Another editor window is updating this Wiki (${holder.host === 'cursor' ? 'Cursor' : 'VS Code'}, started ${formatClockTime(holder.startedAtMs, {})}). Wait for it to finish, then press Update LLM Wiki again.`
}
