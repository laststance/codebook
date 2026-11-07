/**
 * Host-order replay of a recorded editor-event trace (Cycle 0094 task 12, decision D8 and its alignment contract).
 *
 * A native take records, per editor host, the order, timing, duplicates and active-state flags of the five listener events Codebook hears (`onDidChangeTabs`, `onDidChangeTabGroups`, `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorSelection`). The workspace harness' fake host models the same operations in its own order. This module parses the trace, matches the fake's operations to trace events, and delivers the trace's order and gaps to the workspace's listeners instead of the fake's.
 *
 * What it claims: event order, timing, duplicates and active-group/active-tab state. What it does not: the structure (tabs and groups opened or closed, layout) at the moment of delivery; that stays the fake's post-operation structure.
 *
 * Called by {@link workspaceHarness} (`hostOrder` option) and by `hostTraceReplay.test.ts`.
 */

/** Longest real wait the replay puts between two delivered trace events, however long the host really waited. */
export const HOST_TRACE_MAX_GAP_MS = 2_000

/** The listener events the replay reorders; the names are the trace's event kinds. */
export const HOST_TRACE_LISTENER_KINDS = [
  'tabsChanged',
  'groupsChanged',
  'activeTextEditor',
  'visibleTextEditors',
  'selection',
] as const

/** Names a listener event of the host. @example const kind: HostListenerKind = 'tabsChanged' */
export type HostListenerKind = (typeof HOST_TRACE_LISTENER_KINDS)[number]

const SNAPSHOT_KIND = 'tabGroups'
const LAYOUT_KIND = 'editorLayout'
const RELOAD_KIND = 'reload'
const MARK_KIND = 'mark'
const KNOWN_TRACE_KINDS: readonly string[] = [
  ...HOST_TRACE_LISTENER_KINDS,
  SNAPSHOT_KIND,
  LAYOUT_KIND,
  RELOAD_KIND,
  MARK_KIND,
]
const HEADER_FIELDS = [
  'host',
  'hostVersion',
  'os',
  'sequence',
  'codebookVersion',
  'recorderVersion',
  'startedAt',
] as const

/** Kinds of tab input the recorder names. */
export type HostTraceInputKind =
  'text' | 'webview' | 'diff' | 'notebook' | 'custom' | 'terminal' | 'unknown'

/** One tab of a recorded `tabGroups` snapshot. */
export interface TraceTab {
  label: string
  input: { kind: HostTraceInputKind; uri?: string; viewType?: string }
  isActive: boolean
  isPreview: boolean
}

/** One editor group of a recorded `tabGroups` snapshot. */
export interface TraceGroup {
  viewColumn: number
  isActive: boolean
  tabs: TraceTab[]
}

/** The full tab-group state the recorder wrote after an event. */
export interface TabGroupsSnapshot {
  groups: TraceGroup[]
  activeGroupIndex: number
}

/** The first line of a trace file. */
export type HostTraceHeader = Record<(typeof HEADER_FIELDS)[number], string>

/** What an event names, in terms both the trace and the fake host can state: a group by its column, a tab by its label and input kind, a text editor by the file name of its document and its column (a trace comes from another machine, so its paths differ from the fake's). An undefined `column` matches any. */
export type HostObjectRef =
  | { type: 'group'; column?: number }
  | {
      type: 'tab'
      column?: number
      label: string
      inputKind: HostTraceInputKind
    }
  | { type: 'editor'; name: string; column?: number }

/** The roles an event's tabs or groups play. */
type Role = 'opened' | 'closed' | 'changed'

/** One deliverable listener event of a trace, with what it names and the snapshot recorded with it. */
export interface HostTraceEvent {
  seq: number
  tMs: number
  kind: HostListenerKind
  data: unknown
  /** Every object the event names, in order. */
  objects: HostObjectRef[]
  /** The objects of a tab or group event by role, for building the payload of an unsolicited event. */
  roles: Record<Role, HostObjectRef[]>
  /** Whether the event can only be matched by its kind (the fake's `visibleTextEditors` notice has no payload). */
  kindOnly: boolean
  /** The `tabGroups` snapshot that follows the event in the stream: the state recorded with it. */
  snapshot?: TabGroupsSnapshot
  /** The last `editorLayout` the host answered after this event and before the next listener event: the layout it had settled on (a host resizes groups as it activates them, which the fake does not derive). */
  layout?: unknown
}

/** The events between two reloads (or the whole trace when none). */
export interface HostTraceSegment {
  events: HostTraceEvent[]
  /** The last `tabGroups` snapshot of the segment. */
  endSnapshot?: TabGroupsSnapshot
  /** The `reload` event that ends the segment; absent for the last one. */
  reload?: { unrecordedFromMs: number; unrecordedToMs: number }
}

/** A step boundary the take's author typed (the recorder's Mark command): where a window of the take starts or ends. */
export interface HostTraceMark {
  label: string
  seq: number
  tMs: number
  /** The segment the mark stands in. */
  segmentIndex: number
  /** How many of the segment's listener events came before the mark: the first event after it is `events[eventCount]`. */
  eventCount: number
  /** The `tabGroups` snapshot recorded with the mark: the state the step starts from. */
  snapshot?: TabGroupsSnapshot
  /** The last `editorLayout` recorded before the mark. */
  layout?: unknown
}

/** A validated trace. */
export interface ParsedHostTrace {
  header: HostTraceHeader
  segments: HostTraceSegment[]
  /** The marks of the take, in order. */
  marks: HostTraceMark[]
  /** The file's last `tabGroups` snapshot and `editorLayout`: what a replay's final fake state must equal. */
  finalSnapshot?: TabGroupsSnapshot
  finalLayout?: unknown
}

/** Names a failure of trace parsing or replay; `code` is the stable reason. */
export class HostTraceError extends Error {
  constructor(
    readonly code:
      | 'trace-header-missing'
      | 'trace-malformed'
      | 'trace-unknown-kind'
      | 'trace-seq-not-increasing'
      | 'trace-mapping-failed'
      | 'trace-window-invalid',
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'HostTraceError'
  }
}

type Json = Record<string, unknown>

