import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { runCommandsOf } from './utils/runCommandsOf.mjs'

// Review of Cycle 0045 (tests-1 #12): the earlier form looked for each fact in the workflow's raw text, so a command or a folder kept only in a comment or in a cache key passed as one the job runs.
test("the test execution guide gives the Reader DOM check's command and the playwright-cli release the CI job installs", async () => {
  // Arrange: the guide, and the two files the CI job takes the same facts from.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const job = await readFile(
    new URL('../../../.github/workflows/reader-dom.yml', import.meta.url),
    'utf8',
  )
  const pinnedTools = JSON.parse(
    await readFile(
      new URL('../../../.github/reader-dom/package.json', import.meta.url),
      'utf8',
    ),
  ).dependencies

  // Act: the section a developer reads before a local run, and what the job really runs and where (never its comments).
  const section =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n')) ?? ''
  const jobCommands = runCommandsOf(job)
  const jobFolders = job
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('working-directory: '))
    .map((line) => line.slice('working-directory: '.length))
  const commandsOfGuideAndJob = [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'npm ci --ignore-scripts',
    'playwright-cli install-browser ffmpeg',
  ].filter(
    (command) => section.includes(command) && jobCommands.includes(command),
  )
  const foldersOfGuideAndJob = ['.github/reader-dom'].filter(
    (folder) => section.includes(folder) && jobFolders.includes(folder),
  )
  // The paragraph about this check alone: the paragraph of the Wiki reader's check says of itself that a green run earns no credit.
  const limits =
    section
      .split('\n\n')
      .find((part) => part.startsWith('**What it does not cover.**')) ?? ''

  // Assert: the guide's release is the one the job installs, and its commands and its tool folder are the job's.
  assert.deepEqual(pinnedTools, { '@playwright/cli': '0.1.22' })
  assert.ok(
    section.includes('`playwright-cli` 0.1.22'),
    'the guide does not name playwright-cli 0.1.22',
  )
  assert.deepEqual(commandsOfGuideAndJob, [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'npm ci --ignore-scripts',
    'playwright-cli install-browser ffmpeg',
  ])
  assert.deepEqual(foldersOfGuideAndJob, ['.github/reader-dom'])
  assert.ok(
    limits.includes(
      "A green run therefore says nothing about what the extension sends, about the editor's webview (theme, focus between panes, layout) or about VS Code and Cursor, and it earns no native acceptance credit.",
    ),
    'the guide no longer says that a green run of the Study reader DOM check is not native acceptance',
  )
})

// Value: protects=a developer who runs the Wiki reader's DOM check locally from the guide, and one who reads a failed Reader DOM job; fails_when=the guide's command or folder for that check differs from what the CI job runs, the guide says another thing than the job does about when the step runs, or the guide stops saying that a green run is no native acceptance; why_new=Cycle 0046 row 70; row 127 added when the step runs; seam=none
test("the test execution guide gives the Wiki reader DOM check's command as the CI job runs it, and says as the job has it that the check also runs after the Study reader's check failed", async () => {
  // Arrange: the guide and the CI job.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const job = await readFile(
    new URL('../../../.github/workflows/reader-dom.yml', import.meta.url),
    'utf8',
  )

  // Act: the paragraph of the section "Reader DOM check" that describes this check, and the condition of its step in the job.
  const paragraph =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n'))
      ?.split('\n\n')
      .find((part) => part.startsWith('**The Wiki reader’s page.**')) ?? ''
  const command =
    'node extension/scripts/wiki-reader-dom-qa.mjs verify artifacts/wiki-reader-dom'
  const stepCondition = job
    .split('\n')
    .map((line) => line.trim())
    .find(
      (_line, index, lines) =>
        lines[index - 1] === '- name: Run the Wiki reader DOM cases',
    )

  // Assert
  assert.ok(
    paragraph.includes(`\`${command}\``),
    'the guide does not give the command of the Wiki reader DOM check',
  )
  assert.ok(
    runCommandsOf(job).includes(command),
    'the CI job does not run the command the guide gives',
  )
  assert.ok(
    paragraph.includes(
      "The step runs when the Study reader's step passed and when it failed, so one push shows the failures of both checks and the kept artifact holds both folders; it does not run when a step before the Study reader's check failed (the build or the browser tools) or when the job was cancelled.",
    ),
    'the guide does not say when the step of the Wiki reader DOM check runs',
  )
  assert.equal(
    stepCondition,
    "if: ${{ !cancelled() && (steps.study.outcome == 'success' || steps.study.outcome == 'failure') }}",
  )
  assert.ok(
    paragraph.includes('no native acceptance credit'),
    'the guide no longer says that a green run of this check is not native acceptance',
  )
})

