import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  API_VERSION,
  MAX_EXPLANATIONS,
  MAX_SESSIONS,
  MILLISECONDS_PER_SECOND,
  READER_CLOSE_STORAGE_TIMEOUT_MS,
  RECORDING_WINDOW_FOCUS_WAIT_MS,
  SOURCE_TOOK_PAUSED_FOCUS_MESSAGE,
  STUDY_CLOSE_KEYBOARD_MESSAGE,
  SUMMARY_DISPLACED_OFFER,
  SUMMARY_PLACEMENT_ACTION,
  SUMMARY_PLACEMENT_OFFER,
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
} from '../constants'
import { STUDY_UI_OPTIONS } from '../ui/constants'
import { describeUnansweredWikiChat } from '../utils/describeUnansweredWikiChat'
import { describeWikiChatErrorReply } from '../utils/describeWikiChatErrorReply'
import { savedLaterNote } from '../utils/savedLaterNote'
import { tabWithoutEditorObstacle } from '../utils/tabWithoutEditorObstacle'

/**
 * Reads the README packaged with the extension, so every test of this file compares the same document a learner gets in the VSIX; tests run from `dist/tests`.
 * @returns The README's text.
 * @example
 * const readme = await readPackagedReadme()
 * readme.includes('## Recorded walkthroughs') // => true
 */
const readPackagedReadme = (): Promise<string> =>
  readFile(join(__dirname, '..', '..', 'README.md'), 'utf8')

/**
 * Tells for each sentence whether the README holds it word for word, so a failing test names the missing sentence by its position in the list.
 * @param readme - The README's text.
 * @param sentences - The sentences the README must hold.
 * @returns One flag per sentence, in the order given: `true` when the README contains it.
 * @example
 * heldSentences('A. B.', ['A.', 'C.']) // => [true, false]
 */
const heldSentences = (readme: string, sentences: string[]): boolean[] =>
  sentences.map((sentence) => readme.includes(sentence))

// Cycle 0045 (DOC-1, DR-9, with NF-9 and NF-25): red while the Show Variables button, the summary's move in Cursor and the wait of Open replay stood in the CHANGELOG only, and no document said what a ninth MCP client replaces.
test('the packaged README names Show Variables, the Move Learning Summary offer, the wait of Open replay and what a ninth MCP client replaces', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'Study shows the hint `Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.` with a **Show Variables** button below it. One press opens Run and Debug, focuses Variables and expands its first scope, which lists the recorded values;',
    'Once per editor session, until you have taken the step in that workspace, Cursor shows the notification `Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.` with the button **Move Learning Summary…**.',
    "Cursor removes an unanswered notification by itself, so the same step stays within reach as the title action **Codebook: Move Learning Summary…** of the Learning summary view and under that name in Cursor's Command Palette.",
    "When **Show Variables** opens Run and Debug in the side bar the summary shares, the offer reads `Run and Debug took the Learning summary's place in Cursor's side bar. Move the summary to the right once to keep both in view.`, with the same button, at most once per editor session.",
    '**Open replay** pressed while another window has the desktop focus waits up to 10 seconds for the Codebook work window to gain the focus and then opens the Learning summary.',
    'Limits: 8 MCP sessions (a ninth client replaces the least recently seen idle session, a session with no request in flight; `429` is answered only when all eight are busy), 32 concurrent HTTP requests,',
    'A ninth client replaces the least recently seen idle session; `429` with `MCP session limit exceeded; every session has a request in flight. Retry after one completes.` is answered only while all eight have a request in flight: retry then.',
  ])

  // Assert: the README holds each sentence, and the product prints the texts and keeps the numbers the sentences quote.
  assert.deepEqual(delivered, [true, true, true, true, true, true, true])
  assert.equal(
    STUDY_UI_OPTIONS.nativeValuesHint,
    'Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.',
  )
  assert.equal(
    SUMMARY_PLACEMENT_OFFER,
    'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
  )
  assert.equal(
    SUMMARY_DISPLACED_OFFER,
    "Run and Debug took the Learning summary's place in Cursor's side bar. Move the summary to the right once to keep both in view.",
  )
  assert.equal(SUMMARY_PLACEMENT_ACTION, 'Move Learning Summary…')
  assert.equal(RECORDING_WINDOW_FOCUS_WAIT_MS, 10_000)
  assert.equal(MAX_SESSIONS, 8)
})

