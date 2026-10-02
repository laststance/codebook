# Changelog

## [0.2.25.0] - 2026-10-03 (development candidate)

Cycle 0041 lets a `text` condition hold the way an agent writes it from source. The comparison now ignores the whitespace that markup leaves around text, so `Log in` matches a button written as `Log in <Icon />`; before, that one trailing space ended an admitted run before its click. When a before `text` condition still cannot hold, the timeout names the rule, and when the element holds the expected text beside other text it says so and names the fix, without returning page text. The help an agent reads before it declares says the same. On macOS, listing a repository's Vitest files no longer fails with `kill EPERM` in the moment after a helper process has exited. Thirteen tests fail on 0.2.24.0 and pass here, with a disabled-fix control for each fix (16 controls); full 1,774 and package 192 tests. Bounded installed trials on a pre-release build of the `text` change: in VS Code 1.140.0 through Copilot Chat Auto, a prepared `text` condition "Log in" on the dashboard's login button held and the click was sent; the same natural `/codebook` request, sent once per editor, reached the observed result on its third run in VS Code and on its fourth run in Cursor 3.23.14 Agent, where it is the first live explanation, saved and reopened.

- **A natural request still does not pass on its first run, in either chat.** In both editors the agent's first run failed when Codebook continued from a server stop and the debugger paused or continued once more by itself ("Selected server resumed outside its owned continuation", "Additional server stop invalidated the declared operation", "Unowned continuation invalidated live pause"). The cause is not verified. A stop the debugger binds on the next line, and a browser stop at an unmapped column, each cost a run too.
- **The new hint does not reach an after condition.** When an after condition never holds, the run's own 20-second limit ends it first with "Repository after condition or input acknowledgement timed out", which names neither the condition nor the rule. 0.2.24.0 behaved the same way; the sentences for an after condition exist and are tested, but only a before condition gets them today.
- **"Beside other text" is also said for part of a word or number.** A declared `Log` inside "Login failed", or `1` inside "10", gets the same relation and the same advice to choose another selector, although the text simply differs.
- **Text of neighbouring child elements is joined without a space.** `<span>Total</span><span>5</span>` is "Total5" to the comparison, and collapsing whitespace cannot add the space; the hint does not say this. Zero-width characters are not whitespace.
- **Cursor needs "Codebook: Set Up AI Chat" again after an extension update.** Until then its Agent has no Codebook tool and says so. The command is in the Command Palette only.
- **The same `kill EPERM` can still end the release of a Node test run or of the development server on macOS.** Only the Vitest listing is fixed. A group that cannot be signalled for another reason now ends with a timeout text that no longer names `EPERM`.

Final acceptance remains open. No registry publication.

### Changed

- A `text` condition compares the element's whole text with the declared text after whitespace runs are collapsed to one space and both ends are trimmed, on both sides. A before condition therefore holds in more cases than in 0.2.24.0. An after `text` condition that differs from the text before the click only in whitespace is now already true before the input, and the run is refused with "Configured after conditions were already true before application input"; declare an after condition that the click really changes.
- A before `text` condition that times out adds: "A text condition compares the element's whole text, child elements included, with whitespace collapsed." When the element holds the expected text beside other text, it also adds: "Here the element holds the expected text beside other text; use a visible condition, or a selector whose element holds only that text."
- The configured help (`inspections`, `initialState`) and step 4 of "Run one configured repository action" in the extension README state the rule, the icon-button case and what the timeout says.
- A page result with a text relation Codebook does not know fails the run at once instead of being ignored until the timeout.

### Fixed

- A finished listing of a repository's Vitest test files returns its files, and a cancelled one keeps the run's own reason, when macOS answers `EPERM` because a process of the listing's group has exited and is not reaped yet. Before, either could end with "kill EPERM" (seen once in this project's own test suite).

## [0.2.24.0] - 2026-10-03 (development candidate)

Cycle 0040 makes a deletion say what really happened when a step around it fails, and gives the delete button back when a study you chose could not open. A deletion whose files all reached the Trash is reported as moved even when the library's lock file could not be removed afterwards, the "moved" line stays when the next study cannot be arranged, a study you choose while a deletion runs is not replaced, a choice the reader refused or dropped puts the list back and releases the button, a study chosen in the bottom panel while the Study workspace is closed is shown there, and a refused start an agent repeats keeps its refusal until the repeat is accepted. Each behavior change has a mechanism test (29 tests and three webview cases fail on 0.2.23.0 and pass here) and a disabled-fix control (32 controls); full 1,751 and package 192 tests. Bounded installed trials on a pre-release build of this source: in VS Code 1.140.0 through Copilot Chat Auto a Node test history chosen during Recording was refused and the delete button gave the Recording reason instead of waiting; a study chosen in the bottom panel while the Study workspace was closed was shown there; a start on a full library was refused, a study was deleted with its archive, catalog file, recording and raw evidence in the Trash, and the same start with the same key began a new run that reached its four stops, was saved and reopened. In Cursor 3.23.14 a study was deleted and another study's recording presented its saved moment. The failures themselves (a lock that cannot be released, a ledger that cannot be written back, a study that cannot be arranged, a dropped choice) are produced by tests only, not by an installed run. Delivery review found nothing critical. It did find further rare timing overlaps on the same control, read from the code or shown with injected delays and failures, three of them named by more than one reviewer; they are listed first below and wait for a later cycle. The project records also carry the delivery closure of Cycle 0039.

- **The next study and a study you choose meanwhile.** While Codebook arranges the next study after a deletion, you can choose another study and see it. If that arrangement then fails, the reader drops your study as well: it shows no study, remembers none, and lists a reason about a study you did not ask for. Choose your study again. 0.2.23.0 kept your study there and lost the "moved" line instead.
- **A click inside the study that is being deleted.** Selecting an item of that study, returning to the current pause or opening repository evidence while its files move counts as a choice of your own. Afterwards the reader shows no study, not the next one as 0.2.23.0 did.
- **A Node test history chosen while a deletion finishes.** A Node test history stop opened while the next study is being read can leave the source pane on "Configured source is unavailable" while the history and the native debugger stay on that stop. A saved study chosen right after a Node test history, at the moment the deletion finishes, can stay selected without its content until you choose it again.
- **A reason that stays listed.** When a study could not be arranged, the reason stays among the pane's errors after the next study has opened.
- **The bottom panel of a closed Study workspace.** A study chosen there whose archive cannot be read, or whose choice is dropped, leaves that panel loading until the Study workspace is opened or another choice opens. Only a choice that opens is shown there.
- **A storage lock that stays.** When the lock could not be released, the "moved" line can still tell you to ask your agent to start the refused run again, although that run's saves are refused until the file `writer.lock` in the learning storage is removed. Codebook has no command that removes it. A lock file that had already disappeared is reported the same way although nothing blocks later saves.
- **After "Nothing was deleted" with a ledger that could not be written back.** The files are whole, but the learner ledger on disk has forgotten which study was shown and where the repository reading returns to, until the next selection is saved.
- **Tested by a script that CI does not run.** The Study pane's half of the new reply (the list going back, the button released) is covered by the Chromium script only.
- **Not covered, as before.** Node test histories and recordings without a study cannot be deleted; a study deleted in one window while another window of the same workspace holds its run is not handled, apart from the raw evidence staying; a crashed window's connection file keeps that window's evidence in place; the Trash route was observed on macOS only; restoring a deleted study by hand at the ceiling of 256 makes the library unreadable until one archive is moved out again.

Final acceptance remains open. No registry publication.

### Added

- When the library's lock file cannot be released after a deletion moved every file, the pane lists `Learning storage lock could not be released after the removal: <cause>` among its errors, beside the "moved" line.

### Changed