// Value: protects=a developer who reads a failed case of the Wiki reader DOM check, or looks for its stills, knowing that the update panel is the reader's own, that the steps of a page ran twice and where the second pass put its stills, and where a description of the rail entry's link comes from; fails_when=the guide no longer says that the check's reader answers the update states, that the steps run a second time on a page in the shell of 0.2.29.0, how those cases and their folder are named, which cases run once, or that the entry's link is read in Chrome's accessibility tree, or the script does one of these another way than the guide says; why_new=Cycle 0046 rows 83, 84, 132, 137 and 138: the check gained the second pass, the reader's own update states and the cases of the answer's ring, of a page with the reader's ids and of a long path, and the guide described none of them; finding 600: the check gained the cases of the link's description read in Chrome's accessibility tree; /ship finding F2, follow-up N5 and repeat review SC1: the check gained the cases of a page whose content carries script, served and opened from disk, and of a page file with a script written straight into it; Codex review CX5: the case of a Wiki published from a reader shell with CRLF line endings; seam=none
test('the test execution guide says that the Wiki reader DOM check takes its update states from its own reader, runs the steps of a page a second time on a page in the shell of 0.2.29.0 with stills in a folder of their own, reads the rail entry’s link in Chrome’s accessibility tree, and runs eleven kinds of case once, as the script does', async () => {
  // Arrange: the guide and the check.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const check = await readFile(
    new URL('../wiki-reader-dom-qa.mjs', import.meta.url),
    'utf8',
  )

  // Act: the paragraph of the section "Reader DOM check" about this check, and what the script does: the states its reader answers, the second pass and the steps after it.
  const paragraph =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n'))
      ?.split('\n\n')
      .find((part) => part.startsWith('**The Wiki reader’s page.**')) ?? ''
  const statesBlock =
    /^const updateStatuses = \{\n([\s\S]*?)^\}\n/m.exec(check)?.[1] ?? ''
  const answeredStates = [...statesBlock.matchAll(/^ {2}(\w+): \(\) =>/gm)].map(
    (match) => match[1],
  )
  const secondPass =
    /caseSuffix = '([^']+)'\n\s+options\.output = `\$\{outputOfTheOverview\}\/([^`]+)`/.exec(
      check,
    )
  const stepsRunOnce = (
    /caseSuffix = ''\n\s+options\.output = outputOfTheOverview\n\s+for \(const step of \[([\s\S]*?)\]\)/.exec(
      check,
    )?.[1] ?? ''
  )
    .split(',')
    .map((step) => step.trim())
    .filter(Boolean)
  const said = [
    'the height of the rail with a refused update, with a conflict and with the watch-bound and learner-file end sentences, the focus rings in the chapter list, the rail, the article and the composer, among them the ring of an answer, and the line of a missing page.',
    "The update states come from the reader itself: the check hands the reader the state it answers at `api/update-status` (idle, a refused start, a conflict of twelve files, a VS Code watch that passed its 15 minutes, a VS Code update that stopped on twelve files of the learner's), so the rail is measured with the panel the reader's own script draws, its output line included. The watch-bound and learner-file end sentences must each be whole in a rail of at most 45vh at 960 x 600, so a sentence of an update's end that grows past that fails the check.",
    "The steps of a page run twice: on the overview as this publisher prints it, and on the same content in the shell of 0.2.29.0 (`extension/scripts/fixtures/reader-shell-0.2.29.0.txt`: the stylesheet a site of that build carries, with the rail's entry as that build printed it). The cases of the second pass end with `(on a page in the shell of 0.2.29.0)`, and their stills go to the subfolder `shell-of-0.2.29.0/`.",
    "Eleven kinds of case run once, on pages of their own: the rail's entry of a source whose path is about 200 characters long (eight lines of the path at rest where the rail is a row), the rail's entry of a page whose first source is `package.json` line 31, as this publisher prints it, in the shell of 0.2.29.0 and as the builds of Cycle 0046 before finding 600 printed it (the target shown beside the link, with its wrap point, as the link's description), a page whose headings were authored with the ids the reader uses itself, as this publisher prints it and in the shape of a page published before it, the missing page, a page whose content carries an event attribute and a `javascript:` link, as a Wiki published before the publisher refused them, neither of which may run, under the reader or opened from disk (`file:`, where only the page's own Content-Security-Policy holds), while the shell's theme button and, under the reader, the reader's own script work, a page in the shell of 0.2.29.0 with a script written straight into its file, which may not run under the reader while that shell's own script (its theme button) and the reader's run, two pages that point at a script file written into the Wiki folder and named by its manifest, one with a script tag and one with a script tag left open before the reader's own, where the file may not run while the shell's theme button and, on the first page, the reader's own script work, a page whose file got links to a file and to another extension in the editor, a link of another editor's scheme and a refresh to another page, which the reader serves with the links' text but without their links and without the refresh while the rail's entry still opens its source through Codebook, a page whose file got a refresh written with a reference without its semicolon, a frame with a page of its own and an svg animation of a link's address, which the reader serves without the refresh, the frame's page or the animated address, a page of this build's shell and one of 0.2.29.0's whose files refer to images, a frame, a style sheet, a sound and a background of another host on this machine, which fetch none of them, served or opened from disk, while the Wiki's own image loads, and a Wiki the shipped publisher rendered from a reader shell with CRLF line endings, as a Windows checkout holds it, whose theme button runs under a reader of its own and opened from disk.",
    "The accessibility tree is read through Chrome's debugging protocol: the link's role, name and description as Chrome computes them (`Accessibility.getPartialAXTree`), and every text of the entry the tree does not ignore (`Accessibility.queryAXTree`). Chrome reads a `<wbr>` of an element's text as a space, so a description taken from the shown target (`package.json :31`) fails the check.",
  ].map((sentence) => paragraph.includes(sentence))

  // Assert: the guide's five statements, and the script's states, its second pass, its reading of the accessibility tree and its last steps as the guide names them.
  assert.deepEqual(said, [true, true, true, true, true])
  assert.deepEqual(answeredStates, [
    'idle',
    'refused',
    'conflict',
    'watchPastItsBound',
    'learnerFiles',
  ])
  assert.equal(check.includes('{ length: 12 },'), true)
  assert.equal(
    check.includes('() => answeredUpdateStatus,'),
    true,
    'the check no longer hands its reader the update state to answer',
  )
  assert.deepEqual(secondPass?.slice(1), [
    ' (on a page in the shell of 0.2.29.0)',
    'shell-of-0.2.29.0',
  ])
  assert.equal(
    check.includes(
      "new URL('./fixtures/reader-shell-0.2.29.0.txt', import.meta.url)",
    ),
    true,
  )
  assert.deepEqual(
    [
      check.includes("'Accessibility.getPartialAXTree'"),
      check.includes("'Accessibility.queryAXTree'"),
    ],
    [true, true],
  )
  assert.deepEqual(stepsRunOnce, [
    'measureLongTargetInRow',
    'readPackageManifestEntriesFromAccessibilityTree',
    'measureMissingPage',
    'usePageWithReaderIds',
    'usePagePublishedWithReaderIdsTwice',
    'usePageWithContentScript',
    'useOfflinePageWithContentScript',
    'usePageWithPlantedScript',
    'usePagesPointingAtAPlantedScriptFile',
    'usePageWithForeignEditorLinks',
    'usePageWithEncodedRefusals',
    'usePagesWithOtherHostReferences',
    'useWikiPublishedFromCrlfShell',
  ])
})