// Cycle 0045 (DOC-4, X7-A.2): red while the README said that a session the editor starts slower than five seconds needs a reopen, that closing still waits for the saved position without a bound, and that every left lock is resolved by hand.
test("the packaged README says that a slow historical session is adopted, that closing waits five seconds in all for its writes and that a dead writer's lock is taken over", async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const corrected = heldSentences(readme, [
    'If the editor needs more than five seconds to start the historical session, the moment that waited for it fails, and the session is adopted when its start completes: the next moment is presented without reopening the recording.',
    'If the editor does not stop the historical session within five seconds, the session becomes unavailable and reopening the learning replay starts a new one.',
    "It waits at most five seconds in all for its pending storage writes (a running study's final checkpoint, the saved replay position, the archive writes and the library queue); a write still pending then keeps running and the reader closes.",
    'A lock whose process is gone on this machine is taken over: the next setup, update or removal removes it by itself, one window at a time, and resumes the journal.',
    'A lock whose process is gone on this machine (an editor that was killed) is taken over by the next write, by one window at a time, and causes no refusal.',
    'For such a lock the manual steps remain: preserve the skill/config and their private recovery records.',
  ])
  const retired = [
    'If the editor does not start or stop the historical session within five seconds',
    "it still waits for the learner's saved position",
    'The file contains a PID.',
  ].filter((sentence) => readme.includes(sentence))

  // Assert
  assert.deepEqual(corrected, [true, true, true, true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(READER_CLOSE_STORAGE_TIMEOUT_MS, 5_000)
})

// Cycle 0045 (LK-README): red while both lock passages quoted the refusal without the lock file it names since package LK.
test("the packaged README quotes the storage lock's refusal with the lock file it names, for the Cursor skill's lock and for the learning storage", async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const refusal =
    '`Learning storage is locked by another writer or an interrupted session (lock file: <path>). No data changed; retry after resolving the lock.`'

  // Act
  const quotations = readme.split(refusal).length - 1
  const oldQuotations =
    readme.split(
      'Learning storage is locked by another writer or an interrupted session. No data changed',
    ).length - 1

  // Assert
  assert.equal(quotations, 2)
  assert.equal(oldQuotations, 0)
})

// Cycle 0045 (S1a-F2): red while the README said that a focused editor that is no text editor refuses a presentation selection; since cause 7 such a tab is admitted, stays where it is and gets its focus back.
test('the packaged README says that a focused tab that is no text editor is admitted and gets its focus back, and names the two focused tabs that still refuse a selection', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const corrected = heldSentences(readme, [
    "A focused tab that is neither a text editor nor a Codebook pane (an agent chat, a settings page, an image) does not refuse a selection or a restore: the tab is never closed or moved, and its editor group gets the keyboard focus back once the panes are arranged (Cursor's Agent chat through Cursor's own focus command).",
    'An edited or non-text preview tab (for example the Welcome page) is preserved and refuses the change.',
    'A `select` decides every refusal it can foresee first (for example a focused preview tab) and then closes nothing.',
    'When a leftover captured-source tab stays and keeps the focus, the selection is refused with `The presentation was not changed: the focused tab "<name>" in editor group <n> has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.` and the cause `A leftover captured source tab could not be closed.`',
  ])
  const retired = [
    'a focused foreign non-text editor',
    'an unsupported focused editor',
    'or focus a Codebook/text pane, before retrying',
    'the ordinary focus refusal',
  ].filter((phrase) => readme.includes(phrase))

  // Assert: the README's refusal is the one the reader gives for such a tab.
  assert.deepEqual(corrected, [true, true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(
    tabWithoutEditorObstacle('<name>', 1).replace(
      'editor group 1',
      'editor group <n>',
    ),
    'The presentation was not changed: the focused tab "<name>" in editor group <n> has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.',
  )
})

// Cycle 0045 (P1-F1): red while the README named API 1.5 as the current one in two places and did not say what API 1.6 added.
// Cycle 0046 (rows 44 and 54): red while the README named API 1.6 as the current one, its summary of 1.6 left out numberedText on the source answers, and it said those answers still carry text.
test('the packaged README names API 1.7 as the version the server reports, says that 1.7 took text out of the source answers and what API 1.6 added', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const current = heldSentences(readme, [
    '## Shared presentations (API 1.7)',
    "The interface arrived with API 1.5, and API 1.6 and 1.7 changed nothing in it: 1.6 added fields to a configured run's resources, an answer option to its continuation and `numberedText` to the source answers, and 1.7 removed `text` from those source answers (see [Run one configured repository action](#run-one-configured-repository-action)).",
    'with **MCP API 1.7** (`codebook_status` reports the installed build).',
    "API 1.7 changed two answers: `codebook_source`, and `codebook_read_resource` for a book's cited source, answer the source's lines as `numberedText` and no longer as `text`, because the two copies doubled every source answer. An MCP `resources/read` of a cited source's URI still answers its exact text. No request states an API version, so a client written for API 1.6 gets these answers too: where it read `text`, it reads `numberedText` (each line after its one-based number and a tab, the lines joined by a line feed).",
    'API 1.6 added, without changing the meaning of an existing field: `declaredSource`, the position you declared (`requestedSource` is its older name); `armed`, the place Codebook requested the breakpoint at when that differs; `place`, one sentence that names the line a stop paused on when the debugger bound it on another line than you declared; and `answer: "next"` in the run resource\'s `continueArguments`, with which a continuation answers with the next state (the next observation, the observed result or the failure).',
    "API 1.6 also added `numberedText` to the answer of `codebook_source` and to the answer of `codebook_read_resource` for a book's cited source: the source's lines, each after its one-based number and a tab.",
    "Each result contains the path, the SHA-256 of the file's full bytes, a line count and `numberedText`: the source's lines, each after its one-based number and a tab. The lines are answered once; since API 1.7 the result has no `text` beside them.",
    "A book's cited source read through `codebook_read_resource` answers `numberedText` in place of its text as well; an MCP `resources/read` of that source's URI answers the exact text.",
  ])
  const namesOlderApiAsCurrent = /\(API 1\.[56]\)|\*\*MCP API 1\.[56]\*\*/.test(
    readme,
  )
  const saysSourceAnswerHoldsText = [
    'Each result contains exact UTF-8 text',
    'the same lines as `text`',
    'answers its `numberedText` too',
  ].filter((phrase) => readme.includes(phrase))

  // Assert
  assert.equal(API_VERSION, '1.7')
  assert.deepEqual(current, [true, true, true, true, true, true, true, true])
  assert.equal(namesOlderApiAsCurrent, false)
  assert.deepEqual(saysSourceAnswerHoldsText, [])
})

