import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  API_VERSION,
  LEARNER_SIGN_FRESH_MS,
  MAX_EXPLANATIONS,
  MAX_SESSIONS,
  MILLISECONDS_PER_SECOND,
  MS_PER_MINUTE,
  PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
  READER_CLOSE_STORAGE_TIMEOUT_MS,
  RECORDING_WINDOW_FOCUS_WAIT_MS,
  SOURCE_TOOK_PAUSED_FOCUS_MESSAGE,
  STORAGE_LOCK_UNWRITTEN_GRACE_MS,
  STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS,
  STUDY_CLOSE_KEYBOARD_MESSAGE,
  SUMMARY_DISPLACED_OFFER,
  SUMMARY_PLACEMENT_ACTION,
  SUMMARY_PLACEMENT_OFFER,
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS,
  WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS,
  WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS,
  WIKI_UPDATE_MARKER_WRITE_GRACE_MS,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
} from '../constants'
import { STUDY_UI_OPTIONS } from '../ui/constants'
import { cursorCatalogCleanupNotice } from '../utils/cursorCatalogCleanupNotice'
import { describeRefusedSkillLink } from '../utils/describeRefusedSkillLink'
import { describeUnansweredWikiChat } from '../utils/describeUnansweredWikiChat'
import { describeWikiChatErrorReply } from '../utils/describeWikiChatErrorReply'
import { describeWikiChatHandOver } from '../utils/describeWikiChatHandOver'
import { describeWikiChatWatch } from '../utils/describeWikiChatWatch'
import { pagePauseUnderResumeText } from '../utils/pagePauseUnderResumeText'
import { savedLaterNote } from '../utils/savedLaterNote'
import { startOverBy } from '../utils/startOverBy'
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