- "Only partly moved" is now said only when a file of the study is in the Trash. When the Trash refuses a file and the learner ledger then cannot be written back, the line says that nothing was deleted and names both failures; the study, its run and **Save learning replay** stay as they were. 0.2.23.0 said "partly moved" and treated that run as deleted.
- The delete button waits only while the entry you chose is opening. When the reader could not open your choice (it names the reason among its errors), the list goes back to the study that is shown and the button says why it can or cannot be used for that study.
- A repeated start that is itself rejected (an unknown profile, an invalid configuration, another run still active, a presentation change in progress) keeps the refused run: its resource still answers with the refusal, and the next repeat with the same key begins a new run.
- When a study you chose during a deletion fails to open, the reader shows no study; it does not fall back to the next one.
- The extension README's "Delete a saved study" describes what each failure line means, what waits while a study is being moved, and when the delete button waits.

### Fixed

- A deletion that moved every file no longer says "Nothing was deleted" when the library's lock file could not be released afterwards, and a write that was waiting no longer puts the deleted study back into the library. When only part of the study had moved, the line says "partly moved" and names both the Trash's refusal and the lock.
- A deletion keeps its "moved" line, and tells a refused run to start again, when the next study cannot be arranged (for example while a presentation change is pending). The reader then shows no study and names the reason among its errors.
- A study, or a Node test history, that you finish choosing while a deletion is still moving files or reading the learner ledger stays shown; the next study is not read over it.
- After a deletion, the reader no longer keeps pointing at the deleted study when showing the next one was overtaken by a choice that then failed.
- A saved study whose opening is dropped because you chose another one, or because the view changed meanwhile, no longer leaves the reader loading with every later choice ignored. A study that was read and then could not be arranged ends loading and names the reason.
- An older saved-study read that finishes after you opened a Node test history no longer closes that Node test history.
- The delete button no longer keeps saying `Wait for the chosen saved study to open.` after an open that was refused before it started: a presentation change in progress, a Node test history chosen while Recording is open, a recording that fails to open, or a choice with an outdated view. A choice made in the bottom panel while a recording is still loading is answered when that load ends, also when the Study workspace is closed first.
- A saved study chosen in the bottom panel's **Saved studies** while the Study workspace is closed is shown there. Before, the panel kept the earlier study's moments until the Study workspace was opened.

## [0.2.23.0] - 2026-10-02 (development candidate)

Cycle 0039 makes deleting a saved study act on the study you chose and take everything of it: the delete button waits until the entry you picked is open, a deletion also moves the raw evidence of that run to the Trash, the line under the button says what the Trash really took, and an agent can repeat a refused start with the same request. Each behavior change has a mechanism test (33 tests and one webview case fail on 0.2.22.0 and pass here) and a disabled-fix control (36 controls); full 1,720 and package 192 tests. Bounded installed trials: in VS Code 1.140.0 through Copilot Chat Auto a start on a full library was refused, a study was deleted with its raw evidence, and the same start with the same key began a new, admitted run; that run then ended before its click on a condition the agent had added itself, and a further run with a new key reached its four stops, was saved and reopened. The study of that window's own run was deleted with its archive, catalog file, recording and raw evidence in the Trash and the next study shown; choosing another entry and pressing delete at once never named the earlier study. In Cursor 3.23.14 a study with raw evidence was deleted and another study's recording presented its saved moment. Delivery review found nothing critical. It did find defects in rare failure paths of the new code, two of them reproduced by an outside reviewer; they are listed first below and wait for the next cycle. The project records also carry the delivery closure of Cycle 0038 and the owner's decision to resume work. Known limits:

- **A storage lock that cannot be released.** If the library's lock file cannot be removed after the files were moved (for example it was deleted by hand during the deletion), the line says "Nothing was deleted" although the study is in the Trash, and a write that was waiting can put the study back into the library without its recording. 0.2.22.0 said "partly moved" in that case.
- **When the next study cannot be arranged.** After a deletion that followed a live run, the reader arranges itself for the next study. If that fails (a presentation change is in progress, or the Study workspace is being opened), the files are in the Trash but no "moved" line appears, a refused run is not told to start again, and the next study is not remembered.
- **The next study and your own choice.** A study you finish choosing while a deletion is still reading the learner ledger can be replaced by the next study. If showing the next study is overtaken or the reader is closed during the move, the reader can keep pointing at the deleted study and show "Study archive is unavailable." until you choose another.
- **The delete button can keep waiting.** When an open you asked for is refused or dropped before it starts (a presentation change in progress, a Node test history chosen while Recording is open, a recording that fails to open, a request overtaken by a repository navigation), the list can keep the entry you chose and the button can keep saying `Wait for the chosen saved study to open.` Choose an entry again.
- **Raw evidence that stays.** A window that crashed leaves its connection file behind, and deletions then keep the evidence of that window's runs in place every time, with the "may still be open" sentence. An evidence folder that cannot be inspected (a permission or disk error) is left in place while the line says the study was moved, and the study has left the list, so it cannot be deleted again from Codebook. Evidence of runs that were never saved as a study is not touched.
- **When the Trash refuses twice.** If the Trash refuses a file and the learner ledger then cannot be written back, the line says "partly moved" and that run is treated as deleted (its explanations are refused, Save learning replay is gone) although its files are whole.
- **While the files move.** An agent that reads a screenshot of that run in those moments gets "Captured file is unavailable." with the file error and the storage path. Stopping the editor waits for the whole deletion, including showing the next study.
- **Repeating a refused start.** A repeated start that is itself rejected (an unknown profile, an invalid configuration, another run still active) forgets the refused run: its resource answers `NOT_FOUND` and no new run exists. A run that repeats a refused key and also reaches its stops was not seen in one installed run.
- **Not covered, as before.** Node test histories and recordings without a study cannot be deleted; a study deleted in one window while another window of the same workspace holds its run is not handled, apart from the raw evidence staying; the Trash route was observed on macOS only; restoring a deleted study by hand at the ceiling of 256 makes the library unreadable until one archive is moved out again.

Final acceptance remains open. No registry publication.

### Added

