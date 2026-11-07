import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { workspaceHarness } from './studyWorkspaceHarness'
import {
  findCoveringRun,
  HostOrderInterposer,
  HostTraceError,
  layoutProportions,
  parseHostTrace,
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
    editorLayout: () => ({ orientation: 0, groups: [{}] }),
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