// Value: protects=a learner who meets a storage lock that stays reading what the lock records, how a window of this build judges it and which locks are never taken over; fails_when=a lock passage describes the judgement of 0.2.29.0 again (a lock whose process id is in use stays, a lock of another system of this computer is removed by itself), or names another time for an empty lock than the product keeps; why_new=Cycle 0046 row 119: rows 2, 9, 58 and 65 changed the judgement and both passages still described 0.2.29.0; seam=none
test('the packaged README says in both lock passages what a storage lock records, that a window of this build judges it by the start of its writer’s process, also when another process has its process id, and that a lock of another system of this computer stays', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "The lock records its writer's process id and when that process began, the host name, two digests that stand for the machine (of the host name, and of the editor's machine id where the window has one), the boot and, in a local window, the editor's machine id.",
    "A window of this build judges a lock that names this machine by the start of its writer's process: the lock counts as left behind when no process has its process id any more, when the process that has that id now began at another time (the id went to another process), or, on Linux, when the lock names another boot of the kernel than the running one. A correction of the clock changes none of this.",
    'A lock without a process start (written by 0.2.29.0, or by a window that could not read its own start) is judged as 0.2.29.0 judged it, by its process id and its boot.',
    'A lock that was created and stayed empty for 10 seconds counts as left behind too.',
    'A lock stays when its writer may still be alive: a process that still runs, a lock written on another host (a home directory shared between machines), a lock written by an editor of another system of this computer (a Windows window and a WSL window that reach the same file: they share the host name, and a process id of one names another process, or none, in the other), or a file without a readable owner record.',
    'means that another Codebook window is writing, or that a lock stays whose writer may still be alive: a process that still runs, a lock written on another host, a lock written by an editor of another system of this computer (a Windows window and a WSL window that reach the same file), or a file without a readable owner record.',
    "The lock records its writer's process id and when that process began, with the host name, two digests that stand for the machine and the boot, and a window of this build judges it by that start: a lock whose process id another process has since is taken over as well, because that process began at another time.",
    'For a lock that stays, make sure that no Codebook window on any host or system still writes to this storage, then move the named file away and retry ([What a lock or an update marker cannot tell](#what-a-lock-or-an-update-marker-cannot-tell) lists the limits).',
  ])
  const retired = [
    "The lock records its writer's process id, host name, boot and, in a local window, the editor's machine id; it counts as left behind when it names this machine and either an earlier boot or a process id that no longer exists",
    'a lock written on another host, or a file without a readable owner record.',
    'make sure that no Codebook window on any host still writes to this storage',
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README holds each sentence, none of 0.2.29.0's, and the time the product keeps for an empty lock.
  assert.deepEqual(delivered, [true, true, true, true, true, true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(STORAGE_LOCK_UNWRITTEN_GRACE_MS / MILLISECONDS_PER_SECOND, 10)
})

// Value: protects=a learner who finds the file of a running Wiki update in the project folder, or whose update is refused because of another window, reading what the file holds, that it names no computer, host or user in clear, and how long a marker counts that no window here can judge; fails_when=the README loses the marker's paragraphs, or names another longest time than the product computes for Cursor and VS Code; why_new=Cycle 0046 row 119 (amendment ER-14): no document described the marker; seam=none
test('the packaged README says what the marker of a running Wiki update holds, that it names no computer, host or user in clear, that a killed window’s marker does not refuse a start, and that a marker nobody here can judge counts for at most 21 minutes in Cursor and 21 minutes 30 seconds in VS Code', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act: the two paragraphs under "LLM Wiki: open and update", whole.
  const delivered = heldSentences(readme, [
    "While an update runs, its window keeps a marker file beside the output folder, `<folder>.update-run.json` (`.codebook/wiki.update-run.json` unless the setting names another folder), so that a second editor window on the same project does not start a second update. That window's start is refused with `Another editor window is updating this Wiki (<editor>, started <time>). Wait for it to finish, then press Update LLM Wiki again.` The marker usually lies in your project folder, so it holds nothing that names the computer, its host or its user in clear: it records the process id of the window's extension host and when that process began, a random id of the window, the editor, the time the run started, the kernel's boot id on Linux, and two digests that stand for the machine. A digest is a pseudonym and no secret: a commit of the file publishes it, and the digest of a common host name can be found by trying names. When the run ends, its window removes the marker; after a stopped VS Code watch the file stays as that window's note that the chat may still publish, and the window removes it later or the next update does.",
    "A marker that a killed editor left on this machine does not refuse a start: a window of this build judges a marker by the start of its owner's process, so the marker counts as nobody's when that process is gone and also when another process has its process id since, and the next start removes it. A marker whose owner cannot be judged here counts until its run's longest time has passed at the latest: 21 minutes after the run began for Cursor and 21 minutes 30 seconds for VS Code (the 15 minutes of a run, in VS Code after the 30 seconds for the chat's first answer, then 1 minute, then the 5 minutes by which two clocks may differ). That is a marker written on another computer (a project folder shared between machines), in another system or another pid namespace of this computer (a Windows window beside a WSL window, another WSL distribution, a container), where its process id means another process, or by 0.2.29.0 when a process still has its process id. [What a lock or an update marker cannot tell](#what-a-lock-or-an-update-marker-cannot-tell) lists the limits.",
  ])
  const longestCursorMarkerMs =
    WIKI_CURSOR_UPDATE_TIMEOUT_MS +
    WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS +
    WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS
  const longestVsCodeMarkerMs =
    WIKI_CHAT_OPEN_TIMEOUT_MS +
    WIKI_UPDATE_WATCH_TIMEOUT_MS +
    WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS +
    WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS

  // Assert: both paragraphs, and the file name and the times the product keeps: 21 minutes, 21 minutes 30 seconds, and their parts.
  assert.deepEqual(delivered, [true, true])
  assert.equal(WIKI_UPDATE_RUN_MARKER_SUFFIX, '.update-run.json')
  assert.equal(longestCursorMarkerMs, 1_260_000)
  assert.equal(longestVsCodeMarkerMs, 1_290_000)
  assert.equal(WIKI_CURSOR_UPDATE_TIMEOUT_MS, 900_000)
  assert.equal(WIKI_UPDATE_WATCH_TIMEOUT_MS, 900_000)
  assert.equal(WIKI_CHAT_OPEN_TIMEOUT_MS, 30_000)
  assert.equal(WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS, 60_000)
  assert.equal(WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS, 300_000)
})

