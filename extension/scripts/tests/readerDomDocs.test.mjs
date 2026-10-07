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

// Value: protects=a developer who reads a failed case of the Wiki reader DOM check, or looks for its stills, knowing that the update panel is the reader's own, that the steps of a page ran twice and where the second pass put its stills; fails_when=the guide no longer says that the check's reader answers the update states, that the steps run a second time on a page in the shell of 0.2.29.0, how those cases and their folder are named, or which cases run once, or the script does one of these another way than the guide says; why_new=Cycle 0046 rows 83, 84, 132, 137 and 138: the check gained the second pass, the reader's own update states and the cases of the answer's ring, of a page with the reader's ids and of a long path, and the guide described none of them; seam=none
test('the test execution guide says that the Wiki reader DOM check takes its update states from its own reader, runs the steps of a page a second time on a page in the shell of 0.2.29.0 with stills in a folder of their own, and runs three kinds of case once, as the script does', async () => {
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
    'the height of the rail with a refused update and with a conflict, the focus rings in the chapter list, the rail, the article and the composer, among them the ring of an answer, and the line of a missing page.',
    "The update states come from the reader itself: the check hands the reader the state it answers at `api/update-status` (idle, a refused start, a conflict of twelve files), so the rail is measured with the panel the reader's own script draws, its output line included.",
    "The steps of a page run twice: on the overview as this publisher prints it, and on the same content in the shell of 0.2.29.0 (`extension/scripts/fixtures/reader-shell-0.2.29.0.txt`: the stylesheet a site of that build carries, with the rail's entry as that build printed it). The cases of the second pass end with `(on a page in the shell of 0.2.29.0)`, and their stills go to the subfolder `shell-of-0.2.29.0/`.",
    "Three kinds of case run once, on pages of their own: the rail's entry of a source whose path is about 200 characters long (eight lines of the path at rest where the rail is a row), a page whose headings were authored with the ids the reader uses itself, as this publisher prints it and in the shape of a page published before it, and the missing page.",
  ].map((sentence) => paragraph.includes(sentence))

  // Assert: the guide's four statements, and the script's states, its second pass and its last steps as the guide names them.
  assert.deepEqual(said, [true, true, true, true])
  assert.deepEqual(answeredStates, ['idle', 'refused', 'conflict'])
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
  assert.deepEqual(stepsRunOnce, [
    'measureLongTargetInRow',
    'measureMissingPage',
    'usePageWithReaderIds',
    'usePagePublishedWithReaderIdsTwice',
  ])
})

// Value: protects=a developer or an agent who runs a Reader DOM check while another run of it is going on the same machine; fails_when=the guide names another form of the browser session than the scripts give, or no longer says which runs may go side by side and which may not; why_new=Cycle 0046 row 122: the name held the mode alone, two runs in two checkouts closed each other's browser, and the guide named the old form; seam=none
test('the test execution guide names the browser session of each Reader DOM check as the scripts name it, and says that two runs keep their own browsers when their output folders differ', async () => {
  // Arrange: the guide and the two checks.
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
    "**Runs side by side.** Each check names its browser session after itself, its mode and a digest of its output folder's path: `cb-bootstrap-<mode>-<digest>` and `cb-wiki-reader-<mode>-<digest>` (`extension/scripts/utils/readerDomSessionName.mjs`). Two runs on one machine keep their own browsers when their output folders differ: the two checks of one checkout, one check in two checkouts, or one check started twice from one checkout with two folders. Two runs into the same folder share one session: the later one closes the earlier one's browser, and they overwrite each other's files. Until Cycle 0046 the name held the mode alone, so one check running in two checkouts at once closed the other run's browser, and that run ended as a failure for no defect.",
  )
  assert.deepEqual(
    { study: namedCheckOf(studyCheck), wiki: namedCheckOf(wikiCheck) },
    { study: 'bootstrap', wiki: 'wiki-reader' },
  )
})
