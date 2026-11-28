import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'
import * as sanitizeCauseModule from '../utils/sanitizeCause'

import { workspaceHarness } from './studyWorkspaceHarness'

// Value: protects=Return to the current pause from a saved item in a reader whose Application pane still stands in a learner group; fails_when=the App preparation takes its placement guard before the editor reported the Application pane's move into the newly allocated group, so Codebook's own move reads as a learner change and the return fails with "Native pane, group or focus changed while presentation waited"; why_new=Cycle 0046 finding 583 (C50 in VS Code 1.140.0 and Cursor 3.23.12: the first Return Current after a cold Study select was refused, and the extension-host observer saw the pane's move reported during the next layout read); seam=the fake editor's movePanelsLater
test('Return to the current pause from a saved item puts the Application in its own group at the first click', async () => {
  // Arrange: the reader shows a saved item, and the editor reports a pane's move into another column only during the next layout read.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    harness.movePanelsLater()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.action('return-current')

    // Assert: no refusal; one owned group was allocated and the Application stands in it, with the layout confirmed.
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'workbench.action.newGroupAbove')
        .length,
      1,
    )
    assert.equal(harness.reader['app']!.viewColumn, 1)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to the current pause after a window reload that left the old Application group empty and locked at column 1, beside the learner's groups; fails_when=the cold Study select puts the Application into that leftover group and Return Current refuses it as adopted before registration (RUNTIME_FAILED, with the layout unconfirmed) instead of placing it in its own group; why_new=Cycle 0046 finding 590 (C54 in Cursor 3.23.12: after Developer: Reload Window the Study's Return Current failed with "The new Application group was adopted before registration."); seam=leaveEmptyLockedGroup and reactivatePreviousGroupAfterInsertion