// Value: protects=a developer or an agent who runs a Reader DOM check while another run of it is going on the same machine; fails_when=the guide names another form of the browser session than the scripts give, or no longer says which runs may go side by side and which may not; why_new=Cycle 0046 row 122: the name held the mode alone, two runs in two checkouts closed each other's browser, and the guide named the old form; OCR4-2: the test read the name of two of the five checks only; seam=none
test('the test execution guide names the browser session of each Reader DOM check as the scripts name it, and says that two runs keep their own browsers when their output folders differ', async () => {
  // Arrange: the guide and the five checks.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const studyCheck = await readFile(
    new URL('../study-bootstrap-qa.mjs', import.meta.url),
    'utf8',
  )
  const wikiCheck = await readFile(
    new URL('../wiki-reader-dom-qa.mjs', import.meta.url),
    'utf8',
  )
  const readingPoseCheck = await readFile(
    new URL('../study-reading-pose-qa.mjs', import.meta.url),
    'utf8',
  )
  const understandingCheck = await readFile(
    new URL('../understanding-focus-qa.mjs', import.meta.url),
    'utf8',
  )
  const repositoryPaneCheck = await readFile(
    new URL('../repository-return-qa.mjs', import.meta.url),
    'utf8',
  )

  // Act: the paragraph of the section "Reader DOM check" about runs side by side, and the check's part of the name in each script.
  const paragraph =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n'))
      ?.split('\n\n')
      .find((part) => part.startsWith('**Runs side by side.**')) ?? ''
  const namedCheckOf = (script) =>
    /\bsession = readerDomSessionName\('([a-z-]+)', mode, output\)/.exec(
      script,
    )?.[1]

  // Assert
  assert.equal(
    paragraph,
    "**Runs side by side.** Each check names its browser session after itself, its mode and a digest of its output folder's path: `cb-bootstrap-<mode>-<digest>`, `cb-wiki-reader-<mode>-<digest>`, `cb-reading-pose-<mode>-<digest>`, `cb-understanding-<mode>-<digest>` and `cb-repository-pane-<mode>-<digest>` (`extension/scripts/utils/readerDomSessionName.mjs`). Two runs on one machine keep their own browsers when their output folders differ: the checks of one checkout, one check in two checkouts, or one check started twice from one checkout with two folders. Two runs into the same folder share one session: the later one closes the earlier one's browser, and they overwrite each other's files. Until Cycle 0046 the name held the mode alone, so one check running in two checkouts at once closed the other run's browser, and that run ended as a failure for no defect.",
  )
  assert.deepEqual(
    {
      study: namedCheckOf(studyCheck),
      wiki: namedCheckOf(wikiCheck),
      readingPose: namedCheckOf(readingPoseCheck),
      understanding: namedCheckOf(understandingCheck),
      repositoryPane: namedCheckOf(repositoryPaneCheck),
    },
    {
      study: 'bootstrap',
      wiki: 'wiki-reader',
      readingPose: 'reading-pose',
      understanding: 'understanding',
      repositoryPane: 'repository-pane',
    },
  )
})

