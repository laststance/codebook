import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import {
  fileNameOf,
  findCoveringRun,
  HostOrderInterposer,
  hostTraceWindow,
  HostTraceError,
  layoutProportions,
  parseHostTrace,
  roleNormalize,
  startSnapshot,
  type HostOrderFake,
  type ModelEvent,
  type TabGroupsSnapshot,
} from './utils/hostTraceReplay'

const HEADER = {
  host: 'vscode',
  hostVersion: '1.142.0',
  os: 'darwin',
  sequence: 'synthetic',
  codebookVersion: '0.0.0',
  recorderVersion: '1',
  startedAt: '2026-11-07T00:00:00.000Z',
}

/** Writes a synthetic trace file: the header line, then one JSON line per event. @example traceText([{ seq: 1, tMs: 0, kind: 'visibleTextEditors', data: [] }]) */
function traceText(events: object[]): string {
  return [HEADER, ...events].map((line) => JSON.stringify(line)).join('\n')
}

/** One tab of a synthetic snapshot. */
function textTab(label: string, isActive = false) {
  return { label, input: { kind: 'text' }, isActive, isPreview: false }
}

/** One synthetic `tabGroups` snapshot event. */
function snapshotEvent(
  seq: number,
  tMs: number,
  groups: { viewColumn: number; isActive: boolean; tabs: object[] }[],
) {
  return {
    seq,
    tMs,
    kind: 'tabGroups',
    data: { groups, activeGroupIndex: groups.findIndex((g) => g.isActive) },
  }
}

const VISIBLE_NOTICE: ModelEvent = {
  kind: 'visibleTextEditors',
  objects: [],
  kindOnly: true,
}

/** A model event of a tab change of one file in column 1. */
function tabChange(label: string): ModelEvent {
  return {
    kind: 'tabsChanged',
    objects: [{ type: 'tab', column: 1, label, inputKind: 'text' }],
    kindOnly: false,
  }
}

/** A trace event for the matcher tests: a tab change of one file in column 1. */
function tabsChangedEvent(seq: number, tMs: number, label: string) {
  return {
    seq,
    tMs,
    kind: 'tabsChanged',
    data: {
      opened: [],
      closed: [],
      changed: [{ groupIndex: 0, label, inputKind: 'text' }],
    },
  }
}

const COLUMN_ONE_ACTIVE = (labels: string[], front?: string) => [
  {
    viewColumn: 1,
    isActive: true,
    tabs: labels.map((label) => textTab(label, label === front)),
  },
]

// Value: protects=the replay's trust in a recorded take: a valid file parses into its header, events and final state; fails_when=the parser drops the header, the events or the final snapshot a replay compares with; why_new=Cycle 0094 task 12 (D8); seam=parseHostTrace; no_claim=the recorder's own output (a native take)
test('a valid host trace parses into its header, listener events and final state', () => {
  // Arrange
  const text = traceText([
    snapshotEvent(1, 0, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    tabsChangedEvent(2, 10, 'a.ts'),
    snapshotEvent(3, 11, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    { seq: 4, tMs: 12, kind: 'editorLayout', data: { orientation: 0 } },
  ])

  // Act
  const trace = parseHostTrace(text)

  // Assert
  assert.equal(trace.header.host, 'vscode')
  assert.equal(trace.segments.length, 1)
  assert.equal(trace.segments[0]!.events.length, 1)
  assert.equal(trace.segments[0]!.events[0]!.seq, 2)
  assert.equal(trace.segments[0]!.events[0]!.snapshot?.groups[0]?.viewColumn, 1)
  assert.deepEqual(trace.finalLayout, { orientation: 0 })
  assert.equal(trace.finalSnapshot?.groups[0]?.tabs[0]?.label, 'a.ts')
})

// Value: protects=a replay refusing a file that is not a trace instead of replaying nothing; fails_when=a file without its header line parses; why_new=Cycle 0094 task 12 (D8); seam=parseHostTrace; no_claim=the file's other fields
test('a trace without its header line is refused as trace-header-missing', () => {
  // Arrange
  const text = JSON.stringify({ seq: 1, tMs: 0, kind: 'visibleTextEditors' })

  // Act
  const parse = (): unknown => parseHostTrace(text)

  // Assert
  assert.throws(parse, (error) => {
    assert.ok(error instanceof HostTraceError)
    assert.equal(error.code, 'trace-header-missing')
    return true
  })
})

// Value: protects=the recorder and the replay parser agreeing on one trace format (eng review R6); fails_when=the committed sample written by the recorder's serializer is refused by parseHostTrace, or a kind, a payload shape or the header fields stop being read; why_new=Cycle 0094 task 12 cross-check; seam=extension/scripts/tests/fixtures/host-trace-sample.jsonl, which the recorder-side test pins to the serializer's output; no_claim=that a native take is clean
test('the sample trace written by the recorder is read by the parser with every event kind', () => {
  // Arrange
  const sample = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'scripts',
      'tests',
      'fixtures',
      'host-trace-sample.jsonl',
    ),
    'utf8',
  )

  // Act
  const trace = parseHostTrace(sample)

  // Assert
  assert.equal(trace.header.host, 'Visual Studio Code')
  assert.equal(trace.header.hostVersion, '1.142.0')
  assert.equal(trace.header.startedAt, '2026-11-07T00:00:00.000Z')
  assert.equal(trace.segments.length, 2)
  assert.equal(trace.segments[0]!.reload?.unrecordedToMs, 2170)
  assert.deepEqual(
    trace.segments[0]!.events.map((event) => event.kind),
    [
      'tabsChanged',
      'groupsChanged',
      'activeTextEditor',
      'visibleTextEditors',
      'selection',
    ],
  )
  assert.deepEqual(trace.segments[0]!.events[0]!.roles.closed, [
    { type: 'tab', column: 1, label: 'text', inputKind: 'text' },
  ])
  assert.deepEqual(trace.segments[0]!.events[1]!.roles.changed, [
    { type: 'group', column: 2 },
  ])
  assert.deepEqual(trace.segments[0]!.events[2]!.objects, [
    { type: 'editor', name: 'a.ts', column: 1 },
  ])
  assert.equal(trace.finalSnapshot?.activeGroupIndex, 0)
  assert.equal(trace.finalSnapshot?.groups[0]?.tabs[0]?.input.uri, 'src/a.ts')
  assert.deepEqual(trace.finalLayout, {
    orientation: 0,
    groups: [{ size: 0.5 }, { size: 0.5 }],
  })
})