test("a reloaded window's leftover empty Application group does not refuse Return to the current pause", async () => {
  // Arrange: the window reloaded while the Study was open; the old owned group stays empty and locked at column 1, the learner's files stand in columns 2 and 3, and the chat part has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    // The earlier window recorded the Application group it claimed at column 1 of this three-group grid.
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    // Cursor names the group that held the keyboard again as the new group is locked, before the Application's group is claimed.
    harness.reactivatePreviousGroupAfterInsertion()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Act
    await harness.reader.action('return-current')

    // Assert: no refusal; the Application stands in column 1 with the layout confirmed, and both learner files keep their groups.
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.reader['app']!.viewColumn, 1)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerReadme.tab)),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=after a window reload, a cold Study select that retires the earlier window's leftover Application group writes one Output line naming the column, the group count before the close and the removal's delay; fails_when=no line is written, or it names another column or count; no_claim=how long a real editor takes (the fake removes the group within the close).
test("a reloaded window's leftover Application group retirement writes the Output line of a seen removal", async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three groups; after the reload that group stands empty and locked.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const infoLines: string[] = []
  harness.reader.diagnostics = {
    log: () => undefined,
    show: () => undefined,
    info: (line): void => {
      infoLines.push(line)
    },
  }
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: one line, for column 1 of 3, with the removal seen.
    assert.equal(infoLines.length, 1, infoLines.join(' | '))
    assert.match(
      infoLines[0]!,
      /^Leftover Application group: closed column 1 of 3 groups; removal seen after \d+ ms$/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=when the editor accepts the close of the earlier window's leftover Application group but never removes it, Open Study Workspace fails after the 5 s bound with a message naming both group counts and the bound, and the Output line says the same; fails_when=the message is the old one without counts, a count or the bound is wrong, the way on is missing, or no Output line is written; no_claim=which editor behaviour caused a real timeout (Cycle 0111 E1 did not reproduce one), the fake keeps the group on purpose, and both counts are 3 here, so the unit tests of the message and the line tell the two counts apart; the cause assertion (the wait's WaitTimeoutError kept as the refusal's cause) came from the /ship pre-landing review.
test("a reloaded window's leftover Application group that the editor never removes fails Open Study Workspace with both group counts and the bound", async () => {
  // Arrange: as above, and the editor will accept the leftover's close without ever removing the group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const infoLines: string[] = []
  harness.reader.diagnostics = {
    log: () => undefined,
    show: () => undefined,
    info: (line): void => {
      infoLines.push(line)
    },
  }
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.keepNextClosedGroup()

    // Act: the learner's Codebook: Open Study Workspace, the entry the earlier timeouts came through.
    let refusal: unknown
    const outcome = await harness.reader.open().then(
      () => harness.reader.inspect().view?.errors.join(' | ') ?? '',
      (error: unknown) => {
        refusal = error
        return String(error)
      },
    )

    // Assert: the refusal and the Output line name 3 groups before the close and 3 at the 5000 ms bound, and the refusal keeps the wait's timeout as its cause.
    assert.match(
      outcome,
      /Timed out waiting for leftover Application group removal \(groups before the close: 3, now: 3, after 5000 ms\)\. Run "Codebook: Open Study Workspace" again\./,
    )
    // The product module runs in its own realm (loadModule), so its Error is not this file's Error; the cause's class is shared.
    assert.equal(
      typeof refusal === 'object' &&
        refusal !== null &&
        'cause' in refusal &&
        refusal.cause instanceof WaitTimeoutError,
      true,
    )
    assert.deepEqual(infoLines, [
      'Leftover Application group: closed column 1 of 3 groups; removal not seen within 5000 ms (groups now 3)',
    ])
  } finally {
    await harness.close()
  }
})

/**
 * Arranges a window reloaded after Codebook recorded its Application group as the main editor's only group, beside Cursor's Agent part: the earlier window's record names column 1 of a one-group grid, and the editor restored that group empty and locked, with no pane.
 * @param harness - The workspace harness, laid out with one main group.
 * @returns The restored leftover group.
 * @example const leftover = leaveLoneLeftoverBesideAgent(harness)
 */
function leaveLoneLeftoverBesideAgent(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
) {
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 1,
    layout: { orientation: 0, groups: [{ size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  const leftover = harness.groups.find((group) => group.viewColumn === 1)
  assert.ok(leftover)
  return leftover
}

/**
 * Lists every editor group by column with its tab count and lock, as the fake editor holds them now.
 * @param harness - The workspace harness.
 * @returns One entry per group, in column order.
 * @example groupLocks(harness) // => [{ column: 1, tabs: 0, locked: true }, { column: 2, tabs: 1, locked: false }]
 */
function groupLocks(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return harness.groups
    .map((group) => ({
      column: group.viewColumn,
      tabs: group.tabs.length,
      locked: Boolean(group.locked),
    }))
    .toSorted((left, right) => left.column - right.column)
}

/**
 * Lists the tab labels of every locked group, without the run id a pane's title carries.
 * @param harness - The workspace harness.
 * @returns One label list per locked group, in column order.
 * @example lockedGroupTabs(harness) // => [['codebook · Application']]
 */
function lockedGroupTabs(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
) {
  return harness.groups
    .filter((group) => group.locked)
    .toSorted((left, right) => left.viewColumn - right.viewColumn)
    .map((group) =>
      group.tabs.map((tab) => tab.label.replace(/ [0-9a-f-]{8}$/, '')),
    )
}

/**
 * Runs the learner's Codebook: Open Study Workspace and tells how it ended.
 * @param harness - The workspace harness.
 * @returns `opened` when Open resolved with a view and no reader error; otherwise the error or the view's errors.
 * @example await openStudyWorkspace(harness) // => 'opened'
 */
async function openStudyWorkspace(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): Promise<string> {
  return harness.reader.open().then(
    () => {
      const view = harness.reader.inspect().view
      if (!view) return 'no view'
      return view.errors.length ? view.errors.join(' | ') : 'opened'
    },
    (error: unknown) => String(error),
  )
}

/**
 * Names the window that wrote a group record, as the record's `writer` field says.
 * @param record - The stored record, if any.
 * @returns The writer; `undefined` without a record.
 * @example writerOfRecord({ version: 2, writer: 'b2c7…' }) // => 'b2c7…'
 */
function writerOfRecord(record: unknown): unknown {
  return typeof record === 'object' && record !== null && 'writer' in record
    ? record.writer
    : undefined
}

// Value: protects=Cycle 0133 D12 (E3 probe run A): a reloaded window whose record names the leftover Application group as the main editor's only group, beside Cursor's Agent part, opens the Study workspace, with the leftover kept in place, still locked, and the record gone; fails_when=Open closes that leftover and waits for a removal the editor never makes (it keeps a part's last group), failing after 5 s with "Timed out waiting for leftover Application group removal (groups before the close: 2, now: 2, after 5000 ms)", or it unlocks the leftover, which Cursor 3.30.14 closes when the new group comes above it; no_claim=Cursor's real reload and New Group Above (the fake restores the empty locked group by hand; closeEmptiedGroupAtInsertion models the close) and the keyboard's path, which the leftover tests above own
test("a reloaded window's leftover Application group that is the main editor's only group beside Cursor's Agent part is kept and Open Study Workspace succeeds", async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeEmptiedGroupAtInsertion()
  harness.addSeparateEditorPart()
  try {
    leaveLoneLeftoverBesideAgent(harness)
    assert.deepEqual(groupLocks(harness), [
      { column: 1, tabs: 0, locked: true },
      { column: 2, tabs: 1, locked: false },
    ])

    // Act
    const outcome = await openStudyWorkspace(harness)

    // Assert: Open built its view, with the Application pane in the one locked group, and the earlier window's record gave way to this window's.
    assert.deepEqual(
      {
        outcome,
        lockedGroupTabs: lockedGroupTabs(harness),
        recordWriter: writerOfRecord(
          harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
        ),
      },
      {
        outcome: 'opened',
        lockedGroupTabs: [['codebook · Application']],
        recordWriter: harness.reader['applicationGroupMarkerWriter'],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Cycle 0133 D12 (Step 0 run 5): after Close All Editors and a window reload, when Cursor still lists its Agent part as a group with no tab, the main editor's one empty group counts as its whole grid, so Open Study Workspace retires the lone leftover in place and succeeds; fails_when=the one-group grid is proven only beside a chat part that holds a tab, so Open is refused at once with "The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. …"; no_claim=Cursor's own Close All Editors (closeChatTab stands in for it) and its real reload
test("after Close All Editors left Cursor's Agent part with no tab, a reloaded window's lone leftover Application group is kept and Open Study Workspace succeeds", async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  try {
    leaveLoneLeftoverBesideAgent(harness)
    chat.closeChatTab()
    assert.deepEqual(groupLocks(harness), [
      { column: 1, tabs: 0, locked: true },
      { column: 2, tabs: 0, locked: false },
    ])

    // Act
    const outcome = await openStudyWorkspace(harness)

    // Assert: Open built its view, with the Application pane in the one locked group, and the earlier window's record gave way to this window's.
    assert.deepEqual(
      {
        outcome,
        lockedGroupTabs: lockedGroupTabs(harness),
        recordWriter: writerOfRecord(
          harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
        ),
      },
      {
        outcome: 'opened',
        lockedGroupTabs: [['codebook · Application']],
        recordWriter: harness.reader['applicationGroupMarkerWriter'],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an entry cancelled by a wait of its own that timed out, while Open waits for the leftover Application group's removal sees the cancelled entry's own outcome, not a timeout, and no "removal not seen" Output line; fails_when=the cancelled wait is reported as "Timed out waiting for leftover Application group removal" or writes the bound line; why_new=Cycle 0111 /ship coverage audit; seam=keepNextClosedGroup (returns when the kept close happened); no_claim=an ordinary cancel reason (the wait already rethrows it, so only a cancel whose reason is itself a WaitTimeoutError needs the signal guard), the cancelled entry's exact wording, which the other cancel tests own, and the 5 s bound itself
test("a cancelled Open that waits for a leftover Application group's removal keeps its own reason, shows no timeout and writes no removal line", async () => {
  // Arrange: as above, and the editor will accept the leftover's close without ever removing the group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const infoLines: string[] = []
  harness.reader.diagnostics = {
    log: () => undefined,
    show: () => undefined,
    info: (line): void => {
      infoLines.push(line)
    },
  }
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    const keptClose = harness.keepNextClosedGroup()

    // Act: the learner cancels the entry once the editor has accepted the leftover's close, before the 5 s bound.
    const entry = new AbortController()
    const opening = harness.reader.open(entry.signal).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await keptClose
    entry.abort(
      new WaitTimeoutError('The Study entry was abandoned by an outer wait.'),
    )
    const outcome = await opening

    // Assert: the entry's own reason, no timeout text, and no Output line.
    assert.equal(
      outcome,
      'Error: The Study entry was abandoned by an outer wait.',
    )
    assert.doesNotMatch(
      outcome,
      /Timed out waiting for leftover Application group removal/,
    )
    assert.deepEqual(infoLines, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a read of the editor's groups that fails while Open waits for the leftover Application group's removal reaches the learner as that failure, not as a false "after 5000 ms" timeout, and writes no removal line; fails_when=any failed read is turned into "Timed out waiting for leftover Application group removal" or the bound line; why_new=Cycle 0111 /ship coverage audit; seam=failNextGroupsReadAfterKeptClose; no_claim=how a real editor fails a group read, and the 5 s bound itself
test("a failed read of the editor's groups while Open waits for a leftover Application group's removal shows that failure, not a timeout, and writes no removal line", async () => {
  // Arrange: as above, and the editor will accept the leftover's close without ever removing the group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const infoLines: string[] = []
  harness.reader.diagnostics = {
    log: () => undefined,
    show: () => undefined,
    info: (line): void => {
      infoLines.push(line)
    },
  }
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.keepNextClosedGroup()
    harness.failNextGroupsReadAfterKeptClose(
      new Error('the editor could not list its groups'),
    )

    // Act: the learner's Codebook: Open Study Workspace; the first group read after the close fails.
    const outcome = await harness.reader.open().then(
      () => harness.reader.inspect().view?.errors.join(' | ') ?? '',
      (error: unknown) => String(error),
    )

    // Assert: the read failure is what the learner sees, with no timeout text and no Output line.
    assert.match(outcome, /the editor could not list its groups/)
    assert.doesNotMatch(
      outcome,
      /Timed out waiting for leftover Application group removal/,
    )
    assert.deepEqual(infoLines, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a Restore after a Return that could not confirm the Application's dedicated layout keeps the learner's groups and their tabs; fails_when=the refused Return leaves its half-claimed owner (count set, layout unset) behind, so the Restore arranges the live two-group layout over three learner groups and the editor merges the third learner group into the source group; why_new=Cycle 0046 finding 590 (C54 in Cursor 3.23.12: the Restore after the failed Return merged README.md, auth.ts and Cursor Settings into the source group and lost the learner's arrangement); seam=reactivatePreviousGroupAtNextLayoutRead
test('a Restore that cannot confirm its layout leaves the learner’s groups as they were', async () => {
  // Arrange: the same reloaded window; the Return's native read after the Application moved into its new group finds the editor naming the old group, so the Return is refused after its group was taken.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyLockedGroup(1)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.reactivatePreviousGroupAtNextLayoutRead(4)
    // The Return is refused; its switch to the live composition has already closed Codebook's own Study Context pane, which is no learner tab.
    await harness.reader.action('return-current').catch(() => undefined)
    const readmeGroupBefore = harness.groups.find((group) =>
      group.tabs.includes(learnerReadme.tab),
    )!
    const readmeGroupTabsBefore = [...readmeGroupBefore.tabs]

    // Act: the learner asks for Restore.
    const restoreState = harness.reader.presentationState()
    await harness.reader
      .changePresentation({
        presentationId: restoreState.presentationId,
        expectedRevision: restoreState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      .catch(() => undefined)

    // Assert: the learner's README group keeps its tabs, and the learner's notes keep their group.
    const readmeGroupAfter = harness.groups.find((group) =>
      group.tabs.includes(learnerReadme.tab),
    )
    assert.deepEqual(readmeGroupAfter?.tabs, readmeGroupTabsBefore)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the way back to the live run after Developer: Reload Window when the learner resized the grid, so the earlier window's record no longer proves its empty locked Application group at column 1, and a cold Study select placed the Application pane in that leftover; fails_when=the agent's Return Current moves the Application into its own new group, the editor removes the leftover the move left empty (workbench.editor.closeEmptyGroups, on by default in both hosts), and the reservation, still expecting that group, refuses with "The dedicated Application layout could not be confirmed." and leaves the Study unconfirmed, so Restore refuses too and nothing names the leftover; why_new=Cycle 0046 row 626 (native C56 round 1d in VS Code 1.140.0: layout 229/349/109 against the record's 229×3, cold select confirmed with the Application in the leftover at column 1, then codebook_return_current RUNTIME_FAILED and Restore PRESENTATION_UNAVAILABLE); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove, addSeparateEditorPart (Cursor's chat part) and returnToCurrent as the agent
for (const host of ['VS Code', 'Cursor'] as const)
  test(`in ${host}, an agent's Return Current after a reload whose record no longer proves the leftover reaches the live run in a group of the Application's own`, async () => {
    // Arrange: the earlier window recorded its Application group at column 1 of three equal rows; after the reload that group stands empty and locked, and the learner grew the second row twice, so the record proves nothing. The learner's files stand in columns 2 and 3; in Cursor its chat part stands beside the main editor.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
    })
    const chat = host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
    harness.closeEmptyGroupsAfterPanelMove()
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 1,
        writer: 'the window before the reload',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
        },
      })
      harness.leaveEmptyLockedGroup(1)
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      const learnerActions = harness.focusMutableDraft('actions.ts', 2)
      chat?.focusTab()
      const selection = harness.reader.presentationState()
      await harness.reader.changePresentation(
        {
          presentationId: selection.presentationId,
          expectedRevision: selection.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      // The cold select placed the Application pane in the unproven leftover at column 1, which keeps its lock.
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(leftover.tabs.length, 1)
      assert.equal(leftover.locked, true)
      const selected = harness.reader.presentationState(),
        commandsBefore = harness.commands.length

      // Act
      const answer = await harness.reader
        .returnToCurrent(
          {
            presentationId: selected.presentationId,
            expectedRevision: selected.reader.contentRevision,
          },
          'agent',
        )
        .then(
          () => 'returned',
          (error: unknown) => String(error),
        )

      // Assert: the Return reached the live run with its layout confirmed; the Application stands in column 1 in a new locked group, the editor removed the leftover the pane's move left empty at column 2, Codebook unlocked nothing, and the learner's files keep their groups.
      assert.equal(answer, 'returned')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.groups.includes(leftover), false)
      assert.deepEqual(harness.automaticallyClosedColumns(), [2])
      assert.equal(
        harness.groups.find((group) => group.viewColumn === 1)?.locked,
        true,
      )
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.unlockEditorGroup'),
        false,
      )
      assert.equal(
        harness.groups.find((group) => group.tabs.includes(learnerActions.tab))
          ?.viewColumn,
        2,
      )
      assert.equal(
        harness.groups.find((group) => group.tabs.includes(learnerAuth.tab))
          ?.viewColumn,
        3,
      )
      // The earlier window's record, which proved nothing, gave way to this window's record of the Application's own group.
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown; column?: unknown; groupCount?: unknown }
      assert.deepEqual(
        {
          writtenByThisWindow:
            marker.writer === harness.reader['applicationGroupMarkerWriter'],
          column: marker.column,
          groupCount: marker.groupCount,
        },
        { writtenByThisWindow: true, column: 1, groupCount: 3 },
      )
    } finally {
      await harness.close()
    }
  })

for (const situation of [
  {
    host: 'VS Code',
    layoutAfterClose: {
      orientation: 1,
      groups: [{ size: 349 }, { size: 109 }],
    },
  },
  {
    host: 'Cursor',
    // Beside Cursor's chat part no layout read at Close proves the main editor, so no sizes are given back (as without the leftover): the learner's groups stay in the rows the live arrangement made, which the fake editor reports with a size of 1 each.
    layoutAfterClose: {
      orientation: 1,
      groups: [{ size: 1 }, { size: 1 }],
    },
  },
] as const)
  // Value: protects=the learner's arrangement on row 626's path (Developer: Reload Window, the learner resized the stacked groups so the earlier window's record proves nothing, the cold Study select put the Application into the unproven leftover, and the agent's Return Current moved it into its own group): the live arrangement stacks the Application above the captured source's group and the learner's other group as it does without the leftover (C57 rounds 1a and 1b: three rows), and Close gives the learner's two groups back stacked as they stood, the removed leftover aside; fails_when=the Return's newGroupAbove splits only the Study layout's left column (VS Code 1.140.0 workbench.desktop.main.js 990:31740 adds above the active group, 1106:113133 and 981:46383 split that group's cell), so the learner's second group keeps the Study pane's column beside it, and Close finds one group fewer than it noted (the leftover the editor removed) and gives nothing back, so the learner's groups stand side by side (C57 round 1d); why_new=Cycle 0046 row 639; seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove, addSeparateEditorPart (Cursor's chat part), the reader's agent select and returnToCurrent, close, editorLayout and harness.groups
  test(`in ${situation.host}, an agent's Return Current after a reload whose record no longer proves the leftover stacks the Application above the source and the learner's other group, and Close gives the learner's groups back stacked`, async () => {
    // Arrange: the earlier window recorded its Application group at column 1 of three equal rows; after the reload that group stands empty and locked, and the learner grew the second row twice. actions.ts is in the second row and auth.ts in the third; in Cursor its chat part stands beside the main editor. The agent selected the Study cold, which put the Application into the leftover.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
    })
    const chat =
      situation.host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
    harness.closeEmptyGroupsAfterPanelMove()
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 1,
        writer: 'the window before the reload',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
        },
      })
      harness.leaveEmptyLockedGroup(1)
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      const learnerActions = harness.focusMutableDraft('actions.ts', 2)
      chat?.focusTab()
      const selection = harness.reader.presentationState()
      await harness.reader.changePresentation(
        {
          presentationId: selection.presentationId,
          expectedRevision: selection.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      const selected = harness.reader.presentationState()
      /** Names the column of the group that holds a tab. */
      const columnOf = (tab: unknown): number | undefined =>
        harness.groups.find((group) => group.tabs.some((held) => held === tab))
          ?.viewColumn

      // Act
      await harness.reader.returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      const live = {
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        rows: harness.editorLayout(),
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        actionsColumn: columnOf(learnerActions.tab),
        sourceColumn: harness.sourceColumn(),
        authColumn: columnOf(learnerAuth.tab),
      }
      await harness.reader.close()

      // Assert: three stacked rows (the Application, the captured source with actions.ts, auth.ts) while the run is live; after Close the learner's two groups stand stacked again with the sizes they had.
      assert.deepEqual(
        {
          ...live,
          rows: {
            orientation: (live.rows as { orientation: number }).orientation,
            nested: (
              live.rows as { groups: { groups?: unknown }[] }
            ).groups.some((group) => group.groups !== undefined),
            count: (live.rows as { groups: unknown[] }).groups.length,
          },
          afterClose: harness.editorLayout(),
        },
        {
          layoutConfirmed: true,
          rows: { orientation: 1, nested: false, count: 3 },
          applicationColumn: 1,
          actionsColumn: 2,
          sourceColumn: 2,
          authColumn: 3,
          afterClose: situation.layoutAfterClose,
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the way back to the live run on row 626's path in VS Code (Developer: Reload Window, the learner resized the stacked groups so the earlier window's record proves nothing, the cold Study select put the Application into the unproven leftover) when the editor removes the leftover the Application's move emptied only a moment after that move, as VS Code 1.140.0 did about 130 ms later in C58 round 1d (it closes the moved webview's old editor from `onWillOpenEditor` and awaits that close's confirmation before it removes the group: workbench.desktop.main.js 4037:7120, 1106:79300, 1106:79400, 1106:80531); the Return follows that removal as its own move's effect, reaches the live run stacked, and Close gives the learner's groups back stacked; fails_when=the reservation's placement guard, taken before the late removal, reads the editor's own removal as a learner's change and the Return is refused with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved." (C58 rounds c58-vs-1d and c58-vs-1d2; C57 reached the live run); why_new=Cycle 0046 row 658; seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, close, editorLayout, automaticallyClosedColumns and harness.groups
test("in VS Code, an agent's Return Current after a reload whose record no longer proves the leftover follows the editor's late removal of the leftover the Application's move emptied, reaches the live run stacked, and Close gives the learner's groups back stacked", async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal rows; after the reload that group stands empty and locked, and the learner grew the second row twice. actions.ts is in the second row and auth.ts in the third. The editor removes a group a pane's move emptied 130 ms after the move. The agent selected the Study cold, which put the Application into the leftover.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
    const learnerActions = harness.focusMutableDraft('actions.ts', 2)
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    const selected = harness.reader.presentationState()
    /** Names the column of the group that holds a tab. */
    const columnOf = (tab: unknown): number | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.viewColumn

    // Act
    const answer = await harness.reader
      .returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      .then(
        () => 'returned',
        (error: unknown) => String(error),
      )
    const live = {
      answer,
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      leftoverGone: !harness.groups.includes(leftover),
      removedColumns: harness.automaticallyClosedColumns(),
      rows: harness.editorLayout(),
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      actionsColumn: columnOf(learnerActions.tab),
      sourceColumn: harness.sourceColumn(),
      authColumn: columnOf(learnerAuth.tab),
    }
    await harness.reader.close()

    // Assert: the Return answered, the editor removed the leftover at column 2 after the move, three stacked rows (the Application, the captured source with actions.ts, auth.ts) stand while the run is live, and after Close the learner's two groups stand stacked again with the sizes they had.
    assert.deepEqual(
      {
        ...live,
        rows: {
          orientation: (live.rows as { orientation: number }).orientation,
          nested: (live.rows as { groups: { groups?: unknown }[] }).groups.some(
            (group) => group.groups !== undefined,
          ),
          count: (live.rows as { groups: unknown[] }).groups.length,
        },
        afterClose: harness.editorLayout(),
      },
      {
        answer: 'returned',
        layoutConfirmed: true,
        leftoverGone: true,
        removedColumns: [2],
        rows: { orientation: 1, nested: false, count: 3 },
        applicationColumn: 1,
        actionsColumn: 2,
        sourceColumn: 2,
        authColumn: 3,
        afterClose: { orientation: 1, groups: [{ size: 349 }, { size: 109 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own change of the editor groups while the Return waits for the editor's late removal of the leftover the Application's move emptied (row 658): a group the learner adds then is no effect of Codebook's move, and the Return refuses instead of arranging around it; fails_when=the wait takes every group change before the removal for the editor's own, so the learner's new group is stacked into the live arrangement or refused only later with another cause; why_new=Cycle 0046 row 658 (the bound of its fix); seam=applicationGroupMarkers, leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, the fake editor's workbench.action.newGroupAbove run as the learner, panelColumn and harness.groups
test("in VS Code, a group the learner adds while an agent's Return Current waits for the editor's late removal of the emptied leftover refuses the Return as a learner's change", async () => {
  // Arrange: as in the late-removal round above; the agent selected the Study cold, which put the Application into the unproven leftover.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    const selected = harness.reader.presentationState()

    // Act: the agent's Return moves the Application out of the leftover; before the editor removes the emptied leftover, the learner runs New Group Above in the Application's new group.
    const answer = harness.reader
      .returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      .then(
        () => 'returned',
        (error: unknown) => String(error),
      )
    await waitUntil(
      () =>
        harness.panelColumn('codebook.scopedBrowser') === 1 &&
        harness.groups.includes(leftover) &&
        leftover.tabs.length === 0,
      "the Application's move out of the leftover",
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )

    // Assert: the Return is refused as a learner's change.
    assert.equal(
      await answer,
      'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Output › Codebook entry a refused placement guard writes (F382): the entry names the guard that refused, the editor groups before and after, and the group change the editor reported while the guard waited, so the next native occurrence names its own cause; fails_when=a refusal writes no entry, names no guard, or lists no group event or no group after the change; why_new=Cycle 0050 F382 (the refusal sentence alone named no change); seam=applicationGroupMarkers, leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, the fake editor's workbench.action.newGroupAbove run as the learner, the diagnostics log; no_claim=the wording of the refusal sentence the learner reads
test('a refused placement guard writes one Output entry that names the guard, the groups before and after and the group change it saw', async () => {
  // Arrange: as in the learner-adds-a-group round below; the agent selected the Study cold, which put the Application into the unproven leftover.
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    const selected = harness.reader.presentationState()
    const answer = harness.reader
      .returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      .then(
        () => 'returned',
        (error: unknown) => String(error),
      )
    await waitUntil(
      () =>
        harness.panelColumn('codebook.scopedBrowser') === 1 &&
        harness.groups.includes(leftover) &&
        leftover.tabs.length === 0,
      "the Application's move out of the leftover",
    )

    // Act: the learner runs New Group Above before the editor removes the emptied leftover.
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    await answer

    // Assert
    const refusals = logged.filter(
      (entry) => entry.surface === 'presentation:placement-refused',
    )
    assert.equal(refusals.length, 1)
    const lines = refusals[0]!.cause.split('\n')
    assert.equal(lines[0], 'Guard: followRemovalOfGroupLeftByApplication')
    assert.match(
      lines[2]!,
      /^Groups before: 1\* \[codebook · Application \(webview codebook\.scopedBrowser\)\] \| 2 \[\] \|/,
    )
    assert.match(
      lines[3]!,
      /^Groups after: 1\* \[\] \| 2 \[codebook · Application \(webview codebook\.scopedBrowser\)\] \|/,
    )
    assert.match(
      refusals[0]!.cause,
      /\+\d+ ms groups opened \[\] closed \[3\] changed \[1,2,3,4\]/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the extension host not sanitizing every tab label at each placement guard it arms (about thirty arms per presentation), because the snapshot is read only on the rare refusal; fails_when=a guard that ends without refusing still sanitizes the groups it noted at arm time, or the arm sanitizes at all; why_new=Cycle 0050 F393 (every arm ran sanitizeCause on up to eight labels per group); seam=the sanitizeCause export, armPlacementReport, the reader's agent select and returnToCurrent over the leftover-group layout; no_claim=the wall-clock cost of one sanitization
test('a presentation whose placement guards are armed and never refuse sanitizes no tab label for the Output', async (context) => {
  // Arrange: as in the refusal round above; the agent selected the Study cold, which put the Application into the unproven leftover.
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    let arms = 0
    let sanitizedLabels = 0
    const reader = harness.reader as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
    const arm = reader['armPlacementReport']!.bind(reader)
    reader['armPlacementReport'] = (...args) => {
      arms++
      return arm(...args)
    }
    // Counts the sanitizations of a tab label wherever the product makes them: the compiled code reads the export at each call.
    const sanitize = sanitizeCauseModule.sanitizeCause
    context.mock.method(
      sanitizeCauseModule,
      'sanitizeCause',
      (...args: Parameters<typeof sanitize>) => {
        if (
          harness.groups.some((group) =>
            group.tabs.some((tab) => tab.label === args[0]),
          )
        )
          sanitizedLabels++
        return sanitize(...args)
      },
    )
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    const selected = harness.reader.presentationState()
    const answer = harness.reader
      .returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      .then(
        () => 'returned',
        (error: unknown) => String(error),
      )
    await answer

    // Assert
    assert.ok(arms > 0)
    assert.equal(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ).length,
      0,
    )
    assert.equal(sanitizedLabels, 0)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the refusal still sanitizing the groups it reports, once for the snapshot taken at arm time and once for the groups now; fails_when=the refusal reports raw tab labels, or sanitizes only one of the two snapshots; why_new=Cycle 0050 F393 (sanitizing moved from the arm to the refusal); seam=the sanitizeCause export, refusePlacement, the fake editor's workbench.action.newGroupAbove run as the learner; no_claim=the wording of the refusal sentence the learner reads
test('a refused placement guard sanitizes the tab labels of its two snapshots for the Output', async (context) => {
  // Arrange: as in the refusal round above; the agent selected the Study cold, which put the Application into the unproven leftover.
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    let arms = 0
    const sanitizedLabels = new Set<string>()
    let sanitizedLabelCalls = 0
    const reader = harness.reader as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
    const arm = reader['armPlacementReport']!.bind(reader)
    reader['armPlacementReport'] = (...args) => {
      arms++
      return arm(...args)
    }
    // Counts the sanitizations of a tab label wherever the product makes them: the compiled code reads the export at each call.
    const sanitize = sanitizeCauseModule.sanitizeCause
    context.mock.method(
      sanitizeCauseModule,
      'sanitizeCause',
      (...args: Parameters<typeof sanitize>) => {
        if (
          harness.groups.some((group) =>
            group.tabs.some((tab) => tab.label === args[0]),
          )
        ) {
          sanitizedLabelCalls++
          sanitizedLabels.add(String(args[0]))
        }
        return sanitize(...args)
      },
    )
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    const selected = harness.reader.presentationState()
    const answer = harness.reader
      .returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      .then(
        () => 'returned',
        (error: unknown) => String(error),
      )
    await waitUntil(
      () =>
        harness.panelColumn('codebook.scopedBrowser') === 1 &&
        harness.groups.includes(leftover) &&
        leftover.tabs.length === 0,
      "the Application's move out of the leftover",
    )

    // Act: the learner runs New Group Above before the editor removes the emptied leftover.
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    await answer

    // Assert
    assert.ok(arms > 0)
    assert.equal(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ).length,
      1,
    )
    // The exact number of label sanitizations stays pinned beside the set check: a report that sanitizes more or fewer labels than before is a change to review.
    assert.equal(sanitizedLabelCalls, 17)
    // Every tab label the report names went through the sanitizer; the check follows the report's own lines, so a new report line needs no new count.
    const cause = logged.find(
      (entry) => entry.surface === 'presentation:placement-refused',
    )!.cause
    const labelsInReport = [
      ...new Set(
        harness.groups.flatMap((group) => group.tabs.map((tab) => tab.label)),
      ),
    ].filter((label) => cause.includes(label))
    assert.equal(labelsInReport.length > 0, true)
    assert.deepEqual(
      labelsInReport.filter((label) => !sanitizedLabels.has(label)),
      [],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the learner's own choice while an agent's Return Current waits for the editor's late removal of the leftover the Application's move emptied (row 658): a click into their auth.ts, or a page they bring to the front of auth.ts's group, is no effect of Codebook's move, and the Return refuses as a learner's change instead of arranging over it; fails_when=only the groups are compared during the move and the wait, so the learner's focus or front tab is taken into the placement guard taken after them and the Return goes on; why_new=Cycle 0046 row 670; seam=applicationGroupMarkers, leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, focusMutableDraft's focus (the learner's click), addOpaqueTab with focusOpaqueTab (the learner's tab), panelColumn and harness.groups
for (const change of ['focus', 'tab'] as const)
  test(`in VS Code, a learner's ${change === 'focus' ? 'click into their file' : 'tab brought to the front of their group'} while an agent's Return Current waits for the editor's late removal of the emptied leftover refuses the Return as a learner's change`, async () => {
    // Arrange: as in the late-removal round above; the agent selected the Study cold, which put the Application into the unproven leftover.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
    })
    harness.closeEmptyGroupsAfterPanelMove()
    harness.removeGroupLeftByPanelMoveLater()
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 1,
        writer: 'the window before the reload',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
        },
      })
      harness.leaveEmptyLockedGroup(1)
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      harness.focusMutableDraft('actions.ts', 2)
      const selection = harness.reader.presentationState()
      await harness.reader.changePresentation(
        {
          presentationId: selection.presentationId,
          expectedRevision: selection.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      const selected = harness.reader.presentationState()

      // Act: the agent's Return moves the Application out of the leftover; before the editor removes the emptied leftover, the learner clicks into auth.ts, or brings a page of their own to the front of auth.ts's group.
      const answer = harness.reader
        .returnToCurrent(
          {
            presentationId: selected.presentationId,
            expectedRevision: selected.reader.contentRevision,
          },
          'agent',
        )
        .then(
          () => 'returned',
          (error: unknown) => String(error),
        )
      await waitUntil(
        () =>
          harness.panelColumn('codebook.scopedBrowser') === 1 &&
          harness.groups.includes(leftover) &&
          leftover.tabs.length === 0,
        "the Application's move out of the leftover",
      )
      const authColumn = harness.groups.find((group) =>
        group.tabs.includes(learnerAuth.tab),
      )!.viewColumn
      if (change === 'focus') learnerAuth.focus()
      else
        harness.focusOpaqueTab(
          harness.addOpaqueTab('Release notes', authColumn),
        )

      // Assert: the Return is refused as a learner's change.
      assert.equal(
        await answer,
        'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's groups from Codebook's lock: when Cursor activates the group that held the keyboard before the Return's new Application group was inserted (the learner's first group, whose Application pane the reservation focused) again before the lock reaches it, the lock without argument locks that learner group (C57 round 1b: the new Application group stood unlocked above the learner's locked group, which stayed locked after Close); the reservation now finds the tab model naming that group as the lock answers, unlocks it, focuses the new group and locks that one, so only the Application's own group is locked and Close leaves no group locked; fails_when=the lock's target is taken on trust from the naming before the lock, so a learner's group stays locked through Close and into the next rounds; why_new=Cycle 0046 row 644; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part), reactivatePreviousGroupBeforeLock, the reader's agent select and returnToCurrent, close, the groups' lock flags and the command log
test("in Cursor, an agent's Return Current whose lock reaches the learner's group Cursor activated again locks only the Application's own group, and Close leaves no group locked", async () => {
  // Arrange: actions.ts in the first group and auth.ts in the second; the agent selected the Study from Cursor's chat, which put the Application pane into the first group. Cursor will activate that group again before the Return's lock arrives.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    chat.focusTab()
    harness.reactivatePreviousGroupBeforeLock()
    const selected = harness.reader.presentationState()
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const lockedGroups = (): number[] =>
      harness.groups
        .filter((group) => group.locked)
        .map((group) => group.viewColumn)

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      lockedColumns: lockedGroups(),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
    }
    await harness.reader.close()

    // Assert: during the live run only the Application's own group at column 1 is locked; after Close no group is locked.
    assert.deepEqual(
      { ...live, lockedAfterClose: lockedGroups() },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        lockedColumns: [1],
        actionsGroupLocked: false,
        authGroupLocked: false,
        lockedAfterClose: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's groups from Codebook's lock when another group is the active one by the time the reservation acts on its lock's answer: the lock reached the learner's actions.ts group Cursor activated again (row 644), and auth.ts's group became the active one right after; the reservation takes the lock off the group the lock changed, whichever group is active then, and locks only the Application's own group, so Close leaves no group locked and auth.ts's group is never touched; fails_when=the unlock acts only while the group it read as changed is still the active one, so the learner's actions.ts group stays locked through the live run and Close; why_new=Cycle 0046 row 668; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part), reactivatePreviousGroupBeforeLock, activateGroupOfTabAfterNextLock, the reader's agent select and returnToCurrent, close, the groups' lock flags and the command log
test("in Cursor, an agent's Return Current whose lock reached the learner's group takes that lock off again although another learner group is the active one by then, and Close leaves no group locked", async () => {
  // Arrange: actions.ts in the first group and auth.ts in the second; the agent selected the Study from Cursor's chat. Cursor will activate the actions.ts group again before the Return's lock arrives, and the auth.ts group right after the lock answered.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    chat.focusTab()
    harness.reactivatePreviousGroupBeforeLock()
    harness.activateGroupOfTabAfterNextLock(learnerAuth.tab)
    const selected = harness.reader.presentationState()
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const lockedGroups = (): number[] =>
      harness.groups
        .filter((group) => group.locked)
        .map((group) => group.viewColumn)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      lockedColumns: lockedGroups(),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
      unlockCommands: harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'workbench.action.unlockEditorGroup')
        .length,
    }
    await harness.reader.close()

    // Assert: during the live run only the Application's own group at column 1 is locked, after one unlock of the actions.ts group; after Close no group is locked.
    assert.deepEqual(
      { ...live, lockedAfterClose: lockedGroups() },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        lockedColumns: [1],
        actionsGroupLocked: false,
        authGroupLocked: false,
        unlockCommands: 1,
        lockedAfterClose: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a lock the learner set on their own group (View: Lock Editor Group) when an agent's Return Current locks its new Application group and Cursor names the learner's group as the active one only after that lock reached the new group: the tab model the lock sends names the new group, so the learner's group keeps its lock through the live run and Close; fails_when=the reservation takes the group Cursor names after the lock for the group the lock reached (row 644's reading) and unlocks it because it holds a learner's tab, removing a lock Codebook never set; why_new=Cycle 0046 row 650; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part), lockGroupAsLearner, reactivatePreviousGroupAfterInsertion (Cursor names the group that had the keyboard again as the lock settles), the reader's agent select and returnToCurrent, close, the groups' lock flags and the command log
test("in Cursor, an agent's Return Current whose lock reached the new Application group keeps the lock the learner set on their own group that Cursor names afterwards, through Close", async () => {
  // Arrange: actions.ts in the first group and auth.ts in the second; the agent selected the Study from Cursor's chat, and the learner then locked the group that shows actions.ts. Cursor will name the group that held the keyboard before the Return's insertion again only after the lock reached the new group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const actionsColumn = harness.groups.find((group) =>
      group.tabs.includes(learnerActions.tab),
    )!.viewColumn
    harness.lockGroupAsLearner(actionsColumn)
    chat.focusTab()
    harness.reactivatePreviousGroupAfterInsertion()
    const selected = harness.reader.presentationState()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      applicationGroupLocked: Boolean(
        harness.groups.find((group) => group.viewColumn === 1)?.locked,
      ),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
      unlockCommands: harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'workbench.action.unlockEditorGroup')
        .length,
    }
    await harness.reader.close()

    // Assert: the Application's own group at column 1 and the learner's actions.ts group are locked during the live run, and no unlock ran during the Return; after Close the learner's lock is still there.
    assert.deepEqual(
      {
        ...live,
        actionsGroupLockedAfterClose: Boolean(lockedWith(learnerActions.tab)),
        authGroupLockedAfterClose: Boolean(lockedWith(learnerAuth.tab)),
      },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        applicationGroupLocked: true,
        actionsGroupLocked: true,
        authGroupLocked: false,
        unlockCommands: 0,
        actionsGroupLockedAfterClose: true,
        authGroupLockedAfterClose: false,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a lock the learner set on their own group when Cursor activates that group again before the Return's lock reaches the editor: the lock lands on that group, which was locked already, so it changes nothing and the editor sends no tab model; the learner's lock stays, and the new Application group is focused and locked; fails_when=the reservation unlocks the group the tab model names after the lock without proof that the lock changed it, removing the learner's own lock; why_new=Cycle 0046 row 650 (the other order of row 644's race); seam=useNativeLayout, addSeparateEditorPart, lockGroupAsLearner, reactivatePreviousGroupBeforeLock, the reader's agent select and returnToCurrent, close and the groups' lock flags
test("in Cursor, an agent's Return Current whose lock reaches the learner's own locked group Cursor activated again keeps the learner's lock and locks the Application's own group", async () => {
  // Arrange: as above, but Cursor activates the learner's locked actions.ts group again before the lock arrives.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const actionsColumn = harness.groups.find((group) =>
      group.tabs.includes(learnerActions.tab),
    )!.viewColumn
    harness.lockGroupAsLearner(actionsColumn)
    chat.focusTab()
    harness.reactivatePreviousGroupBeforeLock()
    const selected = harness.reader.presentationState()

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      applicationGroupLocked: Boolean(
        harness.groups.find((group) => group.viewColumn === 1)?.locked,
      ),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
    }
    await harness.reader.close()

    // Assert: the Application's own group and the learner's actions.ts group are locked during the live run; after Close only the learner's lock is left.
    assert.deepEqual(
      {
        ...live,
        actionsGroupLockedAfterClose: Boolean(lockedWith(learnerActions.tab)),
        authGroupLockedAfterClose: Boolean(lockedWith(learnerAuth.tab)),
      },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        applicationGroupLocked: true,
        actionsGroupLocked: true,
        authGroupLocked: false,
        actionsGroupLockedAfterClose: true,
        authGroupLockedAfterClose: false,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select after a window reload retiring the empty Application group the earlier window recorded, before the Application is placed; fails_when=the cold entry leaves that unproven leftover group and places the Application in it, so the window keeps an empty locked group beside the learner's groups; why_new=Cycle 0046 finding 590 (C54 in both hosts: Developer: Reload Window kept the earlier window's owned group empty at column 1); seam=applicationGroupMarkers (the earlier window's record) and leaveEmptyLockedGroup
test('a cold Study select after a window reload retires the empty Application group the earlier window recorded', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of this three-group grid; after the reload that group stands empty and locked, the learner's files stand in columns 2 and 3, and the chat part has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the leftover group is gone and its record forgotten, replaced by this window's record of the Context group its Study created (finding 599); both learner files keep their tabs, and the Application stands in column 1.
    assert.equal(harness.groups.includes(leftover), false)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 3,
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      },
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerReadme.tab)),
      true,
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's own empty locked group at column 1 when no record proves it is Codebook's; fails_when=a cold Study select focuses, unlocks or closes an empty group without the earlier window's record; why_new=Cycle 0046 finding 590's repair retires a leftover group only on proof; seam=leaveEmptyLockedGroup
test('an empty locked group at column 1 that no record proves stays as it is at a cold Study select', async () => {
  // Arrange: the learner's own empty group is locked at column 1; no window recorded an Application group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyLockedGroup(1)
    const learnersGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the group was neither unlocked nor closed.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.equal(harness.groups.includes(learnersGroup), true)
    assert.equal(learnersGroup.locked, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the record of the Application group a Return claimed, which alone lets the window after a reload retire that group's empty leftover; fails_when=a confirmed Application group is not recorded, or is recorded with another column, group count or layout than the grid it was confirmed in; why_new=Cycle 0046 finding 590; seam=applicationGroupMarkers
test('a Return records the Application group it claimed for the window after a reload', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')

    // Act
    await harness.reader.action('return-current')

    // Assert: column 1 of the confirmed three-group grid, written by this reader (a random name).
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 1,
        writer: 'string',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.5 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's later empty group at column 1 after Close retired the Study's own Application group; fails_when=Close keeps the record of the group it retired, so the next window's cold Study select takes the learner's empty group in the same grid for Codebook's leftover and closes it; why_new=Cycle 0046 finding 590's record is forgotten when Codebook retires its group; seam=createReader (the next window over the same workspace state) and the learner's own native group commands
test('Close forgets the recorded Application group, so a later empty group at column 1 stays at the next window’s cold select', async () => {
  // Arrange: a Return claims the Application group and Close retires it; the learner then splits the window into the very grid the record described and locks its empty first group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const nextWindow = harness.createReader()
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.close()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.lockEditorGroup',
    )
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.5 }],
    })
    const learnersGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(learnersGroup.tabs.length, 0)
    const commandsBefore = harness.commands.length
    const state = nextWindow.presentationState()

    // Act
    await nextWindow.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the learner's group was neither unlocked nor closed.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.equal(harness.groups.includes(learnersGroup), true)
    assert.equal(learnersGroup.locked, true)
  } finally {
    await nextWindow.dispose()
    await harness.close()
  }
})

// Value: protects=the record of the Application group the Study still holds when a Return retires the Study's own empty Context group; fails_when=retiring the Context group forgets the Application group's record, so the window after a reload has no proof for the Application group left empty at column 1; why_new=Cycle 0046 finding 595 (C55 in Cursor: after rounds of Return Current the reload kept the empty Application group, and the cold select refused with "The previously focused source group changed; focus was not guessed."); seam=applicationGroupMarkers
test('a Return that retires the Study’s own Context group keeps the record of the Application group the Study still holds', async () => {
  // Arrange: a first Return claims the Application group at column 1; a saved item then gives the Study Context a group of its own at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    const contextGroup = harness.groups.find((group) => group.viewColumn === 3)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)

    // Act
    await harness.reader.action('return-current')

    // Assert: the Context group is gone, the Application still stands in its group at column 1, and that group's record names it alone, at the two-group grid this Return confirmed (finding 599).
    assert.equal(harness.groups.includes(contextGroup), false)
    assert.equal(harness.reader['app']!.viewColumn, 1)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 1,
        writer: 'string',
        column: 1,
        groupCount: 2,
        layout: {
          orientation: 1,
          groups: [{ size: 0.5 }, { size: 0.5 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select after a window reload retiring the empty Application group whose record outlived a Return that retired the Study's own Context group; fails_when=that Return forgot the record, so the cold select leaves the leftover group and puts the Application into it; why_new=Cycle 0046 finding 595 (C55 in Cursor: the reload after rounds of Return Current kept the empty Application group at column 1, and no unlock or close was issued); seam=createReader (the window after the reload, over the same workspace state) and leaveEmptyLockedGroup
test('a cold Study select after a window reload retires the empty Application group although a Return before the reload retired the Study’s Context group', async () => {
  // Arrange: a first Return claims the Application group; a saved item gives the Context a group of its own, and a second Return retires that group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    // The window reloads: the Application pane is not restored, and its group stays empty and locked at column 1.
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const nextWindow = harness.createReader()
    try {
      const state = nextWindow.presentationState()

      // Act
      const selected = await nextWindow.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Assert: the leftover group is gone and its record forgotten, replaced by the new window's record of the Source and Context groups its Study created (finding 599); the new window's Application stands in column 1 with the layout confirmed.
      assert.equal(harness.groups.includes(leftover), false)
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown } | undefined
      assert.deepEqual(
        {
          ...marker,
          writer: marker?.writer === nextWindow['applicationGroupMarkerWriter'],
        },
        {
          version: 2,
          writer: true,
          columns: [2, 3],
          groupCount: 3,
          layout: {
            orientation: 0,
            groups: [
              { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
              { size: 0.45 },
            ],
          },
        },
      )
      assert.equal(nextWindow['app']!.viewColumn, 1)
      assert.equal(selected.layoutConfirmed, true)
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the record of the Application group an MCP-first preparation claimed, while a Living book Open gives that group to the Study Context; fails_when=the preparation writes no record before the Open, or the hand-over forgets the record of the group that still stands locked at column 1; why_new=Cycle 0046 finding 596 (the hand-over of the MCP-first Application group to the source-derived Context leaves no App owner beside the record); seam=presentation.createViewport (the MCP-first preparation) and applicationGroupMarkers
test('a Living book Open that gives the MCP-first Application group to the Study Context keeps that group’s record', async () => {
  // Arrange: an MCP run prepared the Application in a locked group of its own at column 1 before the reader opened; the Living book preference is restored.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
  try {
    // Act
    await reader.open()

    // Assert: the claimed group, still locked at column 1, now holds the Study Context, and the record the preparation wrote for it stays, at the three-group grid the Open confirmed, beside the Source group that Open created at column 3 (finding 599).
    assert.equal(harness.groups.includes(claimedGroup), true)
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 2,
        writer: 'string',
        columns: [1, 3],
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.6 },
            { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
          ],
        },
      },
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the group it describes once a Return retired the Study Context's group, the one a Living book Open took from the MCP-first Application; fails_when=the retirement keeps the record because no App owner names that group, and the Return, refused before it claims a new group, writes no record over it, so after a later reload a learner's empty group at column 1 in the same grid passes for Codebook's leftover; why_new=Cycle 0046 finding 596 (finding 595's rule clears the record only for the App owner's allocation, and the hand-over leaves no App owner); seam=failNextCommand('workbench.action.newGroupAbove') and applicationGroupMarkers
test('a Return that retires the Study Context’s group taken from the MCP-first Application forgets that group’s record although the editor refuses the new Application group', async () => {
  // Arrange: an MCP run prepared the Application at column 1, and the Living book Open gave that group to the Study Context; the editor will refuse the Return's new group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    const contextGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    harness.failNextCommand('workbench.action.newGroupAbove')
    const state = reader.presentationState()

    // Act
    await assert.rejects(
      reader.returnToCurrent({
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      }),
      /Native layout command failed/,
    )

    // Assert: the Context's group is gone, and so is its record.
    assert.equal(harness.groups.includes(contextGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a learner's later empty group at column 1 after Close removed the Study Context's group, the one a Living book Open took from the MCP-first Application; fails_when=Close keeps the record of that removed group because no App owner is left to release it, so the next window's cold Study select takes the learner's empty locked group in the very grid the record described for Codebook's leftover, unlocks it and closes it; why_new=Cycle 0046 finding 596; seam=closeDisposedPanelTabsLater (the editor removes the group the Context's last tab left, workbench.editor.closeEmptyGroups on), createReader (the next window over the same workspace state) and the learner's own native group commands
test('Close after a Living book Open that took the MCP-first Application group forgets its record, so a later empty group at column 1 stays at the next window’s cold select', async () => {
  // Arrange: an MCP run prepared the Application at column 1, the Living book Open gave that group to the Study Context, and Close removed it with the Context's tab; the learner then splits the window into the very grid the record described at that Open (finding 599) and locks its empty first group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  const nextWindow = harness.createReader()
  try {
    await reader.open()
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()
    await reader.close()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.lockEditorGroup',
    )
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [
        { size: 0.6 },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
      ],
    })
    const learnersGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(learnersGroup.tabs.length, 0)
    const commandsBefore = harness.commands.length
    const state = nextWindow.presentationState()

    // Act
    await nextWindow.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the learner's group was neither unlocked nor closed.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.equal(harness.groups.includes(learnersGroup), true)
    assert.equal(learnersGroup.locked, true)
  } finally {
    viewport.close()
    await nextWindow.dispose()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's window after Close of a Study whose Context holds the group a Living book Open took from the MCP-first Application, in an editor that keeps a group its last tab left (workbench.editor.closeEmptyGroups off); fails_when=Close leaves that group empty and locked at column 1 because no App owner is left for the release to retire it, keeps its record, or leaves the empty source group Codebook created beside the learner's group; why_new=Cycle 0046 finding 597 (finding 596's hand-over leaves the donated group without an App owner); seam=presentation.createViewport (the MCP-first preparation), the fake editor that keeps emptied groups, and applicationGroupMarkers
test('Close after a Living book Open that took the MCP-first Application group retires every empty group Codebook created and forgets the record, in an editor that keeps emptied groups', async () => {
  // Arrange: an MCP run prepared the Application at column 1 and the Living book Open gave that group to the Study Context; the editor keeps a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  const learnerNotes = harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    const donatedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()

    // Act
    await reader.close()

    // Assert: beside the chat's own part, only the learner's group is left, with the learner's notes, and the donated group's record is gone with it.
    const mainGroups = harness.groups.filter(
      (group) => !group.tabs.includes(chat.tab),
    )
    assert.equal(harness.groups.includes(donatedGroup), false)
    assert.equal(mainGroups.length, 1)
    assert.equal(mainGroups[0]!.tabs.includes(learnerNotes.tab), true)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's window after Close of a Study whose Context holds a group of its own that Codebook created beside the Application's group, in an editor that keeps a group its last tab left (workbench.editor.closeEmptyGroups off); fails_when=Close retires the Application's group but leaves the Study Context's created group empty beside the learner's group; why_new=Cycle 0046 finding 597 (Close retired only the App owner's group); seam=the fake editor that keeps emptied groups
test('Close of a Study whose Context holds a group Codebook created gives back exactly the learner’s group, in an editor that keeps emptied groups', async () => {
  // Arrange: a Return claims the Application group at column 1; a saved item then gives the Study Context a group of its own at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const learnersGroup = harness.groups[0]!,
    learnersTabs = [...learnersGroup.tabs]
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    const contextGroup = harness.groups.find((group) => group.viewColumn === 3)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)

    // Act
    await harness.reader.close()

    // Assert: the Context's group is gone, and the learner's group stands alone with its own tabs.
    assert.equal(harness.groups.includes(contextGroup), false)
    assert.deepEqual(
      harness.groups.map((group) => group.tabs),
      [learnersTabs],
    )
  } finally {
    await harness.close()
  }
})

for (const editor of [
  { keeps: 'keeps', removesEmptiedGroups: false },
  { keeps: 'removes', removesEmptiedGroups: true },
] as const)
  // Value: protects=the learner's window after Close of a Living book Open beside no chat part, whose captured source the editor gave a group of its own at column 3; fails_when=nothing tracks the group that source display created, so Close leaves it empty beside the learner's group when the editor keeps emptied groups (workbench.editor.closeEmptyGroups off), or any other group Codebook created stays; why_new=Cycle 0046 finding 597 (finding 597's observation 3: without the chat's part no reservation precedes the source display, and showTextDocument at a column beyond the grid creates that group); seam=presentation.createViewport (the MCP-first preparation), the fake editor's own group for a text shown beyond the grid, closeDisposedPanelTabsLater for the editor that removes emptied groups
  test(`Close after a Living book Open beside no chat part leaves no group Codebook created, in an editor that ${editor.keeps} emptied groups`, async () => {
    // Arrange: an MCP run prepared the Application at column 1 beside the learner's group; the Living book Open shows the captured source at column 3, where the editor gives it a group of its own.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.focusMutableDraft()
    if (editor.removesEmptiedGroups) harness.closeDisposedPanelTabsLater()
    const learnersTabs = [...harness.groups[0]!.tabs]
    harness.presentationPreferences.set('codebook.presentation.v1', {
      version: 1,
      mode: 'living-book',
    })
    const reader = harness.createReader(),
      viewport = await reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      )
    try {
      await reader.open()
      assert.deepEqual(
        harness.groups.map((group) => group.tabs.length),
        [1, 3, 1],
      )
      assert.equal(harness.textDocumentShows().at(-1)?.viewColumn, 3)
      // End the MCP run's lease first; a live lease keeps its Application available.
      viewport.close()

      // Act
      await reader.close()

      // Assert: the learner's group stands alone, with the tabs it had before the MCP run.
      assert.deepEqual(
        harness.groups.map((group) => group.tabs),
        [learnersTabs],
      )
    } finally {
      viewport.close()
      await reader.dispose()
      await harness.close()
    }
  })

// Value: protects=the next Study action after an Application preparation that failed inside the layout queue: the failed preparation's cleanup disposed the pane it created, and the editor's dispose event, which both extension hosts fire inside dispose() before the pane leaves the editor (VS Code 1.140.0 extensionHostProcess.js 295:115246, Cursor 3.23.12 203:121182), lets the reader's own pane handler forget that pane at once, so the next run prepares a new pane in a new group and acts on nothing of the disposed one; fails_when=the reader still names the disposed pane after the cleanup, so the next preparation reveals or reads it and fails, or keeps a second pane; why_new=Cycle 0046 row 672 (evidence: no reference to the disposed pane remains, this test holds the reader to it); seam=presentation.createViewport with its cancellation (an MCP-first preparation a newer run replaces), holdNextCommand('vscode.getEditorLayout'), counts and panelColumn
test('the run after an Application preparation that a newer run replaced inside the layout queue prepares a new Application pane in its own group, with nothing left of the disposed one', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own; the run is replaced while the preparation reads the confirmed layout, and its cleanup disposes the pane it created.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  const reader = harness.createReader(),
    preparation = new AbortController()
  const gridRead = harness.holdNextCommand('vscode.getEditorLayout')
  const viewport = Promise.resolve(
    reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      preparation.signal,
    ),
  ).catch((error: unknown) => error)
  let finalRead: ReturnType<typeof harness.holdNextCommand> | undefined
  let nextViewport:
    Awaited<ReturnType<typeof reader.presentation.createViewport>> | undefined
  try {
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport
    const afterFailure = {
      outcome: String(outcome),
      panels: harness.counts().panels,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
    }

    // Act: the newer run prepares its Application.
    nextViewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      new AbortController().signal,
    )

    // Assert: the failed preparation left no pane; the newer run's pane stands alone at column 1 in a locked group of its own.
    assert.deepEqual(afterFailure, {
      outcome: 'Error: A newer run replaced this preparation.',
      panels: 0,
      applicationColumn: undefined,
    })
    assert.deepEqual(
      {
        panels: harness.counts().panels,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        applicationGroupLocked: Boolean(
          harness.groups.find((group) => group.viewColumn === 1)?.locked,
        ),
      },
      { panels: 1, applicationColumn: 1, applicationGroupLocked: true },
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    nextViewport?.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the Application group it describes once a preparation that already recorded its group is cancelled; fails_when=the cancellation that arrives during the preparation's final layout read closes the empty group the preparation claimed but keeps that group's record, so after a later reload a learner's empty group at column 1 in the same grid passes for Codebook's leftover; why_new=Cycle 0046 finding 598 (found by reading: the record is written before the preparation's last check of current intent, and the failure cleanup closed the group with tabGroups.close directly); seam=presentation.createViewport with its cancellation (the MCP-first preparation a newer run replaces), holdNextCommand('vscode.getEditorLayout') and applicationGroupMarkers
test('a cancelled Application preparation that already recorded its group forgets that record as it retires the group', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own; the run is replaced while the preparation reads the confirmed layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  const reader = harness.createReader(),
    preparation = new AbortController()
  const gridRead = harness.holdNextCommand('vscode.getEditorLayout')
  const viewport = Promise.resolve(
    reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      preparation.signal,
    ),
  ).catch((error: unknown) => error)
  let finalRead: ReturnType<typeof harness.holdNextCommand> | undefined
  try {
    // The first read measures the grid before the allocation; the next one confirms the Application in its claimed group.
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)

    // Act: a newer run replaces this one during the final layout read.
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport

    // Assert: the preparation was refused, its claimed group is gone, and so is that group's record.
    assert.equal(
      String(outcome),
      'Error: A newer run replaced this preparation.',
    )
    assert.equal(harness.groups.includes(claimedGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the cancellation a refused Application preparation reports, and the record of its claimed group, when the editor refuses to close that empty group during the cleanup; fails_when=the cleanup's refused close throws its own error in place of the preparation's, or the record of a group that still stands is forgotten; why_new=Cycle 0046 finding 598 (the first repair routed the cleanup through the owned retirement, which throws on a refusal); seam=presentation.createViewport with its cancellation, holdNextCommand('vscode.getEditorLayout'), refuseNextGroupClose and applicationGroupMarkers
test('a cancelled Application preparation whose claimed group the editor refuses to close reports its cancellation and keeps the record of that group', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own; the run is replaced while the preparation reads the confirmed layout, and the editor will refuse to close the claimed group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  const reader = harness.createReader(),
    preparation = new AbortController()
  const gridRead = harness.holdNextCommand('vscode.getEditorLayout')
  const viewport = Promise.resolve(
    reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      preparation.signal,
    ),
  ).catch((error: unknown) => error)
  let finalRead: ReturnType<typeof harness.holdNextCommand> | undefined
  try {
    // The first read measures the grid before the allocation; the next one confirms the Application in its claimed group.
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(claimedGroup.locked, true)
    harness.refuseNextGroupClose()

    // Act: a newer run replaces this one during the final layout read.
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport

    // Assert: the preparation reports its own cancellation; the claimed group stands empty, and its record stays with it.
    assert.equal(
      String(outcome),
      'Error: A newer run replaced this preparation.',
    )
    assert.equal(harness.groups.includes(claimedGroup), true)
    assert.equal(claimedGroup.tabs.length, 0)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 1,
        writer: 'string',
        column: 1,
        groupCount: 2,
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
      },
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the Application group it describes once a cancelled preparation's pane leaves and the editor removes the group with the pane's tab (workbench.editor.closeEmptyGroups on, the default); fails_when=the failure cleanup finds no empty group of its own to close and keeps the record of the group the editor removed; why_new=Cycle 0046 finding 598 (the editor, not Codebook, retires the claimed group in the default configuration); seam=presentation.createViewport with its cancellation, holdNextCommand('vscode.getEditorLayout'), closeDisposedPanelTabsLater and applicationGroupMarkers
test('a cancelled Application preparation that already recorded its group forgets that record when the editor removes the group with the pane’s tab', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own in an editor that removes a group its last tab left; the run is replaced while the preparation reads the confirmed layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  const reader = harness.createReader(),
    preparation = new AbortController()
  const gridRead = harness.holdNextCommand('vscode.getEditorLayout')
  const viewport = Promise.resolve(
    reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      preparation.signal,
    ),
  ).catch((error: unknown) => error)
  let finalRead: ReturnType<typeof harness.holdNextCommand> | undefined
  try {
    // The first read measures the grid before the allocation; the next one confirms the Application in its claimed group.
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)

    // Act: a newer run replaces this one during the final layout read.
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport

    // Assert: the preparation was refused, the editor removed its claimed group, and that group's record is gone too.
    assert.equal(
      String(outcome),
      'Error: A newer run replaced this preparation.',
    )
    assert.equal(harness.groups.includes(claimedGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the group a Living book Open took from the MCP-first Application for the Study Context, when Close leaves that group to the editor, which removes it with the Context's last tab (workbench.editor.closeEmptyGroups on); fails_when=Close keeps the record because no App owner is left to release the group and Codebook found no group of its own to retire; why_new=Cycle 0046 finding 599 (the record now names every group by identity, and the forget of a removed group follows all of them; this case reaches the hand-over itself: beside the chat's part the Open gives the claimed group to the Context alone, while without it the captured source joins the Context there and the App owner stays); seam=presentation.createViewport (the MCP-first preparation), addSeparateEditorPart, closeDisposedPanelTabsLater and applicationGroupMarkers
test('Close after a Living book Open that took the MCP-first Application group forgets its record when the editor removes that group with the Context’s tab', async () => {
  // Arrange: an MCP run prepared the Application at column 1 and the Living book Open gave that group to the Study Context; the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    const donatedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(reader['applicationGroup'], undefined)
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()

    // Act
    await reader.close()

    // Assert: the editor removed the donated group, and its record went with it.
    assert.equal(harness.groups.includes(donatedGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the record of every group Codebook created that a reload would leave empty, at the layout a Study select confirmed after it gave the Study Context a group of its own beside the Application's group; fails_when=the record keeps the grid of the Application group's reservation only, or does not name the Study Context's created group; why_new=Cycle 0046 finding 599 (the record kept the reservation's grid, so a reload in a later layout left the Application's leftover unproven and the Context's leftover unrecorded); seam=applicationGroupMarkers
test('a Study select that gives the Context a group of its own records the Application’s group and the Context’s group at the layout it confirmed', async () => {
  // Arrange: a Return claims the Application group at column 1 beside the learner's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')

    // Act: a saved item gives the Study Context a group of its own at column 3.
    await harness.reader.select('repository/workspace/overview')

    // Assert: both groups, by their columns in the confirmed three-group grid, written by this reader (a random name).
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 2,
        writer: 'string',
        columns: [1, 3],
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select after a window reload that left the Application's group empty and locked at column 1 and the Study Context's created group empty at column 3, beside the learner's group; fails_when=the record kept only the reservation's two-group grid, so the cold select proves neither leftover, puts the Application into the locked one and refuses (finding 590's failure), and the Context's empty group stays for good; why_new=Cycle 0046 finding 599; seam=createReader (the window after the reload, over the same workspace state), leaveEmptyLockedGroup and leaveEmptyGroup
test('a cold Study select after a window reload retires the empty Application group and the Study Context’s empty created group the earlier window recorded', async () => {
  // Arrange: one learner group; a Return claims the Application group, and a saved item gives the Study Context a group of its own at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    // The window reloads: neither pane is restored; the Application's group stays empty and locked at column 1, the Context's group empty at column 3.
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    const nextWindow = harness.createReader()
    try {
      const state = nextWindow.presentationState()

      // Act
      const selected = await nextWindow.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Assert: both leftovers are gone and their record forgotten, replaced by the new window's record of the Source and Context groups its Study created; the new window's Application stands in column 1 with the layout confirmed.
      assert.equal(nextWindow.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown } | undefined
      assert.deepEqual(
        {
          ...marker,
          writer: marker?.writer === nextWindow['applicationGroupMarkerWriter'],
        },
        {
          version: 2,
          writer: true,
          columns: [2, 3],
          groupCount: 3,
          layout: {
            orientation: 0,
            groups: [
              { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
              { size: 0.45 },
            ],
          },
        },
      )
      assert.equal(nextWindow['app']!.viewColumn, 1)
      assert.equal(selected.layoutConfirmed, true)
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's group after a window reload whose two recorded leftovers a cold Study select retired: the new Study can be restored, and its Close gives back exactly the learner's group with its own tab; fails_when=a leftover stays beside the learner's group, the Restore cannot confirm the Study's layout, or the Close leaves a group Codebook created; why_new=Cycle 0046 finding 599 (with finding 597's Close); seam=createReader, leaveEmptyLockedGroup and leaveEmptyGroup
test('after a cold Study select retired both recorded leftovers of a reload, Restore confirms the Study and Close gives back exactly the learner’s group', async () => {
  // Arrange: the same reload as above, and the window after it selected the Study, which retired both leftovers.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const learnersTab = harness.groups[0]!.tabs[0]!
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(3)
    const nextWindow = harness.createReader()
    try {
      const selectState = nextWindow.presentationState()
      await nextWindow.changePresentation({
        presentationId: selectState.presentationId,
        expectedRevision: selectState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Act
      const restoreState = nextWindow.presentationState()
      const restored = await nextWindow.changePresentation({
        presentationId: restoreState.presentationId,
        expectedRevision: restoreState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      await nextWindow.close()

      // Assert: the Restore confirmed the Study's layout, and after the Close only the learner's group is left, with its own tab.
      assert.equal(restored.layoutConfirmed, true)
      assert.deepEqual(
        harness.groups.map((group) => group.tabs),
        [[learnersTab]],
      )
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's groups when the learner changed the layout after the last layout Codebook confirmed and the window then reloads; fails_when=the cold Study select guesses that the changed grid is the recorded one and unlocks or closes a group, or forgets the record without a proof; why_new=Cycle 0046 finding 599 (a layout the learner changed without a Codebook confirmation is not guessed: the proof fails conservatively); seam=createReader, leaveEmptyLockedGroup, leaveEmptyGroup and the learner's own layout command
test('a cold Study select after a reload leaves the recorded leftovers untouched when the learner resized the groups after the last confirmed layout', async () => {
  // Arrange: the record names both groups at the confirmed Study grid; the learner then widens the Context's column, and the window reloads.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [
        { size: 0.3, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.7 },
      ],
    })
    const recordBefore = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    )
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    const nextWindow = harness.createReader()
    try {
      const commandsBefore = harness.commands.length
      const state = nextWindow.presentationState()

      // Act
      await nextWindow
        .changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
        .catch(() => undefined)

      // Assert: no group was unlocked or retired as a leftover, and the record is kept as it was.
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.unlockEditorGroup'),
        false,
      )
      assert.equal(harness.groups.includes(applicationLeftover), true)
      assert.equal(harness.groups.includes(contextLeftover), true)
      assert.deepEqual(
        harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
        recordBefore,
      )
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the editor-restart case of finding 590 across the update: a version-1 record that a 0.2.30 candidate (C55) wrote, in pixels, still proves the empty locked Application group that a quit and relaunch of the editor restored at column 1, as after Developer: Reload Window; fails_when=the reader of the new record shape no longer reads a version-1 record as the Application group alone, so the cold select keeps the leftover and puts the Application into it; why_new=Cycle 0046 finding 599 (the record's shape changed; the VS Code QA window holds such a record); seam=applicationGroupMarkers (the record C55 wrote) and leaveEmptyLockedGroup
test('a cold Study select after an editor restart retires the empty Application group a version-1 record of a 0.2.30 candidate proves', async () => {
  // Arrange: C55 recorded its Application group at column 1 of a three-group grid of rows, in pixels; the restarted editor restored that group empty and locked, with the learner's files in rows 2 and 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: '3f0c5a52-8f4e-4f43-9a5e-1d2b7c9e6a10',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the leftover group is gone and its record forgotten, replaced by this window's record of the Context group its Study created (finding 599); both learner files keep their tabs, and the Application stands in column 1.
    assert.equal(harness.groups.includes(leftover), false)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 3,
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      },
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerReadme.tab)),
      true,
    )
    assert.equal(harness.reader['app']!.viewColumn, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's file in a group the earlier window's record names, after a window reload: the cold Study select retires only the recorded group that is proved empty; fails_when=a recorded group that holds a learner's tab is closed with its tab, or the empty Application group beside it stays because the record is taken as a whole; why_new=Cycle 0046 finding 599 (each recorded leftover is retired on its own proof in the recorded grid); seam=applicationGroupMarkers (a version-2 record of the earlier window) and leaveEmptyLockedGroup
test('a cold Study select after a reload retires the recorded empty Application group and keeps the recorded Context group that holds a learner’s file', async () => {
  // Arrange: the earlier window recorded the Application's group at column 1 and the Study Context's group at column 3; after the reload the learner's files stand in columns 2 and 3, and the chat part has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    const readmeGroup = harness.groups.find((group) =>
      group.tabs.includes(learnerReadme.tab),
    )!
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the empty Application group is gone and the earlier record with it, replaced by this window's record of the Context group its Study created; the recorded group with the learner's file stands with its tab.
    assert.equal(harness.groups.includes(applicationLeftover), false)
    assert.equal(harness.groups.includes(readmeGroup), true)
    assert.equal(readmeGroup.tabs.includes(learnerReadme.tab), true)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 3,
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      },
    )
  } finally {
    await harness.close()
  }
})