// Value: protects=a learner or a maintainer who needs to know where a storage lock and the Wiki update marker stop protecting: beside a window of 0.2.29.0, across hosts and systems, with equal host names, with clocks apart, without hard links, with a suspended window, and on the systems nobody observed; fails_when=the README loses a limit, or names another number than the product keeps (60 seconds of a claim, 2 seconds of a marker being written, 5 minutes between clocks, a minute between boot times); why_new=Cycle 0046 row 119: amendment ER-14 asked the README to carry these statements and none was written; seam=none
test('the packaged README states the limits of a storage lock and of the Wiki update marker: a window of 0.2.29.0 on the same folder, another host or system, two computers with one host name, clocks more than 5 minutes apart, a file system without hard links, a suspended window, and the systems observed', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act: the heading, the paragraph under it and its seven limits, each whole.
  const delivered = heldSentences(readme, [
    '### What a lock or an update marker cannot tell\n',
    "Two files keep editor windows from writing at the same time: `writer.lock` in each private storage folder (the learning storage, the Cursor skill and its catalog) and the marker of a running Wiki update beside the Wiki folder ([LLM Wiki: open and update](#llm-wiki-open-and-update)). Between windows of this build a lock, a marker and the claim a window holds for the moment in which it removes or replaces one of them are judged by the start of the owner's process. The limits:",
    "- **A window of 0.2.29.0 on the same storage or project folder.** That window writes and judges as 0.2.29.0 did, so beside it the guarantees are those of 0.2.29.0. Its lock, its marker and its claim name no process start: this build judges such a lock by its process id and its boot, such a marker by its process id alone, and removes such a claim once it is 60 seconds old. The older window judges the files of this build in its own way: a lock or a marker whose process id went to another process stays for it, where the boot is a computed time (macOS, Windows) a clock set forward by more than a minute while a lock is held can make it take over that lock although its writer still runs, it removes a claim after 60 seconds although the claim's window still runs, it creates its marker in place, so that the file is empty for the time of one write, and when it finds no marker under its claim it removes the marker another window has just written. Update every window to leave these limits behind.",
    "- **Another host, another system.** A lock or a marker written on another computer, or by an editor of another system of this computer (a Windows window beside a WSL window), is not judged by a process here, because its process id means another process there. Such a lock stays until you move it away; such a marker counts until its run's longest time has passed at the latest, and a claim on it for 60 seconds. For a marker and its claim, another pid namespace of this computer (another WSL distribution, a container) is such a system too.",
    "- **Two computers with one host name.** A marker names its machine by digests, and the digest of the host name is the one VS Code and Cursor on one computer share. Two computers with the same host name on one shared project folder therefore look like one machine to the marker: each judges the other's marker by its own processes and its own boot, and a second update can start beside a running one.",
    "- **Clocks.** The marker's times allow the clocks of two windows, or one clock before and after a correction, to differ by 5 minutes. Computers whose clocks differ by more, a clock that moves by more during an update and a computer that sleeps for longer during one are not covered: a second update can start beside a running one.",
    '- **A file system without hard links.** A lock or a marker is written beside its path and then linked into place, so it never exists without its content. Where the file system cannot link, the file is created in place and is empty for the time of one write. Another window takes an empty marker younger than 2 seconds for one that is being written and refuses its own start, which narrows that race without closing it.',
    '- **A suspended window.** A window that is suspended in the instant between the check of its claim and its change of the marker can still remove or replace a marker that another window wrote meanwhile.',
    "- **Systems observed.** The judgement by the process start was observed in editors on Linux, for the update marker: the marker of a killed window did not refuse the other editor's start. On macOS and in a Windows editor it has not been observed, for a lock or for a marker: tests cover it there, for Windows on a Windows runner and for macOS with a stand-in for the `ps` query.",
  ])

  // Assert: every limit, and the numbers the product keeps for them.
  assert.deepEqual(delivered, [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ])
  assert.equal(WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS / MILLISECONDS_PER_SECOND, 60)
  assert.equal(WIKI_UPDATE_MARKER_WRITE_GRACE_MS / MILLISECONDS_PER_SECOND, 2)
  assert.equal(WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS / MS_PER_MINUTE, 5)
  assert.equal(STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS / MS_PER_MINUTE, 1)
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

// Value: protects=an agent's author reading in the packaged README both sentences a run can answer with after its saved study was removed, and that the second came with API 1.7; fails_when=the README names only "The learner moved this saved study to the Trash.", so the reason of a removal by hand is in no document of the agent's contract; why_new=Cycle 0046 row 201; seam=none
test('the packaged README names, in API 1.7’s changes and under Delete a saved study, the reason a run answers with after its study was removed by hand or in another window', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const named = heldSentences(readme, [
    "API 1.7 also added a second reason a run resource names, and its evidence is refused with, once the run's saved study was removed: `The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.`, beside `The learner moved this saved study to the Trash.` for a study deleted in this window (see [Delete a saved study](#delete-a-saved-study)).",
    "- When a study's files were removed by hand (the only way in a window without a Trash) or the study was deleted in another Codebook window, the next **Retry storage / refresh** finds its archive gone. An agent that then reads a run of this window whose study that was, or adds an explanation to it, gets `EVIDENCE_UNAVAILABLE` with `The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.`; the run resource still answers and names the same reason.",
    "- After the removal an agent that reads the run's evidence (`manifest`, `events`, observations, explanations) or adds an explanation gets `EVIDENCE_UNAVAILABLE` with `The learner moved this saved study to the Trash.`; the run resource itself still answers and names the same reason.",
  ])

  // Assert
  assert.deepEqual(named, [true, true, true])
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
    "In VS Code the update's request does not go into the chat you are using, with the one exception named below: Codebook reveals the chat, runs the editor's **New Chat** and sends the request into that new chat, so a request of yours that is in progress, waits for a confirmation or is queued is neither stopped nor held back, and the update does not wait behind it.",
    "Your chat is not closed: with a request in progress or waiting for a confirmation it goes on in the background, and you return to it from the Chat view's session list (its chat history). New Chat closes the diff editors that show that chat's edits; the edits stay.",
    "When Codebook sees no sign within those 30 seconds, it stops its request with the chat's own Cancel before it shows the sentence, so a chat that was only slow does not go on with no watch, and it removes nothing from a queue. Your own work in the window (a file you open, a command you run) is not taken for a sign.",
    'The Cancel acts on the chat you focused last and on the session it shows: if you showed another session there or focused another chat within those 30 seconds, it stops the request in progress there.',
    'If Codebook did not see its request end, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.` instead.',
    "Every supported VS Code (1.120 and later) has New Chat. An editor without that command gets the request in the chat that is open, where it acts like a message you typed: it waits in the queue behind a request in progress, the editor cancels a request that waits for a confirmation, and a draft in the chat's input is replaced; the confirmation says so there. At the 30 seconds Codebook then removes the requests queued in that chat, its own and yours, before it uses the Cancel, and the sentence ends `The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.`",
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

// Value: protects=a learner reading, before they press Update LLM Wiki, what the editor's confirmation will tell them: a new chat starts, the open chat keeps its place, a draft in an empty chat is replaced; fails_when=the README quotes another confirmation than the product shows, or says nothing about the command, which starts without one; why_new=Cycle 0046 rows 197 and 198; seam=none
test('the packaged README quotes the confirmation of a VS Code update word for word and says what the command, which asks nothing, does to the chat and to a draft', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const confirmation = describeWikiChatHandOver([
    'workbench.action.chat.open',
    'workbench.action.chat.newChat',
  ])

  // Act
  const delivered = heldSentences(readme, [
    `The button asks for confirmation in the editor first; in VS Code the confirmation says where the request goes: \`${confirmation}\` The command starts at once and asks nothing: its request goes into a new chat in the same way and replaces a draft in an empty chat in the same way, and the notification that watches the update says where the request is.`,
  ])

  // Assert
  assert.equal(
    confirmation,
    'Copilot Chat receives the update request for this project in a new chat; the chat you have open keeps its place in the chat list. If the Chat view has not been opened in this window yet, the request may go into the chat it restores. A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.',
  )
  assert.deepEqual(delivered, [true])
})

// Value: protects=a learner reading when Codebook stops watching a VS Code update and what to do after they refused a step of the chat; fails_when=the update table no longer names the ends of the watch, or leaves out that a refused step is followed by Cancel and, at the next update, by Update anyway; why_new=Cycle 0046 row 217; seam=none
test('the packaged README says when the watch of a VS Code update ends and that a learner who refused a step of the chat ends it with Cancel', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "The watch ends when the new Wiki is published, when the chat's reply ends before the chat asked you to approve a step, when you press Cancel in the notification, or after those 15 minutes.",
    'If you refuse a step, press Cancel in the notification: once the chat has asked you, Codebook does not see it stop, and would watch for the 15 minutes.',
    'Stop the chat itself to cancel the update. If it has already stopped (you refused a step), press **Update anyway** when you update again.',
  ])

  // Assert: the README holds each sentence, and the notification names the same bound.
  assert.deepEqual(delivered, [true, true, true])
  assert.equal(
    describeWikiChatWatch('own', WIKI_UPDATE_WATCH_TIMEOUT_MS),
    'Watching for the LLM Wiki update in a new chat (in the chat the Chat view restored, if it opened only now); the chat you had open keeps its place in the chat list. The watch ends when the new Wiki is published, after 15 minutes, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.',
  )
})