// Value: protects=a learner who presses Update LLM Wiki in VS Code reading why the update ended after half a minute and what a refused start keeps; fails_when=the update table says again that the watch starts with the request, or that every failed update kept a site; why_new=Cycle 0046 row 56: rows 3 and 22 changed both and the table still described 0.2.29.0; seam=none
test('the packaged README says that a VS Code update waits 30 seconds for the chat’s first answer before it watches, and that a folder without a Wiki names no kept site', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'VS Code: the request went to a new chat. Codebook waits up to 30 seconds for the first sign that the chat works on it (its reply or its wait for a confirmation, a file of the Wiki or of the Codebook skill that it opens, the publisher it runs in a terminal, or a folder the publisher prepares beside the Wiki) and then watches the output folder for up to 15 minutes.',
    "In VS Code an update without such a sign within 30 seconds ends with `Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.` A chat that answers the request with an error ends it at once with `The editor chat answered the update request with an error and stopped (…). Read its message in the Chat view, then press Update LLM Wiki again.`, the chat's message in the brackets; a chat that finishes its reply without publishing ends it with `The editor chat finished its reply without publishing a new Wiki. Read its reply in the Chat view, then press Update LLM Wiki again.`",
    'The last usable site is kept, and the sentence says so; in a folder that has no Wiki yet it says to generate one first and names no kept site.',
  ])
  const retired = [
    'VS Code: the request is in the chat and Codebook watches the output folder for up to 15 minutes.',
    'The run ended without a new site. The last usable site is kept.',
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README names the bound the editor enforces.
  assert.deepEqual(delivered, [true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(WIKI_CHAT_OPEN_TIMEOUT_MS / MILLISECONDS_PER_SECOND, 30)
  assert.equal(
    describeWikiChatErrorReply('…'),
    'The editor chat answered the update request with an error and stopped (…). Read its message in the Chat view, then press Update LLM Wiki again.',
  )
})

// Value: protects=a learner who presses Update LLM Wiki in VS Code reading where the request goes (a new chat, not the chat they use), where their own chat went, what Codebook does to the chat at the 30 seconds, and what an editor without New Chat does instead; fails_when=the README describes a request typed into the learner's chat, or a withdrawal that removes queued requests in every editor, or names another sentence than the product prints; why_new=Cycle 0046 rows 82 and 129; seam=none
test('the packaged README says that a VS Code update sends its request into a new chat, where the learner’s chat went, what the Cancel at the 30 seconds acts on, and what an editor without New Chat does', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "In VS Code the update's request does not go into the chat you are using: Codebook reveals the chat, runs the editor's **New Chat** and sends the request into that new chat, so a request of yours that is in progress, waits for a confirmation or is queued is neither stopped nor held back, and the update does not wait behind it.",
    "Your chat is not closed: with a request in progress or waiting for a confirmation it goes on in the background, and you return to it from the Chat view's session list (its chat history). New Chat closes the diff editors that show that chat's edits; the edits stay.",
    "When Codebook sees no sign within those 30 seconds, it stops its request with the chat's own Cancel before it shows the sentence, so a chat that was only slow does not go on with no watch, and it removes nothing from a queue. Your own work in the window (a file you open, a command you run) is not taken for a sign.",
    'The Cancel acts on the chat you focused last and on the session it shows: if you showed another session there or focused another chat within those 30 seconds, it stops the request in progress there.',
    'If Codebook did not see its request end, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.` instead.',
    'Every supported VS Code (1.120 and later) has New Chat. An editor without that command gets the request in the chat that is open, where it acts like a message you typed: it waits in the queue behind a request in progress, and the editor cancels a request that waits for a confirmation. At the 30 seconds Codebook then removes the requests queued in that chat, its own and yours, before it uses the Cancel, and the sentence ends `The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.`',
  ])
  const retired = [
    'Codebook takes its request back before it shows the sentence',
    "Requests of your own that wait in that chat's queue are removed with it, and a request of yours that is in progress there is left alone.",
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README holds each sentence, and the product prints the sentences it quotes.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(
    describeUnansweredWikiChat('withdrawn', 'own', WIKI_CHAT_OPEN_TIMEOUT_MS),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
  )
  assert.equal(
    describeUnansweredWikiChat('left', 'own', WIKI_CHAT_OPEN_TIMEOUT_MS),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.',
  )
  assert.equal(
    describeUnansweredWikiChat(
      'withdrawn',
      'shared',
      WIKI_CHAT_OPEN_TIMEOUT_MS,
    ),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=a client author reading the same limit of explanations the service enforces and an agent reads in its refusal; fails_when=the README counts "explanation intents" again, or names another number than the budget; why_new=Cycle 0046 row 56: row 25 reworded the refusal to "explanation budget (32 keys)" and the README kept the old words; seam=none
test('the packaged README states the run’s explanation budget of 32 keys and what a spent budget refuses', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const statesBudget = readme.includes(
    'an explanation budget of 32 keys/run (a key Codebook already accepted answers its receipt again, and a new key is refused once the budget is spent), 8,192 characters and up to 10 distinct captured paths;',
  )

  // Assert
  assert.equal(statesBudget, true)
  assert.equal(readme.includes('32 explanation intents/run'), false)
  assert.equal(MAX_EXPLANATIONS, 32)
})

// Value: protects=a learner and a client author finding in the README three things only the CHANGELOG named: the rail's entry that opens a page's source, the Update anyway button and the save-learning-summary step; fails_when=the README loses one of them, or states another bound than the product keeps; why_new=Cycle 0046 row 45 (Cycle 0045, documentation audit DA-2); seam=none
test('the packaged README names the rail entry Open in VS Code or Open in Cursor, the Update anyway button and the save-learning-summary step of a run resource', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "Under the outline in the right rail every page has the entry **Open in VS Code**, or **Open in Cursor** when Cursor serves the page. It opens the page's first cited source at its cited line in that editor and names that file and line under its label.",
    'A page opened from disk keeps the entry as it was published: **Open in VS Code**, which opens VS Code, and for a site published by 0.2.29.0 without the file and line.',
    '| Update failed, and the sentence names **Update anyway**',
    'An earlier chat may still be updating this Wiki, so no agent was asked: the VS Code chat of this window or of another window after its watch stopped, or a candidate folder written within the last 15 minutes. The sentence names the time Codebook waits until.',
    "Wait until that time, or, if that chat was stopped, press **Update anyway** in the editor's notification. It starts the update past what that notification named; anything that appeared since is named in a new notification. Another window's running update offers no **Update anyway**: wait for it to finish.",
    "While no explanation of a stopped run with a demonstrated result carries a learning summary, the run resource lists `save-learning-summary` in `nextActions` and gives the step as `saveLearningSummary`: call `codebook_explain` on a committed snapshot of the run with a new key and a complete `learningSummary` whose final step is observed and cites the run resource's `terminalReference`. Once the run's 32 explanation keys are spent the action is no longer listed, and `saveLearningSummary` says that the saved study will have no learning summary.",
  ])

  // Assert: the README holds each sentence, and the product keeps the bounds they name.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.equal(WIKI_UPDATE_WATCH_TIMEOUT_MS, 900_000)
  assert.equal(MAX_EXPLANATIONS, 32)
})

