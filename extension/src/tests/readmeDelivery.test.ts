import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  API_VERSION,
  CHAT_KEYBOARD_RETURNED_MESSAGES,
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
  WIKI_CHAT_SESSION_START_TIMEOUT_MS,
  WIKI_CHAT_WATCH_STATUS_TEXT,
  WIKI_CHAT_WATCH_TOOLTIP,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_PAGE_FILE_LIMIT_BYTES,
  WIKI_PAGE_NAVIGATION_DESTINATIONS,
  WIKI_PAGE_SERVE_DEADLINE_MS,
  WIKI_PAGE_WAITING_LIMIT,
  WIKI_PAGE_WORKER_CONCURRENCY_LIMIT,
  WIKI_PAGE_WORKER_HEAP_LIMIT_MB,
  WIKI_UPDATE_MARKER_CHANGE_RETRIES,
  WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS,
  WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS,
  WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS,
  WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS,
  WIKI_UPDATE_MARKER_WRITE_GRACE_MS,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
  WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
} from '../constants'
import { STUDY_UI_OPTIONS } from '../ui/constants'
import { cursorCatalogCleanupNotice } from '../utils/cursorCatalogCleanupNotice'
import { describeBrokenWikiWatch } from '../utils/describeBrokenWikiWatch'
import { describeRefusedSkillLink } from '../utils/describeRefusedSkillLink'
import { describeUnansweredWikiChat } from '../utils/describeUnansweredWikiChat'
import { describeWikiChatErrorReply } from '../utils/describeWikiChatErrorReply'
import { describeWikiChatHandOver } from '../utils/describeWikiChatHandOver'
import { pagePauseUnderResumeText } from '../utils/pagePauseUnderResumeText'
import { savedLaterNote } from '../utils/savedLaterNote'
import { startOverBy } from '../utils/startOverBy'
import {
  PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
  REMOVE_LINK_OR_RENAME_IT,
  stepPastNoRealFolder,
} from '../utils/stepPastNoRealFolder'
import { studyRemovalMessages } from '../utils/studyRemovalMessages'
import { tabWithoutEditorObstacle } from '../utils/tabWithoutEditorObstacle'
import {
  type WikiPageRefusalReason,
  wikiPageRefusalHtml,
} from '../utils/wikiPageRefusalHtml'
import { withServedAddresses } from '../utils/withServedAddresses'

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
    "A window of this build judges a lock that names this machine by the start of its writer's process: the lock counts as left behind when no process has its process id any more, when the process that has that id now began at another time (the id went to another process), or, on Linux and macOS, when the lock names another boot of the computer than the running one. A correction of the clock changes none of this.",
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

