import {
  REFUSAL_REPORT_EVENTS,
  REFUSAL_REPORT_GROUP_TABS,
  REFUSAL_REPORT_LABEL_CHARS,
} from '../constants'

/** One tab as a refusal report names the active tab of a group: its label, input kind and whether it is a preview or a pinned tab. */
export type RefusalTabView = {
  label: string
  kind: string
  isPreview: boolean
  isPinned: boolean
}

/** One editor group as a refusal report names it; `activeTab` is the tab the group showed, when it showed one. */
export type RefusalGroupView = {
  viewColumn: number
  isActive: boolean
  tabs: readonly { label: string; kind: string }[]
  activeTab?: RefusalTabView
}

/** One change the editor reported while a placement guard was armed. */
export type RefusalEvent = {
  atMs: number
  what: string
}

/**
 * Keeps the last notes (the editor's tab-group changes, tab operations, active text editor changes and pane view-state changes, or the effects Codebook itself issued) with their time, so a placement refusal can say what happened while its guard waited; fed by {@link StudyWorkspace}'s listeners and effect wrappers and read by {@link describePlacementRefusal}.
 * @param capacity - How many notes are kept; the editor's events keep {@link REFUSAL_REPORT_EVENTS}, Codebook's own effects `REFUSAL_REPORT_EFFECTS` (set by the caller).
 * @example
 * const log = new PlacementEventLog()
 * log.record(10, 'groups closed [2]')
 */
export class PlacementEventLog {
  private readonly events: RefusalEvent[] = []

  constructor(private readonly capacity: number = REFUSAL_REPORT_EVENTS) {}

  /** Adds one note, dropping the oldest beyond the capacity. @example log.record(performance.now(), 'groups opened [3]') */
  record(atMs: number, what: string): void {
    this.events.push({ atMs, what })
    if (this.events.length > this.capacity) this.events.shift()
  }

  /** Lists the events at or after a time. @example log.since(armedAtMs) // => [{ atMs: 12, what: 'groups closed [2]' }] */
  since(atMs: number): RefusalEvent[] {
    return this.events.filter((event) => event.atMs >= atMs)
  }
}

/**
 * Words one tab for a refusal report: the label (cut), the input kind and the preview and pinned flags.
 * @param tab - The tab, with a sanitized label; `undefined` for a group or an editor that shows none.
 * @returns The tab's words, or `none`.
 * @example describeRefusalTab({ label: 'data.ts', kind: 'text', isPreview: true, isPinned: false }) // => '"data.ts" (text, preview)'
 */
function describeRefusalTab(tab: RefusalTabView | undefined): string {
  if (!tab) return 'none'
  const flags = [
    tab.kind,
    ...(tab.isPreview ? ['preview'] : []),
    ...(tab.isPinned ? ['pinned'] : []),
  ]
  return `"${Array.from(tab.label).slice(0, REFUSAL_REPORT_LABEL_CHARS).join('')}" (${flags.join(', ')})`
}

/**
 * Words the editor groups for a refusal report: one line per group with its column, whether it is the active group and its tabs (label cut, input kind), bounded.
 * @param groups - The groups, in the editor's order; labels are already sanitized.
 * @returns One line per group.
 * @example describeRefusalGroups([{ viewColumn: 1, isActive: true, tabs: [{ label: 'auth.ts', kind: 'text' }] }]) // => ['1* [auth.ts (text)]']
 */
function describeRefusalGroups(groups: readonly RefusalGroupView[]): string[] {
  return groups.map((group) => {
    const shown = group.tabs
      .slice(0, REFUSAL_REPORT_GROUP_TABS)
      .map(
        (tab) =>
          `${Array.from(tab.label).slice(0, REFUSAL_REPORT_LABEL_CHARS).join('')} (${tab.kind})`,
      )
    const more = group.tabs.length - shown.length
    return `${group.viewColumn}${group.isActive ? '*' : ''} [${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}]`
  })
}

