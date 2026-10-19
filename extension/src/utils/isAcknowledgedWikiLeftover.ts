/**
 * An earlier chat's or another window's leftover that refused a Wiki update's start, as the refusal named it; "Update anyway" carries the leftovers it was offered for.
 *
 * - `reservation`: another window's stopped watch, by that window's id and its run's start
 * - `candidate`: the most recent active candidate, by its folder name
 * - `last-run`: this window's own stopped watch, by when it ended
 */
export type WikiLeftover =
  | { kind: 'reservation'; windowId: string; startedAtMs: number }
  | { kind: 'candidate'; name: string }
  | { kind: 'last-run'; endedAtMs: number }

/**
 * Names a leftover by the fields that tell it from any other of its kind; called by {@link isAcknowledgedWikiLeftover} for both sides of a comparison.
 * @param leftover - A leftover of any kind.
 * @returns The kind and its naming fields as one JSON text.
 * @example
 * leftoverKey({ kind: 'candidate', name: 'wiki.stage-1' }) // => '["candidate","wiki.stage-1"]'
 */
function leftoverKey(leftover: WikiLeftover): string {
  if (leftover.kind === 'reservation')
    return JSON.stringify([
      leftover.kind,
      leftover.windowId,
      leftover.startedAtMs,
    ])
  return JSON.stringify([
    leftover.kind,
    leftover.kind === 'candidate' ? leftover.name : leftover.endedAtMs,
  ])
}

/**
 * Says whether a leftover the start checks found now is one the learner chose "Update anyway" for; called by the extension's start checks for each leftover, so a press answers only the refusal it was offered on.
 *
 * Why: the refusal's notification stays in the editor's Notification Center, and a press there minutes later must not start a second agent beside a chat or a window that began after the refusal.
 *
 * @param leftover - A leftover the start checks found now.
 * @param acknowledged - The leftovers the refusal named when "Update anyway" was offered; empty for an ordinary press.
 * @returns `true` only when one of them is the same leftover: the same window and start, the same candidate, or the same end of this window's watch.
 * @example
 * isAcknowledgedWikiLeftover({ kind: 'candidate', name: 'wiki.stage-2' }, [{ kind: 'candidate', name: 'wiki.stage-1' }]) // => false
 * isAcknowledgedWikiLeftover({ kind: 'last-run', endedAtMs: 1_000 }, [{ kind: 'last-run', endedAtMs: 1_000 }])         // => true
 */
export function isAcknowledgedWikiLeftover(
  leftover: WikiLeftover,
  acknowledged: readonly WikiLeftover[],
): boolean {
  const key = leftoverKey(leftover)
  return acknowledged.some((named) => leftoverKey(named) === key)
}