// Value: protects=a learner who finds the file of a running Wiki update in the project folder, or whose update is refused because of another window, reading what the file holds, that it names no computer, host or user in clear, and how long a marker counts that no window here can judge; fails_when=the README loses the marker's paragraphs, leaves out one of the three refusals or one of the cases in which a marker is not judged by its process (a window that could not read its own process start, a Linux window that could not read its pid namespace), names another longest time than the product computes for Cursor and VS Code, leaves out a cause for which a window asks again for the change of its marker (a marker that cannot be read at that moment), or names only the 2 seconds of a marker being written for the refusal that a marker file which cannot be read gets for 21 minutes 30 seconds; why_new=Cycle 0046 row 119 (amendment ER-14): no document described the marker; rows 103, 115 and 145 added the two cases and the third refusal after the paragraphs were written; Cycle 0047 row 51 (D14.5-3) added the marker that cannot be read at that moment and the refused change to the causes of a retry, and row 32 (P3RT10) the marker file that cannot be read, which counts as one being written for 21 minutes 30 seconds; seam=none
test('the packaged README says what a running Wiki update’s marker holds, preserves marker privacy, distinguishes a killed running owner from a stopped watch whose record could not be stored and states their time bounds', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act: the three paragraphs under "LLM Wiki: open and update", whole.
  const delivered = heldSentences(readme, [
    "While an update runs, its window keeps a marker file beside the output folder, `<folder>.update-run.json` (`.codebook/wiki.update-run.json` unless the setting names another folder), so that a second editor window on the same project does not start a second update. That window's start is refused with `Another editor window is updating this Wiki (<editor>, started <time>). Wait for it to finish, then press Update LLM Wiki again.` Two shorter refusals name no run. `Another editor window is starting an update of this Wiki. Wait a moment and try again.` is shown while another window is writing its marker (a marker file without content that is younger than 2 seconds), and while a marker file cannot be read at that moment (another program holds it open, as a scanner or an indexer can on Windows, or this user may not read it): such a file may be a running update's marker, so it counts until 21 minutes 30 seconds after its last write, as long as any marker counts. `Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.` is shown while another window holds the claim under which a marker is removed or replaced, and a leftover marker is in the way. The marker usually lies in your project folder, so it holds nothing that names the computer, its host or its user in clear: it records the process id of the window's extension host and when that process began, a random id of the window, the editor, the time the run started, the id of the computer's boot on Linux and macOS, and two digests that stand for the machine. A digest is a pseudonym and no secret: a commit of the file publishes it, and the digest of a common host name can be found by trying names. When the run ends, its window removes the marker; after a stopped VS Code watch the file stays as that window's note that the chat may still publish, and the window removes it later or the next update does. Where the window cannot remove or replace its marker at that moment (another window holds the claim on it, the system refuses the claim or the change, or the marker cannot be read at that moment, as on Windows while a scanner or an indexer holds the file open), it tries again every 10 seconds for two minutes, and once more when it closes; a marker still left after that counts until its run's longest time has passed.",
    "A marker of a running update that a killed editor left on this machine does not refuse a start: a window of this build judges a marker by the start of its owner's process, so the marker counts as nobody's when that process is gone and also when another process has its process id since, and the next start removes it. A marker whose owner cannot be judged here counts until its run's longest time has passed at the latest: 21 minutes after the run began for Cursor and 21 minutes 30 seconds for VS Code (the 15 minutes of a run, in VS Code after the 30 seconds for the chat's first answer, then 1 minute, then the 5 minutes by which two clocks may differ). That is a marker written on another computer (a project folder shared between machines), in another system or another pid namespace of this computer (a Windows window beside a WSL window, another WSL distribution, a container), where its process id means another process, by a window that could not read its own process start, or by a Linux window that could not read its own pid namespace (such a window also judges no other window's marker by its process). A running update's marker of this computer that names another boot than the running one (on Linux and macOS, which name their boots) is nobody's all the same. A marker of 0.2.29.0 counts that long when a process still has its process id. [What a lock or an update marker cannot tell](#what-a-lock-or-an-update-marker-cannot-tell) lists the limits.",
    "A stopped VS Code watch's reservation describes a chat that can still publish. If the editor could not store that watch's record, Codebook keeps the reservation when the window closes or reloads. Another window, including the reloaded one, still waits until 15 minutes after the watch ended, also when the former extension host's process is gone. Stop that chat, then choose Update anyway if Codebook still waits for it; a publish the reader recognizes ends the wait sooner.",
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

  // Assert: all paragraphs, and the file name and the times the product keeps: 21 minutes, 21 minutes 30 seconds and their parts, and the 2 seconds of a marker that is being written.
  assert.deepEqual(delivered, [true, true, true])
  assert.equal(WIKI_UPDATE_RUN_MARKER_SUFFIX, '.update-run.json')
  assert.equal(longestCursorMarkerMs, 1_260_000)
  assert.equal(longestVsCodeMarkerMs, 1_290_000)
  assert.equal(WIKI_CURSOR_UPDATE_TIMEOUT_MS, 900_000)
  assert.equal(WIKI_UPDATE_WATCH_TIMEOUT_MS, 900_000)
  assert.equal(WIKI_CHAT_OPEN_TIMEOUT_MS, 30_000)
  assert.equal(WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS, 60_000)
  assert.equal(WIKI_UPDATE_MARKER_CLOCK_TOLERANCE_MS, 300_000)
  assert.equal(WIKI_UPDATE_MARKER_WRITE_GRACE_MS, 2_000)
  assert.equal(WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS, 10_000)
  assert.equal(
    WIKI_UPDATE_MARKER_CHANGE_RETRIES *
      WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS,
    120_000,
  )
})

// Value: protects=a learner or a maintainer who needs to know where a storage lock and the Wiki update marker stop protecting: beside a window of 0.2.29.0, across hosts and systems, with equal host names, with clocks apart, without hard links, with a suspended window, and on the systems nobody observed; fails_when=the README loses a limit, or names another number than the product keeps (60 seconds of a claim, 2 seconds of a marker being written, 5 minutes between clocks, a minute between boot times); why_new=Cycle 0046 row 119: amendment ER-14 asked the README to carry these statements and none was written; seam=none
test('the packaged README states the limits of a storage lock and of the Wiki update marker: a window of 0.2.29.0 on the same folder, another host or system, two computers with one host name, clocks more than 5 minutes apart, a file system without hard links, a suspended window, and the systems observed', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act: the heading, the paragraph under it and its seven limits, each whole.
  const delivered = heldSentences(readme, [
    '### What a lock or an update marker cannot tell\n',
    "Two files keep editor windows from writing at the same time: `writer.lock` in each private storage folder (the learning storage, the Cursor skill and its catalog) and the marker of a running Wiki update beside the Wiki folder ([LLM Wiki: open and update](#llm-wiki-open-and-update)). Between windows of this build a lock, a marker and the claim a window holds for the moment in which it removes or replaces one of them are judged by the start of the owner's process. The limits:",
    "- **A window of 0.2.29.0 on the same storage or project folder.** That window writes and judges as 0.2.29.0 did, so beside it the guarantees are those of 0.2.29.0. Its lock, its marker and its claim name no process start: this build judges such a lock by its process id and its boot, such a marker by its process id alone, and removes such a claim once it is 60 seconds old, or sooner when the claim names this machine and no process has its process id. The older window judges the files of this build in its own way: a lock or a marker whose process id went to another process stays for it, where the boot is a computed time (Windows, and a Mac whose window could not read its boot session) a clock set forward by more than a minute while a lock is held can make it take over that lock although its writer still runs, it removes a claim after 60 seconds although the claim's window still runs, it creates its marker in place, so that the file is empty for the time of one write, when it finds no marker under its claim it removes the marker another window has just written, and it follows a link at the path of the marker's claim (`<marker>.takeover`, which a cloned repository can carry): each time it asks for that claim it deletes the files directly in the folder the link leads to that were last changed more than 60 seconds ago. Update every window to leave these limits behind.",
    "- **Another host, another system.** A lock or a marker written on another computer is not judged by a process here, and neither is a marker, or a lock that records its writer's process start, written by an editor of another system of this computer (a Windows window beside a WSL window), because its process id means another process there. Such a lock stays until you move it away; such a marker counts until its run's longest time has passed at the latest, and a claim on it for 60 seconds. For a marker and its claim, another pid namespace of this computer (another WSL distribution, a container) is such a system too, and so are a window that could not read its own process start and a Linux window that could not read its own pid namespace.",
    "- **Two computers with one host name.** A marker names its machine by digests, and the digest of the host name is the one VS Code and Cursor on one computer share. On Linux and macOS the marker also names the boot by its id, so a marker with this host name, another editor's machine id and another boot is another computer's: it counts until its run's longest time has passed, and a start beside it is refused. The price: a marker that the other editor of this computer left before a restart counts in the same way. Where a boot has no id (Windows, and a Mac whose window could not read its boot session), and where the two computers also share an editor's machine id (a shared home folder), two computers with the same host name on one shared project folder look like one machine to the marker: each judges the other's marker by its own processes, and a second update can start beside a running one.",
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

// Value: protects=a Linux learner whose /proc hides other users' processes (hidepid), whose lock or update marker names a process id that another user's process took after the editor was killed, learning why it stays and how to get past it; fails_when=the README's limits leave out that on Ubuntu's default /proc another user's process is judged by its start and that under hidepid=2 such a lock stays until it is moved away and such a marker counts until its run's longest time; why_new=Cycle 0047 row 33 (P3RT11, its Linux half): closed by evidence and this README limit instead of a code change; seam=none; no_claim=that hidepid was observed in an editor
test('the packaged README states, among the limits of a lock and an update marker, that under hidepid on Linux a lock whose process id went to another user’s process stays until it is moved away and such a marker counts until its run’s longest time', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const limit =
    "- **Another user's process on Linux.** A window reads the start of a process in `/proc`. On Ubuntu's default `/proc` it reads the start of another user's process as well, so a process id that went to another user's process is judged by its start like any other. Where `/proc` is mounted with a `hidepid` option such as `hidepid=2` (a hardening that Ubuntu does not set by default), the start of another user's process cannot be read, and a lock or a marker whose process id another user's process has now is taken for one whose writer may still run: such a lock stays until you move it away (make sure that no Codebook window on any host or system still writes to this storage, then move the named file away and retry), and such a marker counts until its run's longest time has passed."

  // Act: the limit, and where it stands: under the heading of the limits, before the next section.
  const limitAt = readme.indexOf(limit)
  const isUnderTheLimits =
    limitAt >
      readme.indexOf('### What a lock or an update marker cannot tell\n') &&
    limitAt < readme.indexOf('## Validation\n')

  // Assert
  assert.notEqual(limitAt, -1)
  assert.equal(isUnderTheLimits, true)
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

// Value: protects=a learner who presses Update LLM Wiki in VS Code reading why the update ended after half a minute and what a refused start keeps; fails_when=the update table says again that the watch starts with the request, or that every failed update kept a site, or quotes the end of a request Codebook took back, which it no longer does; why_new=Cycle 0046 row 56: rows 3 and 22 changed both and the table still described 0.2.29.0; Cycle 0047 row 6 (S11-X2): the request is left in the chat at the 30 seconds; seam=none
test('the packaged README says that a VS Code update waits 30 seconds for the chat’s first answer before it watches, and that a folder without a Wiki names no kept site', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'VS Code: the request went to a new chat. Codebook waits up to 30 seconds for the first sign that the chat works on it (its reply or its wait for a confirmation, a file of the Wiki or of the Codebook skill that it opens, the publisher it runs in a terminal, or a folder the publisher prepares beside the Wiki) and then watches the output folder for up to 15 minutes.',
    "In VS Code an update without such a sign within 30 seconds ends with `Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.` A chat that answers the request with an error ends it at once with `The editor chat answered the update request with an error and stopped (…). Read its message in the Chat view, then press Update LLM Wiki again.`, the chat's message in the brackets; a chat that finishes its reply without publishing ends it with `The editor chat finished its reply without publishing a new Wiki. Read its reply in the Chat view, then press Update LLM Wiki again.`",
    'The last usable site is kept, and the sentence says so; in a folder that has no Wiki yet it says to generate one first and names no kept site.',
  ])
  const retired = [
    'VS Code: the request is in the chat and Codebook watches the output folder for up to 15 minutes.',
    'The run ended without a new site. The last usable site is kept.',
    'took its request back, so no update is running.',
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README names the bound the editor enforces, and the end it quotes is the product's.
  assert.deepEqual(delivered, [true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(WIKI_CHAT_OPEN_TIMEOUT_MS / MILLISECONDS_PER_SECOND, 30)
  assert.equal(
    describeUnansweredWikiChat('left', 'own', WIKI_CHAT_OPEN_TIMEOUT_MS),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  )
  assert.equal(
    describeWikiChatErrorReply('…'),
    'The editor chat answered the update request with an error and stopped (…). Read its message in the Chat view, then press Update LLM Wiki again.',
  )
})

// Value: protects=a learner who presses Update LLM Wiki in VS Code reading where the request goes (a new chat, not the chat they use), where their own chat went, that Codebook leaves its request in the chat at the 30 seconds and why, and what an editor without New Chat does instead; fails_when=the README describes a request typed into the learner's chat, says that Codebook runs the chat's Cancel or removes queued requests at the 30 seconds, or names another sentence than the product prints; why_new=Cycle 0046 rows 82 and 129; Cycle 0047 row 6 (S11-X2): Codebook no longer runs the chat's Cancel or Remove All Queued, which act on the chat focused last; seam=none
test('the packaged README says that a VS Code update sends its request into a new chat, where the learner’s chat went, that at the 30 seconds Codebook leaves its request in the chat and runs none of the chat’s commands, and what an editor without New Chat does', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "In VS Code the update's request does not go into the chat you are using, with the one exception named below: Codebook reveals the chat, runs the editor's **New Chat** and sends the request into that new chat, so a request of yours that is in progress, waits for a confirmation or is queued is neither stopped nor held back, and the update does not wait behind it.",
    "Your chat is not closed: with a request in progress or waiting for a confirmation it goes on in the background, and you return to it from the Chat view's session list (its chat history). The update asks nothing about edits of that chat you have not decided on yet: they stay pending in their chat, with Keep and Undo, and the **Suggested Edits** editor that shows them stays open.",
    "When Codebook sees no sign within those 30 seconds, it leaves its request in the chat and runs none of the chat's commands: the chat's Cancel and its Remove All Queued act on the chat you focused last and on the session it shows, and the editor tells Codebook neither which session that is nor which request is its own, so they could stop or remove a request of yours instead. Your own work elsewhere in the window (a file you open, a command you run) is not taken for a sign. What the update's own steps touch counts whoever does it, because Codebook cannot tell you from the chat there: a file opened in the Wiki's folder, in a folder prepared beside it or in the Codebook skill's folder, a terminal command that names `publish-wiki.mjs` or the Wiki's folder, and a change in the Wiki's folder or in a folder prepared beside it.",
    "When the chat's command has not returned by then, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.`",
    "Every supported VS Code (1.120 and later) has New Chat. An editor without that command, and one in which the reveal of the chat or New Chat fails or does not return within 5 seconds, gets the request in the chat that is open, where it acts like a message you typed: it waits in the queue behind a request in progress, the editor cancels a request that waits for a confirmation, and a draft in the chat's input is replaced. The confirmation says so before the press where the editor lacks the command; where the reveal or New Chat failed, nothing says so before, and the Chat view shows the request in the chat that was open. At the 30 seconds Codebook leaves its request in that chat as well, also where it waits in the queue, and removes none of yours.",
  ])
  const retired = [
    // Row 337: read in the editor's source, and not what the editor does (seen in VS Code 1.140.0).
    'New Chat closes the diff editors',
    'Codebook takes its request back before it shows the sentence',
    "Requests of your own that wait in that chat's queue are removed with it, and a request of yours that is in progress there is left alone.",
    'Your own work in the window (a file you open, a command you run) is not taken for a sign.',
    'An editor without that command gets the request in the chat that is open',
    // Cycle 0047 row 6: Codebook runs none of the chat's commands at the 30 seconds.
    "it stops its request with the chat's own Cancel",
    'The Cancel acts on the chat you focused last',
    'If Codebook did not see its request end',
    'removes the requests queued in that chat',
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README holds each sentence, and the product prints the sentence it quotes and keeps the bound and the place it names for a request that got no chat of its own.
  assert.deepEqual(delivered, [true, true, true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(WIKI_CHAT_SESSION_START_TIMEOUT_MS / MILLISECONDS_PER_SECOND, 5)
  assert.equal(
    describeUnansweredWikiChat('left', 'own', WIKI_CHAT_OPEN_TIMEOUT_MS),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  )
})

// Value: protects=a learner whose Wiki request went into a shared chat and showed no sign: the next step differs when no request was held and when it remains; fails_when=the README quotes one universal shared-chat ending, omits Update anyway for the request that remains, or still quotes the end of a request Codebook took back, which it no longer does; why_new=Cycle 0046 row 367; Cycle 0047 row 6 (S11-X2): Codebook takes no request back; seam=none
test('the packaged README distinguishes the two shared-chat outcomes, a request the chat never held and one it may still hold, and quotes the whole Update anyway sentence for the second', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'When the shared chat holds no request of the update, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.`',
    'When the chat may still hold it, it reads `Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.`',
  ])
  const sharedSentences = [
    describeUnansweredWikiChat('not-sent', 'shared', WIKI_CHAT_OPEN_TIMEOUT_MS),
    describeUnansweredWikiChat('left', 'shared', WIKI_CHAT_OPEN_TIMEOUT_MS),
  ]
  const hasTheOldUniversalEnding = readme.includes(
    'before it uses the Cancel, and the sentence ends `The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.`',
  )

  const quotesARequestTakenBack = [
    'When Codebook took the request back',
    'and whether Codebook took it back',
  ].some((sentence) => readme.includes(sentence))

  // Assert: the document distinguishes each outcome, quotes no request taken back, and the full product sentences are independent hard-coded expectations.
  assert.deepEqual(delivered, [true, true])
  assert.equal(hasTheOldUniversalEnding, false)
  assert.equal(quotesARequestTakenBack, false)
  assert.deepEqual(sharedSentences, [
    'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  ])
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
    `The button asks for confirmation in the editor first; in VS Code the confirmation says where the request goes: \`${confirmation}\` The command starts at once and asks nothing: its request goes into a new chat in the same way (into the chat the Chat view restores, if that view opens only now) and replaces a draft in an empty chat in the same way; the Chat view shows the chat with the request. When the watch ends and what to do after you refused a step of the chat are in the row **Updating LLM Wiki…** below.`,
  ])

  // Assert
  assert.equal(
    confirmation,
    'Copilot Chat receives the update request for this project in a new chat; the chat you have open keeps its place in the chat list. If the Chat view has not been opened in this window yet, the request may go into the chat it restores. A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.',
  )
  assert.deepEqual(delivered, [true])
})

// Value: protects=a learner reading in the README what follows the 30 seconds with a request Codebook could not take back; fails_when=the README no longer says that Codebook then waits for that chat and answers a retry with Update anyway, so the refusal of the retry comes unannounced, or quotes another sentence than the product prints; why_new=Cycle 0046 row 358; seam=none
test('the packaged README says that after a request Codebook could not take back a retry is answered with the wait for that chat and Update anyway, and quotes the sentence that names the step', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "When the chat's command has not returned by then, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.` Codebook then waits for that chat as it does after a stopped watch, for 15 minutes: a retry in that time is answered with the wait and **Update anyway**, not with a second request beside the first.",
  ])

  // Assert: the README holds the sentences, the sentence it quotes is the product's, and the wait is the watch's bound.
  assert.deepEqual(delivered, [true])
  assert.equal(
    describeUnansweredWikiChat('left', 'own', WIKI_CHAT_OPEN_TIMEOUT_MS),
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  )
  assert.equal(WIKI_UPDATE_WATCH_TIMEOUT_MS / MS_PER_MINUTE, 15)
})