- **A deletion takes the run's raw evidence with it.** **Move to Trash** now also moves the screenshots, the sealed source and the event journal of that study's run from the extension's agent storage to the system Trash. The dialog says so: `Any saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.`
- When the run belongs to another Codebook window that may still be open, its raw evidence stays and the line ends with `The run's raw evidence was left in place because its Codebook window may still be open.`
- After a deletion, an agent that reads the run's evidence (`manifest`, `events`, observations, explanations) or adds an explanation gets `EVIDENCE_UNAVAILABLE` with `The learner moved this saved study to the Trash.` The run resource itself still answers and names the same reason. While the files are moving, an explanation is answered `BUSY` with `The learner is deleting this run's saved study; wait for it to finish.`
- A start the library refused can be repeated with the same key once there is room, and a new run begins. Help for configured runs says so.

### Changed

- The delete button waits while an entry you chose is still opening: the list keeps that entry, and the button says `Wait for the chosen saved study to open.` and sends nothing. The reader refuses a delete request in that state as well, also for a Node test history that is still opening.
- A deletion is refused while a recording is still opening, with the same sentence as for an open Recording (`Choose Overview or Live to leave Recording before deleting this study.`).
- **Save learning replay** is refused for a study while it is being moved to the Trash.

### Fixed

- The delete button no longer acts on the study shown before while a newly chosen entry is still loading.
- A deletion whose first file the Trash refuses says that nothing was deleted, and the learner ledger is back to what it was. 0.2.22.0 could report "partly moved" for a study that was whole and then stopped saving that run's explanations.
- An explanation that was waiting to be saved when a deletion moved nothing is written right afterwards. Before, it waited for the next change, **Retry storage / refresh** or shutdown. Closing the editor during a deletion no longer drops the last state of a study whose deletion moved nothing.
- The study Codebook shows after a deletion no longer replaces a study you chose in the meantime while that study was still opening or while the next one was being read, and after a live run the reader is arranged for it like for an entry you chose yourself.
- A start that repeats the key of a run the library refused no longer gets the refusal back for ever; it asks the library again.

## [0.2.22.0] - 2026-10-02 (development candidate)

Cycle 0038 gives you a way back to a live run when the study library is full: you can delete a saved study yourself, and a run the library refused no longer takes the room you made. Mechanism tests cover each behavior change, with a red-before-green regression where the old behavior existed and a disabled-fix control (38 controls); the new code is split into small functions without a behavior change. Bounded installed trials: in VS Code 1.140.0 through Copilot Chat Auto a prepared run on a full library was refused before any input and left nothing behind; a saved study was moved to the Trash through the new button and the editor's confirmation, and Cancel changed nothing; the same request was then admitted, reached its four stops on its first run, was saved and reopened; in Cursor 3.23.12 a study with a recording was moved to the Trash and another study's recording presented its saved moment. Delivery review found nothing critical in the product; it found one test that read a result before it was reported, fixed in the test, and its other findings wait for later cycles. The test execution guide's account of a delayed CI Test job is corrected. Known limits, from the reviews and the trial:

- **What a deletion leaves.** It moves the study's archive, its catalog file and its recording. The raw evidence of that run (screenshots, captured values, the sealed source and the explanations under the extension's agent storage) stays on disk, and until the editor session ends an agent can still read that run's snapshots.
- **Restoring from the Trash.** Restoring a deleted study by hand while the library holds 256 studies makes the library unreadable until one archive is moved out again. In the window that deleted it, a restored study's playback position is not saved and its run stays without history until the window is reloaded.
- **Timing.** A deletion confirmed while that study's recording is still opening is not refused: the recording then opens on a removed study and its playback fails; choose another study. After a deletion, the next study Codebook opens can replace a study you chose while it was loading. The delete button can act on the study shown before while a newly chosen entry is still loading; the dialog names the study it will move.
- **When the Trash refuses.** An explanation that was waiting to be saved is then written only at the next change, at **Retry storage / refresh** or at shutdown. A removal whose first file move is refused can be reported as partly moved although the study is intact, and that run's later explanations are then not saved. The Trash route was observed on macOS only; an editor that cannot move extension storage to the Trash shows the failure line and offers no other removal, also at the maximum of 256.
- **Starting again.** After a deletion made room, an agent that repeats the start with the same request key gets the refused run's answer back and needs a new key. A run that fails before the library is checked (no workspace or no repository storage) on a full library still shows "History not saved" and can be written later.
- **Texts.** With the limit lowered below the number of saved studies the success line reads like "holds 69 of 64" and names no next step. A refused run's resource still lists `read-history`. The "full" message an agent receives does not itself say that only the learner deletes a study; the help does.
- **Storage edge cases.** A progress file that cannot be read blocks every deletion. An editor killed in the middle of a deletion leaves the storage lock in place, and later saves fail until it is cleared. The deletion does not check that a recording folder is a real folder inside the storage (the extension's private storage would have to be altered first). A window that records, deletes and runs again many times keeps each finished recording's journal in memory until it closes.
- **Not covered.** Node test histories and recordings without a study cannot be deleted; the list does not mark which studies have a recording; a study deleted in one window while another window of the same workspace holds its run is not handled; VS Code 1.140 can open a `code chat` request in a Copilot CLI session that cannot reach Codebook's tools.

Final acceptance remains open. No registry publication.

### Added

- **Delete a saved study.** In the Study pane, **Saved studies** has its own section with a **Delete saved study…** button. A native dialog names the study and asks `Move this saved study to the Trash?`; **Move to Trash** moves its archive, its catalog file and any saved recording to the system Trash (Recycle Bin on Windows), where the operating system can restore them. Codebook has no permanent delete, and an agent has no tool for this. Afterwards the pane shows a line such as `Saved study moved to the Trash. The library now holds 63 of 64 saved studies.` and, when the deleted study was the one shown, the next older study. What you marked as understood is kept; a Repository Wiki link to the removed study shows as unavailable.
- When the deletion made room for a run that was refused, the line ends with `Ask your editor agent to start the run again.` and the "did not start" line goes.
- An entry that cannot be opened (an older format, or a study whose catalog file is missing) can be chosen in the list and deleted.
- The button says why it cannot be used (`Choose a saved study to delete.`, `Node test histories cannot be deleted here yet.`, `Stop the run before deleting its study.`, `Choose Overview or Live to leave Recording before deleting this study.`) and stays reachable by keyboard while it is unavailable.
- If the Trash refuses, nothing is deleted and the line says so. If only part of the study could be moved, the study stays listed; delete it again to finish.

### Changed

- The "library is full" messages name a remedy that works at every limit. Below 256: `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Existing learning was kept.` At 256: `Study library is full at its maximum of 256 saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Existing learning was kept.` The messages for a study that cannot be saved (`…then retry storage.`) and for a recording that cannot start (`Recording library is full…delete a saved study that has a recording…`) follow the same pattern. The Node test "storage is full" message is unchanged.
- A saved-study limit that is not an integer from 1 to 256 ends a run with `PREREQUISITE_MISSING` and `Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to 256. Existing learning was kept.` Before, the run ended as `RUNTIME_FAILED` with that text only in its cause.
- While a refused run is the current one, the Study pane shows `The last run did not start: <message>` and does not offer **Retry storage / refresh** for it. The run's resource reports its history as unavailable with `The run was refused before it started; nothing was saved.` After you delete the study of a stopped run, that run's resource says `The learner moved this saved study to the Trash.` and **Save learning replay** is no longer offered for it.
- Help for configured runs says that only the learner removes a saved study, in the Study workspace; the description of **Codebook: Saved Study Limit** names both remedies.

### Fixed

- A run refused because the study library is full is never saved later. Before, it was written as a not-demonstrated study once the limit was raised (by **Retry storage / refresh**, a server stop or an editor shutdown) and took the room you had made; the pane also showed "History not saved" for it.
- Refused runs no longer use up the 16 runs an editor session keeps: when all 16 are taken, the oldest refused or deleted run gives up its place. Sixteen ordinary runs still refuse a 17th with the unchanged message.

## [0.2.21.0] - 2026-10-02 (development candidate)

Cycle 0037 lets a live explanation start right after an extension update and tells you before a run when its explanation could not be saved. It also restores two behaviors of 0.2.19.0 that 0.2.20.0 changed by mistake. Mechanism tests cover each fix with a red-before-green regression and a disabled-fix control. Bounded installed trials: in VS Code 1.140.0 through Copilot Chat Auto a run on a full study library was refused before any input; after an update with the reader open the first presentation selection closed the old session's panes and opened the reader with no manual click, though it answered `layoutConfirmed: false` once before the agent's next call confirmed the layout; a prepared declaration of three server stops and one browser stop reached every stop on its first run, was saved and reopened; a natural request reached the observed result in one submission and one run, after it had read the prepared run's stops; in VS Code and Cursor 3.23.10 a stopped replay came back with one Recording press, and in Cursor the first click after an update left one Application pane and one Study pane. Delivery review found nothing critical; its other findings wait for later cycles, first among them the two full-library limits named next, which three review passes reported independently. Known limits: with the saved-study limit at its maximum of 256 and a full library every configured run is refused, the message names a setting that cannot be raised further, and Codebook has no command that removes a saved study; a run refused for a full library can still be written to the library as a not-demonstrated study once the limit is raised (by Retry storage, a server stop or an editor shutdown), which takes the slot you freed; another failure of that check (an invalid limit setting, an unreadable library folder) ends the run as `RUNTIME_FAILED` with the useful text only in its cause; an agent that starts a run before the Study workspace is opened leaves the leftover panes in place, and a later selection can be refused as before; a leftover Repository Wiki pane is not closed; a first selection with one of your text tabs in the source column can answer `layoutConfirmed: false` until the next call; a selection that closes leftover tabs can still be refused afterwards for another reason, with those tabs already closed; an unpinned preview tab of another extension still refuses a selection; a natural request has not passed on its first run without help from an earlier run; the live path was not run in Cursor. Final acceptance remains open. No registry publication.

### Changed

- A configured run on a study library that is already full is refused before the application receives any input. The run ends with `PREREQUISITE_MISSING` and `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run. Existing learning was kept.` Before, the run went on and you learned only afterwards that it could not be saved. The check looks at the library when the run starts; a slot another window takes during the run is still reported when the run is saved, with the unchanged save message.
- The first time the Study workspace opens in an editor session, Codebook closes the Application and Study panes an earlier extension session left in the window (they stay after an extension update or **Restart Extensions** and no longer respond). Your own tabs are kept. If the editor keeps such a pane open, a presentation selection ends with `PRESENTATION_UNAVAILABLE`, the message `A Codebook pane left by an earlier extension session is still open. Close the leftover Application and Study tabs, then select the presentation again.` and the cause `A leftover Codebook pane could not be closed.`; opening the workspace from the Learning Outline or through **Recording** continues as before.
- Help for configured runs and the extension README now say what the tool answers when a later stop cannot be armed: that `codebook_continue` answers `Continue was not confirmed.` with the arming error as its cause and sends no resume; the run ends with the reason `Next declared stop was not armed and no resume was sent` (read the run resource), and earlier observations stay. Before, the help named the run's reason as the tool's answer.

### Fixed

- The first presentation selection after an extension update with the reader open is no longer refused with `Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.` or `The current presentation tab is not unique.`
- A stack refresh the debugger sends in the instant after a server stop pauses no longer fails the run with `Native stack refresh changed the captured source location`. Until the stop's bound position is known, the refresh is held to the stop's file and declared line; the stop is still committed at the position the debugger bound. 0.2.19.0 accepted this refresh and 0.2.20.0 did not.
- A Node test stop the debugger acknowledges at another column is refused during preparation again, with `Selected adapter did not acknowledge the exact breakpoint registration`, before the test continues. In 0.2.20.0 it was accepted and failed only at its pause.

## [0.2.20.0] - 2026-10-02 (development candidate)

Cycle 0036 removes the rules that made a natural `/codebook` request fail on its first run for reasons outside the learner's application: a stop that paused before its turn, a stop the debugger bound at another column of its line, and a browser stop that waited 20 seconds before saying anything. Mechanism tests cover each fix with a red-before-green regression and a disabled-fix control. Bounded installed trials: in VS Code 1.140.0 through Copilot Chat Auto a prepared declaration of three server stops and one browser stop reached every stop on its first run, one of them at a column the debugger moved; a natural request reached the observed result in one submission and two runs; in VS Code and Cursor 3.23.10 a stopped replay came back with one Recording press. Delivery review found one regression of this cycle, fixed before release (the refused replay control below), and nothing else critical; its other findings wait for later cycles, and one automated review pass answered in a form its checker could not read and counts as missing coverage, not as a pass. Known limits: the first presentation after an extension update with the reader open still fails, now while the panes are placed, and needs a click on a Study or Application pane; a natural request does not yet pass on its first run; a later stop of the other participant is checked only inside the continuation before it, so a run can fail there after earlier stops and application effects; a full Learning Library is reported only after a run has finished; the live path was not run in Cursor; a study saved by this version whose stop sits at a column the debugger moved cannot be opened by 0.2.19.0 or older, which require the declared column and report altered evidence; if the debugger refreshes its stack in the instant after a server stop pauses, the run fails with "Native stack refresh changed the captured source location" where 0.2.19.0 accepted the refresh (reported by review, not seen in the trials); a reader closed during its first load answers an agent's seek or play with "Recording is not ready"; a Node test stop the debugger acknowledges at another column is now refused only at its pause, one resume later. Final acceptance remains open. No registry publication.

### Changed

- Codebook arms only the next expected stop: the first one before the input, and each later one inside the `codebook_continue` that follows the stop before it. A later stop's line can run earlier without pausing, so declare stops in the order the action executes them.
- The line of a declared stop is the declaration and the column is a request. Codebook accepts the debugger's verified binding anywhere on the declared line and uses that position for every check, for saved evidence and for display. Each observation's inspection resource reports it as `source` beside the new `requestedSource`, the position you declared.
- Binding failures name the declared stop, and their texts changed:
  - a binding on another line fails at once with `Declared stop <path>:<line> bound at <line>:<column>, not on its declared line` and the mapped positions of that stop's citation;
  - a browser binding that never verifies ends after the same 20 seconds with `Timed out waiting for a verified binding of declared stop <path>:<line> on its declared line (requested column <column>)`;
  - a later stop that cannot be armed ends the run with the reason `Next declared stop was not armed and no resume was sent` (that `codebook_continue` call answers `Continue was not confirmed.` with the arming error as its cause; read the run resource for the reason);
  - a later stop that is not hit ends the run with `Repository continuation reached no next declared pause: declared stop <path>:<line> was not hit within 20 s; its line must execute after the preceding continuation`;
  - a refused registration reads `Declared stop <path>:<line> was not registered`, followed by the adapter's reason.
- A declared line the sealed source map never reaches is refused during preparation, before any input reaches the application.
- A seek or play sent before a recording has loaded is told that the recording is not ready, not that the reader is closed.

### Fixed

- A browser stop declared after server stops no longer fails the run when its line executes before its turn.
- A server stop the debugger binds at another column of its declared line commits there. Before, the run failed. A saved study with such a stop reopens with its native values.
- A browser stop on a line the debugger binds elsewhere fails at once and names where it landed, without the 20 second wait.
- A refused replay control leaves the Learning replay panel once the recording is opened again, a later replay control is accepted, an agent reopens the recording, or your next live-run action succeeds. Before, only a successful live-run action removed it, so it stayed after the recording was reopened.
- Selecting a presentation on a closed reader closes the captured-source tabs an earlier editor session left behind and keeps your own tabs.

## [0.2.19.0] - 2026-10-01 (development candidate)

Cycle 0035 makes a learning replay recover while the live run it came from is still attached, and keeps the moment you confirmed last. Mechanism tests cover each fix with a red-before-green regression and a disabled-fix control. Bounded installed trials: in VS Code 1.140.0 a natural `/codebook` request through Copilot Chat Auto reached three server stops and the observed result on its second submission, the saved study reopened with two recorded stops, and the replay recovered in about 1.5 seconds with a live run paused beside it; in Cursor 3.23.10 the recovery with no application running took about one second. The failure itself was not reproduced in an installed editor; the mechanism tests show it on 0.2.18.0. Delivery review found nothing critical, and its other findings wait for later cycles; one automated review pass answered in a form its checker could not read and counts as missing coverage, not as a pass. Known limits: a natural request is not yet reliable on its first run; a recording that is still being captured recovers in about 2.1 seconds; after a refused control the reader keeps showing the refusal until a live-run action succeeds; a seek or play sent while a recording is still loading is told that the reader is closed instead of that the recording is not ready; switching to another recording and back before a position save lands can return to the older saved position. Final acceptance remains open. No registry publication.

### Changed

- A seek or play on a recording whose reader you closed is refused and tells you to open the recording first, for an agent and for the Learning replay panel. Before, it brought back the Application panel alone. Pause still answers, and opening the recording brings the reader back at the saved moment.

### Fixed

- With a live run still attached, pressing **Recording** after the **Codebook · Recorded learning** session ended presents the saved moment again. Before, the live run's loading page replaced the recording's renderer in the shared Application panel, the frame was never acknowledged, and the replay failed after its waits.
- Reopening a recording returns to the moment you confirmed last even while that position is still being saved, or after the save failed. If the recording became shorter, it opens at its end.
- When the historical debugger gives up and both the reader update and the reader's error channel fail, the replay still ends with the reopen message instead of waiting.

## [0.2.18.0] - 2026-10-01 (development candidate)

Cycle 0034 makes a learning replay recover when you reopen it, and keeps one replay request from colliding with the cleanup of the request it replaced. Mechanism tests cover each fix with a red-before-green regression and a disabled-fix control, and bounded installed trials ran in VS Code 1.140.0 and Cursor 3.23.10 with no application running. One planned test for a settle path that the reader cannot reach was not written. Delivery review found nothing critical. It reported, from reading the code, that the recovery below may fail while a live run's application panel is still attached, and that it may return to an earlier saved position while a position save is still pending; neither was reproduced, and both go to the next cycle. The paused foreign-session case and the Node stop in Cursor were not run. Final acceptance remains open. No registry publication.

### Changed

- After you end the **Codebook · Recorded learning** session on a displayed replay, pressing **Recording** presents the saved moment again in a new session. Before, that press did nothing until a seek had failed.
- An agent that opens the same recording after you closed the reader opens the reader again and presents the saved moment.
- A historical debugger that gave up after its five-second bound stays unavailable until you reopen the recording. A late answer from the editor no longer brings it back by itself.

### Fixed

- Opening a recording while the editor is still stopping the previous historical debugger waits for that stop instead of failing with a second debugger registration. Closing the reader waits for it too.
- Opening a recording again after its first reader entry was abandoned waits for that entry instead of reporting that Codebook is busy. If the entry never finishes, the busy message follows after about five seconds.
- A recorded-application panel that was still being revealed when you opened the recording again keeps its place and paints the next frame.
- Stopping the historical debugger right after a slow startup no longer fails: the five-second stop bound now starts once the startup has settled.
- A stop presented after the editor disposed the historical debugger, or a reader update that throws while the debugger gives up, now ends with the reopen message instead of leaving the replay waiting.
- A saved Node stop whose captured source no longer matches offers no **Inspect in native debugger** button, because Inspect could not open it.
- A Node history seek made while a played stop is failing presents the event you chose instead of repeating that stop's error.
- A learning checkpoint still reports a sealed image or source that outgrew its size limit, or was rewritten while it was read, when the run state changes during the same read.

## [0.2.17.0] - 2026-10-01 (development candidate)

Cycle 0033 keeps replay moving when the editor's debugger answers slowly or not at all, and keeps a saved Node stop's state truthful after its native session ends. Mechanism tests cover each fix with a red-before-green regression and a disabled-fix control, and bounded installed trials ran in VS Code 1.140.0 and Cursor 3.23.10. The paused foreign-session case and the Node stop in Cursor were not run. Final acceptance remains open. No registry publication.

### Changed

- A slow first replay open no longer fails. Each recorded frame gets five seconds to paint, counted from when painting starts, and the whole presentation change ends after at most fifteen seconds. Loading, debugger startup and saving your position no longer count against the paint time.
- The Run and Debug hint now also tells you to expand the first Variables scope when it stays closed. VS Code 1.140 and Cursor both keep that scope closed until you expand it.
- A stop whose only Variables group is the recording limitations note shows at once, with no wait and no hint.
- Closing the reader finishes even when a frame never paints or the debugger never answers. It still waits for your replay position to be saved.

### Fixed

- A saved Node stop keeps its position label after you end the **Codebook · Recorded learning** session, open a recording or reopen the reader. "captured source unavailable" now appears only when the captured source really does not match the stop.
- After that session ends, the selected Node stop offers **Inspect in native debugger** again, and Inspect restarts the session.
- A debugger startup the editor refused after you left the moment is retried by the next moment instead of failing every later one.
- A debugger startup, retirement or stop that the editor never answers ends after about five seconds. Replay then asks you to reopen the learning replay, and a session that starts late is stopped.
- A newer seek or another recording opens while an earlier recording load, frame read or frame paint never answers.
- Opening the same recording again after its frame was hidden or timed out paints the moment again.
- A learning checkpoint still reports a changed sealed image or source when the run state changes during the same read.
- A failed Run and Debug update is shown in the reader and leaves once the next update succeeds, and opening a recording while a Node stop is still loading updates the reader at once.
- A stop shown after the editor closed the historical debugger asks you to reopen the learning replay instead of appearing without values.
- A backward wall-clock jump can no longer stretch the one-second values wait or the five-second debugger wait.

## [0.2.16.0] - 2026-10-01 (development candidate)

Cycle 0032 makes the Run and Debug hint from 0.2.15 truthful and keeps every replay presentation wait bounded. Mechanism tests cover each fix with a red-before-green regression and a disabled-fix control, and bounded installed VS Code and Cursor trials were recorded on the 38e4620 cut. In Cursor, if Variables was collapsed at the stop, expand its first scope as well before values load. Final acceptance remains open. No registry publication.

### Changed

- The Run and Debug hint now appears about one second after native Run and Debug shows a recorded stop without loading its values, instead of one second after the moment was requested. Values that load clear it, and when you end the **Codebook · Recorded learning** session, the reader clears the hint and saved Node stops can be inspected again.
- Unrecorded gaps and stops without recorded scopes commit at once with no hint.
- The hint follows the frame native Call Stack actually focuses: the first frame with recorded source, not a library frame on top.
- A replay frame that cannot paint because its panel is hidden no longer holds a presentation change or repository navigation open. It fails within about five seconds with a message to show the replay and try again, and the next recording opens normally.

### Fixed

- Opening a browser recording, or closing the reader, drops a saved Node stop's hint and re-enables Node Inspect, and a Node stop still loading can no longer take over afterward.
- A reopened reader never shows the previous moment's hint.
- Abandoning a presentation while the historical debugger is still starting releases replay playback at once. Retiring the previous session can still wait for the editor.
- A failed debugger selection is selected again on the next presentation, and the debug adapter answers each request exactly once even when a listener fails.
- Saving a learning checkpoint while a recording replaces a captured image discards that copy instead of failing the refresh.

## [0.2.15.0] - 2026-10-01 (development candidate)

Cycle 0031 keeps the learner's first replay command when it reveals a hidden Application tab, lets replay continue when native Run and Debug has not loaded a moment's values, and counts recording paint time only while the recording is visible. Mechanism tests and bounded installed VS Code/Cursor development evidence cover the recorded cut; the new Run and Debug hint is not yet verified natively. Cursor summary placement, reader recovery/accessibility and final acceptance remain open. No registry publication.

### Changed

- A replay moment no longer fails when the native debugger never asks for its values (Variables collapsed or hidden, or another stopped session in focus). It waits up to 1 s, then shows the recorded moment with a Study hint that points to Run and Debug, the **Codebook · Recorded learning** session in Call Stack and Variables. Once values load, the hint clears and later moments wait for their values again. Saved Node test stops show the same hint beside their position.
- Recording paint deadlines count only time the recording is visible. A hidden or covered recording stays loading instead of timing out, and a hidden recorded gap waits for the recording to become visible instead of polling.
- Node Play keeps the recorded spacing between events when a stop waits for the native debugger.
- Development test runs are faster: the Study workspace suite runs as nine parallel partitions, and package checks run four files at a time.

### Fixed

- The first Next, Previous or seek after hiding the Application tab reaches the requested moment instead of restoring the previous one.
- A stopped recording clock no longer re-arms a tiny paint-deadline timer continuously.
- Opening a browser recording while a saved Node stop is loading, or closing the reader, abandons that stop without reporting an error.
- After the learner ends the historical debugger session, the next replay moment selects its stop again in the restarted session.
- Cancelling a presentation placement reports the learner's reason.

## [0.2.14.0] - 2026-09-30 (development candidate)

### Fixed

- A failed cited assertion cannot become successful saved history when a repository plugin resets the process exit code to zero. Ordinary failed process results keep their actual exit code and partial history.
- Vitest report paths may use a valid internal symlink to the exact cited file. Missing or foreign targets and duplicate executions remain refused.

This follow-up addresses two late review findings after PR #51. Source-bound development proof remains separate from final installed, Cursor, replay and nine-project acceptance. No registry publication.

## [0.2.13.0] - 2026-09-30 (development candidate)

Cited Node tests run exactly once, save their history in order and preserve the learner's native debugger pauses. Bounded installed VS Code development checks passed on the 0.2.12 implementation checkpoint; 0.2.13 adds listing-process cleanup and release metadata. Cursor, synchronized replay and final acceptance remain open. Delivery is through PR #51, with no Marketplace publication.

### Changed

- New Node runs cite a test with `testTitles`, including its enclosing suite titles, and require Vitest 4 or later. The retired `testName` remains readable in saved histories but is refused for new runs.
- Vitest selects only the cited file with a literal, anchored title pattern; its result report must confirm exactly that test executed.

### Fixed

- Output and source stops enter the saved Node journal in their recorded order. A refused append leaves a readable, sealed partial prefix; unconfirmed torn bytes remain an interrupted history.
- Learner breakpoints hold the run without automatic continuation or consuming the running stop budget. Retiring Codebook's breakpoint preserves a learner breakpoint on the same line.
- Native server/browser stack refresh retains the original captured source and generation. Unconfirmed refresh, manual resume or a changed source still refuses stale control.
- Cancelling a Vitest file listing waits for its owned launcher and helpers to exit, escalating termination when needed before deleting private scratch.

## [0.2.12.0] - 2026-09-30 (development candidate)

Cycle 0029 applies goal version 9: synchronized learning replay with a native historical debugger, saved Node test histories and an independent DeepWiki reader built by the shared generation skill. The bundled cart demonstration is removed; development trials use the owner-designated external `nextjs-dashboard` checkout. Bounded development evidence comes from normally installed VS Code, plus Cursor for the Wiki reader and skill. No version 9 Stage 1 or Stage 2 acceptance is claimed. Delivered through PR #48; this is not a Marketplace publication.

### Added

- A read-only replay debug adapter. The editor's own debugger shows the recorded source, scopes and call stack of the selected moment as **Codebook · Recorded learning**.
- Saved Node test histories. A cited Vitest run stops at one owned breakpoint, seals a private evidence journal and reopens from the Learning Library, where seek and Play step through recorded stops, output and the result. `codebook://node-history` lists saved histories; `codebook_explain_node_history` saves the agent's question, summary and sequence for one.
- A shared DeepWiki reader shell, an explicit-graph diagram renderer (flow and sequence, with exact source quotes for every node and edge) and a guarded publisher with prepared candidates, sealed manifest identity and verified recovery. **Change location** opens the matching editor's `codebook.wikiOutputDirectory` setting. Shared skill 1.0.41.
- Recording error details name each paint-receipt attempt's renderer stages.