// Value: protects=a learner reading the two cases in which the update's request does not get a new chat of the Chat view, and the sentence of a chat that never held the request; fails_when=the README says without exception that the request does not go into a chat of the learner's, although a Chat view that opens only now sends it into the chat it restores and a chat in an editor tab gets the new chat in its tab, or it quotes two of the three sentences of the bound; why_new=Cycle 0046 row 261; seam=none
test('the packaged README names the Chat view that opens only now and the chat in an editor tab as limits of the new chat, and quotes the sentence of a chat that never held the request', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'Two limits, the first of them that exception. When the Chat view has not been opened in the window yet, it may still be restoring your last chat while New Chat runs: New Chat then does nothing, and the request goes into that restored chat; the confirmation and the notification name this case.',
    'When the chat you focused last is a chat in an editor tab, the new chat starts in that tab, and the chat that was shown there keeps its place in the chat list.',
    "If the chat's command had returned without the chat taking a request, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.`",
  ])

  // Assert: the README holds each sentence, and the product prints the sentence and names the case in its confirmation and its notification.
  assert.deepEqual(delivered, [true, true, true])
  assert.equal(
    describeUnansweredWikiChat('not-sent', 'own', WIKI_CHAT_OPEN_TIMEOUT_MS),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
  )
  assert.equal(
    describeWikiChatHandOver(['workbench.action.chat.newChat']).includes(
      'If the Chat view has not been opened in this window yet, the request may go into the chat it restores.',
    ),
    true,
  )
  assert.equal(
    describeWikiChatWatch('own', WIKI_UPDATE_WATCH_TIMEOUT_MS).includes(
      'in a new chat (in the chat the Chat view restored, if it opened only now)',
    ),
    true,
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

// Value: protects=a learner who reads one of the two keyboard notices finding in the README when Codebook shows it, in which editor and chat layout, and that it comes once in an editor session; fails_when=the README loses a notice, quotes another sentence than the reader shows, or still says that a close beside the learner's own file shows nothing and that Cursor shows no sentence at a pause; why_new=Cycle 0046, found by package DOA: rows 1 and 5 added the two notices and no document named them; rewritten with rows 5 (Cursor half) and 66, which changed both sentences and when they are told, and with row 226 (since row 140 the Close notice is also told beside a page that is no text editor); seam=none
test('the packaged README quotes the notice of Close Study Workspace about the keyboard and the notice of a Codebook pane that took the keyboard at a pause as the reader shows them, and says in which editor and chat layout each is told', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "**Codebook: Close Study Workspace** run in the focused window while a Codebook pane, the captured source or your own file is the active editor, or a page that is no text editor (the editor's Settings, an image) in a window without editor tabs outside the main editor area, gives the active editor group the keyboard once the panes are closed, in VS Code and in Cursor: closing the panes can otherwise leave the keyboard on no element.",
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

// Value: protects=a learner who reads the notice of a Codebook pane that took the keyboard from a file they were working in finding in the README when Codebook shows it and what counts as working in a file; fails_when=the README loses the notice, quotes another sentence than the reader shows, or no longer says that only a click or key press of the last three seconds counts while the debugged program runs; why_new=Cycle 0046 row 293 (a third keyboard notice, for a file the debugger did not give the keyboard); seam=none
test('the packaged README quotes the notice of a Codebook pane that took the keyboard from a file the learner was working in as the reader shows it, and says when a file counts as worked in', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'Codebook also takes the keyboard to be in a file when you click or press a key in it. A Codebook pane that then comes to the front over that file takes the keyboard, because a hidden file cannot keep it, and the first time in an editor session Codebook says where it is: `A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.`',
    "That holds at a pause for a frame you selected in the Call Stack view and for a stop while the editor's `debug.focusEditorOnBreak` setting is off, where a file you go to and a frame's file you open with a double click count too, and while the debugged program runs, where only a click or a key press of the last three seconds counts.",
  ])

  // Assert: the README holds both sentences, the reader shows the sentence it quotes, and the three seconds are the reader's.
  assert.deepEqual(delivered, [true, true])
  assert.equal(
    PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
    'A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.',
  )
  assert.equal(LEARNER_SIGN_FRESH_MS, 3_000)
})

