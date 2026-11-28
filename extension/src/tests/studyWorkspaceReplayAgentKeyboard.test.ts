import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHAT_KEYBOARD_RETURNED_MESSAGES } from '../constants'
import { StudyError } from '../errors'

import {
  workspaceHarness,
  recordedReaderHarness,
} from './studyWorkspaceHarness'

// Value: protects=the chat input's keyboard when an agent opens a recording through codebook_playback while the Study workspace is closed and VS Code's chat view, in front of the secondary side bar, has the keyboard: the replay's Application group is placed without a focus, no file gets the keyboard, the Learning summary's container is not brought in front of the chat (VS Code would remove the chat's element with the keyboard inside, even with the focus kept), and the learner is told once where the summary waits; fails_when=the replay's preparation shows the learner's active file with the keyboard, or the summary's reveal replaces the chat in the secondary side bar, so the chat input loses the keyboard and the agent's answer is hidden without a word; why_new=Cycle 0046 row 613 (an agent's replay open: loadPlayback -> open) and the finding on the summary's reveal beside VS Code's chat (1.140.0 workbench.desktop.main.js 1639:157175, 1106:186495, 1106:190002); seam=recordedReaderHarness, the reader's close, useNativeLayout, focusMutableDraft, focusChatInSecondarySideBar (VS Code's chat view), the service's playback (the codebook_playback tool's handler), textDocumentShows, viewFocusCommands, keyboardInView and the information messages
test('an agent’s replay open while the chat view has the keyboard leaves the keyboard in the chat and keeps the Learning summary behind the chat with a word', async () => {
  // Arrange: a saved recording, the reader closed; the learner's actions.ts is the active editor of the first group, and the learner typed the request into VS Code's chat in the secondary side bar.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const showsBefore = harness.textDocumentShows().length,
      viewFocusBefore = harness.viewFocusCommands.length

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: no document was shown with the keyboard, no view was brought to the front (the moments' view was not shown, row 621), and the chat view still has it; the sentence the editor's ambiguity calls for (row 614) says that a view keeps it, and the next one says where the replay's controls wait.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [])
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own replay open after an agent's codebook_playback open was refused for a stale revision: it is the learner's open, so the learner's active file gets the keyboard back after the Application group's placement, the Learning summary comes to the front with the keyboard, and no agent sentence is told; fails_when=the refused open leaves its mark (StudyService.playback's catch does not forget it), so the learner's next open of the same study, which the controller gives the revision the mark names, enters as the agent's: the chat view keeps the keyboard, the summary stays behind it and the agent's two sentences are told (row 613); why_new=T2, Cycle 0046 /ship review: no test reached the forget of a refused agent open; seam=recordedReaderHarness, the reader's close, useNativeLayout, leaveEmptyGroup, focusMutableDraft, focusChatInSecondarySideBar, the service's playback (the codebook_playback tool's handler) with a stale expectedRevision, the reader's openRecording (the learner's open), textDocumentShows, viewFocusCommands, keyboardInView and the information messages
test('a learner’s replay open after an agent’s open was refused for a stale revision is the learner’s own: the learner’s file gets the keyboard back, the Learning summary comes to the front, and no agent sentence is told', async () => {
  // Arrange: a saved recording, the reader closed, actions.ts the active editor of the first group and the chat view with the keyboard; an agent's open names a revision the controller does not have and is refused.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    let refusal: unknown
    try {
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision + 5,
      })
    } catch (error) {
      refusal = error
    }
    const showsBefore = harness.textDocumentShows().length,
      viewFocusBefore = harness.viewFocusCommands.length,
      messagesBefore = harness.informationMessages.length

    // Act: the learner opens the same recording.
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        refusal: refusal instanceof StudyError ? refusal.code : refusal,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus),
        viewFocus: harness.viewFocusCommands.slice(viewFocusBefore),
        keyboardInView: harness.keyboardInView(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: 'STALE_PLAYBACK',
        shownWithKeyboard: [
          { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
        ],
        viewFocus: [
          { command: 'codebook.observedMoments.focus', preserveFocus: false },
          { command: 'codebook.learningSummary.focus', preserveFocus: false },
        ],
        keyboardInView: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own reopen of a recording that an agent's codebook_playback open found already shown: the controller answered that open without a load, so the learner's later reopen, after the learner stopped the historical debugger session, is the learner's and brings the Learning summary to the front with the keyboard, telling no agent sentence; fails_when=the open answered without a load leaves its mark (StudyService.playback does not forget it when the controller's revision stays the expected one), so the reload the learner's reopen starts, which the controller gives the revision the mark names, enters as the agent's: the summary is focused without the keyboard (row 613); why_new=T2, Cycle 0046 /ship review: no test reached the forget of an agent open answered without a load; seam=recordedReaderHarness, useNativeLayout, leaveEmptyGroup, focusMutableDraft, the reader's openRecording (the learner's opens), the service's playback (the codebook_playback tool's handler) with the current revision, endHistoricalDebugSession (the learner's Stop on the historical session, after which an open reloads), viewFocusCommands and the information messages
test('a learner’s reopen of a recording an agent’s open found already shown is the learner’s own: the Learning summary comes to the front with the keyboard and no agent sentence is told', async () => {
  // Arrange: the learner opened a saved recording; an agent's open of the same recording is answered without a load; the learner then stops the historical debugger session, so the next open reloads the recording.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const revisionBeforeAgent = harness.controller.state().revision
    const agentAnswer = harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: revisionBeforeAgent,
    })
    harness.endHistoricalDebugSession()
    await harness.controller.settle()
    const viewFocusBefore = harness.viewFocusCommands.length,
      messagesBefore = harness.informationMessages.length

    // Act: the learner opens the same recording again.
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: the agent's open was answered at the revision it named, so it started no load.
    assert.deepEqual(
      {
        agentAnswerRevision: agentAnswer.revision - revisionBeforeAgent,
        readiness: harness.controller.state().readiness,
        viewFocus: harness.viewFocusCommands.slice(viewFocusBefore),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        agentAnswerRevision: 0,
        readiness: 'ready',
        viewFocus: [
          { command: 'codebook.learningSummary.focus', preserveFocus: false },
        ],
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent selects the Study workspace through codebook_presentation while a replay stays loaded behind the closed workspace and VS Code's chat view, in front of the secondary side bar, has the keyboard: the entry is an agent's (open with forAgent), so its Application preparation gives no file the keyboard and the Learning summary is not brought in front of the chat, and the learner is told where each is; fails_when=the selection's entry prepares as the learner's and gives the active file the keyboard, or the summary's reveal replaces the chat and its keyboard without a word; why_new=Cycle 0046 coverage of an agent's select into a replay (no test reached open's forAgent through a selection with a recording loaded); seam=recordedReaderHarness, openRecording and the reader's close, hideSummary (the learner brought the chat to the front again), useNativeLayout, focusMutableDraft, focusChatInSecondarySideBar (VS Code's chat view), the service's selectPresentation (the codebook_presentation handler), textDocumentShows, viewFocusCommands, keyboardInView and the information messages
test('an agent’s Study selection while a replay stays loaded and the chat view has the keyboard gives no file the keyboard and keeps the Learning summary behind the chat with a word', async () => {
  // Arrange: the learner opened a saved recording and closed the Study workspace, brought the chat to the front of the secondary side bar again, and typed the request there; actions.ts is the active editor of the first group.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    harness.hideSummary()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      viewFocusBefore = harness.viewFocusCommands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: no document was shown with the keyboard, only the moments' view, which the learner's own open had shown already, was focused again (without the keyboard, no container switch), the chat view still has the keyboard, and the two sentences say where the Application group and the replay's controls are.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [
      { command: 'codebook.observedMoments.focus', preserveFocus: true },
    ])
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).',
      ],
    )
  } finally {
    await harness.close()
  }
})

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the learner's knowledge of where the keyboard is when an agent's Study selection (codebook_presentation) reopens a replay an agent had opened earlier, while the learner's file has the keyboard without a fresh sign of the learner's hand: the Application's new group takes the keyboard from the editor area (VS Code 1.140.0 workbench.desktop.main.js 990:31740), and the arrangement's layout command gives it to the Application pane in front of that group (1106:112155 with 1106:112962, group focus 1106:74902, the webview editor's focus 705:66733; Cursor 3.23.12 17501:57509); row 613 gives an unproven file nothing back, so the selection tells once where the keyboard is, also when the preparation's own sentence was told for the earlier replay open; fails_when=the preparation's sentence, told once in the session already, is the only one the selection has, so the Application pane takes the learner's keyboard without a word (C57 2a: page focus BODY, then the Application pane's webview, no information message); why_new=Cycle 0046 row 640; seam=recordedReaderHarness, the service's playback (codebook_playback open) and the reader's close, useNativeLayout, leaveEmptyGroup, focusMutableDraft, Cursor's host name (its chat in the side bar, one editor part), the service's selectPresentation (codebook_presentation), focusedPanel and innerFocusedPanel (the fake editor gives the active group the keyboard after a layout command when the page body had it), textDocumentShows and the information messages
  test(`in ${host}, an agent’s Study selection that reopens a replay an agent opened earlier, while the learner’s file has the keyboard, says once that the Application pane has it`, async () => {
    // Arrange: an agent opened a saved recording while the learner worked in login-form.tsx in the first group, and the Study workspace was closed; the learner's file has the keyboard again, put there without a key press.
    const harness = await recordedReaderHarness(true, true)
    if (host === 'Cursor') harness.useHostAppName('Cursor')
    try {
      await harness.reader.close()
      harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
      harness.leaveEmptyGroup(1)
      harness.focusMutableDraft('login-form.tsx', 1)
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      await harness.reader.close()
      harness.focusMutableDraft('login-form.tsx', 1)
      const state = harness.reader.presentationState(),
        showsBefore = harness.textDocumentShows().length,
        messagesBefore = harness.informationMessages.length

      // Act
      const answer = await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      await harness.controller.settle()

      // Assert: the replay's arrangement is confirmed, the Application pane has the keyboard, no file was shown with it, and the sentence says once where it is.
      assert.deepEqual(
        {
          layoutConfirmed: answer.layoutConfirmed,
          contentTab: answer.reader.contentTab,
          activePane: harness.focusedPanel(),
          paneWithKeyboard: harness.innerFocusedPanel(),
          shownWithKeyboard: harness
            .textDocumentShows()
            .slice(showsBefore)
            .filter((shown) => !shown.preserveFocus)
            .map((shown) => shown.name),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          layoutConfirmed: true,
          contentTab: 'recording',
          activePane: 'codebook.scopedBrowser',
          paneWithKeyboard: 'codebook.scopedBrowser',
          shownWithKeyboard: [],
          messages: [
            'Codebook arranged the Study workspace an agent asked for with its Application pane in a new editor group. If you were typing in a file or another editor tab, the Application pane has the keyboard now: click where you want to type. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's knowledge of where the keyboard is when an agent's Study selection (codebook_presentation) beside Cursor's Agent chat part reopens a replay an agent opened earlier while the learner's file had the keyboard: the main editor was then the active part, and Cursor reads its file the same while the terminal or a view has the keyboard (Cursor 3.23.12 workbench.desktop.main.js 17501:84373, 17501:88693), so row 612's rule of the only editor part holds: no unproven file gets the keyboard back, the Application pane keeps it, and the learner is told once; fails_when=the selection gives the learner's file its keyboard back and the replay's captured source then covers that file in its group with nothing told (the 640 fixer's reading of the model); why_new=Cycle 0046 row 656; seam=recordedReaderHarness, the service's playback (codebook_playback open) and the reader's close, useNativeLayout, addSeparateEditorPart (Cursor's chat part), leaveEmptyGroup, focusMutableDraft, the service's selectPresentation, the editor's active text editor and the first group's front tab, textDocumentShows and the information messages
test('in Cursor beside its chat part, an agent’s Study selection that reopens a replay an agent opened earlier while the learner’s file has the keyboard gives that file nothing back and says once that the Application pane has the keyboard', async () => {
  // Arrange: an agent opened a saved recording while the learner worked in login-form.tsx in the first group, and the Study workspace was closed; Cursor's Agent chat stands in its own editor part, and the learner's file has the keyboard again, put there without a key press.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.addSeparateEditorPart()
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    harness.focusMutableDraft('login-form.tsx', 1)
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()

    // Assert: the replay's arrangement is confirmed, the Application pane in front of its new group has the keyboard, no learner file was shown with it, and the sentence says once where it is.
    assert.deepEqual(
      {
        layoutConfirmed: answer.layoutConfirmed,
        contentTab: answer.reader.contentTab,
        activePane: harness.focusedPanel(),
        paneWithKeyboard: harness.innerFocusedPanel(),
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => shown.name),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        contentTab: 'recording',
        activePane: 'codebook.scopedBrowser',
        paneWithKeyboard: 'codebook.scopedBrowser',
        shownWithKeyboard: [],
        messages: [
          'Codebook arranged the Study workspace an agent asked for with its Application pane in a new editor group, and the Application pane has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at an agent's cold Study selection that reopens a replay beside Cursor's Agent chat part while Cursor names the Repository Wiki's group: Cursor's Focus Agent gave the chat input the keyboard and changed no group, so the Wiki's tab stays the named one with its panel not active, and the selection gives the chat its keyboard back with Focus Agent and tells the arrangement's sentence once; fails_when=the Wiki's tab is taken for the place of the keyboard, the selection runs the numbered focus command of the Wiki's group (workbench.action.focusThirdEditorGroup here, the fourth in C59) and the chat gets nothing back, as in C59 c59-5-cu-cold, where the keyboard stayed outside the chat for 34.7 s (the same at the C58 build 465a6834, so no regression of rows 647 to 662: C58's round began with the chat's group named, C59's with the Wiki's); why_new=Cycle 0046 row 680; seam=recordedReaderHarness, the service's playback (codebook_playback open) and the reader's close, useNativeLayout, addSeparateEditorPart and its focus (Focus Agent), leavePaneFocusUnreportedBesideChat, focusExistingWebviewTab (the Wiki's tab named), the service's selectPresentation, the command log and the information messages
test('in Cursor, an agent’s cold Study selection that reopens a replay while the editor names the Repository Wiki’s group and the chat input has the keyboard gives the chat its keyboard back and says so once', async () => {
  // Arrange: an agent opened a saved recording and the Study workspace was closed; the learner read the Wiki last, so its group is the named one, and Focus Agent gave the chat input the keyboard without changing a group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const namedBefore =
        harness.editor.window.tabGroups.activeTabGroup.activeTab?.label,
      state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()

    // Assert: the replay is arranged, Focus Agent gave the chat its keyboard back last, no numbered focus ran for the Wiki's group, and the sentence was told once.
    assert.deepEqual(
      {
        namedBefore,
        layoutConfirmed: answer.layoutConfirmed,
        contentTab: answer.reader.contentTab,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        namedBefore: 'codebook · Repository Wiki',
        layoutConfirmed: true,
        contentTab: 'recording',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at an agent's Return Current right after its cold Study selection beside Cursor's Agent chat part (the five-stop flow's cold order): the selection gave the chat its keyboard back with Focus Agent, which changes no group, so the editor names the Application pane's tab with that pane not active, which is the chat's place for a request no pane's control made (row 628's rule for an agent's Restore); the Return gives the chat its keyboard back after its measurement took it through the captured source; fails_when=the agent's Return remembers no chat, its measurement shows the captured source with the keyboard and the chat gets nothing back, so the keyboard stays outside the chat until a pause (C59 c59-5-cu-cold: the captured source shown with preserveFocus false, then a numbered focus of the Wiki's group, 34.7 s outside the chat); why_new=Cycle 0046 row 680; seam=recordedReaderHarness, the service's playback, selectPresentation and returnToCurrent, useNativeLayout, addSeparateEditorPart and its focus (Focus Agent), leavePaneFocusUnreportedBesideChat, focusExistingWebviewTab, the command log, textDocumentShows and the information messages
test('in Cursor, an agent’s Return Current right after its cold Study selection from the chat gives the chat its keyboard back, also after its measurement showed the captured source with the keyboard', async () => {
  // Arrange: as above; the agent's cold selection gave the chat its keyboard back.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const state = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()
    const selected = harness.reader.presentationState(),
      chatAfterSelection = chat.focused(),
      commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: selected.presentationId,
      expectedRevision: selected.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the live panes are confirmed; the measurement showed the captured source with the keyboard, and Focus Agent gave the chat its keyboard back last, with no numbered group focus.
    assert.deepEqual(
      {
        chatAfterSelection,
        layoutConfirmed: returned.layoutConfirmed,
        contentTab: returned.reader.contentTab,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
      },
      {
        chatAfterSelection: true,
        layoutConfirmed: true,
        contentTab: 'live',
        shownWithKeyboard: ['Captured-theme.ts@2'],
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=row 5's cold order beside Cursor's Agent chat part when the reader holds a saved replay (C61 c61-5-cu-cold): the agent's select reopens the replay and gives the chat its keyboard back; its Return Current leaves the replay for the live run, whose captured source opens quietly in place of the replay's, which closes, while the chat input has the keyboard, so Cursor names its chat part's group (rows 696 and 702); the measurement then borrows through the captured source (readMainEditorGrid's sourceBorrow, the Application pane in front of the first group), and the Return gives the chat its keyboard back with Focus Agent, the arrangement's sentence told once in the session, so the run that starts next finds the chat with the keyboard; fails_when=the give-back reads the chat part's group the editor names as a move of the keyboard away from where the measurement left it, so no Focus Agent runs and the captured source keeps the keyboard, which the Live entry's source view then drops to the page body (C61: 3,037 samples on BODY, every stop of the five-stop flow on BODY); why_new=Cycle 0046 row 711; seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus (the click into the chat input), leavePaneFocusUnreportedBesideChat, focusMutableDraft, focusExistingWebviewTab, the service's playback, selectPresentation and returnToCurrent, the command log, textDocumentShows and the information messages
test('in Cursor, an agent’s Return Current from the saved replay its cold select reopened gives the chat its keyboard back after borrowing through the captured source, while Cursor names its chat part’s group', async () => {
  // Arrange: the reader holds a saved replay, the learner's login-form.tsx is in front of the first group, and the learner clicked into the chat input; the agent's cold select reopened the replay and gave the chat its keyboard back.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const messagesBefore = harness.informationMessages.length
    const state = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()
    const selected = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: selected.presentationId,
      expectedRevision: selected.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the measurement borrowed through the captured source, Focus Agent ran last, and the arrangement's sentence was told once over the select and the Return.
    assert.deepEqual(
      {
        layoutConfirmed: returned.layoutConfirmed,
        contentTab: returned.reader.contentTab,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        arrangementSentences: harness.informationMessages
          .slice(messagesBefore)
          .filter(
            (message) =>
              message.message === CHAT_KEYBOARD_RETURNED_MESSAGES.arrangement,
          ).length,
      },
      {
        layoutConfirmed: true,
        contentTab: 'live',
        shownWithKeyboard: ['Captured-theme.ts@2'],
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
        arrangementSentences: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at an agent's Return Current from a replay beside Cursor's Agent chat part when the learner's file is in front of the first group, the Application pane behind it: the learner opened login-form.tsx there and clicked into the chat input, so the editor names that file's group with no active text editor; the Return shows the live captured source quietly in place of the replay's, which closes, while the chat input has the keyboard, so Cursor names its chat part's group (rows 696 and 702); the measurement then borrows the first group with workbench.action.focusFirstEditorGroup, after which Cursor reports login-form.tsx as the active text editor and keeps naming the chat part's group (row 673); the Return gives the chat its keyboard back with Focus Agent and tells the arrangement's sentence once, as after row 711's borrow through the captured source; fails_when=the give-back reads the chat part's group the editor names as a move of the keyboard away from the first group the measurement left it in (leftByMeasurement asked for the first column or the column named at the capture), so no Focus Agent runs and the learner's login-form.tsx keeps the keyboard the measurement gave it, untold; why_new=Cycle 0046 row 723; seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus (the click into the chat input), leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, the command log, textDocumentShows and the information messages
test('in Cursor, an agent’s Return Current from a replay while the learner’s file is in front of the first group gives the chat its keyboard back after borrowing the first group, while Cursor names its chat part’s group', async () => {
  // Arrange: an agent's replay open arranged the Study workspace; the learner opened login-form.tsx in front of the first group, over the Application pane, and clicked into the chat input.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const namedBefore = `${harness.editor.window.tabGroups.activeTabGroup.viewColumn}:${harness.editor.window.tabGroups.activeTabGroup.activeTab?.label}`,
      state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the measurement borrowed the first group while the chat part's group stayed the named one, Focus Agent ran last, and the arrangement's sentence was told once.
    assert.deepEqual(
      {
        namedBefore,
        layoutConfirmed: returned.layoutConfirmed,
        contentTab: returned.reader.contentTab,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        namedAfter:
          harness.editor.window.tabGroups.activeTabGroup.activeTab?.label,
        chatHasKeyboard: chat.focused(),
        arrangementSentences: harness.informationMessages
          .slice(messagesBefore)
          .filter(
            (message) =>
              message.message === CHAT_KEYBOARD_RETURNED_MESSAGES.arrangement,
          ).length,
      },
      {
        namedBefore: '1:login-form.tsx',
        layoutConfirmed: true,
        contentTab: 'live',
        shownWithKeyboard: [],
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        namedAfter: 'New Agent',
        chatHasKeyboard: true,
        arrangementSentences: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice during an agent's Return Current from the saved replay beside Cursor's Agent chat part (row 711's order): right after the measurement showed the captured source with the keyboard, the learner opens a terminal in the editor area of the Wiki's group, and the editor goes on reporting the captured source as the active text editor (an editor that is no code editor leaves that report, rows 659 and 671); the terminal keeps the keyboard, and the chat gets none back; fails_when=namesAnotherEditorPartsTab takes any front tab that is no text tab and no webview for the chat's tab, so isCapturedSourceUnderAnotherPartsName reads the terminal's group as Cursor's chat part's group and Focus Agent gives the chat the keyboard over the learner's terminal; why_new=Cycle 0046 row 727 (both final reviews of 8ac142df..b5f8bf97, rows 711 and 723's test of the chat's tab); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, focusExistingWebviewTab, the service's playback, selectPresentation and returnToCurrent, changeAfterNextSourceDisplay with focusEditorTerminal keeping the text editor report, the command log and the information messages
test('in Cursor, an agent’s Return Current from the saved replay leaves the keyboard in the terminal the learner opened in another group after the measurement showed the captured source, while the editor still reports that source', async () => {
  // Arrange: as in row 711's test; the agent's cold select reopened the replay and gave the chat its keyboard back. The learner will open a terminal in the Wiki's group (column 3) once the captured source has the keyboard.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const state = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()
    const selected = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    /** Opens the learner's terminal at the first display after which the captured source is the active text editor. */
    const chooseTerminalOnceSourceHasKeyboard = (): void => {
      if (
        harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
          '/Captured-theme.ts',
        )
      )
        harness.focusEditorTerminal(3, true)
      else
        harness.changeAfterNextSourceDisplay(
          chooseTerminalOnceSourceHasKeyboard,
        )
    }
    harness.changeAfterNextSourceDisplay(chooseTerminalOnceSourceHasKeyboard)

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: selected.presentationId,
      expectedRevision: selected.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the live panes are confirmed; the terminal's group is named with the terminal in front, the captured source is still reported, no Focus Agent ran, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        layoutConfirmed: returned.layoutConfirmed,
        named: `${named.viewColumn}:${named.activeTab?.label}`,
        reportedTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        keyboardOnBody: harness.keyboardOnBody(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        named: '3:bash',
        reportedTextEditor: 'Captured-theme.ts',
        keyboardCommands: [],
        chatHasKeyboard: false,
        keyboardOnBody: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order): right after the measurement borrowed the first group with workbench.action.focusFirstEditorGroup, the learner opens a terminal in the editor area of the Wiki's group, and the editor goes on reporting login-form.tsx, the first group's file the borrow focused (an editor that is no code editor leaves that report, rows 659 and 671); the Return is refused for the learner's change, the terminal keeps the keyboard, and the chat gets none back; fails_when=namesAnotherEditorPartsTab takes any front tab that is no text tab and no webview for the chat's tab, so isFirstGroupEditorUnderAnotherPartsName reads the terminal's group as Cursor's chat part's group, the borrow counts as left where the measurement left it, and Focus Agent gives the chat the keyboard over the learner's terminal; why_new=Cycle 0046 row 727 (both final reviews of 8ac142df..b5f8bf97); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, focusEditorTerminal keeping the text editor report, the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay leaves the keyboard in the terminal the learner opened in another group after the borrow of the first group, while the editor still reports the first group’s file', async () => {
  // Arrange: as in row 723's test; the learner will open a terminal in the Wiki's group (column 3) right after the measurement's borrow of the first group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.focusEditorTerminal(3, true)
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: refused for the learner's change; the terminal's group is named with the terminal in front, login-form.tsx is still reported, no Focus Agent ran after the borrow, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        refusal,
        named: `${named.viewColumn}:${named.activeTab?.label}`,
        reportedTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        keyboardOnBody: harness.keyboardOnBody(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
        named: '3:bash',
        reportedTextEditor: 'login-form.tsx',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        keyboardOnBody: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order): after the measurement borrowed the first group and the editor applied the Study layout, while it answers the arrangement's receipt read, the learner opens a new empty group right of the main editor's last group (workbench.action.newGroupRight), which the editor names with no active tab and no active text editor; the Return answers, the empty group keeps the keyboard as the learner's place and is not taken for the chat's tab, the chat gets none back and nothing is told; fails_when=namesAnotherEditorPartsTab asks of the named group's front tab without its guard for a group that has none, so the chat return (the function retainForeignTabFocus answers, from finishCurrentReturn) breaks on the empty group and the agent's Return answers with "TypeError: Cannot destructure property 'input' of 'undefined' …"; why_new=Cycle 0046 row 727 (the coverage audit of /ship: the guard active.activeTab !== undefined had no test; the read right after the borrow is no such order, since the arrangement's own guard refuses the Return there before the chat return is asked); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on the layout's runCommands and on the receipt read after it, focusEmptyGroup (the new seam), the command log and the information messages; no_claim=what Cursor does with the keyboard of a learner's new empty group beyond root's probe (named in its own column, no tab, no active text editor, the page focus in the group's container), and whether the layout the Return applied is confirmed
test('in Cursor, an agent’s Return Current from a replay leaves the keyboard in the empty group the learner opened while the arrangement’s receipt was read, and the chat gets none back', async () => {
  // Arrange: as in row 723's test; after the editor applied the Study layout, while it answers the receipt read, the learner opens a new empty group right of the main editor's last group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const layoutCommands = harness.holdNextCommand('runCommands')
    void layoutCommands.started.then(() => {
      const receiptRead = harness.holdNextCommand('vscode.getEditorLayout')
      void receiptRead.started.then(() => {
        harness.focusEmptyGroup(4)
        receiptRead.release()
      })
      layoutCommands.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: the Return answered; the empty group is named with no tab in front and no text editor is active, only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        refusal,
        named: `${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}`,
        activeTextEditor: harness.editor.window.activeTextEditor,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: undefined,
        named: '4:0:undefined',
        activeTextEditor: undefined,
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order), when the editor goes on reporting login-form.tsx, the first group's file, after the learner opened a new empty group right of the main editor's last group (Cursor 3.23.12 kept such a report after a new group, row 710): the empty group, with no tab in front, is the learner's place and not Cursor's chat part's, so the Return answers, the chat gets none back and nothing is told; fails_when=namesAnotherEditorPartsTab takes a group without an active tab for the chat's, since a group with no tabs holds no editor's tab either (AD29's whole-group reading), so isFirstGroupEditorUnderAnotherPartsName reads the empty group as the chat part's under the first group's reported file and Focus Agent takes the keyboard; why_new=Cycle 0046 AD29 (row 727's guard, active.activeTab !== undefined, which AD29's reading of the whole group leaves as the only thing that tells an empty group from the chat's; its earlier test no longer reaches it); seam=as in the test above, with focusEmptyGroup keeping the text editor's report (its new option); no_claim=that Cursor keeps the report after the learner's own new group, which row 710 saw after Codebook's
test('in Cursor, an agent’s Return Current from a replay leaves the keyboard in the empty group the learner opened while the arrangement’s receipt was read, also while the editor still reports the first group’s file, and the chat gets none back', async () => {
  // Arrange: as in row 723's test; after the editor applied the Study layout, while it answers the receipt read, the learner opens a new empty group right of the main editor's last group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const layoutCommands = harness.holdNextCommand('runCommands')
    void layoutCommands.started.then(() => {
      const receiptRead = harness.holdNextCommand('vscode.getEditorLayout')
      void receiptRead.started.then(() => {
        harness.focusEmptyGroup(4, true)
        receiptRead.release()
      })
      layoutCommands.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: the Return answered; the empty group is named with no tab in front and no text editor is active, only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        refusal,
        named: `${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}`,
        reportedTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: undefined,
        named: '4:0:undefined',
        reportedTextEditor: 'login-form.tsx',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

for (const editor of ['Settings', 'Keyboard Shortcuts'] as const)
  // Value: protects=the learner's newer choice during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order): after the editor applied the Study layout, while it answers the arrangement's receipt read, the learner opens an editor whose tab the host gives no input (VS Code's Settings, its Keyboard Shortcuts) in front of the Wiki's group, and the editor goes on reporting login-form.tsx behind it (rows 659 and 671); the Return answers, that editor keeps the keyboard and the chat gets none back, since a tab without an editor's input in a group that holds an editor's tab is no tab of Cursor's chat part; fails_when=namesAnotherEditorPartsTab takes any front tab without an editor's input for the chat's tab, so isFirstGroupEditorUnderAnotherPartsName reads the Wiki's group as Cursor's chat part's group and the chat return (from finishCurrentReturn) runs Focus Agent over the learner's editor and tells the arrangement's sentence; why_new=Cycle 0046 AD29 (/ship's adversarial review: a tab with no typed input in the API is taken for Cursor's chat tab); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on the layout's runCommands and on the receipt read after it, focusEditorWithoutTabInput (the new seam) keeping the text editor's report, the command log and the information messages; no_claim=Cursor's own Settings tab in a group of its own, which the API leaves untyped too: alone in a group beyond the main editor's measured ones it is read as the chat's
  test(`in Cursor, an agent’s Return Current from a replay leaves the keyboard in ${editor} the learner opened in the Wiki’s group while the arrangement’s receipt was read, and the chat gets none back`, async () => {
    // Arrange: as in row 723's test; after the editor applied the Study layout, while it answers the receipt read, the learner opens the editor in front of the Wiki's group, and login-form.tsx stays reported.
    const harness = await recordedReaderHarness(true, true)
    harness.useHostAppName('Cursor')
    try {
      await harness.reader.close()
      harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
      const chat = harness.addSeparateEditorPart()
      harness.leavePaneFocusUnreportedBesideChat()
      harness.focusMutableDraft('login-form.tsx', 1)
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      harness.focusMutableDraft('login-form.tsx', 1)
      chat.focus()
      const wikiColumn = harness.groups.find((group) =>
        group.tabs.some(
          (tab) =>
            Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
        ),
      )!.viewColumn
      const state = harness.reader.presentationState(),
        commandsBefore = harness.commands.length,
        messagesBefore = harness.informationMessages.length
      const layoutCommands = harness.holdNextCommand('runCommands')
      void layoutCommands.started.then(() => {
        const receiptRead = harness.holdNextCommand('vscode.getEditorLayout')
        void receiptRead.started.then(() => {
          harness.focusEditorWithoutTabInput(editor, wikiColumn, true)
          receiptRead.release()
        })
        layoutCommands.release()
      })

      // Act
      const refusal = await harness.service
        .returnToCurrent({
          instanceId: harness.service.instanceId,
          presentationId: state.presentationId,
          expectedRevision: state.reader.contentRevision,
        })
        .then(
          () => undefined,
          (error: unknown) => String(error),
        )
      await harness.controller.settle()

      // Assert: the Return answered; the editor is in front of the named group, login-form.tsx is still reported, only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
      const named = harness.editor.window.tabGroups.activeTabGroup
      assert.deepEqual(
        {
          refusal,
          namedFront: named.activeTab?.label,
          reportedTextEditor:
            harness.editor.window.activeTextEditor?.document.uri.path
              .split('/')
              .at(-1),
          keyboardCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
                command,
              ),
            ),
          chatHasKeyboard: chat.focused(),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          refusal: undefined,
          namedFront: editor,
          reportedTextEditor: 'login-form.tsx',
          keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
          chatHasKeyboard: false,
          messages: [],
        },
      )
    } finally {
      await harness.close()
    }
  })

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the fidelity of the workspace harness's new empty group, on which the tests of rows 714 and 727 with a learner's empty group rest: from the moment the editor tells its group and tab listeners, the new group is named in its own column right of the main editor's last group, shows no tab and no active tab, and no text editor is reported active, as root's probe of Cursor 3.23.12 saw after workbench.action.newGroupRight; fails_when=the fake names the new group only after its group event, keeps a tab in it, or keeps reporting the text editor that had the keyboard, so a reader test of a learner's empty group passes by another path; why_new=Cycle 0046 rows 714 and 727 (the coverage audit of /ship); seam=workspaceHarness's two columns, Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, which rebuilds the group objects), focusMutableDraft, the editor's onDidChangeTabs and onDidChangeTabGroups, focusEmptyGroup; no_claim=VS Code's own answer to newGroupRight, which the fake models the same way
  test(`the fake editor names the learner’s new empty group with no tab and reports no active text editor already while it tells its group and tab listeners (${host})`, async () => {
    // Arrange: auth.ts in the second group has the keyboard; a listener of groups and one of tabs read the named group and the active text editor.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    if (host === 'Cursor') {
      harness.addSeparateEditorPart()
      harness.leavePaneFocusUnreportedBesideChat()
    }
    try {
      harness.focusMutableDraft('auth.ts', 2)
      const readInListeners: string[] = []
      /** Names the named group's column, tab count and front tab, and the active text editor's file, as a listener reads them. */
      const readNamedGroup = (listener: string): void => {
        const named = harness.editor.window.tabGroups.activeTabGroup
        readInListeners.push(
          `${listener}:${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}:${harness.editor.window.activeTextEditor?.document.uri.path.split('/').at(-1)}`,
        )
      }
      const tabGroups = harness.editor.window.tabGroups.onDidChangeTabGroups(
          () => readNamedGroup('groups'),
        ),
        tabs = harness.editor.window.tabGroups.onDidChangeTabs(() =>
          readNamedGroup('tabs'),
        )

      // Act: the learner opens a new empty group right of the second group.
      harness.focusEmptyGroup(3)
      tabGroups.dispose()
      tabs.dispose()

      // Assert: every listener read the empty third group with no text editor, and so it stays after them, with the page focus in that group's container.
      const named = harness.editor.window.tabGroups.activeTabGroup
      assert.deepEqual(
        {
          readInListeners,
          namedAfter: `${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}`,
          activeTextEditorAfter: harness.editor.window.activeTextEditor,
          keyboardOnBody: harness.keyboardOnBody(),
        },
        {
          readInListeners: [
            'groups:3:0:undefined:undefined',
            'tabs:3:0:undefined:undefined',
          ],
          namedAfter: '3:0:undefined',
          activeTextEditorAfter: undefined,
          keyboardOnBody: true,
        },
      )
    } finally {
      await harness.close()
    }
  })

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the fidelity of the workspace harness's terminal in the editor area that keeps the text editor report, on which row 727's tests rest: the text editor that had the keyboard stays reported as the active text editor from the moment the editor tells its tab and group listeners of the terminal, as focusWebviewTabKeepingTextEditorReport keeps it for a webview; fails_when=the fake sets the kept report only after it told the listeners, so a reader that reads the active text editor in them finds none and a test of the stale report passes by another path; why_new=Cycle 0046 row 733 (CodeRabbit on b5f8bf97..ec8a8ec3); seam=workspaceHarness's two columns, Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, which rebuilds the group objects), focusMutableDraft, the editor's onDidChangeTabs and onDidChangeTabGroups, focusEditorTerminal with keepsTextEditorReport
  test(`the fake editor reports the text editor that had the keyboard behind a terminal opened in the editor area already while it tells its tab and group listeners (${host})`, async () => {
    // Arrange: auth.ts in the second group has the keyboard; a listener of tabs and one of groups read the active text editor.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    if (host === 'Cursor') {
      harness.addSeparateEditorPart()
      harness.leavePaneFocusUnreportedBesideChat()
    }
    try {
      harness.focusMutableDraft('auth.ts', 2)
      const readInListeners: string[] = []
      /** Names the active text editor's file as a listener reads it. */
      const readActiveTextEditor = (listener: string): void => {
        readInListeners.push(
          `${listener}:${harness.editor.window.activeTextEditor?.document.uri.path.split('/').at(-1)}`,
        )
      }
      const tabs = harness.editor.window.tabGroups.onDidChangeTabs(() =>
          readActiveTextEditor('tabs'),
        ),
        tabGroups = harness.editor.window.tabGroups.onDidChangeTabGroups(() =>
          readActiveTextEditor('groups'),
        )

      // Act: the learner opens a terminal in the editor area of the first group; the editor keeps reporting auth.ts.
      harness.focusEditorTerminal(1, true)
      tabs.dispose()
      tabGroups.dispose()

      // Assert: every listener read auth.ts, and the report stays after them.
      assert.deepEqual(
        {
          readInListeners,
          reportedAfter:
            harness.editor.window.activeTextEditor?.document.uri.path
              .split('/')
              .at(-1),
        },
        {
          readInListeners: ['tabs:auth.ts', 'groups:auth.ts'],
          reportedAfter: 'auth.ts',
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the truth of what the learner is told when an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order) is refused right after its measurement borrowed the first group: the chat gets its keyboard back with Focus Agent, and the sentence says that Codebook could not finish arranging its panes; fails_when=finishCurrentReturn gives the chat its keyboard back with no cause after the refusal, so the return's own rule after a borrow tells "Codebook placed its panes and gave the keyboard back to the chat. …" although nothing was placed; why_new=Cycle 0046 row 731 (the fixer of rows 725 to 730, found beside row 727; row 718 fixed the same sentence for performPresentation's refusal); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus (the click into the chat input), leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay refused right after its borrow of the first group gives the chat its keyboard back and says that nothing was arranged', async () => {
  // Arrange: as in row 723's test; the layout read right after the measurement's borrow of the first group will fail.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      harness.failNextCommand('vscode.getEditorLayout')
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: refused after the borrow; Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer input when an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order) is refused for it: during the layout read right after the measurement borrowed the first group, the learner changed login-form.tsx there, and the Return is refused with "The primary editor content or selection changed during scope measurement; the newer learner focus was preserved."; the chat gets no keyboard back over the learner's edit and nothing is told; fails_when=finishCurrentReturn gives the chat its keyboard back after any refusal, so Focus Agent takes the keyboard from the file the learner works in and the refusedArrangement sentence is told; why_new=Cycle 0046 row 735 (the OCR delegate's review of b5f8bf97..ec8a8ec3: Return Current lacked row 732's rule); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft and its replaceContent, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay refused for the learner’s change of the first group’s file during its layout read gives the chat no keyboard and tells nothing', async () => {
  // Arrange: as in row 723's test; the learner will change login-form.tsx during the layout read right after the measurement's borrow of the first group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        loginForm.replaceContent('export const changedByLearner = true\n')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: refused for the learner's change after the borrow; only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

/**
 * Opens the recorded reader's harness as Cursor beside its Agent chat part for row 736's replay opens: the reader closed, two main groups with the learner's login-form.tsx in front of the first, and the chat input holding the keyboard (row 678's setup).
 * @returns The harness, its chat part and login-form.tsx's draft.
 * @example const { harness, chat, loginForm } = await cursorReplayOpenFromChat()
 */
async function cursorReplayOpenFromChat() {
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  await harness.reader.close()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
  chat.focus()
  return { harness, chat, loginForm }
}

// Value: protects=the truth of what the learner is told when an agent's replay open (codebook_playback open) beside Cursor's Agent chat part is refused right after its measurement borrowed the first group (measureBeforePanesBesideForeignTab): the chat gets its keyboard back with Focus Agent and the one sentence says that Codebook could not finish arranging its panes; fails_when=open's refusal path gives the chat its keyboard back with no cause, so the return's own rule after a borrow tells "Codebook placed its panes and gave the keyboard back to the chat. …" for an entry that placed nothing; why_new=Cycle 0046 row 736 (the OCR delegate's review of b5f8bf97..ec8a8ec3, row 731's root); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and the controller's state, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the command log and the information messages
test('in Cursor, an agent’s replay open refused right after its borrow of the first group gives the chat its keyboard back and says that nothing was arranged', async () => {
  // Arrange: row 678's setup; the layout read right after the measurement's borrow of the first group will fail.
  const { harness, chat } = await cursorReplayOpenFromChat()
  try {
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      harness.failNextCommand('vscode.getEditorLayout')
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: the replay's open failed after the borrow; Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        reason: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard and the truth of what the learner is told when an agent's replay open beside Cursor's Agent chat part is refused right after its borrow of the first group, after an earlier presentation focus request (codebook_presentation focus) was refused for the learner's newer choice: that request is no owner of presentationYieldedToLearner, so its refusal (retainPresentationPlacement's yieldFocusToLearner) leaves the flag set through the Study's close; the open notes its own refusal from its start, so the chat still gets its keyboard back with Focus Agent and the one sentence says that nothing was arranged; fails_when=an owning entry of open does not clear the flag when it begins, so the earlier request's flag reads as the open's own refusal for the learner and the chat gets nothing back and nothing is told; why_new=Cycle 0046 row 736 (the coverage audit of /ship: the reset when an owning open() entry begins had no test); seam=recordedReaderHarness, useHostAppName, the reader's open, changePresentation with action focus, holdPanelActivity on the Study pane with the learner's focusMutableDraft draft taking the keyboard during it, the reader's close, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and the controller's state, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the command log and the information messages; no_claim=whether a refused focus request should clear the flag itself (each owner clears it when it begins and when it ends, and only owners read it)
test('in Cursor, an agent’s replay open refused right after its borrow still gives the chat its keyboard back and says that nothing was arranged after an earlier focus request was refused for the learner’s newer choice', async () => {
  // Arrange: the Study is open; a focus request for the Study pane is refused because the learner's draft took the keyboard while the pane's activity was held; the Study is closed, and row 678's setup follows with the chat input holding the keyboard; the layout read right after the open's borrow of the first group will fail.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.open()
    const opened = harness.reader.presentationState()
    const draft = harness.focusMutableDraft()
    const held = harness.holdPanelActivity('codebook.studyContext')
    const focusRefusal = Promise.resolve()
      .then(() =>
        harness.reader.changePresentation({
          presentationId: opened.presentationId,
          expectedRevision: opened.presentationControlRevision,
          mode: opened.mode,
          action: 'focus',
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await held.started
    draft.focus()
    held.release()
    const refusedFocus = await focusRefusal
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      harness.failNextCommand('vscode.getEditorLayout')
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: the focus request was refused; the replay's open failed after the borrow, Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        refusedFocus,
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusedFocus:
          'Error: Study focus could not be confirmed. Read current presentation state before retrying.',
        reason: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer input when an agent's replay open beside Cursor's Agent chat part is refused for it: during the layout read right after the measurement borrowed the first group, the learner changed login-form.tsx there, and the open is refused with "The primary editor content or selection changed during scope measurement; the newer learner focus was preserved."; the chat gets no keyboard back over the learner's edit and nothing is told; fails_when=open's refusal path gives the chat its keyboard back after any refusal, so Focus Agent takes the keyboard from the file the learner works in; why_new=Cycle 0046 row 736 (its learner-change half, row 732's rule); seam=as above, with focusMutableDraft's replaceContent and holdNextCommand on the layout read after the borrow
test('in Cursor, an agent’s replay open refused for the learner’s change of the first group’s file during its layout read gives the chat no keyboard and tells nothing', async () => {
  // Arrange: row 678's setup; the learner will change login-form.tsx during the layout read right after the measurement's borrow.
  const { harness, chat, loginForm } = await cursorReplayOpenFromChat()
  try {
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        loginForm.replaceContent('export const changedByLearner = true\n')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: refused for the learner's change; only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        reason:
          'Error: The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when, during an agent's replay open beside Cursor's Agent chat part, the learner clicks into login-form.tsx, the first group's file the measurement's borrow focused, during the layout read right after that borrow (the click moves no caret): the replay opens, the keyboard stays in that file, the chat gets nothing back and no keyboard sentence is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the measurement left the keyboard and not whether the learner clicked or typed there since, so open's last step runs Focus Agent and tells the arrangement's sentence; why_new=Cycle 0046 row 741 (open is one of the entries that share the return); seam=cursorReplayOpenFromChat, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, workInActiveTextEditor('mouse'), the service's playback and the controller's state, the command log and the information messages
test('in Cursor, an agent’s replay open after the learner’s click into the first group’s file during its layout read keeps the keyboard there, gives the chat nothing and tells no keyboard sentence', async () => {
  // Arrange: row 678's setup; during the layout read right after the measurement's borrow of the first group, the learner clicks into login-form.tsx there.
  const { harness, chat } = await cursorReplayOpenFromChat()
  try {
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.workInActiveTextEditor('mouse')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: the replay opened; only the measurements' focus commands ran, the chat has no keyboard, and the one sentence told is the summary's placement, not a keyboard sentence.
    assert.deepEqual(
      {
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        reason: undefined,
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
        ],
        chatHasKeyboard: false,
        messages: [
          'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when, during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order), the learner clicks into login-form.tsx, the first group's file the measurement's borrow focused, during the layout read right after that borrow (the click moves no caret): the Return answers, the keyboard stays in that file, the chat gets nothing back and nothing is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the measurement left the keyboard and not whether the learner clicked or typed there since, so finishCurrentReturn runs Focus Agent and tells the arrangement's sentence; why_new=Cycle 0046 row 741 (Return Current is one of the entries that share the return); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, workInActiveTextEditor('mouse'), the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay after the learner’s click into the first group’s file during its layout read keeps the keyboard there, gives the chat nothing and tells nothing', async () => {
  // Arrange: as in row 723's test; during the layout read right after the measurement's borrow of the first group, the learner clicks into login-form.tsx there.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.workInActiveTextEditor('mouse')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: the Return answered; only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: undefined,
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is after an agent's replay open (codebook_playback open) beside Cursor's Agent chat part while the chat tab has the keyboard: the preparation's measurement borrows the first group, Focus Agent gives the chat its keyboard back, and the arrangement's sentence is told the first time in an editor session only, so the next replay open in that session says nothing (C59 c59-cu-656a told nothing because round c59-cu-650 had told the sentence in the same extension host, after its reload: the notification shows in that round's recording at 7 to 8.5 s, and both rounds' observers share the host's time origin 1792204656982); fails_when=the replay open gives the chat its keyboard back without the sentence the first time, or tells it again each time; why_new=Cycle 0046 row 678 (evidence: not a defect; this test holds the rule the native rounds followed); seam=recordedReaderHarness, useNativeLayout, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, the service's playback and the reader's close, the command log and the information messages
test('in Cursor, an agent’s replay open from the chat tab gives the chat its keyboard back and says so the first time in an editor session only', async () => {
  // Arrange: Cursor's Agent chat as a tab of its own editor part has the keyboard; the learner's login-form.tsx is in front of the first group, and the reader is closed.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focusTab()
    const arrangementSentence =
      'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.'
    const openReplay = async () => {
      const commandsBefore = harness.commands.length,
        messagesBefore = harness.informationMessages.length
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      return {
        lastKeyboardCommand: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          )
          .at(-1),
        chatHasKeyboard: chat.focused(),
        toldArrangement: harness.informationMessages
          .slice(messagesBefore)
          .filter((message) => message.message === arrangementSentence).length,
      }
    }

    // Act: the agent opens the replay, closes the reader and opens it again from the chat.
    const first = await openReplay()
    await harness.reader.close()
    chat.focusTab()
    const second = await openReplay()

    // Assert
    assert.deepEqual(
      { first, second },
      {
        first: {
          lastKeyboardCommand: 'composer.focusComposer',
          chatHasKeyboard: true,
          toldArrangement: 1,
        },
        second: {
          lastKeyboardCommand: 'composer.focusComposer',
          chatHasKeyboard: true,
          toldArrangement: 0,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's terminal and its keyboard in the bottom panel when an agent opens a recording through codebook_playback in VS Code: the Observed moments view's focus command opens its container in place of the terminal even with the focus kept (1.140.0 workbench.desktop.main.js 1639:157156 -> openView 1639:152215 -> doOpenComposite 1106:186495, hideActiveComposite 1106:190002), which hides the terminal and drops its keyboard; the agent's entry leaves the panel as it is, and the one sentence told once names both places where the replay's controls wait; fails_when=the agent's replay open still focuses the moments view while it is not shown, or tells nothing about where the controls wait; why_new=Cycle 0046 row 621; seam=recordedReaderHarness, the reader's close, useNativeLayout, focusMutableDraft, focusTerminalInBottomPanel (the panel's terminal with the keyboard), the service's playback (the codebook_playback handler), viewFocusCommands, keyboardInView, terminalInFrontOfPanel and the information messages
test('an agent’s replay open in VS Code while the learner types in the bottom panel’s terminal keeps the terminal in front with its keyboard and says where the replay controls wait', async () => {
  // Arrange: a saved recording, the reader closed; the learner's actions.ts is the active editor of the first group, and the learner types in the terminal of the bottom panel.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusTerminalInBottomPanel()
    const viewFocusBefore = harness.viewFocusCommands.length

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: neither view was brought to the front, the terminal still stands in front of the panel with the keyboard, and the learner is told where the Application group and the replay's controls are.
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [])
    assert.equal(harness.terminalInFrontOfPanel(), true)
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's terminal and its keyboard in the bottom panel when an agent opens a recording through codebook_playback in Cursor: the Observed moments view's focus command switches the bottom panel's container there too (Cursor 3.23.12 18332:33062 -> 17501:95332, 17501:98812), while the Learning summary, which Cursor puts in the primary side bar, brings the replay's controls to the front without touching the panel; fails_when=the agent's replay open still focuses the moments view while it is not shown, so the terminal is hidden and its keyboard dropped; why_new=Cycle 0046 row 621; seam=recordedReaderHarness, useHostAppName('Cursor'), the reader's close, useNativeLayout, focusMutableDraft, focusTerminalInBottomPanel, the service's playback, viewFocusCommands, keyboardInView and terminalInFrontOfPanel
test('an agent’s replay open in Cursor while the learner types in the bottom panel’s terminal shows the Learning summary and keeps the terminal in front with its keyboard', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.useHostAppName('Cursor')
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusTerminalInBottomPanel()
    const viewFocusBefore = harness.viewFocusCommands.length

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: only the summary, with its transport, was brought to the front without the keyboard; the terminal keeps the panel and the keyboard.
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [
      { command: 'codebook.learningSummary.focus', preserveFocus: true },
    ])
    assert.equal(harness.terminalInFrontOfPanel(), true)
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    await harness.close()
  }
})
