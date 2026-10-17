import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import type { RepositorySelection } from '../learnerSchemas'
import { RepositoryBookStore } from '../repositoryBook'
import { RepositorySourceService } from '../repositorySource'

import { workspaceHarness } from './studyWorkspaceHarness'

const git = promisify(execFile)

/** The refusal of a Repository Wiki navigation whose native focus receipt saw a change it did not make itself. */
const NAVIGATION_FOCUS_REFUSAL =
  'Error: Native focus changed during repository navigation; the newer learner focus was preserved.'

/**
 * Publishes a one-article Repository Wiki that cites two tracked sources of the harness's workspace (module.ts, then order.ts), into the Study workspace's learning storage that a reader of `createRepositoryWikiReader` reads, as an agent's Wiki update leaves it.
 * @param harness - The workspace harness whose directory becomes a Git repository with `src/module.ts` and `src/order.ts`.
 * @returns The selection of the article's first citation (module.ts), and the book store to dispose once the test ended.
 * @example const { selection, books } = await publishTwoCitationWiki(harness)
 */
async function publishTwoCitationWiki(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): Promise<{ selection: RepositorySelection; books: RepositoryBookStore }> {
  const directory = await realpath(harness.directory),
    library = await harness.reader.learningStorage()
  await git('git', ['init', '--quiet', directory])
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(
    join(directory, 'src/module.ts'),
    'export const price = 24;\n',
  )
  await writeFile(join(directory, 'src/order.ts'), 'export const total = 48;\n')
  await git('git', ['add', '--', 'src'], { cwd: directory })
  const sources = new RepositorySourceService(directory),
    books = new RepositoryBookStore(sources, library)
  const module = await sources.read('src/module.ts'),
    order = await sources.read('src/order.ts')
  await books.publish({
    bookId: 'architecture',
    key: 'first',
    expectedRevision: 0,
    document: {
      title: 'Architecture',
      summary: 'Source-derived architecture.',
      nodes: [
        {
          id: 'module',
          title: 'Module',
          sections: [
            { title: 'Price', text: 'The module exports price 24.' },
            { title: 'Order', text: 'Order exports total 48.' },
          ],
          anchors: [module, order].map((value) => ({
            path: value.path,
            hash: value.hash,
            startLine: 1,
            endLine: 1,
          })),
          observations: [],
        },
      ],
      edges: [],
    },
  })
  return {
    selection: {
      bookId: 'architecture',
      revision: 1,
      nodeId: 'module',
      anchorIndex: 0,
    },
    books,
  }
}

/**
 * Opens the workspace harness as Cursor beside its Agent chat part: two main groups and the chat part, with Cursor's stale group name after the first group's focus command (the harness's `leavePaneFocusUnreportedBesideChat`).
 * @returns The harness and its chat part.
 * @example const { harness, chat } = await cursorBesideChatPart()
 */
async function cursorBesideChatPart() {
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 490 }, { size: 490 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  return { harness, chat }
}

