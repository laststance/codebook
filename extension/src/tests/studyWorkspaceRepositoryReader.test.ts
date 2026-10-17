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