// Value: protects=a replay refusing a take of another format version instead of misreading it; fails_when=a header naming formatVersion 2 parses; why_new=Cycle 0094 task 12 (header formatVersion); seam=parseHostTrace; no_claim=what version 2 would contain
test('a trace whose header names another formatVersion is refused as trace-malformed', () => {
  // Arrange
  const text = [{ ...HEADER, formatVersion: 2 }]
    .map((line) => JSON.stringify(line))
    .join('\n')

  // Act
  const parse = (): unknown => parseHostTrace(text)

  // Assert
  assert.throws(parse, (error) => {
    assert.ok(error instanceof HostTraceError)
    assert.equal(error.code, 'trace-malformed')
    return true
  })
})

// Value: protects=a replay refusing a take from a recorder with an event kind the matcher does not know; fails_when=an unknown kind is skipped silently so its order is lost; why_new=Cycle 0094 task 12 (D8); seam=parseHostTrace; no_claim=the event's payload
test('a trace with an unknown event kind is refused as trace-unknown-kind naming its seq', () => {
  // Arrange
  const text = traceText([{ seq: 7, tMs: 0, kind: 'windowFocus', data: {} }])

  // Act
  const parse = (): unknown => parseHostTrace(text)

  // Assert
  assert.throws(
    parse,
    /trace-unknown-kind: seq 7 has the unknown kind "windowFocus"/,
  )
})

// Value: protects=the recorded order a replay delivers; fails_when=a trace whose seq repeats or goes back parses, so its order is ambiguous; why_new=Cycle 0094 task 12 (D8); seam=parseHostTrace; no_claim=tMs order
test('a trace whose seq does not strictly increase is refused as trace-seq-not-increasing', () => {
  // Arrange
  const text = traceText([
    { seq: 3, tMs: 0, kind: 'visibleTextEditors', data: [] },
    { seq: 3, tMs: 5, kind: 'visibleTextEditors', data: [] },
  ])

  // Act
  const parse = (): unknown => parseHostTrace(text)

  // Assert
  assert.throws(parse, /trace-seq-not-increasing: seq 3 follows seq 3/)
})

// Value: protects=the two-segment replay of a Reload Window take; fails_when=events before and after a reload marker land in one segment; why_new=Cycle 0094 task 12 (D8 rule 6, R10); seam=parseHostTrace; no_claim=the harness' reload path
test('a trace with a reload marker splits into the events before and after it', () => {
  // Arrange
  const text = traceText([
    tabsChangedEvent(1, 0, 'a.ts'),
    {
      seq: 2,
      tMs: 5,
      kind: 'reload',
      data: { unrecordedFromMs: 5, unrecordedToMs: 900 },
    },
    snapshotEvent(3, 901, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    tabsChangedEvent(4, 905, 'b.ts'),
  ])

  // Act
  const trace = parseHostTrace(text)

  // Assert
  assert.deepEqual(
    trace.segments.map((segment) => segment.events.map((event) => event.seq)),
    [[1], [4]],
  )
  assert.deepEqual(trace.segments[0]!.reload, {
    unrecordedFromMs: 5,
    unrecordedToMs: 900,
  })
})

// Value: protects=the causal match of rule 2: a native burst larger than the fake's burst; fails_when=the matcher takes the whole native burst instead of the shortest covering run, or loses the leftover for the next burst; why_new=Cycle 0094 task 12 (D8, R9); seam=findCoveringRun; no_claim=delivery
test('the shortest run covering a model burst is taken and the events after it stay for the next burst', () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      tabsChangedEvent(2, 5, 'b.ts'),
      tabsChangedEvent(3, 9, 'b.ts'),
    ]),
  )
  const events = trace.segments[0]!.events

  // Act
  const first = findCoveringRun([tabChange('a.ts')], events, 0)
  const second = findCoveringRun([tabChange('b.ts')], events, first!.end + 1)

  // Assert
  assert.deepEqual([first?.start, first?.end], [0, 0])
  assert.deepEqual([second?.start, second?.end], [1, 1])
})

// Value: protects=the unsolicited events of rule 2 (Cursor's group move 46 ms after focus); fails_when=an event that no model burst asked for before the matched run is dropped or the run starts too early; why_new=Cycle 0094 task 12 (D8); seam=findCoveringRun; no_claim=the recorded offsets
test('a run that starts after unrelated events leaves those events before it, to be delivered first as unsolicited', () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'x.ts'),
      {
        seq: 2,
        tMs: 3,
        kind: 'groupsChanged',
        data: { opened: [], closed: [], changed: [{ groupIndex: 0 }] },
      },
      tabsChangedEvent(3, 46, 'a.ts'),
    ]),
  )

  // Act
  const run = findCoveringRun([tabChange('a.ts')], trace.segments[0]!.events, 0)

  // Assert
  assert.deepEqual([run?.start, run?.end], [2, 2])
})

// Value: protects=rule 5: a model burst the host never did is not matched to an unrelated run; fails_when=a burst with no covering run takes some other event; why_new=Cycle 0094 task 12 (D8); seam=findCoveringRun; no_claim=the unmatched count
test('a model burst that no run of the trace covers has no run', () => {
  // Arrange
  const trace = parseHostTrace(traceText([tabsChangedEvent(1, 0, 'a.ts')]))

  // Act
  const run = findCoveringRun(
    [tabChange('c.ts'), VISIBLE_NOTICE],
    trace.segments[0]!.events,
    0,
  )

  // Assert
  assert.equal(run, undefined)
})

// Value: protects=the layout comparison of a replay across display scale; fails_when=pixel sizes instead of proportions are compared, or the rounding to 0.01 is lost; why_new=Cycle 0094 task 12 (D8); seam=layoutProportions; no_claim=nested orientation
test('a layout compares by proportions rounded to 0.01, whatever its pixel scale', () => {
  // Arrange
  const pixels = { orientation: 0, groups: [{ size: 500 }, { size: 1000 }] }
  const ratios = { orientation: 0, groups: [{ size: 1 }, { size: 2 }] }

  // Act
  const fromPixels = layoutProportions(pixels)
  const fromRatios = layoutProportions(ratios)

  // Assert
  assert.deepEqual(fromPixels, {
    orientation: 0,
    groups: [{ share: 0.33 }, { share: 0.67 }],
  })
  assert.deepEqual(fromRatios, fromPixels)
})

/** A tab group of the small fake the interposer tests drive without the workspace harness. */
interface StubTab {
  label: string
  isActive?: boolean
}
interface StubGroup {
  viewColumn: number
  tabs: StubTab[]
  isActive?: boolean
}