// Value: protects=a learner reading in the README what to do when an update stopped on a file of their own; fails_when=the row tells a VS Code learner only to move the file and update again, although the chat was not stopped and that press is answered with the wait for it, or no longer says that the chat can still publish; why_new=Cycle 0046 row 343; seam=none
test('the packaged README says for an update that stopped on a file of the learner’s that in VS Code the chat was not stopped and can still publish, and what to do with it before updating again', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "The new site would overwrite a file of your own in the Wiki folder. In VS Code only Codebook's watch stopped: the chat that prepared the site was not stopped and can still publish once the file is out of the way.",
    'Move or rename the file. Cursor: update again. VS Code: answer the chat if it waits for you, or stop it. To start again, update again and press **Update anyway** if Codebook still waits for that chat.',
  ])

  // Assert
  assert.deepEqual(delivered, [true, true])
})

// Value: protects=a learner reading in the README what a failed update says of the site when a chat or another window can still publish, and what a watch that broke off says; fails_when=the README says of every failed end that the last usable site is kept, quotes another sentence of a broken watch than the product prints, or leaves out that the next update is then answered with Update anyway; why_new=Cycle 0046 row 341; seam=none
test('the packaged README says which failed ends say that nothing had been replaced by then in place of a kept site, and quotes the sentence of a watch that broke off', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "A sentence about a run that ended without success also says whether the site on disk was kept or replaced. Where a chat or another editor window can still publish after that end (a request Codebook could not take back at the 30 seconds, a watch of Codebook's that broke off with an error, a start refused because an earlier chat or another window is still updating), it says `Nothing had been replaced by then.` in place of `The last usable site is kept.`, so that a later publish does not make the notice untrue.",
    'A watch that broke off reads `Codebook stopped watching the update because of an error (…). The VS Code chat was not stopped and can still publish: let it finish (the Wiki page says when it has), or stop it in the chat.`, and the next update is then answered as after a stopped watch, with **Update anyway**.',
  ])

  // Assert: the README holds both sentences, and the sentence it quotes is the product's.
  assert.deepEqual(delivered, [true, true])
  assert.equal(
    describeBrokenWikiWatch('…'),
    'Codebook stopped watching the update because of an error (…). The VS Code chat was not stopped and can still publish: let it finish (the Wiki page says when it has), or stop it in the chat.',
  )
})