### Changed

- Replay snapshots copy only the stopped frame's local and block scopes. The DAP `locals` hint decides this before the English scope name, so editors in other display languages keep their values; globals, closures and caller frames are never saved.
- A Node test name is passed as one `--testNamePattern=` token, and test file paths that Vitest would read as options are refused.
- The node-test profile advertises 0.2.12 as its minimum extension version.
- Wiki manifest exclusions also match directories and directory globs such as `**/fixtures`.
- A browser **Update LLM Wiki** link now asks for a modal confirmation in the editor before the editor agent starts, naming what that agent can do.
- A configured non-root `entryPath` proves development-server readiness by itself, so an application without a root page runs through its selected entry.
- Saving a reading position in a Node history reuses the verified opened history instead of re-reading its journal.

### Fixed

- Codebook continues a Node test only from the exact pause it captured. A native Continue or step, or a later pause, now refuses a stale Codebook continue instead of resuming the learner's pause. A native stack refresh at the same frame, such as Toggle Skipping this File or Pretty Print, keeps the run going.
- A Node stop is accepted only when the paused top frame is the declared position.
- Node test output waiting for its durable history is bounded at the history's 8 MiB capacity; a log flood fails capture instead of buffering in the editor.
- **Return to current pause** and `codebook_return_current` leave a selected Node history, closing its captured-source preview, so its missing-video notice no longer covers the live application. While a Node history is selected, agents see `followingCurrentRun: false`.
- An oversized debugger type name is omitted from a saved fact instead of failing the run.
- Native Variables no longer pair older recorded values with a newer moment while another debug session runs.
- One lost recorded-frame paint receipt is retried after a renderer re-handshake instead of stopping playback.
- A second opened Node history can seek and play. After the learner stops the historical debugger, selecting a stop starts a fresh one instead of failing at every stop.
- The final Node stop retires its owned breakpoint before continuing, and a stop whose breakpoint the learner already removed no longer times out a passing run.
- The Node history catalog stays readable past its first 4 KiB page, and each entry returns its history and events URIs.
- Node history autoplay reports a failed step unless a newer selection superseded it.
- The Wiki source-routing prompt stays within Cursor's prompt limit, and owned runtimes are released before the DeepWiki reader closes.
- The rest of a Node test file finishes under the run deadline, and an unreadable Node history folder is reported without blocking the Study workspace.