/** A fake host of groups and tabs only: the operation the interposer sees is the test calling a wrapped listener. */
function stubFake(
  groups: StubGroup[],
  layoutHolder?: { current: unknown },
): HostOrderFake<StubGroup, StubTab, never> {
  return {
    groups: () => groups,
    groupColumn: (group) => group.viewColumn,
    groupTabs: (group) => group.tabs,
    tabLabel: (tab) => tab.label,
    tabInputKind: () => 'text',
    applyActiveState(snapshot: TabGroupsSnapshot): void {
      for (const recorded of snapshot.groups) {
        const group = groups.find((g) => g.viewColumn === recorded.viewColumn)
        if (!group) continue
        group.isActive = recorded.isActive
        for (const tab of group.tabs)
          tab.isActive = recorded.tabs.some(
            (other) => other.isActive && other.label === tab.label,
          )
      }
    },
    activeGroupColumn: () => groups.find((g) => g.isActive)?.viewColumn,
    findTextEditor: () => undefined,
    textEditorName: () => '',
    textEditorColumn: () => undefined,
    selectionChange: () => undefined,
    editorLayout: () =>
      layoutHolder ? layoutHolder.current : { orientation: 0, groups: [{}] },
    ...(layoutHolder && {
      applyLayout(recorded: unknown): void {
        layoutHolder.current = recorded
      },
    }),
  }
}

// Value: protects=the accounting of replays: a burst the host never did is delivered in the fake's order and counted, and trace events no burst reached are counted; fails_when=either count stays 0 or the unmatched burst is swallowed; why_new=Cycle 0094 task 12 (D8 rule 5); seam=HostOrderInterposer.wrap, settled, result; no_claim=structure at delivery
test('a model burst with no covering run is delivered in the fake order and counted, and trailing trace events are counted as unreached', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      tabsChangedEvent(2, 4, 'z.ts'),
      tabsChangedEvent(3, 8, 'z.ts'),
    ]),
  )
  const groups: StubGroup[] = [
    { viewColumn: 1, tabs: [{ label: 'a.ts' }, { label: 'c.ts' }] },
  ]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const heard: string[] = []
  const listener = interposer.wrap(
    'tabsChanged',
    (event: { changed: StubTab[]; opened?: StubTab[]; closed?: StubTab[] }) => {
      heard.push(event.changed.map((tab) => tab.label).join(','))
    },
  )

  // Act
  listener({ changed: [groups[0]!.tabs[1]!] })
  await interposer.settled()
  const unmatched = interposer.result()

  // Assert
  assert.deepEqual(heard, ['c.ts'])
  assert.equal(unmatched.unmatchedModelBursts, 1)
  assert.equal(unmatched.unreachedTraceBursts, 3)
})

// Value: protects=rule 2 end to end: events before the matched run reach the workspace first, with their gap; fails_when=the unsolicited event is delivered after the matched one or the matched run loses its trace order; why_new=Cycle 0094 task 12 (D8); seam=HostOrderInterposer.wrap, settled; no_claim=gap length
test('an unsolicited trace event before the matched run reaches the listener first and the matched event after it', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      {
        seq: 1,
        tMs: 0,
        kind: 'groupsChanged',
        data: { opened: [], closed: [], changed: [{ groupIndex: 0 }] },
      },
      snapshotEvent(2, 1, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      tabsChangedEvent(3, 20, 'a.ts'),
      snapshotEvent(4, 21, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const heard: string[] = []
  const onTabs = interposer.wrap('tabsChanged', (_event: unknown) =>
    heard.push('tabs'),
  )
  interposer.wrap('groupsChanged', (_event: unknown) => heard.push('groups'))

  // Act
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  await interposer.settled()

  // Assert
  assert.deepEqual(heard, ['groups', 'tabs'])
  assert.equal(interposer.result().unmatchedModelBursts, 0)
})

// Value: protects=the trace-mapping contract of rule 5; fails_when=a trace event naming a tab the fake never had is delivered with a made-up object or skipped silently; why_new=Cycle 0094 task 12 (D8); seam=HostOrderInterposer.settled; no_claim=which listener hears it
test('a trace event that names a tab the fake never had fails the replay as trace-mapping-failed naming its seq', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(5, 0, 'ghost.ts'),
      tabsChangedEvent(6, 4, 'a.ts'),
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const onTabs = interposer.wrap('tabsChanged', (_event: unknown) => {})

  // Act
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  const settled = interposer.settled()

  // Assert
  await assert.rejects(
    settled,
    /trace-mapping-failed: seq 5 \(tabsChanged\) names the tab "ghost\.ts"/,
  )
})

// Value: protects=rule 4 of the contract: a payload names a group the fake closed since; fails_when=an unsolicited groupsChanged.closed event for a group the fake no longer lists fails as unmapped; why_new=Cycle 0094 task 12 (D8, R8); seam=HostOrderInterposer.wrap, settled; no_claim=the structure at delivery
test('a group named by a closed event maps to the fake object kept by identity after the fake dropped it', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      snapshotEvent(1, 0, [
        ...COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts'),
        { viewColumn: 2, isActive: false, tabs: [] },
      ]),
      {
        seq: 2,
        tMs: 1,
        kind: 'groupsChanged',
        data: { opened: [], closed: [{ groupIndex: 1 }], changed: [] },
      },
      snapshotEvent(3, 2, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      tabsChangedEvent(4, 6, 'a.ts'),
    ]),
  )
  const closing: StubGroup = { viewColumn: 2, tabs: [] }
  const groups: StubGroup[] = [
    { viewColumn: 1, tabs: [{ label: 'a.ts' }] },
    closing,
  ]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const closedGroups: StubGroup[] = []
  interposer.wrap('groupsChanged', (event: { closed: StubGroup[] }) => {
    closedGroups.push(...event.closed)
  })
  const onTabs = interposer.wrap('tabsChanged', (_event: unknown) => {})
  // The fake told its listeners while the group stood; it drops the group before the next operation.
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  groups.splice(1, 1)
  await interposer.settled()

  // Act
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  await interposer.settled().catch(() => undefined)

  // Assert
  assert.deepEqual(closedGroups, [closing])
})