// Value: protects=a learner reading when Codebook stops waiting for a chat whose watch it had stopped; fails_when=the README still says only that Codebook waits until the named time, although the chat's own publish ends that wait and the next update then starts without a refusal; why_new=Cycle 0046 row 335; seam=none
test('the packaged README says that the wait for a chat whose watch stopped ends when that chat publishes, so the next update starts without the sentence that names Update anyway', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'An earlier chat may still be updating this Wiki, so no agent was asked: the VS Code chat of this window or of another window after its watch stopped or after a request Codebook could not take back, or a candidate folder written within the last 15 minutes. The sentence names the time Codebook waits until. The wait for a chat whose watch stopped ends earlier when that chat publishes: once a site was published after the watch stopped, the next update starts without this sentence (in the window that watched only when the candidate folder its watch saw is gone too).',
  ])

  // Assert
  assert.deepEqual(delivered, [true])
})

// Value: protects=a learner whose chat asks for approvals while Codebook watches a VS Code update, and the learner of the command, who reads no confirmation; fails_when=the README quotes another entry or tooltip than the editor shows, still describes the watch as a notification, no longer says that pressing the entry stops watching and not the chat, or no longer says for the command where the request goes and where the ends of the watch are named; why_new=Cycle 0046 row 336 (the title lost the sentences of rows 216, 217 and 261, which the README must now carry for the command) and row 592 (the watch moved from a notification into the status bar); seam=none
test('the packaged README quotes the status bar entry and the tooltip that watch a VS Code update, says that pressing the entry stops watching and not the chat and that no notification of the watch lies over the chat’s approvals, and says for the command where the request goes and where the ends of the watch are named', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'While Codebook watches a VS Code update the right of the status bar shows the entry `$(sync~spin) Watching for the LLM Wiki update · Cancel` (a spinning icon, then the words), for as long as the watch lasts; its tooltip reads `Watching the editor chat for the LLM Wiki update. Cancel stops watching, not the chat.`',
    'Pressing the entry is the Cancel: it stops watching, not the chat. The entry leaves the status bar when the watch ends.',
    'The watch shows no notification: the editor stacks its notifications at the lower right of the window, where it shows the Chat view by default, so any other notification would push a notification that lasts the whole watch over the buttons of a step the chat asks you to approve. The status bar lies below every notification, and those buttons stay free.',
    "The entry says the same wherever the request went (a new chat, the chat the Chat view restored, or the chat that was open); where it went is said by the confirmation and above, and when the watch ends and what to do after a refused step by the page's running line and the table.",
    "Where the Wiki's output folder lies outside the project, the chat asks you to approve each step there (an output inside the project, `codebook.wikiOutputDirectory`, needs none); the confirmation and the page's running line say so, the status bar entry does not.",
    'The command starts at once and asks nothing: its request goes into a new chat in the same way (into the chat the Chat view restores, if that view opens only now) and replaces a draft in an empty chat in the same way; the Chat view shows the chat with the request. When the watch ends and what to do after you refused a step of the chat are in the row **Updating LLM Wiki…** below.',
  ])

  // Assert: the README holds each sentence, quotes the entry and the tooltip the editor shows, and no longer sends the learner to a notification of the watch.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.deepEqual(
    [WIKI_CHAT_WATCH_STATUS_TEXT, WIKI_CHAT_WATCH_TOOLTIP],
    [
      '$(sync~spin) Watching for the LLM Wiki update · Cancel',
      'Watching the editor chat for the LLM Wiki update. Cancel stops watching, not the chat.',
    ],
  )
  assert.deepEqual(
    [
      'the editor shows the notification `Watching',
      'press Cancel in the notification',
      'behind the bell',
    ].filter((oldWords) => readme.includes(oldWords)),
    [],
  )
})

// Value: protects=a learner reading in the README what the end of a VS Code watch after its 15 minutes means; fails_when=the row of "No new site appeared" no longer says that the chat was not stopped and can still publish, or names for a chat that stopped a press without the Update anyway that press needs while Codebook waits for the chat; why_new=Cycle 0046 row 330 (the row told the learner only that the chat may be waiting or have reported a problem); seam=none
test('the packaged README says for a VS Code watch that passed its 15 minutes that nothing had been replaced by then, that the chat can still publish, and what to do for a chat that waits, still works or stopped', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'Nothing was published within 15 minutes, so Codebook stopped watching; nothing had been replaced by then. The chat was not stopped with the watch: it may still be working and can still publish, and the page says when it has (**A new site was published**).',
    "Check the chat. If it waits for you, answer it. If it is still working, let it finish. If it stopped or reported a problem, update again, then press **Update anyway** in the editor's notification if Codebook still waits for that chat.",
  ])

  // Assert
  assert.deepEqual(delivered, [true, true])
})

// Value: protects=a learner reading when Codebook stops watching a VS Code update and what to do after they refused a step of the chat; fails_when=the update table no longer names the ends of the watch, or leaves out that a refused step is followed by Cancel and, at the next update, by Update anyway; why_new=Cycle 0046 row 217; seam=none
test('the packaged README says when the watch of a VS Code update ends and that a learner who refused a step of the chat ends it with Cancel', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "The watch ends when the new Wiki is published, when a file of your own in the Wiki folder is in the way of the publish (**Update stopped**), when a new site is on disk whose manifest Codebook still cannot read 10 seconds after it appeared, when the chat's reply ends before the chat asked you to approve a step, when you press Cancel in the status bar, or after those 15 minutes.",
    'If you refuse a step, press Cancel in the status bar: once the chat has asked you, Codebook does not see it stop, and would watch for the 15 minutes.',
    'Stop the chat itself to cancel the update. If it has already stopped (you refused a step), press **Update anyway** when you update again.',
  ])

  // Assert: the README holds each sentence with all six ends of the watch.
  assert.deepEqual(delivered, [true, true, true])
  assert.equal(
    readme.includes(
      "The watch ends when the new Wiki is published, when the chat's reply ends",
    ),
    false,
    'the README lists the ends of the watch without a file in the way and a manifest that cannot be read',
  )
  assert.equal(WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS, 10_000)
})