// Value: protects=the learner's Open Repository Wiki run while Cursor's Agent chat tab has the keyboard and no Wiki is open, end to end through the real RepositoryReader and the real Study workspace's layout: the measurement borrows the first group under the chat's stale group name, the cited source takes the keyboard in front of the first group while Cursor still names the chat's group (a tab that opened there is no group activation for Cursor's tab model, C58 c58-cu-567), and the Wiki then gets the keyboard; fails_when=either half of row 660 is gone: the borrow's receipt refuses Cursor's stale name of the measured group, or the citation's receipt refuses it for the citation's own group, and the open ends with "Native focus changed during repository navigation; the newer learner focus was preserved."; why_new=Cycle 0046 row 674 (until then row 660 was tested through the reader's own harness and the Study workspace's alone); seam=workspaceHarness's Cursor model of the chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, chat.focusTab), createRepositoryWikiReader, the native commands and textDocumentShows
test("the learner's cold Open Repository Wiki beside Cursor's chat part opens the Wiki after its citation took the keyboard in the first group under the chat's group name, and gives the Wiki the keyboard", async () => {
  // Arrange: Cursor's chat tab has the keyboard; login-form.tsx is in front of the first group and no Wiki of this reader is open.
  const { harness, chat } = await cursorBesideChatPart()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  try {
    // Act
    const refusal = await wiki.open(selection).then(
      () => undefined,
      (error: unknown) => String(error),
    )

    // Assert: the open answered with its article; the measurement borrowed the first group once, the citation was shown once with the keyboard in front of it, and the Wiki has the keyboard.
    assert.deepEqual(
      {
        refusal,
        article: wiki.inspect().view.selection,
        borrows: harness.commands.filter(
          (command) => command === 'workbench.action.focusFirstEditorGroup',
        ).length,
        shows: harness.textDocumentShows(),
        firstGroupFront: harness.groups[0]!.activeTab?.label,
        keyboard: harness.focusedPanel(),
        chatHasKeyboard: chat.focused(),
      },
      {
        refusal: undefined,
        article: selection,
        borrows: 1,
        shows: [{ name: 'module.ts', viewColumn: 1, preserveFocus: false }],
        firstGroupFront: 'module.ts',
        keyboard: 'codebook.repositoryWiki',
        chatHasKeyboard: false,
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=Cursor's chat tab keyboard at an agent's cold Wiki open (codebook_open_book) beside Cursor's chat part, end to end through the real RepositoryReader and the real Study workspace's layout: the measurement borrows the first group under the chat's stale group name, the Wiki is shown with its citation and without the keyboard, and the arrangement's keyboard return gives the chat its keyboard back with Cursor's Focus Agent; fails_when=the borrow's receipt refuses Cursor's stale name of the measured group (row 660 gone), so the agent's open is refused; why_new=Cycle 0046 row 674; seam=workspaceHarness's Cursor model of the chat part, createRepositoryWikiReader's openFromAgent, the native commands
test("an agent's cold Wiki open beside Cursor's chat part shows the Wiki with its citation and gives the chat tab its keyboard back", async () => {
  // Arrange: as above.
  const { harness, chat } = await cursorBesideChatPart()
  const learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  try {
    // Act
    const answer = await wiki
      .openFromAgent({ ...selection, instanceId: harness.service.instanceId })
      .then(
        (receipt) => ({
          citedFile: receipt.sourceUri.split('?')[0]?.split('/').at(-1),
          refusal: undefined,
        }),
        (error: unknown) => ({ citedFile: undefined, refusal: String(error) }),
      )

    // Assert: the agent got its receipt for the citation; the chat has its keyboard again through Focus Agent, and no text editor keeps it.
    assert.deepEqual(
      {
        ...answer,
        focusCommands: harness.commands.filter((command) =>
          /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
            command,
          ),
        ),
        chatHasKeyboard: chat.focused(),
        focusedFile: harness.focusedSource()?.document.uri.toString(),
      },
      {
        citedFile: 'module.ts',
        refusal: undefined,
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        focusedFile: undefined,
      },
    )
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=an agent's cold Wiki open beside Cursor's chat part after Focus Agent from the learner's file in the first group (row 690's state, read again on C61: c61-702-probe step 2 left no active text editor, the first group named and layout reads answering the chat part's grid; row 702): nothing proves the main editor the active part, so the layout read borrows the first group, and the open answers and gives the chat its keyboard back with Focus Agent (row 620's path, as C60's c60-cu-2c saw natively); fails_when=the open borrows nothing and measures the chat part's grid as the main editor's, or leaves the keyboard in the first group's file; why_new=Cycle 0046 rows 690 and 702 (the C61 probe replaced c59's reading of Focus Agent, which had the file still reported and no borrow); seam=workspaceHarness's Cursor model (cursorBesideChatPart), Focus Agent (composer.focusComposer), createRepositoryWikiReader's openFromAgent and the native commands
test("an agent's cold Wiki open beside Cursor's chat part, after Focus Agent from the first group's file, borrows the first group and gives the chat its keyboard back", async () => {
  // Arrange: the learner's login-form.tsx in front of the first group had the keyboard; Focus Agent gave the chat input the keyboard, and Cursor goes on naming the first group with no active text editor.
  const { harness, chat } = await cursorBesideChatPart()
  harness.focusMutableDraft('login-form.tsx', 1)
  await harness.editor.commands.executeCommand('composer.focusComposer')
  const commandsBefore = harness.commands.length
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  try {
    // Act
    const refusal = await wiki
      .openFromAgent({ ...selection, instanceId: harness.service.instanceId })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: the open answered; the borrow of the first group and Focus Agent ran, and the chat input has the keyboard.
    assert.deepEqual(
      {
        refusal,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
      },
      {
        refusal: undefined,
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=a citation the learner follows with Open Repository Wiki in the open Wiki after Cursor's chat tab took the keyboard again, end to end: the second citation takes the keyboard in front of the first group under the chat's stale group name, replaces the copy of the citation before, and the Wiki gets the keyboard; fails_when=the citation's receipt refuses Cursor's stale name for the citation's own group (row 660's isStaleGroupNameOfCitation gone), so the citation is refused with "Native focus changed during repository navigation; the newer learner focus was preserved."; why_new=Cycle 0046 row 674; seam=workspaceHarness's Cursor model of the chat part, createRepositoryWikiReader's open, the native commands, textDocumentShows and the first group's tabs
test("a second citation followed in the open Wiki after Cursor's chat tab took the keyboard again takes the keyboard in the first group under the chat's group name and replaces the citation before", async () => {
  // Arrange: the learner's Wiki shows module.ts; then the chat tab has the keyboard again.
  const { harness, chat } = await cursorBesideChatPart()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  try {
    const firstRefusal = await wiki.open(selection).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    chat.focusTab()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const refusal = await wiki.open({ ...selection, anchorIndex: 1 }).then(
      () => undefined,
      (error: unknown) => String(error),
    )

    // Assert: both opens answered; order.ts was shown once with the keyboard in front of the first group, module.ts's copy left it, and the Wiki has the keyboard.
    assert.deepEqual(
      {
        firstRefusal,
        refusal,
        citation: wiki.inspect().view.selection?.anchorIndex,
        shows: harness.textDocumentShows().slice(showsBefore),
        firstGroup: harness.groups[0]!.tabs.map((tab) => tab.label),
        firstGroupFront: harness.groups[0]!.activeTab?.label,
        keyboard: harness.focusedPanel(),
      },
      {
        firstRefusal: undefined,
        refusal: undefined,
        citation: 1,
        shows: [{ name: 'order.ts', viewColumn: 1, preserveFocus: false }],
        firstGroup: ['article-source.ts', 'login-form.tsx', 'order.ts'],
        firstGroupFront: 'order.ts',
        keyboard: 'codebook.repositoryWiki',
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's newer choice during a cold Open Repository Wiki beside Cursor's chat part, end to end: a click into the learner's file of the second group right after the citation took the keyboard in the first group (a group activation, which names that group) is the learner's change, which the citation's receipt refuses although it accepts Cursor's stale name of the chat's group for its own citation (row 660's bound), so the file keeps the keyboard and the Wiki takes nothing; fails_when=the stale name is accepted for any group or any later name, so a learner who went elsewhere loses the keyboard to the Wiki; why_new=Cycle 0046 row 674; seam=workspaceHarness's Cursor model of the chat part, changeAfterNextSourceDisplay with focusExistingSource (the learner's click), createRepositoryWikiReader's open
test("a learner's click into another group's file right after the citation of a cold Open Repository Wiki beside Cursor's chat part took the keyboard is still refused as the learner's newer focus", async () => {
  // Arrange: as the first test, with the learner's notes.ts in the second group; the learner clicks into it as soon as the citation is shown.
  const { harness, chat } = await cursorBesideChatPart()
  const notes = harness.focusMutableDraft('notes.ts', 2)
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  harness.changeAfterNextSourceDisplay(() =>
    harness.focusExistingSource(notes.editor),
  )
  try {
    // Act
    const refusal = await wiki.open(selection).then(
      () => undefined,
      (error: unknown) => String(error),
    )

    // Assert: the open is refused with the reader's sentence; notes.ts keeps the keyboard and its group is the named one.
    assert.deepEqual(
      {
        refusal,
        focusedFile: harness.focusedSource()?.document.uri.toString(),
        namedColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      },
      {
        refusal: NAVIGATION_FOCUS_REFUSAL,
        focusedFile: notes.document.uri.toString(),
        namedColumn: 2,
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=reader tests beside Cursor's chat part meeting Cursor's stale group name as it lasts: after the first group's focus command, a document shown with the keyboard that opens a new tab in the first group leaves the chat's group named (the rebuild Cursor answers that tab with names the group its editor groups service holds active, `workbench.desktop.main.js` 17269:31013, which the display does not change: C58 c58-cu-567, C59 c59-cu-2c), while an open tab brought to the front with the keyboard names the first group (the Application's preparation borrows the learner's source that way, focusApplicationSourceGroup); fails_when=the fake clears the stale name at the new tab's rebuild, so a reader that accepts Cursor's stale name for its citation passes without that acceptance; why_new=Cycle 0046 row 674 (the model the end-to-end reader tests above run on); seam=the workspace harness's Cursor model of the chat part, the first-group focus command and showTextDocument
test("the fake editor of Cursor goes on naming the chat's group when a document shown with the keyboard opens a new tab in the first group after that group's focus command, and names the first group when an open tab comes to its front with the keyboard", async () => {
  // Arrange: login-form.tsx behind notes.ts in the first group; the chat tab has the keyboard, then the first group's focus command leaves the chat's group named.
  const { harness, chat } = await cursorBesideChatPart()
  const learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusMutableDraft('notes.ts', 1)
  chat.focusTab()
  const citedPath = join(harness.directory, 'cited.ts')
  await writeFile(citedPath, 'export const cited = true;\n')
  const tabGroups = harness.editor.window.tabGroups
  await harness.editor.commands.executeCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const namedAfterFocus = tabGroups.activeTabGroup.viewColumn

  try {
    // Act
    const cited = await harness.editor.workspace.openTextDocument(
      harness.editor.Uri.file(citedPath),
    )
    await harness.editor.window.showTextDocument(cited, {
      viewColumn: 1,
      preserveFocus: false,
    })
    const namedAfterNewTab = tabGroups.activeTabGroup.viewColumn
    await harness.editor.window.showTextDocument(learnerFile.document, {
      viewColumn: 1,
      preserveFocus: false,
    })
    const namedAfterOpenTab = tabGroups.activeTabGroup.viewColumn

    // Assert
    assert.deepEqual(
      { namedAfterFocus, namedAfterNewTab, namedAfterOpenTab },
      { namedAfterFocus: 3, namedAfterNewTab: 3, namedAfterOpenTab: 1 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests that compare the text editor a display answers with the active one, and its selection with the range they asked for, as the Repository Wiki's citation receipt does: both editors answer showTextDocument with the one text editor they then report as active, and select the given range from its start to its end, so the caret stands at its end (VS Code 1.140.0 `workbench.desktop.main.js` 981:134134, Cursor 3.23.12 11678:42235 `setSelection({startLineNumber,…,endColumn})`); fails_when=the fake answers with another object than its active text editor or collapses the range to its start, so the citation's receipt refuses its own display; why_new=Cycle 0046 row 674; seam=the workspace harness's showTextDocument and activeTextEditor
test('the fake editor answers showTextDocument with the text editor it then reports as active, and selects the given range from its start to its end, as both editors do', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const citedPath = join(harness.directory, 'cited.ts')
  await writeFile(citedPath, 'export const cited = true;\n')
  try {
    const cited = await harness.editor.workspace.openTextDocument(
      harness.editor.Uri.file(citedPath),
    )

    // Act
    const shown = await harness.editor.window.showTextDocument(cited, {
      viewColumn: 1,
      preserveFocus: false,
      selection: new harness.editor.Range(0, 0, 0, 26),
    })

    // Assert
    assert.equal(shown, harness.editor.window.activeTextEditor)
    assert.deepEqual(
      shown.selections.map((selection) => ({
        anchor: [selection.anchor.line, selection.anchor.character],
        active: [selection.active.line, selection.active.character],
      })),
      [{ anchor: [0, 0], active: [0, 26] }],
    )
  } finally {
    await harness.close()
  }
})

/**
 * Opens the workspace harness with the learner's two columns and no Repository Wiki: login-form.tsx in front of the first group, auth.ts in front of the second, the column a cold Wiki is created in, with the keyboard; in Cursor beside its Agent chat part as {@link cursorBesideChatPart} opens it (Cycle 0046 row 694).
 * @param host - The editor whose model the harness runs.
 * @returns The harness, and the chat part in Cursor.
 * @example const { harness } = await learnerTypingInWikiColumn('VS Code')
 */
async function learnerTypingInWikiColumn(host: 'VS Code' | 'Cursor') {
  const { harness, chat } =
    host === 'Cursor'
      ? await cursorBesideChatPart()
      : { harness: await workspaceHarness(false), chat: undefined }
  if (!chat)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 490 }, { size: 490 }],
    })
  // The fixture's Wiki tab without a panel goes: no Wiki is open.
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusMutableDraft('auth.ts', 2)
  return { harness, chat }
}

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the learner's keyboard when an agent opens an article through codebook_open_book while no Wiki is open and the learner types in a file in front of the second group, the column the Wiki is created in: the Wiki covers that file without the keyboard and the hidden editor's keyboard falls to the page body, so Codebook gives the Wiki the keyboard and says once what happened and how to type in the file again; fails_when=RepositoryReader.settleAgentEntryKeyboard takes the arrangement's "nothing borrowed" for a keyboard where the learner had it, so the keyboard stays on the page body and nothing is told (C60 in both hosts: auth.ts in front of column 2 with the keyboard, then BODY to the end); why_new=Cycle 0046 row 694; seam=workspaceHarness's two columns (leaveEmptyGroup, focusMutableDraft), workInActiveTextEditor (the learner's key press), Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat), createRepositoryWikiReader with the workspace's knowsLearnerTypesInActiveEditor, openFromAgent, Close Repository Wiki, keyboardOnBody, focusedPanel, panelReveals, textDocumentShows and the information messages
  test(`an agent's cold Wiki open created in front of the file the learner was typing in gives the Wiki the keyboard and says so once (${host})`, async () => {
    // Arrange: the learner types in auth.ts in front of the second group; no Wiki is open.
    const { harness } = await learnerTypingInWikiColumn(host)
    harness.workInActiveTextEditor('keyboard')
    const { selection, books } = await publishTwoCitationWiki(harness)
    const wiki = harness.createRepositoryWikiReader()
    const article = { instanceId: harness.service.instanceId, ...selection }
    try {
      // Act: the agent opens the article; after Close Repository Wiki the learner types in auth.ts again, and the agent opens it once more.
      await wiki.openFromAgent(article)
      const afterFirstOpen = {
        keyboardOnBody: harness.keyboardOnBody(),
        keyboard: harness.focusedPanel(),
        secondGroup: harness.groups[1]!.tabs.map(
          (tab) =>
            `${tab === harness.groups[1]!.activeTab ? '*' : ''}${tab.label}`,
        ),
      }
      wiki.close()
      harness.focusMutableDraft('auth.ts', 2)
      harness.workInActiveTextEditor('keyboard')
      await wiki.openFromAgent(article)

      // Assert: each open gave the Wiki the keyboard with one reveal; the cited source was shown without the keyboard, no file was shown with it, and the sentence was told for the first open only.
      assert.deepEqual(
        {
          afterFirstOpen,
          keyboardOnBody: harness.keyboardOnBody(),
          wikiRevealsWithKeyboard: harness
            .panelReveals()
            .filter(
              (reveal) =>
                reveal.kind === 'codebook.repositoryWiki' &&
                reveal.preserveFocus === false,
            ).length,
          shownWithKeyboard: harness
            .textDocumentShows()
            .filter((shown) => !shown.preserveFocus),
          notices: harness.informationMessages.map((notice) => notice.message),
        },
        {
          afterFirstOpen: {
            keyboardOnBody: false,
            keyboard: 'codebook.repositoryWiki',
            secondGroup: ['auth.ts', '*codebook · Repository Wiki'],
          },
          keyboardOnBody: false,
          wikiRevealsWithKeyboard: 2,
          shownWithKeyboard: [],
          notices: [
            'Codebook opened the Repository Wiki an agent asked for in front of the file you were typing in, and the Wiki has the keyboard now. To type in that file again, click its tab in the same editor group.',
          ],
        },
      )
    } finally {
      await books.dispose()
      await harness.close()
    }
  })

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the learner's keyboard when an agent opens an article through codebook_open_book while no Wiki is open and the learner types in a diff editor in front of the second group (the Source Control view's Open Changes), whose text editors both editors report with no view column (C61 c61-688-diffprobe): the diff proves the main editor the active part as a plain file does, so the layout read borrows nothing, and the Wiki created in front of the diff gets the keyboard with row 694's sentence, told once; fails_when=a diff's text editor without a view column proves nothing, so the read borrows the first group and cannot give the keyboard back (C61 c61-cu-688 in Cursor: focusFirstEditorGroup, the Wiki in front of the diff with the keyboard and REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE), or the Wiki covers the diff and nothing settles its keyboard, which falls to the page body; why_new=Cycle 0046 row 709; seam=workspaceHarness's two columns (leaveEmptyGroup, focusMutableDraft), focusDiffEditor (a diff's text editors without a view column), workInActiveTextEditor (the learner's key press), Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat), createRepositoryWikiReader, openFromAgent, the command log, keyboardOnBody, focusedPanel and the information messages
  test(`an agent's cold Wiki open while the learner types in a diff editor in front of the second group borrows nothing and gives the Wiki the keyboard with the typed-file sentence once (${host})`, async () => {
    // Arrange: the learner types in the diff of auth.ts in front of the second group; no Wiki is open.
    const harness =
      host === 'Cursor'
        ? (await cursorBesideChatPart()).harness
        : await workspaceHarness(false)
    if (host === 'VS Code')
      harness.useNativeLayout({
        orientation: 0,
        groups: [{ size: 490 }, { size: 490 }],
      })
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusDiffEditor('auth.ts', 2)
    harness.workInActiveTextEditor('keyboard')
    const { selection, books } = await publishTwoCitationWiki(harness)
    const wiki = harness.createRepositoryWikiReader()
    const commandsBefore = harness.commands.length
    try {
      // Act
      await wiki.openFromAgent({
        instanceId: harness.service.instanceId,
        ...selection,
      })

      // Assert: no group focus ran; the Wiki in front of the diff has the keyboard, and the typed-file sentence was told once.
      assert.deepEqual(
        {
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /^workbench\.action\.focus\w+EditorGroup$/.test(command),
            ),
          keyboardOnBody: harness.keyboardOnBody(),
          keyboard: harness.focusedPanel(),
          secondGroup: harness.groups[1]!.tabs.map(
            (tab) =>
              `${tab === harness.groups[1]!.activeTab ? '*' : ''}${tab.label}`,
          ),
          notices: harness.informationMessages.map((notice) => notice.message),
        },
        {
          focusCommands: [],
          keyboardOnBody: false,
          keyboard: 'codebook.repositoryWiki',
          secondGroup: [
            'auth.ts (Working Tree)',
            '*codebook · Repository Wiki',
          ],
          notices: [
            'Codebook opened the Repository Wiki an agent asked for in front of the file you were typing in, and the Wiki has the keyboard now. To type in that file again, click its tab in the same editor group.',
          ],
        },
      )
    } finally {
      await books.dispose()
      await harness.close()
    }
  })

// Value: protects=the learner's keyboard in VS Code's floating window of text editors when an agent opens an article through codebook_open_book while no Wiki is open: the layout read borrows the main editor's first group (row 689), measures the main editor, and gives the keyboard back to the floating window's file through its group's numbered focus (row 708), so the open answers, the Wiki stands in the main editor and the learner types on in the floating window with nothing told; fails_when=the borrow gives nothing back, so the keyboard stays in the main editor's first group, or the Repository Wiki's navigation takes the return for a learner's move and refuses the open; why_new=Cycle 0046 row 708; seam=useNativeLayout with two main groups, leaveEmptyGroup, addFloatingEditorWindow (two groups) and its focus, createRepositoryWikiReader, openFromAgent, the native commands, focusedSource and the information messages
test("an agent's cold Wiki open while a text editor of VS Code's floating window has the keyboard gives that editor the keyboard back after the borrow and opens the Wiki in the main editor", async () => {
  // Arrange: the main editor's first group shows login-form.tsx; the learner works in notes.ts, in the first group of a floating window of two groups; no Wiki is open.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 490 }, { size: 490 }],
  })
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('login-form.tsx', 1)
  const floating = harness.addFloatingEditorWindow(['notes.ts', 'readme.md'])
  floating.focus(0)
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  const commandsBefore = harness.commands.length
  try {
    // Act
    const refusal = await wiki
      .openFromAgent({ instanceId: harness.service.instanceId, ...selection })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: one borrow and the floating group's focus; the Wiki is in the main editor's second group; notes.ts has the keyboard; nothing was told.
    assert.deepEqual(
      {
        refusal,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$/.test(command),
          ),
        wikiGroup: harness.groups.find((group) =>
          group.tabs.some((tab) => tab.label === 'codebook · Repository Wiki'),
        )?.viewColumn,
        keyboard: harness.focusedSource()?.document.uri.path.split('/').at(-1),
        notices: harness.informationMessages.map((notice) => notice.message),
      },
      {
        refusal: undefined,
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
        wikiGroup: 2,
        keyboard: 'notes.ts',
        notices: [],
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

for (const situation of [
  { host: 'VS Code', keyboard: 'the chat view' },
  { host: 'Cursor', keyboard: 'a view' },
] as const)
  // Value: protects=the keyboard of a view the learner typed in when an agent's cold Wiki open is created in front of the file the editor reports as the active text editor (VS Code reports the learner's last file so while its chat view types, rows 612 and 620; Cursor while the terminal or a view does, row 656): with no fresh sign of the learner's hand in that file, Codebook focuses nothing, so the view keeps its keyboard, and says once that the Wiki opened in front of that file and where to click if the learner was typing there; fails_when=the Wiki takes the keyboard whenever it covers the reported active text editor, so the chat view loses the keyboard the learner typed the agent's request with, or nothing is told when the keyboard did fall to the page body; why_new=Cycle 0046 row 694 (the bound of the keyboard rule); seam=workspaceHarness's two columns, focusChatInSecondarySideBar or focusView (the view's keyboard, which the editor does not report), createRepositoryWikiReader, openFromAgent, keyboardInView, panelReveals and the information messages
  test(`an agent's cold Wiki open created in front of the file the editor reports active while ${situation.keyboard} has the keyboard leaves the keyboard there and says once where to click (${situation.host})`, async () => {
    // Arrange: auth.ts in front of the second group is the active text editor; the learner typed into the view since, which the editor does not report.
    const { harness } = await learnerTypingInWikiColumn(situation.host)
    if (situation.host === 'VS Code') harness.focusChatInSecondarySideBar()
    else harness.focusView()
    const { selection, books } = await publishTwoCitationWiki(harness)
    const wiki = harness.createRepositoryWikiReader()
    try {
      // Act
      await wiki.openFromAgent({
        instanceId: harness.service.instanceId,
        ...selection,
      })

      // Assert: the view keeps the keyboard, the Wiki was not revealed with it, and the learner was told once where to click.
      assert.deepEqual(
        {
          keyboardInView: harness.keyboardInView(),
          wikiRevealsWithKeyboard: harness
            .panelReveals()
            .filter(
              (reveal) =>
                reveal.kind === 'codebook.repositoryWiki' &&
                reveal.preserveFocus === false,
            ).length,
          notices: harness.informationMessages.map((notice) => notice.message),
        },
        {
          keyboardInView: true,
          wikiRevealsWithKeyboard: 0,
          notices: [
            'Codebook opened the Repository Wiki an agent asked for in front of the file you had open in its editor group. If you were typing in that file, click its tab in that group to type in it again.',
          ],
        },
      )
    } finally {
      await books.dispose()
      await harness.close()
    }
  })

// Value: protects=the fidelity of the workspace harness's panes, on which row 694's verdicts rest: a pane created without the keyboard in front of the text editor that has the keyboard hides that editor and leaves the keyboard on the page body, as both editors did natively; fails_when=the fake keeps the hidden editor's keyboard, so a test passes on a keyboard no editor has; why_new=Cycle 0046 row 694 (C60, Cursor 3.23.12 c60-663-cu2 and VS Code 1.140.0 c60-663-vs-probe: auth.ts in column 2 with the keyboard, then BODY once the Wiki was created there with preserveFocus); seam=workspaceHarness's two columns, focusMutableDraft, the fake editor's createWebviewPanel with preserveFocus, keyboardOnBody and the active text editor
test('the fake editor leaves the keyboard on the page body when a pane is created without the keyboard in front of the text editor that has it, as both editors do', async () => {
  // Arrange: auth.ts in front of the second group has the keyboard.
  const { harness } = await learnerTypingInWikiColumn('VS Code')
  try {
    const keyboardBefore = {
      keyboardOnBody: harness.keyboardOnBody(),
      activeTextEditor:
        harness.editor.window.activeTextEditor?.document.uri.path
          .split('/')
          .at(-1),
    }

    // Act
    harness.editor.window.createWebviewPanel(
      'codebook.repositoryWiki',
      'codebook · Repository Wiki',
      { viewColumn: 2, preserveFocus: true },
    )

    // Assert
    assert.deepEqual(
      {
        keyboardBefore,
        keyboardOnBody: harness.keyboardOnBody(),
        activeTextEditor: harness.editor.window.activeTextEditor,
      },
      {
        keyboardBefore: { keyboardOnBody: false, activeTextEditor: 'auth.ts' },
        keyboardOnBody: true,
        activeTextEditor: undefined,
      },
    )
  } finally {
    await harness.close()
  }
})

/**
 * Opens the first citation of the two-citation Wiki as an agent's cold codebook_open_book beside Cursor's chat part, from the precondition of row 696's native rounds: the chat input has the keyboard (Focus Agent) while Cursor names the learner's main group 2; the cold layout borrows the first group and gives the chat its keyboard back with Focus Agent, after which Cursor names group 1 while the chat has the keyboard (C60 c60-cu-7d2 0-before.json).
 * @returns The harness, its chat part, the Wiki reader, the first citation's selection and the book store to dispose.
 * @example const { harness, wiki, selection } = await agentFirstCitationBesideCursorChat()
 */
async function agentFirstCitationBesideCursorChat() {
  const { harness, chat } = await cursorBesideChatPart()
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusMutableDraft('auth.ts', 2)
  await harness.editor.commands.executeCommand('composer.focusComposer')
  const { selection, books } = await publishTwoCitationWiki(harness)
  const wiki = harness.createRepositoryWikiReader()
  await wiki.openFromAgent({
    ...selection,
    instanceId: harness.service.instanceId,
  })
  return { harness, chat, wiki, selection, books }
}

// Value: protects=an agent's second codebook_open_book of the same article's other citation beside Cursor's chat part, after its first cold open borrowed the first group and gave the chat its keyboard back: the reader's own copy shown without the keyboard is answered by Cursor's rebuild, which moves its name from the stale group 1 to the chat part's group, the part that already had the keyboard; that is no learner's move, so the open completes as row 652 designs, with one copy in the first group, and the chat keeps its keyboard; fails_when=RepositoryReader's focus receipt takes that group name change for the learner's, refuses the open with "Native focus changed during repository navigation; the newer learner focus was preserved." (RUNTIME_FAILED to the agent) and leaves the first citation's copy beside the second (C60 c60-cu-7d, c60-cu-7d2: two codebook-repository-source tabs in group 1 until Close); why_new=Cycle 0046 row 696; seam=workspaceHarness's Cursor model (cursorBesideChatPart; a rebuild for a tab opened in the main editor names the chat part's group while the chat part is the active one with its input focused), Focus Agent, createRepositoryWikiReader's openFromAgent, textDocumentShows and the first group's tabs
test("an agent's second citation open beside Cursor's chat part, after its first cold open gave the chat its keyboard back, shows its copy in place of the first and leaves the chat its keyboard", async () => {
  // Arrange: the agent's first cold open showed module.ts in the first group, and the chat has its keyboard again while Cursor names group 1.
  const { harness, chat, wiki, selection, books } =
    await agentFirstCitationBesideCursorChat()
  const namedBefore = harness.editor.window.tabGroups.activeTabGroup.viewColumn
  try {
    // Act: the agent opens the article's second citation, order.ts.
    const refusal = await wiki
      .openFromAgent({
        ...selection,
        anchorIndex: 1,
        instanceId: harness.service.instanceId,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: the open answered; order.ts is the first group's one copy, shown without the keyboard, and the chat has the keyboard.
    assert.deepEqual(
      {
        namedBefore,
        refusal,
        shows: harness.textDocumentShows(),
        firstGroup: harness.groups[0]!.tabs.map((tab) => tab.label),
        firstGroupFront: harness.groups[0]!.activeTab?.label,
        chatHasKeyboard: chat.focused(),
      },
      {
        namedBefore: 1,
        refusal: undefined,
        shows: [
          { name: 'module.ts', viewColumn: 1, preserveFocus: true },
          { name: 'order.ts', viewColumn: 1, preserveFocus: true },
        ],
        firstGroup: ['article-source.ts', 'login-form.tsx', 'order.ts'],
        firstGroupFront: 'order.ts',
        chatHasKeyboard: true,
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's newer choice of a page of the editor that is no text editor during an agent's citation open beside Cursor's chat part: the learner gives a terminal in the editor area of group 2 the keyboard while the reader shows its copy without the keyboard; the reader's own show explains only Cursor's chat part's group (row 696), so that choice refuses the open as the learner's newer focus and the terminal keeps the keyboard; fails_when=isOwnQuietCopyShowPlace takes any active tab of another group whose input is no text editor and no webview for the chat's tab (a terminal, a notebook, a notebook diff or a custom editor), adoptOwnQuietCopyShow takes the learner's group change into the receipt, and the open completes over the learner's choice; why_new=Cycle 0046 row 714 (the local CodeRabbit review of e6a3daeb..8ac142df); seam=workspaceHarness's Cursor model, Focus Agent, changeAfterNextSourceDisplay with focusEditorTerminal (the learner's terminal in group 2 right after the show), createRepositoryWikiReader's openFromAgent and the named group
test("an agent's citation open beside Cursor's chat part is refused for the learner's terminal in the editor area of another group chosen while the copy was shown", async () => {
  // Arrange: as above; the learner will give a terminal in group 2 the keyboard right after the reader shows the second copy.
  const { harness, wiki, selection, books } =
    await agentFirstCitationBesideCursorChat()
  harness.changeAfterNextSourceDisplay(() => {
    harness.focusEditorTerminal(2)
  })
  try {
    // Act
    const refusal = await wiki
      .openFromAgent({
        ...selection,
        anchorIndex: 1,
        instanceId: harness.service.instanceId,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: refused as the learner's newer focus; the terminal in front of group 2 is the named group's tab, and no text editor is active.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        refusal,
        named: named.viewColumn,
        namedFront: named.activeTab?.label,
        activeTextEditor: harness.editor.window.activeTextEditor,
      },
      {
        refusal: NAVIGATION_FOCUS_REFUSAL,
        named: 2,
        namedFront: 'bash',
        activeTextEditor: undefined,
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's first group when an agent's second citation open is refused for the learner's own newer focus (the learner clicked into notes.ts, another file of group 2, while the reader showed the copy): the refused open leaves no copy of its own behind, so the first citation's copy stays the group's one copy and notes.ts keeps the keyboard; fails_when=the refusal leaves the copy its show put in front of the first group, so two codebook-repository-source tabs stand there until Close Repository Wiki (row 683 keeps the reader's record; the copy must not stay either); why_new=Cycle 0046 row 696; seam=workspaceHarness's Cursor model, Focus Agent, changeAfterNextSourceDisplay (the learner's click into notes.ts right after the show), createRepositoryWikiReader's openFromAgent and the first group's tabs
test("an agent's citation open refused for the learner's click right after its copy was shown closes that copy again and leaves the copy before it", async () => {
  // Arrange: as above; the learner will click into notes.ts in group 2 right after the reader shows the second copy.
  const { harness, wiki, selection, books } =
    await agentFirstCitationBesideCursorChat()
  harness.changeAfterNextSourceDisplay(() => {
    harness.focusMutableDraft('notes.ts', 2)
  })
  try {
    // Act
    const refusal = await wiki
      .openFromAgent({
        ...selection,
        anchorIndex: 1,
        instanceId: harness.service.instanceId,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: refused as the learner's newer focus; module.ts is the first group's one copy again, and notes.ts has the keyboard.
    assert.deepEqual(
      {
        refusal,
        firstGroup: harness.groups[0]!.tabs.map((tab) => tab.label),
        keyboard: harness.editor.window.activeTextEditor?.document.uri.path
          .split('/')
          .at(-1),
      },
      {
        refusal: NAVIGATION_FOCUS_REFUSAL,
        firstGroup: ['article-source.ts', 'login-form.tsx', 'module.ts'],
        keyboard: 'notes.ts',
      },
    )
  } finally {
    await books.dispose()
    await harness.close()
  }
})

/**
 * Opens the workspace harness with the learner's two columns, the Study open and its pane moved by the learner into the second column, the column a cold Wiki is created in, where its document reports that it has the keyboard; no Repository Wiki is open (Cycle 0046 row 705). In Cursor beside its Agent chat part as {@link cursorBesideChatPart} opens it.
 * @param host - The editor whose model the harness runs.
 * @returns The harness.
 * @example const { harness } = await learnerUsingStudyPaneInWikiColumn('VS Code')
 */
async function learnerUsingStudyPaneInWikiColumn(host: 'VS Code' | 'Cursor') {
  const { harness } = await learnerTypingInWikiColumn(host)
  await harness.reader.open()
  harness.movePanel('codebook.studyContext', 2)
  harness.receiveContext({ type: 'pane-focus', focused: true })
  return { harness }
}

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the learner's keyboard when an agent opens an article through codebook_open_book while no Wiki is open and the learner works in the Study pane in front of the second group, the column the Wiki is created in: the Wiki covers that pane without the keyboard, the hidden pane's document loses the keyboard to the page body as a covered file does (row 694), so Codebook gives the Wiki the keyboard and says once what happened and how to use the Study pane again; the Study pane's own report that it has the keyboard is the sign that the learner works there; fails_when=RepositoryReader notes only a text editor at the entry, so the Study pane's keyboard stays on the page body and nothing is told; why_new=Cycle 0046 row 705 (the rows 686 to 701 fixer's findings); seam=workspaceHarness's two columns, the reader's open, movePanel (the learner's move of the Study pane), the pane's focus report (receiveContext pane-focus), Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat), createRepositoryWikiReader with the workspace's controls, openFromAgent, keyboardOnBody, innerFocusedPanel, panelReveals, textDocumentShows and the information messages
  test(`an agent's cold Wiki open created in front of the Study pane the learner was using gives the Wiki the keyboard and says so once (${host})`, async () => {
    // Arrange: the Study pane in front of the second group reports that it has the keyboard; no Wiki is open.
    const { harness } = await learnerUsingStudyPaneInWikiColumn(host)
    const { selection, books } = await publishTwoCitationWiki(harness)
    const wiki = harness.createRepositoryWikiReader()
    const revealsBefore = harness.panelReveals().length
    try {
      // Act
      await wiki.openFromAgent({
        instanceId: harness.service.instanceId,
        ...selection,
      })

      // Assert: the Wiki in front of the Study pane has the keyboard with one reveal, no file was shown with the keyboard, and the learner was told once.
      assert.deepEqual(
        {
          keyboardOnBody: harness.keyboardOnBody(),
          keyboard: harness.innerFocusedPanel(),
          secondGroup: harness.groups[1]!.tabs.map(
            (tab) =>
              `${tab === harness.groups[1]!.activeTab ? '*' : ''}${tab.label}`,
          ),
          wikiRevealsWithKeyboard: harness
            .panelReveals()
            .slice(revealsBefore)
            .filter(
              (reveal) =>
                reveal.kind === 'codebook.repositoryWiki' &&
                reveal.preserveFocus === false,
            ).length,
          shownWithKeyboard: harness
            .textDocumentShows()
            .filter((shown) => !shown.preserveFocus),
          notices: harness.informationMessages.map((notice) => notice.message),
        },
        {
          keyboardOnBody: false,
          keyboard: 'codebook.repositoryWiki',
          secondGroup: [
            'auth.ts',
            'Captured-overview.mts',
            'codebook · Study',
            '*codebook · Repository Wiki',
          ],
          wikiRevealsWithKeyboard: 1,
          shownWithKeyboard: [],
          notices: [
            'Codebook opened the Repository Wiki an agent asked for in front of the Study pane you were using, and the Wiki has the keyboard now. To use the Study pane again, click its tab, codebook · Study, in the same editor group.',
          ],
        },
      )
    } finally {
      await books.dispose()
      await harness.close()
    }
  })

// Value: protects=the fidelity of the workspace harness's panes, on which row 705's verdicts rest: a pane created without the keyboard in front of a pane whose document has the keyboard hides that pane, and the keyboard falls to the page body, as it does for a covered text editor (row 694, C60 in both hosts); a hidden pane's document is no longer rendered, and the page's focus falls back to its body (the HTML standard's focus fixup rule); fails_when=the fake keeps the keyboard in the hidden pane's document, so a test passes on a keyboard no document has; why_new=Cycle 0046 row 705; seam=workspaceHarness's two columns, the reader's open, movePanel, the fake editor's createWebviewPanel with preserveFocus, innerFocusedPanel and keyboardOnBody
test('the fake editor leaves the keyboard on the page body when a pane is created without the keyboard in front of the pane whose document has it', async () => {
  // Arrange: the Study pane in front of the second group has the keyboard in its document.
  const { harness } = await learnerUsingStudyPaneInWikiColumn('VS Code')
  try {
    const keyboardBefore = {
      keyboardOnBody: harness.keyboardOnBody(),
      keyboard: harness.innerFocusedPanel(),
    }

    // Act
    harness.editor.window.createWebviewPanel(
      'codebook.repositoryWiki',
      'codebook · Repository Wiki',
      { viewColumn: 2, preserveFocus: true },
    )

    // Assert
    assert.deepEqual(
      {
        keyboardBefore,
        keyboardOnBody: harness.keyboardOnBody(),
        keyboard: harness.innerFocusedPanel(),
      },
      {
        keyboardBefore: {
          keyboardOnBody: false,
          keyboard: 'codebook.studyContext',
        },
        keyboardOnBody: true,
        keyboard: undefined,
      },
    )
  } finally {
    await harness.close()
  }
})