// Value: protects=a learner who reads one of the two keyboard notices finding in the README when Codebook shows it, in which editor and chat layout, and that it comes once in an editor session; fails_when=the README loses a notice, quotes another sentence than the reader shows, or still says that a close beside the learner's own file shows nothing and that Cursor shows no sentence at a pause; why_new=Cycle 0046, found by package DOA: rows 1 and 5 added the two notices and no document named them; rewritten with rows 5 (Cursor half) and 66, which changed both sentences and when they are told; seam=none
test('the packaged README quotes the notice of Close Study Workspace about the keyboard and the notice of a Codebook pane that took the keyboard at a pause as the reader shows them, and says in which editor and chat layout each is told', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    '**Codebook: Close Study Workspace** run in the focused window while a Codebook pane, the captured source or your own file is the active editor gives the active editor group the keyboard once the panes are closed, in VS Code and in Cursor: closing the panes can otherwise leave the keyboard on no element.',
    'The first time in an editor session, Codebook says so: `Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.`',
    'A close made while Cursor shows its Agent chat as an editor tab and that chat has the keyboard moves nothing and shows nothing, and so does a close in a window that does not have the focus.',
    "When a live run pauses, the editor's debugger opens the paused file with the keyboard. The first time in an editor session that a Codebook pane (the Application pane or the captured source) takes that file's place and Codebook knows of no chat to give the keyboard back to, it says where the keyboard is: `The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.`",
    'That is so in VS Code, in Cursor while its Agent chat is a pane of the secondary side bar, and in Cursor with the chat as an editor tab when you were working in a file or another tab before the pause.',
    'Where Cursor shows its Agent chat as an editor tab and that chat had the keyboard before the pause, Codebook gives the keyboard back to the chat at that pause, and shows no sentence.',
  ])

  // Assert: the README holds each sentence, and the reader shows the sentences it quotes.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.equal(
    STUDY_CLOSE_KEYBOARD_MESSAGE,
    'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
  )
  assert.equal(
    SOURCE_TOOK_PAUSED_FOCUS_MESSAGE,
    'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
  )
})