### Removed

- The bundled cart demo, its launchers and fixtures, the retired experiment workspaces and their CI jobs.
- Closed-cycle records 0001–0028 and their evidence files, now linked at immutable commit `273660c`.

## [0.2.11.0] - 2026-09-26 (development candidate)

Cycle 0028 opens the saved/default Study presentation from ordinary editor chat before runtime input. The Live reader now reveals a complete followed pause after loading, keeps long explanations keyboard-readable in a narrow pane, and retains the first captured-value rows in view. The checked 0.2.11 VSIX completed the checkout fixture with four saved explanations and a recording in VS Code. Cursor completed the same fixture after an initial focus refusal and pane-layout recovery; clean ordinary entry remains qualified. These fixture trials do not count toward the nine-project final acceptance.

## [0.2.8.0] - 2026-09-26 (development candidate)

- Collapse Study's view and pane controls when a narrow reader first enters Live, placing the observed explanation and values closer to the top while retaining an explicit disclosure to reopen every control. Keep the learner's manually reopened controls visible through subsequent runtime updates.
- Retain the 0.2.7 Codebook-owned debugger console behavior; the native 0.2.7 trial still placed Live evidence below the visible fold at owner zoom 2. This new candidate requires separate installed VS Code and Cursor reading proof.

## [0.2.7.0] - 2026-09-26 (development candidate)

