import {
  REFUSAL_REPORT_EVENTS,
  REFUSAL_REPORT_GROUP_TABS,
  REFUSAL_REPORT_LABEL_CHARS,
} from '../constants'

/** One editor group as a refusal report names it. */
export type RefusalGroupView = {
  viewColumn: number
  isActive: boolean
  tabs: readonly { label: string; kind: string }[]
}

/** One change the editor reported while a placement guard was armed. */
export type RefusalEvent = {
  atMs: number
  what: string
}

/**
 * Keeps the last editor events (tab-group changes and active text editor changes) with their time, so a placement refusal can say what the editor reported while its guard waited; fed by {@link StudyWorkspace}'s group listener and read by {@link describePlacementRefusal}.
 * @example
 * const log = new PlacementEventLog()
 * log.record(10, 'groups closed [2]')
 */
export class PlacementEventLog {
  private readonly events: RefusalEvent[] = []

  /** Adds one event, dropping the oldest beyond {@link REFUSAL_REPORT_EVENTS}. @example log.record(performance.now(), 'groups opened [3]') */
  record(atMs: number, what: string): void {
    this.events.push({ atMs, what })
    if (this.events.length > REFUSAL_REPORT_EVENTS) this.events.shift()
  }

  /** Lists the events at or after a time. @example log.since(armedAtMs) // => [{ atMs: 12, what: 'groups closed [2]' }] */
  since(atMs: number): RefusalEvent[] {
    return this.events.filter((event) => event.atMs >= atMs)
  }
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
 * Words what a refused placement guard saw, for one Output › Codebook entry that names the guard, the groups before and after and the editor's events with the milliseconds since the guard was armed; called by {@link StudyWorkspace} when one of its three placement guards refuses.
 * @param input - The guard's name, the arm time, the groups at arm time and now, and the events since arming.
 * @returns The multi-line cause text.
 * @example describePlacementRefusal({ guard: 'placement', armedAtMs: 0, nowMs: 130, before, after, events }) // => 'Guard: placement\nArmed 130 ms before the refusal\nBefore: …'
 */
export function describePlacementRefusal(input: {
  guard: string
  armedAtMs: number
  nowMs: number
  before: readonly RefusalGroupView[]
  after: readonly RefusalGroupView[]
  events: readonly RefusalEvent[]
}): string {
  const events = input.events.length
    ? input.events.map(
        (event) =>
          `  +${Math.round(event.atMs - input.armedAtMs)} ms ${event.what}`,
      )
    : ['  none']
  return [
    `Guard: ${input.guard}`,
    `Armed ${Math.round(input.nowMs - input.armedAtMs)} ms before the refusal`,
    `Groups before: ${describeRefusalGroups(input.before).join(' | ')}`,
    `Groups after: ${describeRefusalGroups(input.after).join(' | ')}`,
    'Events while armed:',
    ...events,
  ].join('\n')
}