// Cycle 0045 (B2-README): red while step 8 named the arming failure as the only cause of a continuation that sends no resume; the help gives both since row B-L4.
test('the packaged README gives both reasons of a continuation that sends no resume, as the help does', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const givesBothReasons = readme.includes(
    "The next declared stop is armed inside that continuation; if it cannot be armed, or that stop is the other participant's and that participant's earlier pauses cannot be read, that `codebook_continue` answers `Continue was not confirmed.` with the error as its cause and sends no resume; the run ends with a reason that begins `Next declared stop was not armed and no resume was sent` or `Next declared stop could not be continued to` (read the run resource), and earlier observations stay. The second reason names no declaration to change: start a new run.",
  )

  // Assert
  assert.equal(givesBothReasons, true)
})

// Cycle 0045 (P2-README, cause 10): red while the replay step described the notes of an explanation saved later without quoting them as the pane prints them.
test('the packaged README quotes the three notes of an explanation saved later than the selected time as the Study pane prints them', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const quotesNotes = readme.includes(
    'The notes read `This explanation was saved while this pause was held.`, `This explanation was saved after this pause ended.` and `This explanation was saved after the recording ended.`',
  )
  const printed = [
    savedLaterNote('while-pause-held'),
    savedLaterNote('after-pause-ended'),
    savedLaterNote('after-recording-ended'),
  ]

  // Assert
  assert.equal(quotesNotes, true)
  assert.deepEqual(printed, [
    'This explanation was saved while this pause was held.',
    'This explanation was saved after this pause ended.',
    'This explanation was saved after the recording ended.',
  ])
})

// Cycle 0045 (CR-6): red while the note on build.dirty ran into the removal step, which had lost its list number.
test('the packaged README keeps the removal of the managed Cursor skill as step 4 of the chat setup, after the note on build.dirty', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const lines = readme.split('\n')
  const noteLine = lines.findIndex((line) =>
    line.startsWith('   `codebook_status.build.dirty` reports'),
  )
  const removalLine = lines.findIndex((line) =>
    line.startsWith(
      '4. To remove a Codebook-owned Cursor user skill, run **Codebook: Remove Managed Cursor Skill**',
    ),
  )
  const note = lines[noteLine] ?? ''

  // Assert: the note is its own paragraph under step 3 and ends where it ends; step 4 begins a line two lines below it.
  assert.equal(
    note.endsWith('confirm that separately before describing its Git state.'),
    true,
  )
  assert.equal(removalLine - noteLine, 2)
  assert.equal(noteLine > 0, true)
})