// Value: protects=a learner whose keyboard is on no element after a Codebook pane covered a frame's file finding in the README which three gestures lead there and what to do; fails_when=the README loses the stated limit, names other gestures than the three the editor reports nothing for, or no longer says to press a key in the file first or to click afterwards; why_new=Cycle 0046 row 292 (what rows 263 and 273 could not close is a stated limit: the Call Stack view and the navigation commands look alike to an extension); seam=none
test('the packaged README names the three Call Stack gestures after which a Codebook pane leaves the keyboard on no element, and what the learner does', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "Three gestures at a pause give a frame's file the keyboard without the editor telling Codebook: the editor's **Navigate Up Call Stack** and **Navigate Down Call Stack** commands by themselves (and the two that go to the top and to the bottom of the call stack), a double click or Enter on a frame whose file is already open as a kept tab, and Enter on a row of the Call Stack view that is not the selected frame yet.",
    'After one of them, the next Codebook pane (the Application pane or the captured source) that comes to the front over that file comes without the keyboard, which is then on no element.',
    'Press a key in the file before that, so that Codebook knows you work there, or click where you want to type afterwards.',
  ])

  // Assert
  assert.deepEqual(delivered, [true, true, true])
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

// Value: protects=a learner whose home folder is on a file system without hard links reading, before or after Cursor setup refused, that this is a limit of Codebook and which sentence it ends with; fails_when=the README does not state the limit, names another sentence than the setup words, or leaves out one of the two files or the kinds of file system; why_new=Cycle 0046 row 214: the limit stood in no document; seam=none
test('the packaged README says that Cursor setup needs a file system with hard links, names the skill and the config it links and the file systems that have none, and quotes the refusal as the setup words it', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const paragraphs = readme.split('\n').filter((line) => line.trim() !== '')

  // Act: the paragraph, and the one right before it.
  const at = paragraphs.findIndex((line) =>
    line.startsWith('**Cursor setup needs a file system with hard links.**'),
  )
  const paragraph = paragraphs[at] ?? ''
  const facts = {
    standsAfterTheLockParagraph: (paragraphs[at - 1] ?? '').startsWith(
      'A Cursor setup/update/removal that an editor or process crash interrupted leaves its `writer.lock` behind.',
    ),
    namesTheSkill: paragraph.includes('`~/.cursor/skills/codebook/SKILL.md`'),
    namesTheConfig: paragraph.includes('`~/.cursor/mcp.json`'),
    namesTheFileSystems: paragraph.includes(
      '(exFAT, FAT, some network shares)',
    ),
    quotesTheRefusalOfTheSetup: paragraph.includes(
      `"${describeRefusedSkillLink('<path>', 'EPERM')}"`,
    ),
    saysThatNoOtherWayIsTaken: paragraph.includes(
      'Codebook does not place the file another way.',
    ),
  }

  // Assert: the README's quotation is the sentence the setup builds, word for word.
  assert.deepEqual(facts, {
    standsAfterTheLockParagraph: true,
    namesTheSkill: true,
    namesTheConfig: true,
    namesTheFileSystems: true,
    quotesTheRefusalOfTheSetup: true,
    saysThatNoOtherWayIsTaken: true,
  })
  assert.equal(
    describeRefusedSkillLink('<path>', 'EPERM'),
    "Cursor skill could not be installed: the file system refused to put Codebook's new file in place as <path> (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.",
  )
})