Cycle 0028's installed 0.2.6 VS Code trial entered Live before execution and retained grounded explanations at all four pauses, but the owned Node/browser debug launches opened the Debug Console and compressed the application/source/Study reading area. Owned launch configurations now keep that panel closed without changing the user's settings. The same bundled skill 1.0.20 remains in use. New installed layout verification is pending; neither demo run counts toward D029 acceptance.

## [0.2.6.0] - 2026-09-26 (development candidate)

Cycle 0028's first 0.2.5 installed VS Code trial opened Study through the ordinary AI chat, but left it on Overview throughout real pauses. Skill 1.0.20 and public discovery now require both Live content and current-run following before input, using the existing protected Return to Current operation. The failed visibility attempt and successful saved replay remain distinct. The later installed 0.2.6 trial confirmed Live entry and saved pauses, then exposed the separate Debug Console reading-space limitation fixed in 0.2.7.

## [0.2.5.0] - 2026-09-26 (development candidate)

Cycle 0028 updates the common skill to 1.0.19 and public presentation guidance to open the current/default learner mode before runtime application input. Default and saved-mode cold entry are covered through the actual MCP transport. The later installed 0.2.5 trial failed because Overview stayed selected during pauses. Goal version 6 replaces random consecutive final reviews with the nine mandatory projects and ordered main-agent/independent-junior acceptance stages under D029; no new acceptance pass is claimed.