// Value: protects=a developer who runs one of the three later checks locally from the guide, and one who reads a failed Reader DOM job; fails_when=the guide's command or folder for one of the three differs from what the CI job runs, the guide stops saying what each of them checks, or it stops saying that a check outside every workflow fails a script test; why_new=Cycle 0046 row 333: the three checks ran by hand only, their folders were named after old cycles, and nothing said what they checked or that two of them could not start; seam=none
test('the test execution guide gives the commands of the reading pose, the understanding checkbox and the Repository Wiki pane checks as the CI job runs them, and says what each checks and that a browser check outside every workflow fails a script test', async () => {
  // Arrange: the guide and the CI job.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const job = await readFile(
    new URL('../../../.github/workflows/reader-dom.yml', import.meta.url),
    'utf8',
  )

  // Act: the paragraph of the section "Reader DOM check" about the three checks, and which of its commands the job runs.
  const paragraph =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n'))
      ?.split('\n\n')
      .find((part) =>
        part.startsWith(
          '**The reading pose, the understanding checkbox and the Repository Wiki pane.**',
        ),
      ) ?? ''
  const jobCommands = runCommandsOf(job)
  const commandsOfGuideAndJob = [
    'node extension/scripts/study-reading-pose-qa.mjs verify artifacts/reading-pose-dom',
    'node extension/scripts/understanding-focus-qa.mjs verify artifacts/understanding-dom',
    'node extension/scripts/repository-return-qa.mjs verify artifacts/repository-pane-dom',
  ].filter(
    (command) =>
      paragraph.includes(`\`${command}\``) && jobCommands.includes(command),
  )
  const said = [
    "checks the Study reader's reading pose: what the reader captures before the host replaces its document (the reading position, the open disclosures, the visited links, the focused control) and restores in the new one;",
    'checks the understanding checkbox of the Study reader and of the Repository Wiki pane under real key and pointer input: two immediate presses ask for one save, the checkbox keeps the focus while a save is pending and after it failed,',
    "checks the Repository Wiki pane: the place a Return from a study restores against the place the pane saved itself, and where the keyboard stands when the learner leaves the pane and returns. The leaving is done the way the editor's webview does it (the control loses the focus, then the window):",
    "Each step runs under the condition of the Wiki reader's step, so one push shows the failures of all five checks.",
    "a script test (`extension/scripts/tests/workflowPins.test.mjs`) fails when a `*-qa.mjs` script of `extension/scripts` is run by no workflow and is not named in that test's list of retired checks.",
    'No editor takes part, so a green run earns no native acceptance credit either;',
  ].map((sentence) => paragraph.includes(sentence))

  // Assert
  assert.deepEqual(commandsOfGuideAndJob, [
    'node extension/scripts/study-reading-pose-qa.mjs verify artifacts/reading-pose-dom',
    'node extension/scripts/understanding-focus-qa.mjs verify artifacts/understanding-dom',
    'node extension/scripts/repository-return-qa.mjs verify artifacts/repository-pane-dom',
  ])
  assert.deepEqual(said, [true, true, true, true, true, true])
})