// Value: protects=a learner reading the two cases in which the update's request does not get a new chat of the Chat view, and the sentence of a chat that never held the request; fails_when=the README says without exception that the request does not go into a chat of the learner's, although a Chat view that opens only now sends it into the chat it restores and a chat in an editor tab gets the new chat in its tab, or it quotes two of the three sentences of the bound; why_new=Cycle 0046 row 261; seam=none
test('the packaged README names the Chat view that opens only now and the chat in an editor tab as limits of the new chat, and quotes the sentence of a chat that never held the request', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'Two limits, the first of them that exception. When the Chat view has not been opened in the window yet, it may still be restoring your last chat while New Chat runs: New Chat then does nothing, and the request goes into that restored chat; the confirmation names this case.',
    'When the chat you focused last is a chat in an editor tab, the new chat starts in that tab, and the chat that was shown there keeps its place in the chat list.',
    "If the chat's command had returned without the chat taking a request, the sentence reads `Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.`",
  ])

  // Assert: the README holds each sentence, and the product prints the sentence and names the case in its confirmation.
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
    'An earlier chat may still be updating this Wiki, so no agent was asked: the VS Code chat of this window or of another window after its watch stopped or after a request Codebook could not take back, or a candidate folder written within the last 15 minutes. The sentence names the time Codebook waits until.',
    "Wait until that time, or, if that chat was stopped, press **Update anyway** in the editor's notification. It starts the update past what that notification named; anything else in the way gets a new notification of its own. Another window's running update offers no **Update anyway**: wait for it to finish.",
    "While no explanation of a stopped run with a demonstrated result carries a learning summary, the run resource lists `save-learning-summary` in `nextActions` and gives the step as `saveLearningSummary`: call `codebook_explain` on a committed snapshot of the run with a new key and a complete `learningSummary` whose final step is observed and cites the run resource's `terminalReference`. Once the run's 32 explanation keys are spent the action is no longer listed, and `saveLearningSummary` says that the saved study will have no learning summary. Nor is it listed once a write of the stopped run's evidence has failed (a full disk, its evidence folder removed by hand): `saveLearningSummary` then names the failed write and says that the saved study will have no learning summary, and `codebook_explain` refuses a new key with `EVIDENCE_UNAVAILABLE` without spending it.",
  ])

  // Assert: the README holds each sentence, and the product keeps the bounds they name.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.equal(WIKI_UPDATE_WATCH_TIMEOUT_MS, 900_000)
  assert.equal(MAX_EXPLANATIONS, 32)
})

// Value: protects=a learner who reads one of the two keyboard notices finding in the README when Codebook shows it, in which editor and chat layout, and that it comes once in an editor session; fails_when=the README loses a notice, quotes another sentence than the reader shows, or still says that a close beside the learner's own file shows nothing and that Cursor shows no sentence at a pause; why_new=Cycle 0046, found by package DOA: rows 1 and 5 added the two notices and no document named them; rewritten with rows 5 (Cursor half) and 66, which changed both sentences and when they are told, and with row 226 (since row 140 the Close notice is also told beside a page that is no text editor), and with row 317 (a close that ends an enlarged reading shows the side bars again, which moves the keyboard: the README said that such a close beside the chat tab and in an unfocused window moves nothing), and with rows 635 and 649 (the chat given its keyboard back at a pause and after a Close that showed the side bars is told once with its own sentence, which the README quotes since the integration of rows 647 to 662); seam=none
test('the packaged README quotes the notice of Close Study Workspace about the keyboard and the notice of a Codebook pane that took the keyboard at a pause as the reader shows them, and says in which editor and chat layout each is told', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "**Codebook: Close Study Workspace** run in the focused window while a Codebook pane, the captured source or your own file is the active editor, or a page that is no text editor (the editor's Settings, an image) in a window without editor tabs outside the main editor area, gives the active editor group the keyboard once the panes are closed, in VS Code and in Cursor: closing the panes can otherwise leave the keyboard on no element.",
    'The first time in an editor session, Codebook says so: `Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.`',
    'A close made while Cursor shows its Agent chat as an editor tab and that chat has the keyboard moves nothing and shows nothing, and so does a close in a window that does not have the focus, with one exception.',
    "A close that ends an enlarged reading (the Study pane's **App**, **Source** or **Explanation** button, or **Codebook: Read Application**, **Codebook: Read Captured Source** or **Codebook: Read Explanation**) shows the side bars that reading hid again, and the editor shows a side bar only with a command that gives it the keyboard.",
    "When Codebook can tell from the editor's tabs that the chat had the keyboard (Cursor's Agent chat shown as an editor tab of the focused window, or VS Code's chat as an editor tab in a floating window), it gives the keyboard back to the chat after showing the side bars, and the first time in an editor session says so: `Study workspace closed, and Codebook gave the keyboard back to the chat: showing the side bars your Read had hidden took it. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.`",
    'In every other case in which that close showed a side bar, also in a window that does not have the focus, the active editor group has the keyboard afterwards and Codebook says so with the sentence above, the first time in an editor session; the editor keeps that notification in a window without the focus until you return to it.',
    "When `debug.focusEditorOnBreak` is enabled, a live pause makes the editor's debugger open the paused file with the keyboard. The first time in an editor session that a Codebook pane (the Application pane or the captured source) takes that file's place and Codebook knows of no chat to give the keyboard back to, it says where the keyboard is: `The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.`",
    'That is so in VS Code, in Cursor while its Agent chat is a pane of the secondary side bar, and in Cursor with the chat as an editor tab when you were working in a file or another tab before the pause.',
    'Where Cursor shows its Agent chat as an editor tab and that chat had the keyboard before the pause, Codebook gives the keyboard back to the chat at that pause, and the first time in an editor session says so: `Codebook gave the keyboard back to the chat editor tab after the editor moved it to another group (at a pause, to the paused file the debugger opened). The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.`',
  ])

  // Assert: the README holds each sentence, and the reader shows the sentences it quotes.
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
  assert.equal(
    STUDY_CLOSE_KEYBOARD_MESSAGE,
    'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
  )
  assert.equal(
    SOURCE_TOOK_PAUSED_FOCUS_MESSAGE,
    'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
  )
  assert.equal(
    CHAT_KEYBOARD_RETURNED_MESSAGES.close,
    'Study workspace closed, and Codebook gave the keyboard back to the chat: showing the side bars your Read had hidden took it. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  )
  assert.equal(
    CHAT_KEYBOARD_RETURNED_MESSAGES.pause,
    'Codebook gave the keyboard back to the chat editor tab after the editor moved it to another group (at a pause, to the paused file the debugger opened). The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
  )
})

// Value: protects=a learner who reads the notice of a Codebook pane that took the keyboard from a file they were working in finding in the README when Codebook shows it and what counts as working in a file; fails_when=the README loses the notice, quotes another sentence than the reader shows, or no longer says that only a click or key press of the last three seconds counts while the debugged program runs; why_new=Cycle 0046 row 293 (a third keyboard notice, for a file the debugger did not give the keyboard); seam=none
test('the packaged README quotes the notice of a Codebook pane that took the keyboard from a file the learner was working in as the reader shows it, and says when a file counts as worked in', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    'Codebook also takes the keyboard to be in a file when a click or a key press of yours moves the caret or changes the selection in it, which is all the editor reports to Codebook of a click or a key press. A Codebook pane that then comes to the front over that file takes the keyboard, because a hidden file cannot keep it, and the first time in an editor session Codebook says where it is: `A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.`',
    "That holds at a pause for a frame you selected in the Call Stack view and for a stop while the editor's `debug.focusEditorOnBreak` setting is off, where a file you go to and a frame's file you open with a double click count too, and while the debugged program runs, where only such a click or key press of the last three seconds counts.",
  ])

  // Assert: the README holds both sentences, the reader shows the sentence it quotes, and the three seconds are the reader's.
  assert.deepEqual(delivered, [true, true])
  assert.equal(
    PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
    'A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.',
  )
  assert.equal(LEARNER_SIGN_FRESH_MS, 3_000)
})