// Value: protects=a learner who follows the README after a Cursor setup or removal was refused; fails_when=the README still forbids deleting a record that a refusal now tells the learner to delete, still sends a learner whose config cleanup failed through Restore Managed Cursor Skill, which installs again the skill that was just removed, or does not say what to do about a skill file that was edited or replaced; why_new=Cycle 0046 rows 188, 211 to 213 and 222 changed what these refusals say and what the removal command does; seam=none
test('the packaged README agrees with the refusals of a Cursor setup or removal: a record a refusal names may be deleted as the refusal says, a failed config cleanup is finished by the removal command itself, an edited or replaced skill file is deleted or renamed, and the folder of another skill named codebook is renamed or moved', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const endOfTheCleanupWarning = cursorCatalogCleanupNotice(
    new Error('<cause>.'),
    'removed',
  ).slice('<cause>. '.length)

  // Act
  const delivered = heldSentences(readme, [
    "If another skill is present under the name `codebook`, Codebook will not replace it: the refusal names its folder, and that folder is yours to keep. Rename that folder to keep the skill beside Codebook's, or move it elsewhere, then run **Codebook: Set Up AI Chat** again; as long as it stays where it is, Codebook installs no skill.",
    "A skill file that was edited or replaced after setup is left alone too, as long as it is there: delete or rename that file, then run the command again; setup then installs Codebook's skill again, and the removal finishes.",
    "Do not delete a pending or removal record, a retained file or another user's skill/config on your own to force setup through.",
    `The one exception is a record that a refusal names: where Codebook can neither finish nor undo an interrupted step by itself, or cannot read a record, the refusal names what to delete and ends with how to start over, for example \`${startOverBy('<record path>').trim()}\``,
    `If catalog cleanup alone failed after skill removal, the warning leads with the cause and ends \`${endOfTheCleanupWarning}\``,
    'Resolve that cause, then run **Codebook: Remove Managed Cursor Skill** again: it retires the empty config Codebook created and leaves an existing or changed config in place.',
  ])
  const retired = [
    'Never delete a pending/removal record, retained file or another user',
    'If catalog cleanup alone failed after skill removal, run **Codebook: Restore Managed Cursor Skill**',
    'If another skill or a manual edit is present, leave it in place and resolve that conflict yourself',
    'leave it in place and resolve that name conflict yourself',
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README holds each sentence and none of the earlier ones, and the two quotations are the product's words.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(
    startOverBy('<record path>').trim(),
    'To start over, delete <record path>, then run Codebook: Set Up AI Chat again.',
  )
  assert.equal(
    endOfTheCleanupWarning,
    'The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.',
  )
})