## [0.2.4.0] - 2026-09-26 (development candidate)

Cycle 0027 exposes the existing demo profile help and updates the shared skill to 1.0.18. Public guidance requires committed pause explanations before continuation, actual image reads for screen claims, and verification of saved recording interpretations. The extension patch version distinguishes this candidate from the owner's installed 0.2.3 during dedicated-profile validation. The same frozen 0.2.4 VSIX demonstrated four saved pause explanations and stopped-app replay in ordinary Copilot Chat and Cursor Agent. Delivered through PR #43; this is not a Marketplace publication.

## [0.2.3.0] - 2026-09-25 (development candidate)

Cycle 0019 adds the common versioned `codebook` skill to the VSIX, registers it through VS Code `contributes.chatSkills`, and introduces an ordinary editor-chat setup command. The source routes VS Code through a workspace-local MCP provider and Cursor through receipt-protected user-skill deployment plus per-instance MCP registration. Dirty development VSIX trials discovered `/codebook` and AI-owned MCP calls in both standard chats. On the known theme target, the same `7eea2bd9…` VSIX supported AI-owned source/runtime observations and saved recordings in both hosts; later dashboard Copilot trials failed before input and remain recorded. A newer same-archive dashboard development pair on dirty VSIX `55172940…` completed AI-owned menu observation and saved recordings in Cursor Agent and subscribed VS Code Claude Code; the latter passed its first Study reveal, while later manual Restore failed after chat/Wiki focus in both editors. Dirty development archive `d9c20802…` (selected-source hash `0e3c582710210e8d14d3b86a8d427490e2e10b9ed4c3b5c67e2aab92c9c1e091`) passed 925/925 extension and 101/101 package tests after ownership, resource-result and package-boundary repairs; the [source/archive record](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0019/local-review-followup-20260925.md) keeps that historical cut separate from later clean builds. Clean development VSIX `c091212…` (SHA-256 `43bc2bae…`) later completed the same dashboard question through ordinary subscribed VS Code Claude Code and Cursor Agent, with demonstrated studies and complete recordings in both; the Claude-only MCP/skill bridge was temporary. Standard VS Code Copilot Chat on this cut, the later API-help correction, complete G12 and final acceptance remain unverified. The previous 0.2.2 preview remains the latest merged version.

### Added

- A thin status-first skill that uses public Codebook help and distinguishes observed facts, source inference and unknowns without marking learner understanding.
- Cursor skill ownership, update, removal and restoration controls that refuse unowned or edited same-name files; private receipts include content hash and file identity.
- A single setup command for a trusted current workspace, with host-specific MCP registration and same-workspace restart handling. Same clean-candidate installed chat behavior remains unverified.
- Bounded bridge reconnection after an expired upstream session, immediate session termination on child exit, and journaled recovery for interrupted Cursor skill installation, update and removal.

### Fixed

- Serialize overlapping Cursor AI Chat setup and registration, reject readiness when another window removes the shared skill, and preserve a newer window's MCP catalog during stale cleanup. Publish the first owned empty catalog through a recoverable journal.
- Retry a failed native source reveal when returning from saved history, and report unavailable evidence if the current source still cannot be shown.
- Expose a run's cleanup failure in the compact status list so editor chats can see a failed release without first opening the full run resource.
- Exit any maximized editor group before switching Enlarge to the requested Application or Context pane, then maximize that pane while retaining the original Restore receipt.

## [0.2.2.0] - 2026-09-23

Private preview 0.2.2 / MCP API 1.5. This increment repairs native Study/Wiki entry and presentation transfer. The same normally installed v32 candidate passes the complete frozen VS Code and Cursor development schedules, including v31's cold Study regression, with inspected video and protected original work. Source and same-source CI pass 993 product/shared and 96 package checks. [PR #24](https://github.com/laststance/codebook/pull/24) merged; exact-main CI succeeded and its downloaded VSIX matches all 276 source inputs and 29/31 installed-v32 entries, with only revision metadata/reference differences. The three reused delegated fixing passes retain non-convergence and the later current-head CodeRabbit pass has one minor packaged README status finding. The main CI artifact was package-compared, not natively executed. Visible loading and broader UX remain open. G12 and final editor-AI acceptance remain unimplemented/unstarted; no publication is claimed.

### Fixed

- Restore the saved Wiki and exact paused recording after ordinary restart in VS Code and Cursor, while distinguishing the visible main grid from a separate chat/editor part. Refuse a real fourth main group and preserve unrelated Settings, tabs, drafts and focus.
- Switch among all three presentations through pinned replacement panes, retaining the same viewport session, source, values, reading position, disclosures, visited links and recording position. Ordinary source-file opens preserve the existing owned panes.
- Confirm native and inner-document focus before declaring a layout ready. Preserve newer learner navigation and selection, including tab/selection departures followed by return during cold Wiki scope acquisition. Cancel stale or failed handoffs, drain adopted renderer work, and bound pose delivery and recovery instead of waiting indefinitely.
- Retain native group identity when Cursor refreshes wrappers during an exact, currently owned predecessor/successor overlap. Continue rejecting ambiguous, moved, additional and unowned tabs.
- Accept the measured missing-editor and initial-caret stages when opening an exact copied Wiki citation, while preserving newer input and observed group/selection detours.
- Preserve the active Wiki tab when first Application registration covers its background source; reject unrelated text clears, tab-only learner departures or roundtrips, and closed/reopened lookalikes. Release temporary observers if native Application creation fails.
- Show a visible failure when cold Wiki entry is refused. Keep replacement readers noninteractive with neutral loading guidance until their first complete snapshot, avoiding an unrelated checkout title and premature controls.

### Changed

- Keep installed functional checks, inspected motion, source review, CI packaging and final user acceptance distinct. The required completion experience now includes explicit `/codebook` use by each editor's own AI through normal skill/MCP setup; that integration remains to be implemented.

## [0.2.1.1] - 2026-09-21

Documentation and validation update; the extension remains private preview 0.2.1 / MCP API 1.5. The actual main-CI package now has separate real-repository evidence in both editors. Cursor cold restart still fails; this entry does not announce a repaired package.

### Added

- Follow one unchanged Laststance.io theme action through an installed extension: actual source/value pause, continuation, recorded light-to-dark result, three shared live/replay modes and six exact Wiki returns per editor. VS Code also restores the paused recording and learner progress after normal restart. This familiar example does not establish all intended uses or owner learning acceptance.
- Identify the reproduced Cursor restart limitation: global tab groups include a hidden empty group outside the active editor grid, defeating cold pane reservation and restoration checks. Preserve successful checks, failed attempts, diagnostic controls and exact cleanup separately; compatibility repair remains pending.

### Changed

- Confirm the previous preview's merged private package delivery and retain its CI/archive identities. Preserve the owner's decision to skip unfinished Claude Code reviews after repeated timeouts.

## [0.2.1.0] - 2026-09-21