// Value: protects=a Reload Window take replaying as two segments around the workspace re-creation; fails_when=the second segment's events are matched against the first segment's or the reload step runs out of order; why_new=Cycle 0094 task 12 (D8 rule 6); seam=HostOrderInterposer.runSegments; no_claim=the harness reload path itself
test('a reload trace replays its second segment only after the reload step ran', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      {
        seq: 2,
        tMs: 5,
        kind: 'reload',
        data: { unrecordedFromMs: 5, unrecordedToMs: 50 },
      },
      tabsChangedEvent(3, 60, 'a.ts'),
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const steps: string[] = []
  const onTabs = interposer.wrap(
    'tabsChanged',
    (event: { changed: StubTab[]; opened?: StubTab[]; closed?: StubTab[] }) => {
      steps.push(`heard ${event.changed.length}`)
    },
  )
  const operate = async (): Promise<void> => {
    onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  }

  // Act
  const result = await interposer.runSegments(
    [
      async (): Promise<void> => {
        steps.push('segment 0')
        await operate()
      },
      async (): Promise<void> => {
        steps.push('segment 1')
        await operate()
      },
    ],
    async () => {
      steps.push('reload')
    },
  )

  // Assert
  assert.deepEqual(steps, [
    'segment 0',
    'heard 1',
    'reload',
    'segment 1',
    'heard 1',
  ])
  assert.equal(result.unmatchedModelBursts, 0)
  assert.equal(result.unreachedTraceBursts, 0)
})

// Value: protects=the Discussion 183 class (787050d4): the editor reports a group change before the front-tab change, so a workspace reading the group then still sees the old front tab active; fails_when=the harness delivers the fake's tab-first order, or the flags show the new front tab during the group event; why_new=Cycle 0094 task 12 (D8 rules 2 and 3); seam=workspaceHarness hostOrder, openAnnouncedTextTab, the fake's tab group listeners; no_claim=the intermediate structure (the new tab already stands in the group, as the fake does today) and the real editor's timing
test('a group change delivered before the front-tab change shows the old front tab as active, as the native editor did', async () => {
  // Arrange
  const text = (): string => {
    return traceText([
      snapshotEvent(1, 0, []),
      {
        seq: 2,
        tMs: 10,
        kind: 'tabsChanged',
        data: {
          opened: [{ groupIndex: 0, label: 'a.ts', inputKind: 'text' }],
          closed: [],
          changed: [],
        },
      },
      snapshotEvent(3, 11, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      { seq: 4, tMs: 12, kind: 'activeTextEditor', data: {} },
      snapshotEvent(5, 13, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      {
        seq: 6,
        tMs: 100,
        kind: 'groupsChanged',
        data: { opened: [], closed: [], changed: [{ groupIndex: 0 }] },
      },
      snapshotEvent(7, 101, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'a.ts')),
      {
        seq: 8,
        tMs: 110,
        kind: 'tabsChanged',
        data: {
          opened: [{ groupIndex: 0, label: 'b.ts', inputKind: 'text' }],
          closed: [],
          changed: [],
        },
      },
      snapshotEvent(9, 111, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'b.ts')),
      {
        seq: 10,
        tMs: 112,
        kind: 'activeTextEditor',
        data: { uri: 'file:///recorded/machine/b.ts', viewColumn: 1 },
      },
      snapshotEvent(11, 113, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'b.ts')),
    ])
  }
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: parseHostTrace(text()),
  })
  const observations: string[] = []
  const { tabGroups } = harness.editor.window
  const frontLabels = (): string =>
    tabGroups.all
      .filter((group) => group.viewColumn === 1)
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.isActive)
      .map((tab) => tab.label)
      .join(',')
  tabGroups.onDidChangeTabGroups(() => {
    observations.push(`group event: front tab ${frontLabels()}`)
  })
  tabGroups.onDidChangeTabs(() => {
    observations.push(`tab event: front tab ${frontLabels()}`)
  })

  // Act
  harness.openAnnouncedTextTab('a.ts', 1, { isPreview: false, isDirty: false })
  await harness.hostOrder!.settled()
  observations.length = 0
  harness.openAnnouncedTextTab('b.ts', 1, { isPreview: false, isDirty: false })
  await harness.hostOrder!.settled()
  const result = harness.hostOrder!.result()
  await harness.close()

  // Assert
  assert.deepEqual(observations, [
    'group event: front tab a.ts',
    'tab event: front tab b.ts',
  ])
  assert.equal(result.unmatchedModelBursts, 0)
  assert.equal(result.unreachedTraceBursts, 0)
})

// Value: protects=a replay test building its recorded start state (a take's first line is a snapshot of a window already set up) without the setup consuming trace events; fails_when=a call the fake makes while the replay is bypassed waits for a burst end, is matched against the trace or is counted as unmatched; why_new=Cycle 0094 task 12 spike (the historical take starts from a prepared window); seam=workspaceHarness hostOrder, openAnnouncedTextTab, the fake's tab listeners; no_claim=the replay after the bypass is turned off, which the other tests cover
test('listener calls made while the replay is bypassed reach the workspace at once and are not counted', async () => {
  // Arrange
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: parseHostTrace(traceText([snapshotEvent(1, 0, [])])),
  })
  const heard: string[] = []
  harness.editor.window.tabGroups.onDidChangeTabs(() => {
    heard.push('tab event')
  })

  // Act
  harness.hostOrder!.bypass(true)
  harness.openAnnouncedTextTab('a.ts', 1, { isPreview: false, isDirty: false })
  const heardBeforeAnyBurstEnded = [...heard]
  await harness.hostOrder!.settled()
  const result = harness.hostOrder!.result()
  await harness.close()

  // Assert
  assert.deepEqual(heardBeforeAnyBurstEnded, ['tab event'])
  assert.equal(result.unmatchedModelBursts, 0)
  assert.equal(result.unreachedTraceBursts, 0)
})

/** A trace of one window: a mark `step` after a first event, one event inside the window, a layout after it, and a second mark `end`, then one event after the window. */
function windowedTraceText(): string {
  const before = COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')
  return traceText([
    snapshotEvent(1, 0, before),
    tabsChangedEvent(2, 5, 'a.ts'),
    snapshotEvent(3, 5, before),
    { seq: 4, tMs: 10, kind: 'editorLayout', data: { orientation: 0 } },
    { seq: 5, tMs: 900, kind: 'mark', data: { label: 'step' } },
    snapshotEvent(6, 900, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'a.ts')),
    tabsChangedEvent(7, 910, 'b.ts'),
    snapshotEvent(8, 910, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'b.ts')),
    { seq: 9, tMs: 915, kind: 'editorLayout', data: { orientation: 1 } },
    { seq: 10, tMs: 2000, kind: 'mark', data: { label: 'end' } },
    snapshotEvent(11, 2000, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'b.ts')),
    tabsChangedEvent(12, 2010, 'a.ts'),
    snapshotEvent(13, 2010, COLUMN_ONE_ACTIVE(['a.ts', 'b.ts'], 'a.ts')),
  ])
}

