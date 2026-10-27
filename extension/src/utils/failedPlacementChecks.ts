/** The comparisons a placement guard makes between arming and asserting, each `true` when nothing changed. */
export type PlacementChecks = {
  groups: boolean
  panePositions: boolean
  focusGroup: boolean
  webviewTab: boolean
  closeRevision: boolean
  source: boolean
  appActive: boolean
  contextActive: boolean
}

// The comparisons that only a guard retaining the learner's focus makes.
const FOCUS_CHECKS = [
  'focusGroup',
  'webviewTab',
  'closeRevision',
  'source',
  'appActive',
  'contextActive',
] as const satisfies readonly (keyof PlacementChecks)[]

// How a refusal report names each comparison.
const CHECK_NAMES: Record<keyof PlacementChecks, string> = {
  groups: 'groups',
  panePositions: 'pane positions',
  focusGroup: 'focus group',
  webviewTab: 'webview tab',
  closeRevision: 'close revision',
  source: 'source',
  appActive: 'app active',
  contextActive: 'context active',
}

/**
 * Names the comparisons of a placement guard that failed, so a refusal's report says which one refused; called by {@link StudyWorkspace}'s `retainPresentationPlacement` guard each time it asserts.
 * The focus comparisons count only for a guard that retains the focus; a guard that does not retain it is not refused by them.
 * @param checks - Each comparison, `true` when nothing changed.
 * @param retainFocus - Whether the guard retains the learner's focus.
 * @returns The names of the failed comparisons in report order; empty when the guard passes.
 * @example failedPlacementChecks({ ...allSame, focusGroup: false }, true) // => ['focus group']
 */
export function failedPlacementChecks(
  checks: PlacementChecks,
  retainFocus: boolean,
): string[] {
  const names: (keyof PlacementChecks)[] = ['groups', 'panePositions']
  if (retainFocus) names.push(...FOCUS_CHECKS)
  return names.filter((name) => !checks[name]).map((name) => CHECK_NAMES[name])
}
