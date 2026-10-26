import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describePlacementRefusal,
  PlacementEventLog,
} from '../utils/placementRefusalReport'

// Value: protects=refusal report bounded: 8 tabs per group, 48 chars per label, rest counted; fails_when=a group lists every tab in full; why_new=only short groups asserted; seam=none; no_claim=guard choice
test('cuts a crowded group to eight tabs and long labels to 48 characters in the refusal report', () => {
  // Arrange
  const tabs = Array.from({ length: 10 }, (_, index) => ({
    label: index === 0 ? 'x'.repeat(60) : `t${index}`,
    kind: 'text',
  }))
  const group = { viewColumn: 2, isActive: true, tabs }

  // Act
  const report = describePlacementRefusal({
    guard: 'placement',
    armedAtMs: 100,
    nowMs: 230,
    before: [group],
    after: [{ viewColumn: 1, isActive: false, tabs: [] }],
    events: [],
  })

  // Assert
  assert.equal(
    report,
    [
      'Guard: placement',
      'Armed 130 ms before the refusal',
      `Groups before: 2* [${'x'.repeat(48)} (text), t1 (text), t2 (text), t3 (text), t4 (text), t5 (text), t6 (text), t7 (text), +2 more]`,
      'Groups after: 1 []',
      'Events while armed:',
      '  none',
    ].join('\n'),
  )
})

// Value: protects=report lists last 24 editor events as ms since arming; fails_when=more than 24 kept or absolute times shown; why_new=cap and since() untested; seam=none; no_claim=editor events
test('keeps the last 24 editor events and lists those since the guard was armed', () => {
  // Arrange
  const log = new PlacementEventLog()
  for (let index = 0; index < 30; index += 1)
    log.record(index * 10, `event ${index}`)

  // Act
  const events = log.since(280)
  const all = log.since(0)
  const report = describePlacementRefusal({
    guard: 'placement',
    armedAtMs: 270,
    nowMs: 300,
    before: [],
    after: [],
    events,
  })

  // Assert
  assert.equal(all.length, 24)
  assert.equal(all[0]!.what, 'event 6')
  assert.deepEqual(
    events.map((event) => event.what),
    ['event 28', 'event 29'],
  )
  assert.match(
    report,
    /Events while armed:\n  \+10 ms event 28\n  \+20 ms event 29$/,
  )
})

// Value: protects=the lines N55-F4's native reproduction reads: the call site, the failed comparisons, each group's front tab with preview and pinned flags, the focused tab at arming against the active tab at the refusal, and Codebook's own effects with their time since arming; fails_when=a line is missing, a flag is not shown, or the effects are mixed with the editor's events; why_new=Cycle 0056 task 17 stage 1; seam=none; no_claim=the guard that names them
test('names the call site, the failed checks, the front tabs, the focused tab and Codebook’s own effects in the refusal report', () => {
  // Arrange
  const studyTab = {
    label: 'codebook · Study',
    kind: 'webview codebook.studyContext',
    isPreview: false,
    isPinned: true,
  }
  const nextTab = {
    label: 'data.ts',
    kind: 'text',
    isPreview: true,
    isPinned: false,
  }
  const before = [
    {
      viewColumn: 3,
      isActive: true,
      tabs: [
        { label: 'codebook · Study', kind: 'webview codebook.studyContext' },
        { label: 'data.ts', kind: 'text' },
      ],
      activeTab: studyTab,
    },
  ]
  const after = [{ ...before[0]!, activeTab: nextTab }]

  // Act
  const report = describePlacementRefusal({
    guard: 'retainPresentationPlacement',
    callSite: 'readMainEditorGrid/assertInitial',
    failedChecks: ['focus group', 'webview tab'],
    armedAtMs: 100,
    nowMs: 102,
    before,
    after,
    focus: { atArming: studyTab, atRefusal: nextTab },
    events: [
      { atMs: 101, what: 'tabs opened [] closed [] changed ["data.ts"]' },
    ],
    effects: [
      {
        atMs: 100,
        what: 'reveal codebook.scopedBrowser column 1 preserveFocus true',
      },
    ],
  })

  // Assert
  assert.equal(
    report,
    [
      'Guard: retainPresentationPlacement',
      'Call site: readMainEditorGrid/assertInitial',
      'Failed checks: focus group, webview tab',
      'Armed 2 ms before the refusal',
      'Groups before: 3* [codebook · Study (webview codebook.studyContext), data.ts (text)]',
      'Groups after: 3* [codebook · Study (webview codebook.studyContext), data.ts (text)]',
      'Front tabs before: 3* "codebook · Study" (webview codebook.studyContext, pinned)',
      'Front tabs after: 3* "data.ts" (text, preview)',
      'Focused tab at arming: "codebook · Study" (webview codebook.studyContext, pinned)',
      'Active tab at refusal: "data.ts" (text, preview)',
      'Events while armed:',
      '  +1 ms tabs opened [] closed [] changed ["data.ts"]',
      'Codebook’s own effects since arming:',
      '  +0 ms reveal codebook.scopedBrowser column 1 preserveFocus true',
    ].join('\n'),
  )
})

// Value: protects=a guard that retains no focus tab and has no effects still prints a report without the new lines' guesses: no front tabs, no focus lines and an empty effects list that says none; fails_when=the report invents a front tab or leaves the effects heading without a line; why_new=Cycle 0056 task 17 stage 1; seam=none; no_claim=the guards that name them
test('says none when no effect of Codebook’s own was issued since arming and shows no focus lines without them', () => {
  // Arrange
  const group = { viewColumn: 1, isActive: true, tabs: [] }

  // Act
  const report = describePlacementRefusal({
    guard: 'placement',
    failedChecks: [],
    armedAtMs: 0,
    nowMs: 5,
    before: [group],
    after: [group],
    events: [],
    effects: [],
  })

  // Assert
  assert.equal(
    report,
    [
      'Guard: placement',
      'Failed checks: none',
      'Armed 5 ms before the refusal',
      'Groups before: 1* []',
      'Groups after: 1* []',
      'Events while armed:',
      '  none',
      'Codebook’s own effects since arming:',
      '  none',
    ].join('\n'),
  )
})

// Value: protects=Codebook's own effects are kept apart from the editor's events and bounded by the capacity the log is given (48 for effects); fails_when=a log built for effects keeps only 24 notes; why_new=Cycle 0056 task 17 stage 1; seam=none; no_claim=what is recorded
test('keeps as many notes as the capacity the log was given', () => {
  // Arrange
  const log = new PlacementEventLog(48)

  // Act
  for (let index = 0; index < 60; index += 1)
    log.record(index, `effect ${index}`)

  // Assert
  assert.equal(log.since(0).length, 48)
  assert.equal(log.since(0)[0]!.what, 'effect 12')
})