// Value: protects=a learner whose keyboard is on no element after a Codebook pane covered a frame's file finding in the README which three gestures lead there and what to do; fails_when=the README loses the stated limit, names other gestures than the three the editor reports nothing for, leaves out the click on the place where the caret already stands (Cycle 0046 row 320: natively the pane came over the file 0.5 s after such a click without the keyboard and with no notice), or no longer says to move the caret in the file first or to click afterwards; why_new=Cycle 0046 row 292 (what rows 263 and 273 could not close is a stated limit: the Call Stack view and the navigation commands look alike to an extension); seam=none
test('the packaged README names the three Call Stack gestures and the click that moves no caret after which a Codebook pane leaves the keyboard on no element, and what the learner does', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    "Three gestures at a pause give a frame's file the keyboard without the editor telling Codebook: the editor's **Navigate Up Call Stack** and **Navigate Down Call Stack** commands by themselves (and the two that go to the top and to the bottom of the call stack), a double click or Enter on a frame whose file is already open as a kept tab, and Enter on a row of the Call Stack view that is not the selected frame yet.",
    'A click on the place where the caret already stands moves nothing, so the editor reports nothing of it and it does not count, at a pause and while the program runs.',
    'After one of these, the next Codebook pane (the Application pane or the captured source) that comes to the front over that file comes without the keyboard, which is then on no element.',
    'Move the caret in the file before that (press an arrow key, or click on another place than the caret stands), so that Codebook knows you work there, or click where you want to type afterwards.',
  ])

  // Assert
  assert.deepEqual(delivered, [true, true, true, true])
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
    saysWhichSetupChangesNoFile: paragraph.includes(
      "and a setup that had no skill of Codebook's to replace changes no file.",
    ),
    saysWhatARefusedUpdateLeaves: paragraph.includes(
      "An update of a skill Codebook installed earlier has moved that skill aside before the link is tried; when the link is refused then, the previous skill stays under the name it was moved to, and the sentence says `Codebook's previous skill is kept as <kept path>; move it back to <path> to go on using it.` where the other says `No existing file was changed.`",
    ),
    saysOfEverySetupThatItChangesNoFile: paragraph.includes(
      'again.", and changes no file.',
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
    saysWhichSetupChangesNoFile: true,
    saysWhatARefusedUpdateLeaves: true,
    saysOfEverySetupThatItChangesNoFile: false,
    saysThatNoOtherWayIsTaken: true,
  })
  assert.equal(
    describeRefusedSkillLink('<path>', 'EPERM'),
    "Cursor skill could not be installed: the file system refused to put Codebook's new file in place as <path> (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.",
  )
  assert.equal(
    describeRefusedSkillLink('<path>', 'EPERM', '<kept path>'),
    "Cursor skill could not be installed: the file system refused to put Codebook's new file in place as <path> (EPERM). Codebook's previous skill is kept as <kept path>; move it back to <path> to go on using it. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.",
  )
})

// Value: protects=a learner whose `~/.cursor` or a folder below it is a link (a home folder whose settings are linked from elsewhere) reading that Codebook sets up nothing below a link, which sentence a setup ends with and what either step does to the link; fails_when=the README does not state the limit, quotes another sentence than the setup builds for a link at a folder above the skill folder, or names another step for the skill folder than the product has; why_new=Cycle 0046 row 277: the limit stood in the cycle record alone; seam=none
test('the packaged README says that Cursor setup does not go below a link, names the three folders, quotes the refusal of a setup for a link at ~/.cursor/skills as the setup builds it, and gives the step of the skill folder', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const paragraphs = readme.split('\n').filter((line) => line.trim() !== '')
  const aLink = { isSymbolicLink: () => true, isDirectory: () => false }

  // Act: the paragraph and the one right before it, and the end of the refusal as the product builds it for a link.
  const at = paragraphs.findIndex((line) =>
    line.startsWith('**Cursor setup does not go below a link.**'),
  )
  const paragraph = paragraphs[at] ?? ''
  const stepOfTheSetup = stepPastNoRealFolder(
    aLink,
    PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
    'Codebook: Set Up AI Chat',
  )
  const facts = {
    standsAfterTheHardLinkParagraph: (paragraphs[at - 1] ?? '').startsWith(
      '**Cursor setup needs a file system with hard links.**',
    ),
    namesTheThreeFolders: paragraph.includes(
      'When `~/.cursor`, `~/.cursor/skills` or `~/.cursor/skills/codebook` is a link',
    ),
    namesTheThreeCommands: paragraph.includes(
      'Codebook refuses the setup, the reconnect and the removal, and leaves the link and what it points to as they are.',
    ),
    quotesTheRefusalOfTheSetup: paragraph.includes(
      `\`Codebook will not follow a non-directory skill path: /home/user/.cursor/skills. ${stepOfTheSetup}\``,
    ),
    givesTheStepOfTheSkillFolder: paragraph.includes(
      `At \`~/.cursor/skills/codebook\` the step reads \`${REMOVE_LINK_OR_RENAME_IT}\`, because what that link points to may be a skill of your own.`,
    ),
  }

  // Assert: the README's quotation ends as the product's sentence does, word for word.
  assert.deepEqual(facts, {
    standsAfterTheHardLinkParagraph: true,
    namesTheThreeFolders: true,
    namesTheThreeCommands: true,
    quotesTheRefusalOfTheSetup: true,
    givesTheStepOfTheSkillFolder: true,
  })
  assert.equal(
    stepOfTheSetup,
    "That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
  )
  assert.equal(
    REMOVE_LINK_OR_RENAME_IT,
    'Remove the link or give it another name',
  )
})

// Value: protects=a learner whose Wiki output folder, or a folder on its path inside the project, is a link, or whose output is named by a Windows short name in the setting, reading why an update, the publisher and the opening of the Wiki refuse it and what to do instead; fails_when=the README loses one of the refusals' sentences (the update start's two, the publisher's two, the reader's two), the limit of a short name with its step, or still says that the Wiki opens through a link; why_new=Cycle 0046 rows 185 and 265 (the refusal and the limit of a short name); row 220's decision that opening stays was superseded by /ship repeat review SC2, and maintainability review MT15 asked for the final behaviour; seam=none
test('the packaged README quotes the refusals of a link or a file on the Wiki’s path inside the project, by the update start, the publisher and Open DeepWiki in Browser, the Wiki folder included, and states the limit of a folder named by a Windows short name with what to write instead', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const manifest = await readFile(
    join(__dirname, '..', '..', 'package.json'),
    'utf8',
  )

  // Act
  const delivered = heldSentences(readme, [
    "A link or a file on the Wiki's path inside the project, the Wiki folder included, is refused wherever Codebook reads or writes the Wiki.",
    'An update does not start when the Wiki folder itself is one (`Update not started (<time>): the Wiki folder itself (<name>) is a link or a file, or leads out of the project, and the publisher refuses anything there but a folder of its own. Replace it with a real folder (if it is a link to your Wiki’s folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then press Update LLM Wiki again.`) or when a folder above it is one (`Update not started (<time>): the Wiki folder’s path in the project passes through a link or a file (<path>), and the publisher writes only into the project’s own folders, so nothing was written. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then press Update LLM Wiki again.`).',
    'The publisher refuses it too and writes nothing (`The Wiki folder <path> is a link, a file or a folder that leads out of the project. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.` for the Wiki folder itself, and `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: <path>. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.` for a folder above it).',
    "**Codebook: Open DeepWiki in Browser** and the Wiki reader read nothing through it (`The Wiki folder <folder> is a link or a file, or leads out of the project. Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to your Wiki’s folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`, and for a folder above it `The Wiki folder <folder> lies behind a link or a file in the project (<path>). Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`; the editor's notice shows the refusal as it is).",
    'An output folder outside the project stays your choice, and a link on its path there is followed.',
    "One limit: on Windows an output folder whose last name is written as a short name (`WIKI~1`) is taken for no folder of its own and gets the update's sentence of a Wiki folder that is itself a link or a file; write the folder's long name in `codebook.wikiOutputDirectory`.",
  ])
  const retired = readme.includes(
    'still opens a Wiki through a link at its folder',
  )

  // Assert: every sentence, none of the retired statement, and the setting and the command the README names are the manifest's.
  assert.deepEqual(delivered, [true, true, true, true, true, true])
  assert.equal(retired, false)
  assert.equal(manifest.includes('"codebook.wikiOutputDirectory": {'), true)
  assert.equal(
    manifest.includes('"title": "Codebook: Open DeepWiki in Browser"'),
    true,
  )
})