// Value: protects=a replay of one step of a take: only the events between two marks are replayed, from the state recorded at the first mark to the state recorded at the second; fails_when=events before the start mark or after the end mark enter the window, or the window's start or end state is read from the wrong snapshot or layout; why_new=Cycle 0094 task 12 (R13 windowed replay); seam=parseHostTrace marks, hostTraceWindow, startSnapshot; no_claim=what the fake does inside the window
test('a window between two marks holds only the events between them with the start and end state recorded at the marks', () => {
  // Arrange
  const trace = parseHostTrace(windowedTraceText())

  // Act
  const window = hostTraceWindow(trace, 'step', 'end')

  // Assert
  assert.deepEqual(
    window.trace.segments[0]!.events.map((event) => event.seq),
    [7],
  )
  assert.deepEqual(
    startSnapshot(window).snapshot.groups[0]!.tabs.map((tab) => tab.label),
    ['a.ts', 'b.ts'],
  )
  assert.deepEqual(startSnapshot(window).layout, { orientation: 0 })
  assert.deepEqual(window.trace.finalLayout, { orientation: 1 })
  assert.equal(window.trace.finalSnapshot?.groups[0]?.tabs[1]?.isActive, true)
})

// Value: protects=a window that runs to the take's end (the last step has no closing mark); fails_when=the window stops early or its end state is not the take's final one; why_new=Cycle 0094 task 12 (R13); seam=hostTraceWindow without an end label; no_claim=none
test('a window without an end mark runs to the take end and ends in the take final state', () => {
  // Arrange
  const trace = parseHostTrace(windowedTraceText())

  // Act
  const window = hostTraceWindow(trace, 'end')

  // Assert
  assert.deepEqual(
    window.trace.segments[0]!.events.map((event) => event.seq),
    [12],
  )
  assert.equal(window.trace.finalSnapshot?.groups[0]?.tabs[0]?.isActive, true)
})

// Value: protects=a test failing loudly when its mark is not in the take instead of replaying an empty window; fails_when=an unknown label or an end before the start returns a window; why_new=Cycle 0094 task 12 (R13); seam=hostTraceWindow; no_claim=none
test('a window naming a mark the take does not have is refused as trace-window-invalid', () => {
  // Arrange
  const trace = parseHostTrace(windowedTraceText())

  // Act
  const unknownStart = (): unknown => hostTraceWindow(trace, 'missing')
  const endBeforeStart = (): unknown => hostTraceWindow(trace, 'end', 'step')

  // Assert
  for (const refuse of [unknownStart, endBeforeStart])
    assert.throws(refuse, (error) => {
      assert.ok(error instanceof HostTraceError)
      assert.equal(error.code, 'trace-window-invalid')
      return true
    })
})

// Value: protects=the comparison of a native take with the harness despite their labels: Codebook's panes, the captured source and the chat group by role, learner tabs by label, fixture-only tabs dropped by name, layout per role; fails_when=a chat group's conversation count, a captured file name or a listed fixture tab makes two equal states differ, or a role is mislabelled; why_new=Cycle 0094 task 12 (R13 role normalization); seam=roleNormalize; no_claim=that a state differing in a learner's tab label compares equal (it must not)
test('a state is compared by roles: panes, captured source and chat group by what they are, learner tabs by label, listed fixture tabs dropped', () => {
  // Arrange
  const webview = (viewType: string, label: string, isActive: boolean) => ({
    label,
    input: { kind: 'webview' as const, viewType },
    isActive,
    isPreview: false,
  })
  const learnerTab = (label: string) => ({
    label,
    input: { kind: 'text' as const },
    isActive: false,
    isPreview: false,
  })
  const state = {
    snapshot: {
      groups: [
        {
          viewColumn: 1,
          isActive: false,
          tabs: [
            learnerTab('article-source.ts'),
            learnerTab('data.ts'),
            webview(
              'mainThreadWebview-codebook.scopedBrowser',
              'codebook · Application',
              true,
            ),
          ],
        },
        {
          viewColumn: 2,
          isActive: true,
          tabs: [
            {
              label: 'Captured-theme.ts',
              input: {
                kind: 'text' as const,
                uri: 'codebook-source:Captured-theme.ts',
              },
              isActive: true,
              isPreview: false,
            },
          ],
        },
        {
          viewColumn: 3,
          isActive: false,
          tabs: [
            {
              label: 'Fix login',
              input: { kind: 'unknown' as const },
              isActive: true,
              isPreview: false,
            },
            {
              label: 'Plan billing',
              input: { kind: 'unknown' as const },
              isActive: false,
              isPreview: false,
            },
          ],
        },
      ],
      activeGroupIndex: 1,
    },
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 3 }] },
  }

  // Act
  const normalized = roleNormalize(state, {
    dropTabLabels: ['article-source.ts'],
  })

  // Assert
  assert.deepEqual(normalized, {
    groups: [
      {
        tabs: ['text:data.ts', 'application'],
        frontTab: 'application',
        isActive: false,
      },
      {
        tabs: ['captured-source'],
        frontTab: 'captured-source',
        isActive: true,
      },
      { tabs: ['chat'], frontTab: 'chat', isActive: false },
    ],
    layout: {
      orientation: 0,
      groups: [
        { share: 0.25, role: 'application' },
        { share: 0.75, role: 'captured-source' },
      ],
    },
  })
})