// Cycle 0046 (row 283): red while the README said that a deadline's failure text "ends with where" a participant is paused without a debugger stop; since row 268 the sentences on a page pause Codebook is resuming follow it, and a refused resume ends the run with them.
// Cycle 0046 (row 290): red while the README named "the active-progress or hold deadline" for the first sentence; the whole run's deadline adds the place too.
test('the packaged README says that a deadline’s failure text says where a participant is paused without a debugger stop, and ends with the page pause Codebook asked the debugger to resume when one is still open', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'When a deadline expires while a participant is paused without a debugger stop, the failure text says where, for example `The server is paused at auth.ts:18 without a debugger stop.`',
    "When a deadline expires while the page is still paused at a server stop's breakpoint that Codebook asked the debugger to resume, the failure text ends with that pause: the declared server stop, the place when Codebook read the page's own pause, and whether the debugger answered the resume, followed by `Keep the declaration and start a new run.`",
    'A resume the debugger refuses ends the run with the same sentences and the refusal in quotation marks.',
  ])
  const failureOfRefusedResume = pagePauseUnderResumeText(
    { declared: 'app/lib/actions.ts:27', place: undefined },
    { failure: 'Thread is not paused' },
  )

  // Assert: the README holds each sentence and no longer says "ends with where", and the product's text closes with the sentence the README quotes and holds the refusal in quotation marks.
  assert.deepEqual(delivered, [true, true, true])
  assert.equal(readme.includes('the failure text ends with where'), false)
  assert.equal(
    readme.includes('When the active-progress or hold deadline expires'),
    false,
  )
  assert.equal(
    failureOfRefusedResume,
    'The debugger reported that the page paused at the breakpoint of declared server stop app/lib/actions.ts:27, which it also sets in the page\'s copy of that module. Codebook asked the debugger to resume the page, and the request failed: "Thread is not paused". Keep the declaration and start a new run.',
  )
})