// Value: protects=a learner who opens a cloned repository in an untrusted workspace, whose `.vscode/settings.json` names a Wiki folder, learning where the Wiki is read and written instead; fails_when=the README's sentence on the Wiki folder no longer says that an untrusted workspace's own value of codebook.wikiOutputDirectory is not used and that the user setting or the default applies (the manifest's restriction is held by deepWikiOutput.test.ts); why_new=Cycle 0047 row 52 (N1): the restriction stood in the change history only; seam=none
test('the packaged README says, where it names the Wiki folder, that an untrusted workspace’s own value of codebook.wikiOutputDirectory is not used and the learner’s user setting or the default folder applies', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act: the folder's first sentence and the restriction after it, as one text.
  const saysIt = readme.includes(
    "The folder is `.codebook/wiki` in the project unless `codebook.wikiOutputDirectory` says otherwise; the status names it. In a workspace you have not trusted, the editor does not use the workspace's own value of `codebook.wikiOutputDirectory` (a cloned repository's `.vscode/settings.json` could name any folder): your user setting, or else `.codebook/wiki`, applies.",
  )

  // Assert
  assert.equal(saysIt, true)
})

// Value: protects=a learner whose Wiki page shows a dead link, a short page "Page not shown" or a refusal, reading under "LLM Wiki: open and update" what the reader makes inert and what it refuses, with the sentences and the numbers the product keeps; fails_when=the README's section loses the address filter, the page workers' limits (two at a time, four waiting, 10 seconds, 256 MB, 2 MiB), one of the four sentences of the refusal page, the refusal of a page asked for as a part of a page or of a file that is no regular file, or quotes a sentence or a number the product no longer prints or keeps; why_new=Cycle 0047 row 50 (D14.5-2): only the change history described them, with the limits of before Cycle 0047 rows 3, 4 and 19; seam=none
test('the packaged README says under LLM Wiki what the reader makes inert in a served page and which pages and files it refuses, with the refusal page’s sentences and the limits of its page workers', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const section = readme.slice(
    readme.indexOf('## LLM Wiki: open and update\n'),
    readme.indexOf('## Install the private VSIX\n'),
  )
  const tooLarge =
      'This page is too large for Codebook to prepare for reading. No page of a Wiki is that large, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.',
    pastTheDeadline =
      'Codebook stopped preparing this page after 10 seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.',
    failed =
      'Codebook could not prepare this page for reading. Reload the page; if it is still not shown, press Update LLM Wiki.',
    busy =
      'Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.'

  // Act: the section's three paragraphs and four items, each whole, and what the product prints and keeps for them.
  const delivered = heldSentences(section, [
    "Before it serves a page, the reader reads the page's tags as a browser reads them and makes inert each address that is no relative path, `#fragment`, `http`, `https` or `mailto` address and not Codebook's own (an editor address that opens a file or calls another extension, `javascript:`, `data:`, `file:`): the attribute's name becomes `data-codebook-unlinked`, so the element and its text stay and a browser follows nothing. A refresh (`<meta http-equiv=\"refresh\">`), a frame's own page (`srcdoc`) and an svg animation of an address are made inert the same way. This holds for a page of any age, also one that a cloned repository carries or one written by hand into the Wiki folder. Codebook's own addresses get the scheme of the editor that serves the page.",
    "The reader prepares each page in a worker thread, so the editor goes on working while a page is read: at most two pages at a time, each within 10 seconds and 256 MB of heap, while up to four more pages wait for a worker. A page it does not prepare is answered with status 503 by a short page, `Page not shown`, with one sentence and a link to the Wiki's overview (the overview's own has no such link):",
    `- \`${tooLarge}\` for a page file larger than 2 MiB, which is not read, and for a page whose preparation needs more heap.`,
    `- \`${pastTheDeadline}\` for a page whose preparation passes the 10 seconds.`,
    `- \`${failed}\` for a page whose worker failed.`,
    `- \`${busy}\` for a page asked for while two pages are prepared and four wait; its file is not read.`,
    'An HTML page asked for as a part of a page (an image, a style sheet, a script, a fetch), and not to be opened as a page or in an inline frame (the browser says which in `Sec-Fetch-Dest`), is refused with `A Wiki page is served only to be opened as a page.` (status 403); a request without that header, from a client that is no browser, is served. A file of the Wiki that is no regular file (a named pipe, a device, a folder) is never opened, a page or any other file: `The Wiki file is no regular file; a pipe, a device or a folder at its path is not served.` (status 403).',
  ])
  const reasons: WikiPageRefusalReason[] = [
    'too-large',
    'deadline',
    'failed',
    'busy',
  ]
  const printed = reasons.map((reason) =>
    wikiPageRefusalHtml(
      reason,
      WIKI_PAGE_SERVE_DEADLINE_MS,
      '/w/0f/',
      'guide.html',
    ),
  )
  const overviewRefusal = wikiPageRefusalHtml(
    'busy',
    WIKI_PAGE_SERVE_DEADLINE_MS,
    '/w/0f/',
    'index.html',
  )
  const inert = withServedAddresses(
    '<a href="vscode://file/etc/hosts">hosts</a>',
    'vscode',
  )

  // Assert: every paragraph and item; the refusal page prints each quoted sentence, its title and the overview's link, which the overview's own lacks; an address is made inert under the quoted name; and the numbers are the product's.
  assert.deepEqual(delivered, [true, true, true, true, true, true, true])
  assert.deepEqual(
    printed.map((html) =>
      [tooLarge, pastTheDeadline, failed, busy].findIndex((sentence) =>
        html.includes(
          `<title>Page not shown</title></head><body><p>${sentence}</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p>`,
        ),
      ),
    ),
    [0, 1, 2, 3],
  )
  assert.equal(overviewRefusal.includes('Open the Wiki’s overview'), false)
  assert.equal(
    inert,
    '<a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a>',
  )
  assert.equal(WIKI_PAGE_WORKER_CONCURRENCY_LIMIT, 2)
  assert.equal(WIKI_PAGE_WAITING_LIMIT, 4)
  assert.equal(WIKI_PAGE_SERVE_DEADLINE_MS, 10_000)
  assert.equal(WIKI_PAGE_WORKER_HEAP_LIMIT_MB, 256)
  assert.equal(WIKI_PAGE_FILE_LIMIT_BYTES, 2_097_152)
  assert.deepEqual(WIKI_PAGE_NAVIGATION_DESTINATIONS, ['document', 'iframe'])
})