// Value: protects=the host's order of events relative to the command that caused them: a window replay delivers a matched burst before the awaited operation answers, as the native host reports events before the command result; fails_when=the listener hears the burst only after the operation's promise resolved (the guard that reads the groups right after the command then sees a state no event described); why_new=Cycle 0094 task 12 (R13 delivery before the operation's result); seam=HostOrderInterposer with-operation delivery; no_claim=gap timing inside a run
test('a window replay delivers the matched burst before the awaited operation resolves', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      snapshotEvent(2, 1, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(
    trace,
    stubFake(groups),
    'with-operation',
  )
  const order: string[] = []
  const listener = interposer.wrap('tabsChanged', (_event: unknown) =>
    order.push('listener heard the tab change'),
  )
  /** The fake operation: changes the model, tells its listeners synchronously, then answers. */
  async function fakeCommand(): Promise<void> {
    listener({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  }

  // Act
  await fakeCommand()
  order.push('caller continued after the command')

  // Assert
  assert.deepEqual(order, [
    'listener heard the tab change',
    'caller continued after the command',
  ])
})

// Value: protects=the default delivery staying after the operation (the hand-written order scenarios keep their verdicts); fails_when=the default mode delivers before the operation answers; why_new=Cycle 0094 task 12 (R13: the new mode is opt-in); seam=HostOrderInterposer default delivery; no_claim=none
test('the default replay still delivers a matched burst only after the operation resolved', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      snapshotEvent(2, 1, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const order: string[] = []
  const listener = interposer.wrap('tabsChanged', (_event: unknown) =>
    order.push('listener heard the tab change'),
  )
  async function fakeCommand(): Promise<void> {
    listener({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  }

  // Act
  await fakeCommand()
  order.push('caller continued after the command')
  await interposer.settled()

  // Assert
  assert.deepEqual(order, [
    'caller continued after the command',
    'listener heard the tab change',
  ])
})

// Value: protects=events of the window that the fake never produced: they still reach the workspace, after the last burst and at their recorded offsets, and stay counted as unreached; fails_when=a trailing event is not delivered, is delivered before the burst, or is dropped from the unreached count; why_new=Cycle 0094 task 12 (R13 unsolicited events); seam=HostOrderInterposer.deliverTrailing, result; no_claim=the 2 s cap's exact wait
test('events no model burst reached are delivered after the last burst and still counted as unreached', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      snapshotEvent(2, 1, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      {
        seq: 3,
        tMs: 30,
        kind: 'groupsChanged',
        data: { opened: [], closed: [], changed: [{ groupIndex: 0 }] },
      },
      snapshotEvent(4, 31, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(
    trace,
    stubFake(groups),
    'with-operation',
  )
  const heard: string[] = []
  const onTabs = interposer.wrap('tabsChanged', (_event: unknown) =>
    heard.push('tabs'),
  )
  interposer.wrap('groupsChanged', (_event: unknown) => heard.push('groups'))

  // Act
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  await interposer.deliverTrailing()
  const result = interposer.result()

  // Assert
  assert.deepEqual(heard, ['tabs', 'groups'])
  assert.equal(result.unmatchedModelBursts, 0)
  assert.equal(result.unreachedTraceBursts, 1)
})

// Value: protects=the fake's layout following what the host settled on after an event (a host resizes groups as it activates them, which the fake does not derive); fails_when=the recorded layout after a delivered event is not applied to the fake; why_new=Cycle 0094 task 12 (R13: Cursor's resize on the Arrange window); seam=HostOrderFake.applyLayout, HostOrderInterposer.deliverTrailing; no_claim=that the fake would produce the layout itself
test('the fake layout follows the layout the host recorded after a delivered event', async () => {
  // Arrange
  const trace = parseHostTrace(windowedTraceText())
  const window = hostTraceWindow(trace, 'step', 'end')
  const groups: StubGroup[] = [
    { viewColumn: 1, tabs: [{ label: 'a.ts' }, { label: 'b.ts' }] },
  ]
  let layout: unknown = { orientation: 0 }
  const fake = {
    ...stubFake(groups),
    editorLayout: () => layout,
    applyLayout: (recorded: unknown): void => {
      layout = recorded
    },
  }
  const interposer = new HostOrderInterposer(
    window.trace,
    fake,
    'with-operation',
  )
  interposer.wrap('tabsChanged', (_event: unknown) => undefined)

  // Act
  await interposer.deliverTrailing()

  // Assert
  assert.deepEqual(layout, { orientation: 1 })
})

// Value: protects=the workspace's own layout command in a window replay: a layout the host recorded before it answered that command is the old state and must not be put back over it; the host's later answer is applied; fails_when=the recorded layout equal to the one the command replaced is applied after the command (the fake reverts to the old layout and the reader never reads its own back: Cursor 3.29.9 open-study, "The editor could not reserve separate Codebook panes"), or the host's different later layout is skipped; why_new=Cycle 0094 task 12 (Cursor chat-closed open-study); seam=HostOrderInterposer with-operation delivery, applyLayout; no_claim=a host that answers with the same layout it had (nothing to apply), the after-operation mode
test('a layout recorded before the host answered the workspace layout command is not applied over it, and the answer is', async () => {
  // Arrange
  const oldLayout = { orientation: 1, groups: [{ size: 678 }] }
  const commandLayout = { orientation: 0, groups: [{ size: 2 }, { size: 1 }] }
  const hostAnswer = { orientation: 0, groups: [{ size: 938 }, { size: 768 }] }
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      snapshotEvent(2, 1, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      { seq: 3, tMs: 2, kind: 'editorLayout', data: oldLayout },
      {
        seq: 4,
        tMs: 30,
        kind: 'groupsChanged',
        data: { opened: [], closed: [], changed: [{ groupIndex: 0 }] },
      },
      snapshotEvent(5, 31, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      { seq: 6, tMs: 32, kind: 'editorLayout', data: hostAnswer },
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const layoutHolder = { current: structuredClone(oldLayout) as unknown }
  const interposer = new HostOrderInterposer(
    trace,
    stubFake(groups, layoutHolder),
    'with-operation',
  )
  const listener = interposer.wrap(
    'tabsChanged',
    (_event: unknown) => undefined,
  )
  interposer.bypass(false)

  // Act: the workspace sets its own layout, and the editor tells it about the tab change in the same burst.
  layoutHolder.current = commandLayout
  listener({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  await interposer.settled()
  const layoutAfterBurst = layoutHolder.current
  await interposer.deliverTrailing()

  // Assert
  assert.deepEqual(layoutAfterBurst, commandLayout)
  assert.deepEqual(layoutHolder.current, hostAnswer)
})

// Value: protects=a window replay naming a tab the first replayed operation closes: the tabs the setup built are remembered when the replay is switched on, so the trace can still name them once the fake has closed them; fails_when=a tab closed by the first burst, before any burst remembered it, makes the replay fail with trace-mapping-failed (Cursor 3.29.9 recording, the Study tab); why_new=Cycle 0094 task 12 (recorded harness windows); seam=HostOrderInterposer.bypass, rememberObjects; no_claim=groups, which the trace names by column
test('a tab the first replayed operation closes can still be named by the trace', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      tabsChangedEvent(1, 0, 'a.ts'),
      snapshotEvent(2, 1, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      {
        seq: 3,
        tMs: 5,
        kind: 'tabsChanged',
        data: {
          opened: [],
          closed: [{ groupIndex: 0, label: 'b.ts', inputKind: 'text' }],
          changed: [],
        },
      },
      snapshotEvent(4, 6, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
    ]),
  )
  const groups: StubGroup[] = [
    { viewColumn: 1, tabs: [{ label: 'a.ts' }, { label: 'b.ts' }] },
  ]
  const interposer = new HostOrderInterposer(
    trace,
    stubFake(groups),
    'with-operation',
  )
  const heard: string[] = []
  const listener = interposer.wrap('tabsChanged', (event: unknown) =>
    heard.push(JSON.stringify(event === undefined ? 0 : 1)),
  )
  interposer.bypass(true)
  interposer.bypass(false)

  // Act: the operation closes b.ts, then tells its listeners about a.ts only.
  const closedTab = groups[0]!.tabs.pop()!
  listener({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  await interposer.deliverTrailing()

  // Assert
  assert.equal(closedTab.label, 'b.ts')
  assert.equal(heard.length, 2)
  assert.equal(interposer.result().unmatchedModelBursts, 0)
})

// Value: protects=a window test building its recorded start state with a saved recording: the recorded harness forwards the host-order options and its setup (recording, attach, stop) consumes no trace event; fails_when=the recorded harness ignores hostOrder (no interposer), or the setup's tab and group events are matched against the trace or counted as unmatched; why_new=Cycle 0094 task 12 (VS Code and Cursor recording and reload windows); seam=recordedReaderHarness hostOrderOptions, workspaceHarness hostOrderStartBypassed; no_claim=the replay after the bypass is turned off, which the window tests cover
test('a recorded harness built over a trace consumes no trace event while its recording is set up', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([snapshotEvent(1, 0, []), tabsChangedEvent(2, 5, 'a.ts')]),
  )

  // Act
  const harness = await recordedReaderHarness(false, false, 1, undefined, {
    hostOrder: trace,
    hostOrderDelivery: 'with-operation',
    startBypassed: true,
  })
  await harness.reader.open()
  await harness.hostOrder!.settled()
  const result = harness.hostOrder!.result()
  await harness.close()

  // Assert
  assert.equal(result.unmatchedModelBursts, 0)
  // The trace's one event stays unconsumed: the setup took none.
  assert.equal(result.unreachedTraceBursts, 1)
})

// Value: protects=a sanitized trace's selection or active-editor event on Codebook's captured source being matched to the fake's editor; fails_when=a document URI of the form `scheme:Name` (no slash, as the recorder writes a virtual document) names the whole URI, so the event never finds the fake's `Captured-index.ts` editor and a replay stops with trace-mapping-failed; why_new=Cycle 0094 task 12 (VS Code 1.145.2 window replays); seam=fileNameOf; no_claim=any other URI shape than the three asserted
test('names a captured source by its file name whether its URI has a slash path or only a scheme', () => {
  // Arrange
  const uris = [
    'codebook-source:Captured-index.ts',
    'codebook-source://key/study/Captured-index.ts?x=1',
    'file:///repo/db/index.ts#L3',
  ]

  // Act
  const names = uris.map(fileNameOf)

  // Assert
  assert.deepEqual(names, [
    'Captured-index.ts',
    'Captured-index.ts',
    'index.ts',
  ])
})

// Value: protects=rule 4 for a group the host closed before the recorder read its index (the recorder writes -1 for it): the closed group is named by the column the snapshot before the event had and the one after it lacks; fails_when=a closed entry with groupIndex -1 names no column and the replay fails as trace-mapping-failed instead of handing the listener the fake object it kept by identity; why_new=Cycle 0094 part 2 review round (R3 finding 1); seam=parseHostTrace, HostOrderInterposer.wrap, settled; no_claim=which group the host closed when two close at once (they are named in column order)
test('a group the host closed before the recorder read its index is delivered as the closed group the fake kept by identity', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      snapshotEvent(1, 0, [
        ...COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts'),
        { viewColumn: 2, isActive: false, tabs: [] },
      ]),
      {
        seq: 2,
        tMs: 1,
        kind: 'groupsChanged',
        data: { opened: [], closed: [{ groupIndex: -1 }], changed: [] },
      },
      snapshotEvent(3, 2, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      tabsChangedEvent(4, 6, 'a.ts'),
    ]),
  )
  const closing: StubGroup = { viewColumn: 2, tabs: [] }
  const groups: StubGroup[] = [
    { viewColumn: 1, tabs: [{ label: 'a.ts' }] },
    closing,
  ]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const closedGroups: StubGroup[] = []
  interposer.wrap('groupsChanged', (event: { closed: StubGroup[] }) => {
    closedGroups.push(...event.closed)
  })
  const onTabs = interposer.wrap('tabsChanged', (_event: unknown) => {})
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  groups.splice(1, 1)
  await interposer.settled()

  // Act
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  const settled = interposer.settled()

  // Assert
  await settled
  assert.deepEqual(closedGroups, [closing])
})

// Value: protects=the replay of a closed group whose column no snapshot names (a window cut right after a reload has no state before it): it is left out of the payload instead of failing the whole replay; fails_when=the unnamed closed group throws trace-mapping-failed; why_new=Cycle 0094 part 2 review round (R3 finding 1); seam=HostOrderInterposer.deliverTrailing; no_claim=that the listener learns of the closed group
test('a closed group no snapshot can name is left out of the delivered payload and does not fail the replay', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      {
        seq: 1,
        tMs: 0,
        kind: 'groupsChanged',
        data: { opened: [], closed: [{ groupIndex: -1 }], changed: [] },
      },
    ]),
  )
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const closedCounts: number[] = []
  interposer.wrap('groupsChanged', (event: { closed: StubGroup[] }) => {
    closedCounts.push(event.closed.length)
  })

  // Act
  const trailing = interposer.deliverTrailing()

  // Assert
  await trailing
  assert.deepEqual(closedCounts, [0])
})