// Value: protects=a learner whose Cursor exposes no MCP registration and whom the refusal sends to an external MCP client: "For an external MCP client, run Codebook: Start Agent Server and Codebook: Copy Agent Connection."; fails_when=the README no longer names that way in those words, so the refusal names something the README does not have (it said "the public manual connection setup", which the README never had); why_new=Cycle 0046 row 303: the refusal uses the README's sentence; seam=none, the packaged README
test('the packaged README names the way to an external MCP client in the words the refusal of a Cursor without MCP registration uses', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'For an external MCP client, run **Codebook: Start Agent Server** and **Codebook: Copy Agent Connection**.',
  ])
  const retired = ['public manual connection setup'].filter((words) =>
    readme.includes(words),
  )

  // Assert
  assert.deepEqual({ delivered, retired }, { delivered: [true], retired: [] })
})

// Value: protects=a learner whom a refusal for a damaged installation sends to the README: 'Install the verified VSIX again (README, "Install the private VSIX")'; fails_when=the README's section gets another heading, or no longer says how to install again, so the refusal names a place that is not there; why_new=Cycle 0046 row 285: the refusal names the section and uses its words; seam=none, the packaged README
test('the packaged README has the section a refusal for a damaged installation names, and that section says how to install the verified VSIX again', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const section =
    readme.split('\n## Install the private VSIX\n')[1]?.split('\n## ')[0] ??
    'no section "Install the private VSIX"'

  // Assert
  assert.deepEqual(
    heldSentences(section, [
      'To update or reinstall, stop active Codebook runs, close the affected editor windows, install the desired verified VSIX with the same command and reopen the same workspace/profile.',
    ]),
    [true],
  )
})

// Value: protects=a learner or an agent who reads in the README why a start was refused with SOURCE_CHANGED and that Codebook does not save a document when it starts a debugger; fails_when=the recovery table loses the sentence, or says again only that the editor file differs; why_new=Cycle 0046 row 314: a chat request saved the learner's unsaved documents and failed its own run, and the README named neither the cause nor the way on; seam=none
test('the packaged README says for SOURCE_CHANGED that a start saves no document and is refused while a cited source is open in the editor with other text, and what the learner and the agent do then', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    '| `SOURCE_CHANGED` ',
    '| Read the captured source resource; the current editor file differs from it. A start is refused with it, before the application, the test, the browser or a debugger is started, while a cited source is open in the editor with other text than the article cites: Codebook starts its debuggers without saving a document, so the learner saves the file (the agent then reads the source and publishes the article again) or reverts it before a new run. ',
  ])

  // Assert
  assert.deepEqual(delivered, [true, true])
})