// Value: protects=a learner who finds an entry "Archive missing; remaining files kept" in Saved studies, or whose Node test is refused beside another window, reading what the entry is, how its rest is removed and why the test did not start; fails_when=the README no longer names what is left of a study whose archive was removed, how it is removed with and without a Trash, that it is neither selected nor counted, and that a run whose archive only waits to be saved is not such a loss, or no longer says that the start of a Node test takes the storage lock; why_new=Cycle 0046 rows 86, 181, 248 and 190: the entry, its place in the list and the lock at a Node test's start stood in no document; seam=none
test('the packaged README says what is left of a study whose archive was removed, with its words in the list, how the rest is removed, that it is neither selected nor counted and that a waiting archive is written by Retry, and that the start of a Node test takes the storage lock', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    '- An entry that cannot be opened (an older format, a study whose catalog file is missing, or what is left of a study whose archive was removed) can still be chosen and deleted.',
    '- What is left of a study whose archive was removed (its catalog file, or a recording that no editor of this computer still writes) stays in the list with `Archive missing; remaining files kept` in its label, so that the rest can be removed: **Delete saved study…** moves it to the Trash, and in a window without a Trash **Remove by hand** lists its files. A recording that names another computer is listed too, and so is one whose editor Codebook cannot tell from another program of this computer; for such a recording **Delete saved study…** asks first, as the next point says. Such an entry can be chosen and not opened, it has no **Repair saved study**, a reader that starts neither selects it nor shows it first, and it takes no place of the saved study limit. The finished recording of a run of this window whose archive could not be saved yet is listed with the same words; that study has not left the library, and **Retry storage / refresh** writes its archive.',
    "The start of a Node test is different: it takes the storage lock (`writer.lock` in the learning storage) and reserves its history under it, so of two windows that start a test for the last free place one is refused with `Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.` A start that meets the lock while another window holds it, or a lock that stays, is refused with the storage lock's sentence, which [Delete a saved study](#delete-a-saved-study) quotes and explains; nothing was written then, and the test was not started.",
  ])
  const retired = [
    'An entry that cannot be opened (an older format, or a study whose catalog file is missing) can still be chosen and deleted.',
    'or a recording that no editor is still writing)',
  ].filter((sentence) => readme.includes(sentence))

  // Assert: the README holds each sentence, and the section the last one points to.
  assert.deepEqual(delivered, [true, true, true])
  assert.deepEqual(retired, [])
  assert.equal(readme.includes('\n#### Delete a saved study\n'), true)
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

// Value: protects=a learner or an agent recovering from SOURCE_CHANGED at a start or during a run; fails_when=the README describes only a refused start and hides earlier execution, retained observations or a continuation that sent no resume; why_new=Cycle 0046 rows 314 and 349: the source comparison also ends a running repository-browser or node-test run; seam=none
test('the packaged README distinguishes a source-changed start that ran nothing from a running browser or Node test that ended, preserves earlier observations and says how to start deliberately again', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const delivered = heldSentences(readme, [
    '| `SOURCE_CHANGED` ',
    '| At a start, a cited source open in the editor with text that differs from the article refuses the run before the application, test, browser or debugger starts; Codebook saves no document. During a repository-browser or node-test run, the same change ends the run at its next stop or before a continuation; that continuation sends no resume. Earlier committed observations and their captured source remain readable. Read the existing run and its captured source resources; ask the learner to save or revert the named file: after a save, read the source again and publish the article again; after a revert, change nothing. Then start a new deliberate run. Never retry application input automatically. ',
  ])

  // Assert
  assert.deepEqual(delivered, [true, true])
})

// Value: protects=a learner whose Delete meets a recording that may still be written, reading in the README the dialog they will see, what each answer does, and the refusal for a recording another window of this computer still writes; fails_when=the README quotes another title, detail or button than the dialog, says nothing of the case of this computer or of several recordings, drops the refusal, or loses the line of a move whose state is unknown (PD8, AD10), or quotes the refusal of 0.2.30.0 ("is still recording this study. Stop its run"), which misleads for a window that finished its recording and has not saved the study yet, or leaves that case out (Cycle 0047 row 55); why_new=Cycle 0046 design review PD8: the section quoted neither the dialog nor the refusal; Cycle 0047 row 55: since row 36 the refusal also meets a finished recording whose study is not saved, and its words changed to hold in both cases; seam=the messages of the removal, from which the expected sentences are built
test('the packaged README quotes, under Delete a saved study, the dialog about a recording that may still be written, both of its places, the refusal for a recording another window still writes or has finished and not saved yet, and the line of a move whose state is unknown', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const section =
    readme.split('\n#### Delete a saved study\n')[1]?.split('\n### ')[0] ??
    'no section "Delete a saved study"'
  const messages = studyRemovalMessages('Trash')

  // Act
  const delivered = heldSentences(section, [
    `\`${messages.unconfirmedWriterTitle([{ host: '<host>', startedAt: '<start>', place: 'another-computer' }])}\``,
    `\`${messages.unconfirmedWriterDetail([{ host: '<host>', startedAt: '<start>', place: 'another-computer' }])}\``,
    `**${messages.unconfirmedWriterButton}**`,
    `\`${messages.unconfirmedWriterTitle([{ host: '<host>', startedAt: '<start>', place: 'this-computer' }])}\``,
    `\`${messages.unconfirmedWriterDetail([{ host: '<host>', startedAt: '<start>', place: 'this-computer' }])}\``,
    `\`${
      messages
        .unconfirmedWriterTitle([
          { host: '<host>', startedAt: '<start>', place: 'another-computer' },
          { host: '<host>', startedAt: '<start>', place: 'this-computer' },
        ])
        .split(' on another computer')[0]
    }\``,
    'and names the places that apply (`on another computer`, `in another editor window`, or `on another computer or in another editor window`), and the detail names each host and start. Nothing moves while the dialog is open.',
    'When another editor window of this computer is still recording the study, or has finished its recording and not saved the study yet, nothing moves and the line reads `The saved study could not be moved to the Trash. Nothing was deleted. Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.`',
    `\`${messages.moveUnknown('').trimEnd()}\``,
  ])

  // Assert
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
})

// Value: protects=a learner whose library holds the recording of a run that saved no study, reading that Saved studies lists it and Delete removes it; fails_when=the README still counts "a recording that has no study" among what deletion does not cover, although such a recording is listed and moved since AF2, or no longer says that a recording a run of this computer may still write is that run's and is not listed (AF11), or says again that such a recording is listed once no editor of this computer still writes it, although the finished recording of another open window's run is not listed before that run has saved its study (Cycle 0047 row 36); why_new=Cycle 0046 review AF11: the claim was stale; Cycle 0047 row 54: since row 36 a sealed recording stays its run's until the study is saved, and the sentence left that out; seam=none
test('the packaged README says that the recording of a run that saved no study is listed and deleted, unless a run of this computer may still write it or another open window has finished it and not saved its study yet, and no longer counts it as not covered', async () => {
  // Arrange
  const readme = await readPackagedReadme()
  const section =
    readme.split('\n#### Delete a saved study\n')[1]?.split('\n### ')[0] ??
    'no section "Delete a saved study"'

  // Act
  const delivered = heldSentences(section, [
    '- The recording of a run that saved no study is listed in the same way, with `Archive missing; remaining files kept`, once no editor of this computer still writes it and no other editor window of this computer may still save its study, and **Delete saved study…** moves it to the Trash. While a run of this computer may still write it, or a run of another editor window that is still open has finished it and has not saved its study yet, that run holds it and it is not listed.',
    '- Not covered yet: Node test histories, removing several studies at once, and a study whose run is still held by another window of the same workspace.',
  ])
  const retired = [
    'a recording that has no study',
    'once no editor of this computer still writes it, and **Delete saved study…** moves it to the Trash',
  ].filter((sentence) => readme.includes(sentence))

  // Assert
  assert.deepEqual(
    { delivered, retired },
    { delivered: [true, true], retired: [] },
  )
})