// Value: protects=a run's events carrying the payload of the model event each one was assigned to (findCoveringRun's modelIndexOf), not of the first model event that could cover it; fails_when=two model events that a trace event could each cover both deliver the first one's payload; why_new=Cycle 0094 part 2 review round (R3 finding 2); seam=HostOrderInterposer.wrap, settled; no_claim=the order of the two assigned events beyond what the assignment gives
test('each event of a matched run delivers the payload of the model event assigned to it, not the first one that could cover it', async () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      {
        seq: 1,
        tMs: 0,
        kind: 'tabsChanged',
        data: {
          opened: [],
          closed: [],
          changed: [
            { groupIndex: 0, label: 'a.ts', inputKind: 'text' },
            { groupIndex: 0, label: 'b.ts', inputKind: 'text' },
          ],
        },
      },
      tabsChangedEvent(2, 1, 'a.ts'),
    ]),
  )
  const groups: StubGroup[] = [
    { viewColumn: 1, tabs: [{ label: 'a.ts' }, { label: 'b.ts' }] },
  ]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const heard: string[] = []
  const onTabs = interposer.wrap(
    'tabsChanged',
    (event: { changed: StubTab[]; opened?: StubTab[]; closed?: StubTab[] }) => {
      heard.push(event.changed.map((tab) => tab.label).join(','))
    },
  )

  // Act
  onTabs({ opened: [], closed: [], changed: [groups[0]!.tabs[0]!] })
  onTabs({
    opened: [],
    closed: [],
    changed: [groups[0]!.tabs[0]!, groups[0]!.tabs[1]!],
  })
  await interposer.settled()

  // Assert
  assert.deepEqual(heard, ['a.ts,b.ts', 'a.ts'])
})