Private extension preview 0.2.1 / MCP API 1.5. The self-contained VSIX supports ordinary installation in VS Code and Cursor. Source-qualified native checks demonstrate the bounded checkout, offline replay, shared layouts, manual-reading retention and restart independently in both editors. Packaging and native regressions found during delivery are repaired, with their original failures retained in Cycle 0016. Clean v16 binds the reviewed package to exact both-host installation, 12/12 Wiki observation/recording returns, retained drafts and complete owned cleanup; its runtime/assets match v14, which separately demonstrates 24/24 original/restarted Wiki returns. Current v16 PR CI passes 680 + 96 tests and matches all 267 selected inputs and 29 non-metadata archive entries. The two remaining frozen Claude Code reviews were stopped at the owner’s request after repeated timeouts; no completed result is inferred. Merge and main-CI comparison remain pending. Real-repository usefulness and complete product acceptance remain open.

### Added

- Build and verify a self-contained VSIX with its own ten demo source/executable/map/HTML assets, bundled runtime dependencies, license notices and source/file identities. The pinned CI workflow supplies the private VSIX and checksum file; ordinary installation and update instructions cover VS Code and Cursor.
- Propose weekly updates to pinned GitHub Actions through Dependabot; normal review and checks remain required.
- Validate a real archive before atomic publication, reject unsafe or excessive ZIP contents and unresolved runtime imports, and load the locally built artifact outside the checkout. Failed compilation, source changes, validation or final rename preserve the previous VSIX.

### Fixed

- Restore an explicit Wiki Return position before stale cached viewport state when native pane movement recreates the reader. A real-renderer regression and both-host original/restarted observation and recording checks preserve the exact link, reading position and understanding.
- Preserve all renderer QA verification and cleanup failures while independently attempting video stop, evidence writing and browser close. Three combined-failure controls retain the original cause and later diagnostics.
- Preserve compiler outputs when pnpm cannot start; reject case variants of owned build/source output destinations before cleanup. Disable optional Git index writes when reading provenance. Record running/resolved package tool versions and explicitly distinguish clean source identity from dependency-store attestation.
- Preserve the original package spawn error when descriptor exhaustion prevents diagnostic pipes from being created; keep caller signal handlers and empty diagnostics intact.
- Accept coherent SHA-1 and SHA-256 Git revision formats in package metadata while rejecting malformed identities. Full SHA-256 repository builds remain outside demonstrated coverage.
- Retire owned POSIX package process groups after success, failure, timeout, output overflow or SIGINT/SIGTERM/SIGHUP/SIGQUIT during an active command. Propagate those interruptions through caller cleanup so the prior VSIX survives and owned stage/candidate files are removed; retain caller signal handlers and preserve the original code/signal if cleanup also fails. Signal handling outside command ownership remains a documented limitation. Reject Windows package builds before Git, output preparation or compiler cleanup.
- Reject duplicate dependency-notice paths before hashing the repeated content.
- Hash the same bounded archive bytes that were validated, even when another process atomically replaces the input path during checking.
- Await each moved pane’s actual native focus before observing the new grid, preserving strict later learner-focus checks.
- Isolate package Git provenance from inherited `GIT_*` overrides, compare actual selected inputs directly with the stored HEAD tree despite ignore rules/index hints/replacement refs, detect hidden deletions, bound Git output and reject explicitly empty `--out` values.
- Cancel a pending focus-recovery receipt when the learner closes Study, preserving the original transfer failure and unrelated draft.
- Avoid retrying an already-failed final focus wait. Reject an obsolete reading pose when the learner document changes during transfer, preserving edited text and the dirty tab.
- Wait for the native focus receipt before confirming a presentation transfer. Preserve the visible source reading position after final pane placement and across paused replay refresh, including manual reading away from the selected stop.
- Exclude only the current package operation's untracked scratch files from its final source-state comparison so a clean checkout can use a custom in-repository output path. Unrelated files and actual source changes still invalidate the applicable identity checks.
- Reject accidental test, SDK-client and native-runner inputs before they enter the shipped runtime bundle. Regressions preserve evidence and unrelated drafts when final focus or source restoration cannot complete.

### Changed

- Resolve demo assets through the extension-owned copy in both development and ordinary installation. Development edits to the original experiment sources require a rebuild before the copied-source watcher detects them.
- Record host-specific installation, checkout, offline replay, three-mode transfer, restart and cleanup evidence. Historical failures, transient layout motion, host console attribution and the unresolved Cursor view-descriptor ordering observation remain explicit.

See [Cycle 0016](docs/cycles/0016-packaged-installation.md) for exact artifact and validation identities, and [the installation guide](extension/README.md) for supported versions and limits.

## [0.2.0.1] - 2026-09-21

Documentation checkpoint; development extension remains 0.2.0 / MCP API 1.5.

### Changed

- Document native Wiki navigation ordering in both supported editors: 30 source-navigation cases and five Close cases per host match their distinct expected outcomes, with an explicit limitation that the modeled reverse completion order was not observed. No runtime repair or general ordering guarantee is claimed.
- Provide source identities, reproducible diagnostic instructions and private artifact checksums, and record the previous shared-presentation delivery. Packaged installation and complete product acceptance remain open.

## [0.2.0.0] - 2026-09-21

Development extension 0.2.0 / MCP API 1.5. This integrates the recording, repository learning, configured execution and shared presentation increments since 0.1.0; it is not a packaged or published release.

### Added

- Replay captured application frames together with their original source, actual values and explanations after the application exits or the editor restarts. Seek observed moments, distinguish later annotations, and inspect partial recordings without inventing a complete run.
- Ask an external agent to read tracked repository source and publish a cited learning book with a source-linked map. Navigate between an article, immutable source, an observed moment and its recording while retaining reading position and explicit understanding.
- Run one declared browser operation in a trusted local Next development application using webpack at its root route. The agent binds the current source and an immutable article before execution; discovery explains the adapter, limits, prerequisites and allowed input.
- Select Study workspace, Living book or Guided walkthrough through the reader, Command Palette or MCP while preserving the learning item, live pause, understanding and confirmed replay position. Use the executable SDK example to discover and select a presentation.

### Changed

- Keep accepted input, dispatch, acknowledgement, observed result, observation storage and recording storage separate. Missing pixels, values, source identity or required correspondence remain explicit evidence gaps.
- Retain earlier readers while adding configured Study v3, book v2, progress v4 and configured recording v2. Corrupt preferred files fail visibly instead of discarding history or silently falling back.
- Save presentation preferences per workspace independently from native layout confirmation. Unknown preferences remain untouched until an explicit choice; a failed save supports a save-only retry.
- Document the supported macOS development environments, including Cursor with Open Chat as Editor Tabs disabled, and preserve host-specific validation and review limitations.

### Fixed

- Preserve learner-owned pane positions, later focus changes, source selection and unrelated dirty tabs during asynchronous presentation work. Reject late foreign previews and insufficient layout space without reporting a successful transfer.
- Ignore obsolete outline requests and queued checkbox events after the selected study changes. A later successful selection clears its own diagnostic without hiding unrelated failures.
- Keep recording failures visible, preserve keyboard focus while controls are busy, and retain independent interpretation/value reading at constrained pane sizes.
- Retain exact recorded context and current control identities across delayed frames, response loss and storage recovery; recovery does not repeat application input or mark understanding automatically.
- Wait for a complete development-server port before connecting. Release diagnostic listeners and owned validation editors even when final diagnostics or launch metadata fail.

The [Cycle 0014 evidence](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0014/README.md) distinguishes implementation, test, native, review and delivery stages. Actual VS Code and Cursor development hosts separately demonstrate three live/replay mode transfers and 15 theme/zoom cells each. Source-cut differences, cropped 200% screencast limits, missing outside-model coverage and remaining acceptance checks remain recorded. See [PROJECT_STATE.md](PROJECT_STATE.md) and [extension/README.md](extension/README.md) for setup and current support.