/** The last path segment of a document URI, without query or fragment: how an editor is named across machines. A URI with a scheme and no slash (`codebook-source:Captured-a.ts`, as the recorder writes a virtual document) is named by the part after the scheme. @example fileNameOf('file:///repo/src/a.ts?x=1') // => 'a.ts' @example fileNameOf('codebook-source:Captured-a.ts') // => 'Captured-a.ts' */
export function fileNameOf(uri: string): string {
  return uri.split(/[?#]/)[0]!.split(/[/:]/).at(-1) ?? ''
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordsOf(value: unknown): Json[] {
  return asArray(value).filter(isRecord)
}

/** Reads a recorded snapshot's shape; anything else is a malformed trace. */
function toSnapshot(data: unknown, seq: number): TabGroupsSnapshot {
  if (!isRecord(data) || !Array.isArray(data.groups))
    throw new HostTraceError(
      'trace-malformed',
      `tabGroups snapshot at seq ${seq} has no groups array`,
    )
  return {
    groups: recordsOf(data.groups).map((group) => ({
      viewColumn: Number(group.viewColumn),
      isActive: group.isActive === true,
      tabs: recordsOf(group.tabs).map((tab) => ({
        label: String(tab.label),
        input: isRecord(tab.input)
          ? {
              kind: tab.input.kind as HostTraceInputKind,
              uri:
                typeof tab.input.uri === 'string' ? tab.input.uri : undefined,
              viewType:
                typeof tab.input.viewType === 'string'
                  ? tab.input.viewType
                  : undefined,
            }
          : { kind: 'unknown' },
        isActive: tab.isActive === true,
        isPreview: tab.isPreview === true,
      })),
    })),
    activeGroupIndex: Number(data.activeGroupIndex ?? -1),
  }
}

/**
 * Finds the column of the group at an index of a recorded snapshot; the event's own recorded state first, then its neighbor.
 * @param role - `closed` objects stood in the state before the event, the others in the state after it.
 */
function columnAt(
  groupIndex: number,
  role: Role,
  before: TabGroupsSnapshot | undefined,
  after: TabGroupsSnapshot | undefined,
): number | undefined {
  const [first, second] = role === 'closed' ? [before, after] : [after, before]
  return (
    first?.groups[groupIndex]?.viewColumn ??
    second?.groups[groupIndex]?.viewColumn
  )
}

/** Builds what an event names and its objects by role, from the trace's data and its neighboring snapshots. */
function describeTraceEvent(
  kind: HostListenerKind,
  data: unknown,
  before: TabGroupsSnapshot | undefined,
  after: TabGroupsSnapshot | undefined,
): Pick<HostTraceEvent, 'objects' | 'roles' | 'kindOnly'> {
  const roles: Record<Role, HostObjectRef[]> = {
    opened: [],
    closed: [],
    changed: [],
  }
  if (kind === 'tabsChanged' || kind === 'groupsChanged') {
    // The recorder reads a closed group's index after it closed, so it writes -1: such a group is one the snapshot before had and the one after lacks.
    const removedColumns = (before?.groups ?? [])
      .map((group) => group.viewColumn)
      .filter(
        (column) => !after?.groups.some((group) => group.viewColumn === column),
      )
    for (const role of ['opened', 'closed', 'changed'] as const)
      for (const entry of recordsOf(isRecord(data) ? data[role] : undefined)) {
        const groupIndex = Number(entry.groupIndex)
        const column =
          kind === 'groupsChanged' && role === 'closed' && groupIndex < 0
            ? removedColumns.shift()
            : columnAt(groupIndex, role, before, after)
        roles[role].push(
          kind === 'groupsChanged'
            ? { type: 'group', column }
            : {
                type: 'tab',
                column,
                label: String(entry.label),
                inputKind: entry.inputKind as HostTraceInputKind,
              },
        )
      }
    return {
      objects: [...roles.opened, ...roles.closed, ...roles.changed],
      roles,
      kindOnly: false,
    }
  }
  if (kind === 'visibleTextEditors')
    return { objects: [], roles, kindOnly: true }
  // activeTextEditor and selection name one text editor, or none.
  const uri = isRecord(data) ? data.uri : undefined
  const column = isRecord(data) ? data.viewColumn : undefined
  return {
    objects:
      typeof uri === 'string'
        ? [
            {
              type: 'editor',
              name: fileNameOf(uri),
              column: typeof column === 'number' ? column : undefined,
            },
          ]
        : [],
    roles,
    kindOnly: false,
  }
}

/**
 * Parses and validates a recorded host trace, and splits it at its `reload` events into segments.
 *
 * Called by every replay before the harness is built, so a malformed take fails here with a named reason instead of as a mismatching replay.
 * @param text - The JSONL file: a header line, then events with strictly increasing `seq`.
 * @returns The validated trace.
 * @throws {@link HostTraceError} `trace-header-missing` when line 1 is not a header with every field; `trace-malformed` also for a header whose `formatVersion` is not 1; `trace-unknown-kind` for an event kind the format does not name; `trace-seq-not-increasing` when `seq` does not strictly increase; `trace-malformed` for a line that is not JSON or lacks `seq`, `tMs` or `kind`.
 * @example
 * ```ts
 * const trace = parseHostTrace(readFileSync('take.jsonl', 'utf8'))
 * trace.segments.length // => 1 without a Reload Window
 * ```
 */
export function parseHostTrace(text: string): ParsedHostTrace {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const parse = (line: string, index: number): unknown => {
    try {
      return JSON.parse(line)
    } catch {
      throw new HostTraceError(
        'trace-malformed',
        `line ${index + 1} is not JSON`,
      )
    }
  }
  const header = lines.length > 0 ? parse(lines[0]!, 0) : undefined
  if (
    !isRecord(header) ||
    HEADER_FIELDS.some((field) => typeof header[field] !== 'string')
  )
    throw new HostTraceError(
      'trace-header-missing',
      `line 1 must be a header with ${HEADER_FIELDS.join(', ')}`,
    )
  // A header without formatVersion predates the field; one that names another version is not this format.
  if (header.formatVersion !== undefined && header.formatVersion !== 1)
    throw new HostTraceError(
      'trace-malformed',
      `header names formatVersion ${String(header.formatVersion)}, this parser reads 1`,
    )
  const rawEvents = lines.slice(1).map((line, index) => {
    const value = parse(line, index + 1)
    if (
      !isRecord(value) ||
      typeof value.seq !== 'number' ||
      typeof value.tMs !== 'number' ||
      typeof value.kind !== 'string'
    )
      throw new HostTraceError(
        'trace-malformed',
        `line ${index + 2} needs numeric seq and tMs and a kind`,
      )
    return value as { seq: number; tMs: number; kind: string; data: unknown }
  })
  let previousSeq = -Infinity
  for (const event of rawEvents) {
    if (!KNOWN_TRACE_KINDS.includes(event.kind))
      throw new HostTraceError(
        'trace-unknown-kind',
        `seq ${event.seq} has the unknown kind "${event.kind}"`,
      )
    // seq must grow strictly, or the order the replay delivers is not the recorded one.
    if (event.seq <= previousSeq)
      throw new HostTraceError(
        'trace-seq-not-increasing',
        `seq ${event.seq} follows seq ${previousSeq}`,
      )
    previousSeq = event.seq
  }
  const segments: HostTraceSegment[] = [{ events: [] }]
  const marks: HostTraceMark[] = []
  // The mark whose snapshot line has not come yet.
  let openMark: HostTraceMark | undefined
  let lastSnapshot: TabGroupsSnapshot | undefined
  let finalLayout: unknown
  let finalSnapshot: TabGroupsSnapshot | undefined
  rawEvents.forEach((event, index) => {
    const segment = segments.at(-1)!
    if (event.kind === SNAPSHOT_KIND) {
      lastSnapshot = toSnapshot(event.data, event.seq)
      finalSnapshot = lastSnapshot
      segment.endSnapshot = lastSnapshot
      // The snapshot after a mark is the state its step starts from.
      if (openMark) {
        openMark.snapshot = lastSnapshot
        openMark = undefined
        return
      }
      // The snapshot after an event is the state recorded with it.
      const pending = segment.events.at(-1)
      if (pending && pending.snapshot === undefined)
        attachSnapshot(pending, lastSnapshot)
      return
    }
    if (event.kind === MARK_KIND) {
      openMark = {
        label: String(isRecord(event.data) ? event.data.label : ''),
        seq: event.seq,
        tMs: event.tMs,
        segmentIndex: segments.length - 1,
        eventCount: segment.events.length,
        layout: finalLayout,
      }
      marks.push(openMark)
      return
    }
    if (event.kind === LAYOUT_KIND) {
      finalLayout = event.data
      // The layout belongs to the listener event before it; a later read replaces an earlier one of the same event.
      const owner = segment.events.at(-1)
      if (owner) owner.layout = event.data
      return
    }
    if (event.kind === RELOAD_KIND) {
      const range = isRecord(event.data) ? event.data : {}
      segment.reload = {
        unrecordedFromMs: Number(range.unrecordedFromMs),
        unrecordedToMs: Number(range.unrecordedToMs),
      }
      segments.push({ events: [] })
      // A reload writes a fresh snapshot on resume, so no earlier state carries over.
      lastSnapshot = undefined
      return
    }
    const kind = event.kind as HostListenerKind
    const described = describeTraceEvent(
      kind,
      event.data,
      lastSnapshot,
      followingSnapshot(rawEvents, index),
    )
    segment.events.push({
      seq: event.seq,
      tMs: event.tMs,
      kind,
      data: event.data,
      ...described,
    })
  })
  const fields = Object.fromEntries(
    HEADER_FIELDS.map((field) => [field, String(header[field])]),
  )
  return {
    header: { ...fields } as HostTraceHeader,
    segments,
    marks,
    finalSnapshot,
    finalLayout,
  }
}

/** The first `tabGroups` snapshot after an index of the stream, before the next listener event. */
function followingSnapshot(
  rawEvents: { kind: string; data: unknown; seq: number }[],
  index: number,
): TabGroupsSnapshot | undefined {
  for (const next of rawEvents.slice(index + 1)) {
    if (next.kind === SNAPSHOT_KIND) return toSnapshot(next.data, next.seq)
    if ((HOST_TRACE_LISTENER_KINDS as readonly string[]).includes(next.kind))
      return undefined
  }
  return undefined
}

/** Attaches the snapshot recorded with an event, and refines the columns of its objects that the state before could not name. */
function attachSnapshot(
  event: HostTraceEvent,
  snapshot: TabGroupsSnapshot,
): void {
  event.snapshot = snapshot
}

/**
 * What a model burst's one event names; produced from the fake's listener call.
 * @example { kind: 'tabsChanged', objects: [{ type: 'tab', column: 1, label: 'a.ts', inputKind: 'text' }], kindOnly: false }
 */
export interface ModelEvent {
  kind: HostListenerKind
  objects: HostObjectRef[]
  kindOnly: boolean
}

/** Says whether a name in a model event is the same object as a name in a trace event. A column known on both sides must agree. */
function sameObject(model: HostObjectRef, trace: HostObjectRef): boolean {
  if (model.type !== trace.type) return false
  if (
    model.column !== undefined &&
    trace.column !== undefined &&
    model.column !== trace.column
  )
    return false
  if (model.type === 'tab' && trace.type === 'tab')
    return model.label === trace.label && model.inputKind === trace.inputKind
  if (model.type === 'editor' && trace.type === 'editor')
    return model.name === trace.name
  return true
}

/**
 * Says whether one trace event can be the host's side of one model event: same kind, and every object the fake's event names is named by the trace event.
 * @example coversModelEvent(model, traceEvent) // => true when both are tab changes of a.ts in column 1
 */
export function coversModelEvent(
  model: ModelEvent,
  event: Pick<HostTraceEvent, 'kind' | 'objects' | 'kindOnly'>,
): boolean {
  if (model.kind !== event.kind) return false
  if (model.kindOnly || event.kindOnly) return true
  // An event that names nothing (no active editor) matches only a trace event that names nothing.
  if (model.objects.length === 0) return event.objects.length === 0
  return model.objects.every((name) =>
    event.objects.some((other) => sameObject(name, other)),
  )
}

/** Assigns each model event to a distinct trace event of a window, if every model event can be covered. */
function coverWindow(
  models: ModelEvent[],
  window: HostTraceEvent[],
): number[] | undefined {
  const assignedTo: number[] = new Array(window.length).fill(-1)
  const tryAssign = (modelIndex: number, seen: Set<number>): boolean => {
    for (let slot = 0; slot < window.length; slot++) {
      if (
        seen.has(slot) ||
        !coversModelEvent(models[modelIndex]!, window[slot]!)
      )
        continue
      seen.add(slot)
      if (assignedTo[slot] === -1 || tryAssign(assignedTo[slot]!, seen)) {
        assignedTo[slot] = modelIndex
        return true
      }
    }
    return false
  }
  for (let index = 0; index < models.length; index++)
    if (!tryAssign(index, new Set())) return undefined
  return assignedTo
}

/** A run of consecutive unconsumed trace events that covers a model burst. */
export interface CoveringRun {
  /** Index of the run's first event in the segment's events. */
  start: number
  /** Index of the run's last event. */
  end: number
  /** For each event of the run, the index of the model event it covers, or -1 for a duplicate, flag flip or other event that goes with the run. */
  modelIndexOf: number[]
}

/**
 * The matcher of contract rule 2: finds the shortest run of the unconsumed trace events that covers a model burst by kind and object identity.
 *
 * Called when a model burst of the fake ends. Events after the run stay unconsumed for the next burst; events between `from` and the run are the caller's unsolicited events. Among runs of equal length the earliest wins.
 * @param model - The events of the fake's burst.
 * @param events - The segment's trace events.
 * @param from - Index of the first unconsumed event.
 * @returns The run, or `undefined` when no run covers the burst.
 * @example findCoveringRun([tabsChange], segment.events, 0) // => { start: 2, end: 3, modelIndexOf: [0, -1] }
 */
export function findCoveringRun(
  model: ModelEvent[],
  events: HostTraceEvent[],
  from: number,
): CoveringRun | undefined {
  if (model.length === 0) return undefined
  let best: CoveringRun | undefined
  for (let start = from; start < events.length; start++) {
    // A run that cannot start with an event the burst needs is never the shortest.
    if (!model.some((entry) => coversModelEvent(entry, events[start]!)))
      continue
    // The first window from this start that covers the burst is its shortest.
    for (let end = start + model.length - 1; end < events.length; end++) {
      if (best && end - start >= best.end - best.start) break
      const assigned = coverWindow(model, events.slice(start, end + 1))
      if (!assigned) continue
      best = { start, end, modelIndexOf: assigned }
      break
    }
  }
  return best
}

/** What the fake host offers the replay; implemented by the workspace harness over its own state. */
export interface HostOrderFake<
  Group extends object,
  Tab extends object,
  Editor extends object,
> {
  /** The fake's groups now, with live objects. */
  groups(): readonly Group[]
  groupColumn(group: Group): number
  groupTabs(group: Group): readonly Tab[]
  tabLabel(tab: Tab): string
  tabInputKind(tab: Tab): HostTraceInputKind
  /** Makes the fake's group and tab `isActive` flags and its active tab group follow a recorded snapshot; objects the fake has no longer or never had are skipped. */
  applyActiveState(snapshot: TabGroupsSnapshot): void
  /** The column of the fake's active tab group. */
  activeGroupColumn(): number | undefined
  /** The fake's text editor of a file name, in a column when given. */
  findTextEditor(name: string, column: number | undefined): Editor | undefined
  /** The file name of an editor's document, as {@link fileNameOf} gives it for a URI. */
  textEditorName(editor: Editor): string
  textEditorColumn(editor: Editor): number | undefined
  /** The payload of a selection event for an editor. */
  selectionChange(editor: Editor): unknown
  /** The fake's editor layout as the host's `vscode.getEditorLayout` answers it. */
  editorLayout(): unknown
  /** Makes the fake's editor layout the one the host recorded after an event; a replay calls it while it delivers the event. Optional: a fake without it keeps the layout its own operations produced. */
  applyLayout?(layout: unknown): void
  /** The fake's tab groups in the shape of a recorded `tabGroups` snapshot (tab URI as `<scheme>:<file name>` for a virtual document, else the file name; webview `viewType` as the host reports it). Needed only by a window replay's role-normalized comparison ({@link HostOrderInterposer.roleNormalizedState}). */
  snapshot?(): TabGroupsSnapshot
}

/** One tab or group listener call of the fake, before the replay lets it reach the workspace. */
interface BufferedCall {
  kind: HostListenerKind
  wrapper: (...args: never[]) => void
  args: unknown[]
}

/** One event of a model burst: the listeners the fake called with it. */
interface BufferedEvent {
  model: ModelEvent
  args: unknown[]
  calls: BufferedCall[]
}

/** A tab or group proportion tree, rounded to 0.01, for comparing a fake's layout with a recorded one. */
export interface LayoutProportions {
  orientation: number
  groups: { share: number; groups?: LayoutProportions['groups'] }[]
}

/** The shape a replay compares: groups in column order, tabs per group by label and kind, the active group, and layout proportions. */
export interface HostComparisonState {
  groups: { tabs: { label: string; kind: HostTraceInputKind }[] }[]
  activeGroupIndex: number
  layout: LayoutProportions | undefined
}

/**
 * Reduces an editor layout to rounded proportions, so a recorded and a fake layout compare whatever their pixel scale.
 * @param layout - The host's `vscode.getEditorLayout` result; groups without sizes share equally.
 * @returns The proportions, or `undefined` when the value is no layout.
 * @example layoutProportions({ orientation: 0, groups: [{ size: 1 }, { size: 2 }] }) // => { orientation: 0, groups: [{ share: 0.33 }, { share: 0.67 }] }
 */
export function layoutProportions(
  layout: unknown,
): LayoutProportions | undefined {
  if (!isRecord(layout) || !Array.isArray(layout.groups)) return undefined
  const shares = (nodes: unknown[]): LayoutProportions['groups'] => {
    const children = nodes.filter(isRecord)
    const sizes = children.map((child) => child.size)
    const sized = sizes.every((size) => typeof size === 'number' && size > 0)
    const total = sized ? (sizes as number[]).reduce((a, b) => a + b, 0) : 0
    return children.map((child, index) => ({
      share:
        Math.round(
          (sized ? (sizes[index] as number) / total : 1 / children.length) *
            100,
        ) / 100,
      ...(Array.isArray(child.groups) && child.groups.length > 0
        ? { groups: shares(child.groups) }
        : {}),
    }))
  }
  return {
    orientation: Number(layout.orientation ?? 0),
    groups: shares(layout.groups),
  }
}

/** Builds the comparison shape of a recorded final state. */
export function comparisonStateOfTrace(
  snapshot: TabGroupsSnapshot,
  layout: unknown,
): HostComparisonState {
  const ordered = [...snapshot.groups].sort(
    (a, b) => a.viewColumn - b.viewColumn,
  )
  const activeColumn = snapshot.groups[snapshot.activeGroupIndex]?.viewColumn
  return {
    groups: ordered.map((group) => ({
      tabs: group.tabs.map((tab) => ({
        label: tab.label,
        kind: tab.input.kind,
      })),
    })),
    activeGroupIndex: ordered.findIndex(
      (group) => group.viewColumn === activeColumn,
    ),
    layout: layoutProportions(layout),
  }
}

/** Builds the comparison shape of the fake's final state. */
export function comparisonStateOfFake<
  Group extends object,
  Tab extends object,
  Editor extends object,
>(fake: HostOrderFake<Group, Tab, Editor>): HostComparisonState {
  const ordered = [...fake.groups()].sort(
    (a, b) => fake.groupColumn(a) - fake.groupColumn(b),
  )
  const activeColumn = fake.activeGroupColumn()
  return {
    groups: ordered.map((group) => ({
      tabs: fake.groupTabs(group).map((tab) => ({
        label: fake.tabLabel(tab),
        kind: fake.tabInputKind(tab),
      })),
    })),
    activeGroupIndex: ordered.findIndex(
      (group) => fake.groupColumn(group) === activeColumn,
    ),
    layout: layoutProportions(fake.editorLayout()),
  }
}

/** What a finished replay reports: both comparison states and the two alignment counts every replay test hard-codes. */
export interface HostOrderReplayResult {
  /** The fake's final state. */
  fakeState: HostComparisonState
  /** The trace's final state; `undefined` when the trace has no final snapshot. */
  traceState: HostComparisonState | undefined
  /** Model bursts that no trace run covered; delivered in modelled order. */
  unmatchedModelBursts: number
  /** Trace events left at the end of a segment that no model burst reached. */
  unreachedTraceBursts: number
}

/** One window of a take: the events between two of its marks, replayed on a state built to equal the start. */
export interface HostTraceWindow {
  startLabel: string
  /** The mark that ends the window; `undefined` when it runs to the take's end. */
  endLabel: string | undefined
  /** The window as a trace of its own (one segment holding only the window's events, the end state as its final state), so the interposer's counts and final comparison apply to the window. */
  trace: ParsedHostTrace
  /** The state the window starts from. */
  start: HostStateRecord
}

/** A recorded state: the `tabGroups` snapshot and the editor layout that go with it. */
export interface HostStateRecord {
  snapshot: TabGroupsSnapshot
  layout: unknown
}

/**
 * Cuts the window between two marks of a take (contract revision R13).
 *
 * Called by a window replay test before it builds the fake host: the window's start state is what the test must rebuild with harness helpers, its events are what the interposer then replays, and events outside it are never delivered.
 * @param trace - The parsed take.
 * @param startLabel - The label of the mark the window starts at (the first mark of that name).
 * @param endLabel - The label of the mark that ends it (the first mark of that name after the start); omitted for a window that runs to the take's end.
 * @returns The window.
 * @throws {@link HostTraceError} `trace-window-invalid` for a label no mark has, an end before the start, marks in different segments (a Reload Window between them) or a start mark without its snapshot.
 * @example
 * const window = hostTraceWindow(trace, 'arrange')
 * window.trace.segments[0]!.events.length // => the events after the arrange mark
 */
export function hostTraceWindow(
  trace: ParsedHostTrace,
  startLabel: string,
  endLabel?: string,
): HostTraceWindow {
  const invalid = (reason: string): never => {
    throw new HostTraceError('trace-window-invalid', reason)
  }
  const startIndex = trace.marks.findIndex((mark) => mark.label === startLabel)
  const start = trace.marks[startIndex]
  if (!start) return invalid(`the take has no mark "${startLabel}"`)
  if (!start.snapshot)
    return invalid(`mark "${startLabel}" has no snapshot after it`)
  const end =
    endLabel === undefined
      ? undefined
      : trace.marks
          .slice(startIndex + 1)
          .find((mark) => mark.label === endLabel)
  if (endLabel !== undefined && !end)
    return invalid(`the take has no mark "${endLabel}" after "${startLabel}"`)
  if (end && end.segmentIndex !== start.segmentIndex)
    return invalid(
      `"${startLabel}" and "${endLabel}" stand in different segments`,
    )
  const segment = trace.segments[start.segmentIndex]!
  const events = segment.events.slice(
    start.eventCount,
    end ? end.eventCount : undefined,
  )
  const endSnapshot = end ? end.snapshot : trace.finalSnapshot
  // A window that runs to the take's end keeps the later segments (after a Reload Window) whole.
  const segments: HostTraceSegment[] = end
    ? [{ events, endSnapshot }]
    : [
        { events, endSnapshot: segment.endSnapshot, reload: segment.reload },
        ...trace.segments.slice(start.segmentIndex + 1),
      ]
  return {
    startLabel,
    endLabel,
    start: { snapshot: start.snapshot, layout: start.layout },
    trace: {
      header: trace.header,
      segments,
      marks: [],
      finalSnapshot: endSnapshot,
      finalLayout: end ? end.layout : trace.finalLayout,
    },
  }
}

/**
 * The recorded state a window starts from.
 * @param window - A window of {@link hostTraceWindow}.
 * @returns The snapshot and layout at its start mark, for {@link roleNormalize}.
 * @example roleNormalize(startSnapshot(window), { dropTabLabels: ['article-source.ts'] })
 */
export function startSnapshot(window: HostTraceWindow): HostStateRecord {
  return window.start
}

/** Which tabs a role normalization leaves out: fixture-only extras the harness adds that the native take did not have, named per test so nothing is dropped silently. */
export interface RoleNormalizeOptions {
  /** Labels of tabs dropped from the state before comparing (both sides get the same list). */
  dropTabLabels?: readonly string[]
}

/** One group of a role-normalized state. */
export interface RoleNormalizedGroup {
  /** The group's tabs in order, as roles. */
  tabs: string[]
  /** The role of the tab in front, or `undefined` for an empty group. */
  frontTab: string | undefined
  isActive: boolean
}

/** A layout node whose leaves carry the role of the group they hold. */
export type RoleLayoutNode =
  { share: number; role: string } | { share: number; groups: RoleLayoutNode[] }

/** A recorded or fake state with groups and tabs named by what they are, not by the label or URI of this machine: comparable across a native take and the harness. */
export interface RoleNormalizedState {
  /** The groups in column order. */
  groups: RoleNormalizedGroup[]
  /** The main editor grid's proportions (rounded to 0.01) with the role of each leaf; the chat group stands outside the grid. */
  layout: { orientation: number; groups: RoleLayoutNode[] } | undefined
}

/** Strips the prefix an editor puts on its webview types. */
const MAIN_THREAD_WEBVIEW_PREFIX = 'mainThreadWebview-'

/** Says whether a group is the Agent chat's: it holds tabs, and none of them has an input kind the extension API names. */
function isChatGroup(group: TraceGroup): boolean {
  return (
    group.tabs.length > 0 &&
    group.tabs.every((tab) => tab.input.kind === 'unknown')
  )
}

/** Names a tab's role: Codebook's panes and captured source by what they are, the chat's tabs as `chat`, any other tab by input kind and label. */
function tabRole(group: TraceGroup, tab: TraceTab): string {
  if (isChatGroup(group)) return 'chat'
  const { kind, uri, viewType } = tab.input
  const view = viewType?.replace(MAIN_THREAD_WEBVIEW_PREFIX, '')
  if (kind === 'webview' && view === 'codebook.scopedBrowser')
    return 'application'
  if (kind === 'webview' && view === 'codebook.studyContext') return 'study'
  if (kind === 'text' && uri?.startsWith('codebook-source:'))
    return 'captured-source'
  return `${kind}:${tab.label}`
}

/** The role that names a group in the layout: the first Codebook role of its tabs, else `learner` (or `empty`). */
function groupRole(tabRoles: string[]): string {
  const codebookRole = ['application', 'study', 'captured-source'].find(
    (role) => tabRoles.includes(role),
  )
  if (codebookRole) return codebookRole
  return tabRoles.length > 0 ? 'learner' : 'empty'
}

/**
 * Maps a recorded or fake state to roles so a native take and the harness compare despite their labels, file names and extra fixture tabs.
 *
 * Tabs become `application` (the scoped-browser webview), `study` (the study-context webview), `captured-source` (a `codebook-source:` document), `chat` (every tab of a group whose tabs are all of unknown input kind, the Cursor Agent group) or `<kind>:<label>` for a learner's tabs. Layout proportions are rounded to 0.01 and each leaf of the main grid carries its group's role; the chat group is outside the grid.
 * @param state - A snapshot and the layout recorded with it, or the fake's.
 * @param options - Tabs the fixture adds that the take lacks, dropped from the state.
 * @returns The role-normalized state, groups in column order.
 * @example
 * roleNormalize({ snapshot, layout }, { dropTabLabels: ['article-source.ts'] }).groups[0]!.tabs // => ['text:data.ts', 'application']
 */
export function roleNormalize(
  state: HostStateRecord,
  options: RoleNormalizeOptions = {},
): RoleNormalizedState {
  const dropped = new Set(options.dropTabLabels ?? [])
  const ordered = [...state.snapshot.groups].sort(
    (a, b) => a.viewColumn - b.viewColumn,
  )
  const gridRoles: string[] = []
  const groups = ordered.map((group): RoleNormalizedGroup => {
    const kept = group.tabs.filter((tab) => !dropped.has(tab.label))
    // How many Agent conversations the chat group lists is no layout fact: its tabs collapse to one `chat`.
    const tabs = isChatGroup(group)
      ? ['chat']
      : kept.map((tab) => tabRole(group, tab))
    const front = kept.find((tab) => tab.isActive)
    // The chat group stands outside the main editor grid.
    if (!isChatGroup(group)) gridRoles.push(groupRole(tabs))
    return {
      tabs,
      frontTab: front ? tabRole(group, front) : undefined,
      isActive: group.isActive,
    }
  })
  const proportions = layoutProportions(state.layout)
  let leaf = 0
  const withRoles = (nodes: LayoutProportions['groups']): RoleLayoutNode[] =>
    nodes.map((node) =>
      node.groups
        ? { share: node.share, groups: withRoles(node.groups) }
        : { share: node.share, role: gridRoles[leaf++] ?? 'unknown' },
    )
  return {
    groups,
    layout: proportions
      ? {
          orientation: proportions.orientation,
          groups: withRoles(proportions.groups),
        }
      : undefined,
  }
}

/**
 * Sits between the fake host and the workspace's listeners and delivers the trace's order and gaps (contract rules 1 to 5).
 *
 * The harness wraps each of the five listener registrations with {@link HostOrderInterposer.wrap}. Every call the fake makes during one operation (synchronously or before the next macrotask) is buffered as one model burst; when the burst ends, the shortest covering run of unconsumed trace events is delivered instead, in trace order with the trace's gaps (each capped at {@link HOST_TRACE_MAX_GAP_MS}). While each event is delivered the fake's `isActive` flags follow the snapshot recorded with it.
 *
 * @example
 * ```ts
 * const interposer = new HostOrderInterposer(trace, fake)
 * activeEditorListeners.add(interposer.wrap('activeTextEditor', callback))
 * await openSomething()
 * await interposer.settled()
 * interposer.result().unmatchedModelBursts // => 0
 * ```
 */
export class HostOrderInterposer<
  Group extends object,
  Tab extends object,
  Editor extends object,
> {
  private segmentIndex = 0
  private cursor = 0
  private unmatchedModelBursts = 0
  private unreachedTraceBursts = 0
  private segmentEnded = false
  private lastDeliveredMs: number | undefined
  private burst: BufferedEvent[] = []
  private burstScheduled = false
  private delivery: Promise<void> = Promise.resolve()
  private failure: unknown
  private disposed = false
  private bypassed = false
  /** The fake's editor layout (as JSON) when the last delivery ended or the replay was switched on; a different layout at the next burst's end was set by the workspace's own layout command. */
  private deliveredLayoutKey: string | undefined
  /** The layout (as JSON) the workspace's own layout command replaced in the burst being delivered: a recorded layout equal to it was recorded before the host answered that command and must not be applied over it. `undefined` when no command ran. */
  private staleLayoutKey: string | undefined
  private readonly registered = new Map<
    HostListenerKind,
    Set<(...args: never[]) => void>
  >()
  /** Tabs and groups the fake has told listeners about, kept by identity so a payload can name one that is closed by now. */
  private readonly seenTabs: { column?: number; tab: Tab }[] = []
  private readonly seenGroups = new Map<number, Group>()

  /**
   * @param trace - The trace to replay; for a window replay, the {@link HostTraceWindow}'s `trace`.
   * @param fake - What the replay needs from the fake host.
   * @param mode - `'after-operation'` (default): a burst ends before the next macrotask and its events are delivered afterwards, with the trace's gaps. `'with-operation'`: a burst ends at the next microtask checkpoint, so its matched events reach the listeners before the fake operation's promise resolves, as the native host reports them before the command result; no gap is waited inside a flush, and events no burst reached are delivered by {@link HostOrderInterposer.deliverTrailing}.
   */
  constructor(
    private readonly trace: ParsedHostTrace,
    private readonly fake: HostOrderFake<Group, Tab, Editor>,
    private readonly mode:
      'after-operation' | 'with-operation' = 'after-operation',
  ) {}

  /**
   * Wraps a listener the workspace registers, so the fake's calls to it become a model burst.
   * @param kind - Which of the five registrations the listener belongs to.
   * @param callback - The workspace's listener.
   * @returns The listener to hand to the fake; keep it to remove the registration.
   */
  wrap<Args extends unknown[]>(
    kind: HostListenerKind,
    callback: (...args: Args) => void,
  ): (...args: Args) => void {
    // The listener types differ per kind; the replay only stores and calls them, so they are held under one erased type.
    const erased = (...args: Args): void => this.buffer(kind, wrapper, args)
    const wrapper = erased as unknown as (...args: never[]) => void
    this.delivered.set(
      wrapper,
      callback as unknown as (...args: never[]) => void,
    )
    let set = this.registered.get(kind)
    if (!set) this.registered.set(kind, (set = new Set()))
    set.add(wrapper)
    return erased
  }

  /**
   * Ends the registration of a wrapped listener: no later delivery, of the fake's calls or of trace-built events, reaches the workspace's callback.
   *
   * Called by the harness' registration `dispose`, so a disposed listener hears nothing even when a delivery was already queued.
   * @param listener - What {@link HostOrderInterposer.wrap} returned.
   * @example
   * const listener = interposer.wrap('selection', callback)
   * interposer.unwrap(listener)
   */
  unwrap(listener: (...args: never[]) => void): void {
    this.delivered.delete(listener)
    for (const set of this.registered.values()) set.delete(listener)
  }

  private readonly delivered = new Map<
    (...args: never[]) => void,
    (...args: never[]) => void
  >()

  /** Starts the replay of another segment (after a Reload Window); counts the earlier segment's unreached events. */
  beginSegment(index: number): void {
    // The first segment is already open; only a later one closes the one before it.
    if (index !== this.segmentIndex) this.endSegment()
    this.segmentIndex = index
    this.cursor = 0
    this.segmentEnded = false
    this.lastDeliveredMs = undefined
  }

  /** Counts the events the segment did not reach, once. */
  private endSegment(): void {
    if (this.segmentEnded) return
    this.segmentEnded = true
    const events = this.trace.segments[this.segmentIndex]?.events ?? []
    this.unreachedTraceBursts += Math.max(0, events.length - this.cursor)
  }

  /**
   * Lets the fake's listener calls reach the workspace at once and in the fake's own order, without matching or counting them, while `active` is `true`.
   *
   * A take starts with its window already set up (the recorder's first line is a snapshot), so a replay test builds that setup while bypassed and turns the bypass off at the step its trace begins with.
   * @param active - `true` to bypass the replay, `false` to match the fake's bursts against the trace from the next call on.
   * @example
   * interposer.bypass(true)
   * openSetupTabs()
   * interposer.bypass(false)
   */
  bypass(active: boolean): void {
    this.bypassed = active
    // Switching the replay on: the tabs and groups the setup built are the ones the trace may name later, even after the first replayed operation closes them.
    if (!active) {
      this.rememberObjects()
      this.deliveredLayoutKey = JSON.stringify(this.fake.editorLayout())
    }
  }

  /** Stops every pending delivery; the harness calls it when it closes. */
  dispose(): void {
    this.disposed = true
  }

  /**
   * Resolves once every burst that ended so far has been delivered.
   * @throws When a delivery failed: `trace-mapping-failed` naming the `seq`, or an error a listener threw.
   */
  async settled(): Promise<void> {
    // A burst still open ends before the next macrotask.
    await new Promise<void>((resolve) => setImmediate(resolve))
    await this.delivery
    if (this.failure !== undefined) throw this.failure
  }

  /**
   * The fake's current state, role-normalized (see {@link roleNormalize}).
   * @param options - The tabs to drop from the fake's state.
   * @returns The state of the fake's tab groups and editor layout.
   * @throws When the fake offers no `snapshot()`.
   */
  roleNormalizedState(options: RoleNormalizeOptions = {}): RoleNormalizedState {
    if (!this.fake.snapshot)
      throw new HostTraceError(
        'trace-mapping-failed',
        'the fake host offers no snapshot() for a role-normalized comparison',
      )
    return roleNormalize(
      { snapshot: this.fake.snapshot(), layout: this.fake.editorLayout() },
      options,
    )
  }

  /**
   * Ends a window replay and reports it role-normalized: the fake's final state, the trace window's end state and the two counts, all within the window.
   * @param options - The tabs to drop from the fake's and the trace's states.
   * @returns The role-normalized states and the counts.
   */
  windowResult(options: RoleNormalizeOptions = {}): {
    fakeState: RoleNormalizedState
    traceState: RoleNormalizedState | undefined
    unmatchedModelBursts: number
    unreachedTraceBursts: number
  } {
    const { unmatchedModelBursts, unreachedTraceBursts } = this.result()
    const { finalSnapshot, finalLayout } = this.trace
    return {
      fakeState: this.roleNormalizedState(options),
      traceState: finalSnapshot
        ? roleNormalize(
            { snapshot: finalSnapshot, layout: finalLayout },
            options,
          )
        : undefined,
      unmatchedModelBursts,
      unreachedTraceBursts,
    }
  }

  /**
   * Ends the replay and reports it.
   * @returns The fake's and the trace's final states and the two counts.
   */
  result(): HostOrderReplayResult {
    this.endSegment()
    const { finalSnapshot, finalLayout } = this.trace
    return {
      fakeState: comparisonStateOfFake(this.fake),
      traceState: finalSnapshot
        ? comparisonStateOfTrace(finalSnapshot, finalLayout)
        : undefined,
      unmatchedModelBursts: this.unmatchedModelBursts,
      unreachedTraceBursts: this.unreachedTraceBursts,
    }
  }

  /** Takes one listener call of the fake into the open burst, and makes sure the burst ends before the next macrotask. */
  private buffer(
    kind: HostListenerKind,
    wrapper: (...args: never[]) => void,
    args: unknown[],
  ): void {
    if (this.bypassed) {
      this.call(wrapper, args)
      return
    }
    this.rememberObjects()
    const call: BufferedCall = { kind, wrapper, args }
    const model = this.describeModelEvent(kind, args)
    const key = JSON.stringify(model)
    // Several listeners hear one event (the fake builds the event object once per listener): an equal event from another listener is the same event.
    const sameEvent = this.burst.find(
      (entry) =>
        JSON.stringify(entry.model) === key &&
        !entry.calls.some((other) => other.wrapper === wrapper),
    )
    if (sameEvent) sameEvent.calls.push(call)
    else this.burst.push({ model, args, calls: [call] })
    if (!this.burstScheduled) {
      this.burstScheduled = true
      // A microtask queued here runs before the continuation of whoever awaits the fake operation that is making this call, because that promise settles after this synchronous part.
      if (this.mode === 'with-operation') queueMicrotask(() => this.endBurst())
      else setImmediate(() => this.endBurst())
    }
  }

  /** Names what a call of the fake's listener names. */
  private describeModelEvent(
    kind: HostListenerKind,
    args: unknown[],
  ): ModelEvent {
    const { fake } = this
    const tabRef = (tab: Tab): HostObjectRef => ({
      type: 'tab',
      column: this.columnOfLiveTab(tab),
      label: fake.tabLabel(tab),
      inputKind: fake.tabInputKind(tab),
    })
    const first = args[0]
    if (kind === 'tabsChanged') {
      if (!isRecord(first)) return { kind, objects: [], kindOnly: true }
      const tabs = ['opened', 'closed', 'changed'].flatMap(
        (role) => asArray(first[role]) as Tab[],
      )
      return { kind, objects: tabs.map(tabRef), kindOnly: false }
    }
    if (kind === 'groupsChanged') {
      const groups = isRecord(first)
        ? ['opened', 'closed', 'changed'].flatMap(
            (role) => asArray(first[role]) as Group[],
          )
        : []
      return {
        kind,
        objects: groups.map((group) => ({
          type: 'group',
          column: fake.groupColumn(group),
        })),
        kindOnly: false,
      }
    }
    if (kind === 'visibleTextEditors')
      return { kind, objects: [], kindOnly: true }
    const editor = (
      kind === 'selection' && isRecord(first) ? first.textEditor : first
    ) as Editor | undefined
    return {
      kind,
      objects: editor
        ? [
            {
              type: 'editor',
              name: fake.textEditorName(editor),
              column: fake.textEditorColumn(editor),
            },
          ]
        : [],
      kindOnly: false,
    }
  }

  private columnOfLiveTab(tab: Tab): number | undefined {
    const group = this.fake
      .groups()
      .find((candidate) => this.fake.groupTabs(candidate).includes(tab))
    return group ? this.fake.groupColumn(group) : undefined
  }

  /** Remembers every tab and group the fake has now, so a payload can name one that closes later. */
  private rememberObjects(): void {
    for (const group of this.fake.groups()) {
      const column = this.fake.groupColumn(group)
      this.seenGroups.set(column, group)
      for (const tab of this.fake.groupTabs(group))
        if (!this.seenTabs.some((seen) => seen.tab === tab))
          this.seenTabs.push({ column, tab })
    }
  }

  /** Ends the open burst: matches it to a run of the trace and delivers it (queued, or at once in the `with-operation` mode). */
  private endBurst(): void {
    this.burstScheduled = false
    const buffered = this.burst.splice(0)
    if (buffered.length === 0 || this.disposed) return
    this.noteLayoutCommand()
    // Objects the burst's payloads name stay reachable by identity.
    for (const entry of buffered) this.rememberPayload(entry)
    const events = this.trace.segments[this.segmentIndex]?.events ?? []
    const run = findCoveringRun(
      buffered.map((entry) => entry.model),
      events,
      this.cursor,
    )
    // Contract rule 5: no covering run, so the burst reaches the workspace in the fake's own order.
    if (!run) {
      this.unmatchedModelBursts++
      this.deliver(() => {
        for (const entry of buffered)
          for (const call of entry.calls) this.call(call.wrapper, call.args)
      })
      return
    }
    const delivering = events.slice(this.cursor, run.end + 1)
    const firstIndex = this.cursor
    this.cursor = run.end + 1
    if (this.mode === 'with-operation') {
      this.deliver(() => {
        for (const [offset, event] of delivering.entries())
          this.deliverEvent(event, firstIndex + offset, run, buffered)
        this.followLastSnapshot(delivering)
      })
      return
    }
    this.queue(async () => {
      for (const [offset, event] of delivering.entries()) {
        await this.waitFor(event)
        if (this.disposed) return
        this.deliverEvent(event, firstIndex + offset, run, buffered)
      }
      this.followLastSnapshot(delivering)
    })
  }

  /** Delivers one event of a run: the fake's own payload when it covers a model event, else one built from the trace. */
  private deliverEvent(
    event: HostTraceEvent,
    index: number,
    run: CoveringRun,
    buffered: BufferedEvent[],
  ): void {
    // Events of the run that cover a model event carry the fake's own payload; unsolicited events are built from the trace.
    const modelIndex = run.modelIndexOf[index - run.start] ?? -1
    const covered =
      index >= run.start && modelIndex >= 0 ? buffered[modelIndex] : undefined
    // Rule 3: flags follow the snapshot recorded with the event while it is delivered.
    if (event.snapshot) this.fake.applyActiveState(event.snapshot)
    if (covered)
      for (const call of covered.calls) this.call(call.wrapper, call.args)
    else this.deliverToAll(event)
    this.applyRecordedLayout(event)
  }

  /**
   * Notes, for the `with-operation` delivery, whether the workspace changed the fake's layout since the last delivery ended (its own `vscode.setEditorLayout`), and which layout that replaced.
   *
   * A host answers such a command with its own layout a few events later; the layouts recorded before that answer are the old state and would put the old layout back over the command's.
   */
  private noteLayoutCommand(): void {
    if (this.mode !== 'with-operation') return
    const now = JSON.stringify(this.fake.editorLayout())
    this.staleLayoutKey =
      this.deliveredLayoutKey !== undefined && now !== this.deliveredLayoutKey
        ? this.deliveredLayoutKey
        : undefined
  }

  /**
   * Lets the fake's layout follow what the host settled on after an event.
   *
   * While a layout command of the workspace is waiting for the host's answer ({@link HostOrderInterposer.noteLayoutCommand}), a recorded layout equal to the one the command replaced is skipped; the first different one is the host's answer and is applied.
   */
  private applyRecordedLayout(event: HostTraceEvent): void {
    if (event.layout === undefined) return
    if (this.staleLayoutKey !== undefined) {
      if (JSON.stringify(event.layout) === this.staleLayoutKey) return
      this.staleLayoutKey = undefined
    }
    this.fake.applyLayout?.(event.layout)
  }

  /** After a run the flags follow its last snapshot. */
  private followLastSnapshot(delivered: HostTraceEvent[]): void {
    const last = delivered.at(-1)?.snapshot
    if (last) this.fake.applyActiveState(last)
  }

  /** Runs a synchronous delivery now (a failure is kept for {@link HostOrderInterposer.settled}) or queues it, by the delivery mode. */
  private deliver(delivery: () => void): void {
    if (this.mode !== 'with-operation') {
      this.queue(async () => delivery())
      return
    }
    if (this.failure !== undefined || this.disposed) return
    try {
      delivery()
    } catch (error) {
      this.failure = error
    }
    this.deliveredLayoutKey = JSON.stringify(this.fake.editorLayout())
  }

  /**
   * Delivers the events of the replayed window that no model burst reached, at their recorded offsets (each capped at {@link HOST_TRACE_MAX_GAP_MS}) after the last delivered one, and ends the window.
   *
   * Call it once, after the last step of a window replay and before {@link HostOrderInterposer.result}; the events still count as unreached, because no model burst reached them.
   * @returns Resolves when every trailing event was delivered.
   * @throws The first delivery failure, like {@link HostOrderInterposer.settled}.
   */
  async deliverTrailing(): Promise<void> {
    await this.settled()
    // Count first: delivering them does not make a model burst reach them.
    this.endSegment()
    const events = this.trace.segments[this.segmentIndex]?.events ?? []
    for (const event of events.slice(this.cursor)) {
      await this.waitFor(event)
      if (this.disposed) return
      if (event.snapshot) this.fake.applyActiveState(event.snapshot)
      this.deliverToAll(event)
      this.applyRecordedLayout(event)
    }
    this.followLastSnapshot(events.slice(this.cursor))
  }

  private rememberPayload(entry: BufferedEvent): void {
    const first = entry.args[0]
    if (!isRecord(first)) return
    for (const role of ['opened', 'closed', 'changed'])
      for (const object of asArray(first[role])) {
        if (entry.model.kind === 'groupsChanged') {
          const group = object as Group
          this.seenGroups.set(this.fake.groupColumn(group), group)
        } else if (!this.seenTabs.some((seen) => seen.tab === object))
          this.seenTabs.push({ tab: object as Tab })
      }
  }

  /** Waits for the trace's gap before an event, capped, and notes the event as delivered. */
  private async waitFor(event: HostTraceEvent): Promise<void> {
    const gapMs =
      this.lastDeliveredMs === undefined ? 0 : event.tMs - this.lastDeliveredMs
    this.lastDeliveredMs = event.tMs
    if (gapMs > 0)
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(gapMs, HOST_TRACE_MAX_GAP_MS)),
      )
  }

  /** Queues a delivery behind the earlier ones and keeps its first failure. */
  private queue(delivery: () => Promise<void>): void {
    this.delivery = this.delivery.then(async () => {
      if (this.failure !== undefined || this.disposed) return
      try {
        await delivery()
      } catch (error) {
        this.failure = error
      }
    })
  }

  private call(wrapper: (...args: never[]) => void, args: unknown[]): void {
    const callback = this.delivered.get(wrapper)
    ;(callback as ((...values: unknown[]) => void) | undefined)?.(...args)
  }

  /** Delivers a trace-built event to every listener of its kind. */
  private deliverToAll(event: HostTraceEvent): void {
    const args = this.payloadOf(event)
    for (const wrapper of this.registered.get(event.kind) ?? [])
      this.call(wrapper, args)
  }

  /** Builds the listener arguments of an unsolicited event from the trace, naming the fake's objects. */
  private payloadOf(event: HostTraceEvent): unknown[] {
    const fail = (what: string): never => {
      throw new HostTraceError(
        'trace-mapping-failed',
        `seq ${event.seq} (${event.kind}) names ${what} the fake host never had`,
      )
    }
    if (event.kind === 'visibleTextEditors') return []
    if (event.kind === 'tabsChanged' || event.kind === 'groupsChanged') {
      const payload: Record<Role, object[]> = {
        opened: [],
        closed: [],
        changed: [],
      }
      for (const role of ['opened', 'closed', 'changed'] as const)
        for (const ref of event.roles[role]) {
          // A closed group whose column the trace cannot name (no snapshot before it) has no object to hand over.
          if (
            ref.type === 'group' &&
            role === 'closed' &&
            ref.column === undefined
          )
            continue
          payload[role].push(
            ref.type === 'tab'
              ? (this.findTab(ref) ?? fail(`the tab "${ref.label}"`))
              : (this.findGroup(ref.column) ??
                  fail(`the group in column ${ref.column}`)),
          )
        }
      return [payload]
    }
    const named = event.objects[0]
    if (named?.type !== 'editor') return [undefined]
    const editor =
      this.fake.findTextEditor(named.name, named.column) ??
      fail(`the text editor of ${named.name}`)
    return [
      event.kind === 'selection' ? this.fake.selectionChange(editor) : editor,
    ]
  }

  private findGroup(column: number | undefined): Group | undefined {
    return (
      this.fake
        .groups()
        .find((group) => this.fake.groupColumn(group) === column) ??
      (column === undefined ? undefined : this.seenGroups.get(column))
    )
  }

  private findTab(
    ref: Extract<HostObjectRef, { type: 'tab' }>,
  ): Tab | undefined {
    const matches = (tab: Tab): boolean =>
      this.fake.tabLabel(tab) === ref.label &&
      this.fake.tabInputKind(tab) === ref.inputKind
    // A live tab of the group first; a closed one stays reachable by identity.
    for (const group of this.fake.groups())
      if (
        ref.column === undefined ||
        this.fake.groupColumn(group) === ref.column
      ) {
        const live = this.fake.groupTabs(group).find(matches)
        if (live) return live
      }
    return this.seenTabs.find(
      (seen) =>
        matches(seen.tab) &&
        (ref.column === undefined ||
          seen.column === undefined ||
          seen.column === ref.column),
    )?.tab
  }

  /**
   * Replays a trace across a Reload Window (contract rule 6): runs each segment's action, with `reload` between them.
   * @param actions - One per segment: the harness' entry the native take ran for that segment.
   * @param reload - Re-creates the workspace the way the harness' reload path does.
   * @returns The replay result after the last segment.
   * @throws The first delivery failure.
   */
  async runSegments(
    actions: ((segmentIndex: number) => Promise<void>)[],
    reload: () => Promise<void>,
  ): Promise<HostOrderReplayResult> {
    for (const [index, action] of actions.entries()) {
      if (index > 0) {
        await this.settled()
        await reload()
      }
      this.beginSegment(index)
      await action(index)
      await this.settled()
    }
    return this.result()
  }
}