// Value: protects=a disposed workspace listener hearing nothing more, also from trace events the replay builds itself; fails_when=an unwrapped listener still receives a delivery; why_new=Cycle 0094 part 2 review round (R3 finding 3); seam=HostOrderInterposer.wrap, unwrap, deliverTrailing; no_claim=the harness' own registration bookkeeping
test('a listener whose registration ended hears no trace event delivered afterwards', async () => {
  // Arrange
  const trace = parseHostTrace(traceText([tabsChangedEvent(1, 0, 'a.ts')]))
  const groups: StubGroup[] = [{ viewColumn: 1, tabs: [{ label: 'a.ts' }] }]
  const interposer = new HostOrderInterposer(trace, stubFake(groups))
  const heard: string[] = []
  const listener = interposer.wrap('tabsChanged', (_event: unknown) => {
    heard.push('tabs')
  })

  // Act
  interposer.unwrap(listener)
  await interposer.deliverTrailing()

  // Assert
  assert.deepEqual(heard, [])
})

// Value: protects=the workspace harness ending a listener's registration in the replay when the workspace disposes it; fails_when=a tab-group listener the workspace disposed still hears a trace event the replay delivers afterwards; why_new=Cycle 0094 part 2 review round (R3 finding 3); seam=workspaceHarness hostOrder, tabGroups.onDidChangeTabs, deliverTrailing; no_claim=listeners of the other four registrations (they share the same dispose line)
test('a tab listener the workspace disposed hears no trailing trace event in the harness', async () => {
  // Arrange
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: parseHostTrace(
      traceText([
        snapshotEvent(1, 0, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
        tabsChangedEvent(2, 5, 'a.ts'),
        snapshotEvent(3, 6, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      ]),
    ),
  })
  const heard: string[] = []
  const registration = harness.editor.window.tabGroups.onDidChangeTabs(() => {
    heard.push('tabs')
  })
  harness.hostOrder!.bypass(true)
  harness.openAnnouncedTextTab('a.ts', 1, { isPreview: false, isDirty: false })
  harness.hostOrder!.bypass(false)
  heard.length = 0

  // Act
  registration.dispose()
  await harness.hostOrder!.deliverTrailing()
  await harness.close()

  // Assert
  assert.deepEqual(heard, [])
})

// Value: protects=a window that has no end mark running to the take's end across a Reload Window; fails_when=the later segments' events are dropped from the window; why_new=Cycle 0094 part 2 review round (R3 finding 4); seam=hostTraceWindow, parseHostTrace; no_claim=what a replay does with the second segment (runSegments' tests)
test('a window without an end mark keeps the segments after a Reload Window whole', () => {
  // Arrange
  const trace = parseHostTrace(
    traceText([
      snapshotEvent(1, 0, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      { seq: 2, tMs: 5, kind: 'mark', data: { label: 'step' } },
      snapshotEvent(3, 5, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      tabsChangedEvent(4, 6, 'a.ts'),
      {
        seq: 5,
        tMs: 7,
        kind: 'reload',
        data: { unrecordedFromMs: 7, unrecordedToMs: 50 },
      },
      snapshotEvent(6, 60, COLUMN_ONE_ACTIVE(['a.ts'], 'a.ts')),
      tabsChangedEvent(7, 61, 'a.ts'),
      tabsChangedEvent(8, 62, 'a.ts'),
    ]),
  )

  // Act
  const window = hostTraceWindow(trace, 'step')

  // Assert
  assert.deepEqual(
    window.trace.segments.map((segment) => segment.events.map((e) => e.seq)),
    [[4], [7, 8]],
  )
  assert.equal(window.trace.segments[0]!.reload?.unrecordedToMs, 50)
})

// Value: protects=the front tab of a recorded snapshot being applied to the one fake tab at its position when a group holds several tabs of one name and kind; fails_when=every same-name tab of the group becomes active; why_new=Cycle 0094 part 2 review round (R3 finding 5); seam=workspaceHarness hostOrder applyActiveState via deliverTrailing; no_claim=which of two identical tabs the editor would really show
test('a snapshot front tab among same-name tabs of one group activates only the tab at its position', async () => {
  // Arrange
  const twoXTabs = [
    {
      viewColumn: 1,
      isActive: true,
      tabs: [textTab('x.ts', true), textTab('x.ts', false)],
    },
  ]
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: parseHostTrace(
      traceText([
        snapshotEvent(1, 0, twoXTabs),
        tabsChangedEvent(2, 5, 'x.ts'),
        snapshotEvent(3, 6, twoXTabs),
      ]),
    ),
  })
  harness.hostOrder!.bypass(true)
  harness.openAnnouncedTextTab('first/x.ts', 1, {
    isPreview: false,
    isDirty: false,
  })
  harness.openAnnouncedTextTab('second/x.ts', 1, {
    isPreview: false,
    isDirty: false,
  })
  harness.hostOrder!.bypass(false)

  // Act
  await harness.hostOrder!.deliverTrailing()
  const tabs = harness.groups.find((group) => group.viewColumn === 1)!.tabs
  const active = tabs.map((tab) => tab.isActive)
  const labels = tabs.map((tab) => tab.label)
  await harness.close()

  // Assert
  assert.deepEqual(labels, ['x.ts', 'x.ts'])
  assert.deepEqual(active, [true, false])
})
