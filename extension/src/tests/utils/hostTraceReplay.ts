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
const KNOWN_TRACE_KINDS: readonly string[] = [
  ...HOST_TRACE_LISTENER_KINDS,
  SNAPSHOT_KIND,
  LAYOUT_KIND,
  RELOAD_KIND,
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
}

/** The events between two reloads (or the whole trace when none). */
export interface HostTraceSegment {
  events: HostTraceEvent[]
  /** The last `tabGroups` snapshot of the segment. */
  endSnapshot?: TabGroupsSnapshot
  /** The `reload` event that ends the segment; absent for the last one. */
  reload?: { unrecordedFromMs: number; unrecordedToMs: number }
}

/** A validated trace. */
export interface ParsedHostTrace {
  header: HostTraceHeader
  segments: HostTraceSegment[]
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
      | 'trace-mapping-failed',
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'HostTraceError'
  }
}

type Json = Record<string, unknown>

/** The last path segment of a document URI, without query or fragment: how an editor is named across machines. @example fileNameOf('file:///repo/src/a.ts?x=1') // => 'a.ts' */
export function fileNameOf(uri: string): string {
  return uri.split(/[?#]/)[0]!.split('/').at(-1) ?? ''
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
    for (const role of ['opened', 'closed', 'changed'] as const)
      for (const entry of recordsOf(isRecord(data) ? data[role] : undefined)) {
        const column = columnAt(Number(entry.groupIndex), role, before, after)
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
  let lastSnapshot: TabGroupsSnapshot | undefined
  let finalLayout: unknown
  let finalSnapshot: TabGroupsSnapshot | undefined
  rawEvents.forEach((event, index) => {
    const segment = segments.at(-1)!
    if (event.kind === SNAPSHOT_KIND) {
      lastSnapshot = toSnapshot(event.data, event.seq)
      finalSnapshot = lastSnapshot
      segment.endSnapshot = lastSnapshot
      // The snapshot after an event is the state recorded with it.
      const pending = segment.events.at(-1)
      if (pending && pending.snapshot === undefined)
        attachSnapshot(pending, lastSnapshot)
      return
    }
    if (event.kind === LAYOUT_KIND) {
      finalLayout = event.data
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
  private readonly registered = new Map<
    HostListenerKind,
    Set<(...args: never[]) => void>
  >()
  /** Tabs and groups the fake has told listeners about, kept by identity so a payload can name one that is closed by now. */
  private readonly seenTabs: { column?: number; tab: Tab }[] = []
  private readonly seenGroups = new Map<number, Group>()

  constructor(
    private readonly trace: ParsedHostTrace,
    private readonly fake: HostOrderFake<Group, Tab, Editor>,
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
      setImmediate(() => this.endBurst())
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

  /** Ends the open burst: matches it to a run of the trace and queues the delivery. */
  private endBurst(): void {
    this.burstScheduled = false
    const buffered = this.burst.splice(0)
    if (buffered.length === 0 || this.disposed) return
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
      this.queue(async () => {
        for (const entry of buffered)
          for (const call of entry.calls) this.call(call.wrapper, call.args)
      })
      return
    }
    const delivering = events.slice(this.cursor, run.end + 1)
    const firstIndex = this.cursor
    this.cursor = run.end + 1
    this.queue(async () => {
      for (const [offset, event] of delivering.entries()) {
        await this.waitFor(event)
        if (this.disposed) return
        const index = firstIndex + offset
        // Events of the run that cover a model event carry the fake's own payload; unsolicited events are built from the trace.
        const covered =
          index >= run.start
            ? buffered.find((entry) => coversModelEvent(entry.model, event))
            : undefined
        // Rule 3: flags follow the snapshot recorded with the event while it is delivered.
        if (event.snapshot) this.fake.applyActiveState(event.snapshot)
        if (covered)
          for (const call of covered.calls) this.call(call.wrapper, call.args)
        else this.deliverToAll(event)
      }
      // After the run the flags follow its last snapshot.
      const last = delivering.at(-1)?.snapshot
      if (last) this.fake.applyActiveState(last)
    })
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
        for (const ref of event.roles[role])
          payload[role].push(
            ref.type === 'tab'
              ? (this.findTab(ref) ?? fail(`the tab "${ref.label}"`))
              : (this.findGroup(ref.column) ??
                  fail(`the group in column ${ref.column}`)),
          )
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