/**
 * Words the tab each group showed, one entry per group that showed one, for the two lines that name the front tabs before and after.
 * @param groups - The groups, in the editor's order; labels are already sanitized.
 * @returns `column tab` entries, or an empty list when no group named its front tab.
 * @example describeFrontTabs([{ viewColumn: 3, isActive: true, tabs: [], activeTab: { label: 'data.ts', kind: 'text', isPreview: false, isPinned: false } }]) // => ['3* "data.ts" (text)']
 */
function describeFrontTabs(groups: readonly RefusalGroupView[]): string[] {
  return groups.flatMap((group) =>
    group.activeTab
      ? [
          `${group.viewColumn}${group.isActive ? '*' : ''} ${describeRefusalTab(group.activeTab)}`,
        ]
      : [],
  )
}

/**
 * Words the lines of a list of timed notes, as milliseconds since the guard was armed.
 * @param events - The notes, oldest first.
 * @param armedAtMs - The time the guard was armed.
 * @returns One line per note, or one line saying `none`.
 * @example describeRefusalEvents([{ atMs: 12, what: 'groups closed [2]' }], 10) // => ['  +2 ms groups closed [2]']
 */
function describeRefusalEvents(
  events: readonly RefusalEvent[],
  armedAtMs: number,
): string[] {
  return events.length
    ? events.map(
        (event) => `  +${Math.round(event.atMs - armedAtMs)} ms ${event.what}`,
      )
    : ['  none']
}

/**
 * Words what a refused placement guard saw, for one Output › Codebook entry that names the guard, the groups before and after and the editor's events with the milliseconds since the guard was armed; called by {@link StudyWorkspace} when one of its placement guards refuses.
 * The guard's call site, the checks that failed, each group's front tab, the focused tab at arming against the active tab at the refusal and the effects Codebook itself issued since arming are optional: a guard that does not name them prints the first lines only.
 * @param input - The guard's name, the arm time, the groups at arm time and now, and the events since arming; optionally the call site, the failed checks, the focused tab then and the active tab now, and Codebook's own effects since arming.
 * @returns The multi-line cause text.
 * @example describePlacementRefusal({ guard: 'placement', armedAtMs: 0, nowMs: 130, before, after, events }) // => 'Guard: placement\nArmed 130 ms before the refusal\nBefore: …'
 */
export function describePlacementRefusal(input: {
  guard: string
  callSite?: string
  failedChecks?: readonly string[]
  armedAtMs: number
  nowMs: number
  before: readonly RefusalGroupView[]
  after: readonly RefusalGroupView[]
  focus?: {
    atArming: RefusalTabView | undefined
    atRefusal: RefusalTabView | undefined
  }
  events: readonly RefusalEvent[]
  effects?: readonly RefusalEvent[]
}): string {
  return [
    `Guard: ${input.guard}`,
    ...(input.callSite === undefined ? [] : [`Call site: ${input.callSite}`]),
    ...(input.failedChecks === undefined
      ? []
      : [
          `Failed checks: ${input.failedChecks.length ? input.failedChecks.join(', ') : 'none'}`,
        ]),
    `Armed ${Math.round(input.nowMs - input.armedAtMs)} ms before the refusal`,
    `Groups before: ${describeRefusalGroups(input.before).join(' | ')}`,
    `Groups after: ${describeRefusalGroups(input.after).join(' | ')}`,
    ...(input.before.some((group) => group.activeTab)
      ? [
          `Front tabs before: ${describeFrontTabs(input.before).join(' | ')}`,
          `Front tabs after: ${describeFrontTabs(input.after).join(' | ')}`,
        ]
      : []),
    ...(input.focus
      ? [
          `Focused tab at arming: ${describeRefusalTab(input.focus.atArming)}`,
          `Active tab at refusal: ${describeRefusalTab(input.focus.atRefusal)}`,
        ]
      : []),
    'Events while armed:',
    ...describeRefusalEvents(input.events, input.armedAtMs),
    ...(input.effects
      ? [
          'Codebook’s own effects since arming:',
          ...describeRefusalEvents(input.effects, input.armedAtMs),
        ]
      : []),
  ].join('\n')
}
