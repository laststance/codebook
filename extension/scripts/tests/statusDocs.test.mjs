import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { readCurrentState } from './utils/currentState.mjs'

/**
 * Reads a document of the repository by its path from the repository root, so every test of this file names its documents the way a reader does.
 * @param {string} path - The path from the repository root, for example `README.md`.
 * @returns {Promise<string>} The document's text.
 * @example
 * const readme = await readDocument('README.md')
 */
const readDocument = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')

/**
 * Lists what a status document still takes from the retired decision log (`DECISIONS.md`, removed in `c549da6`): its numbers D001 to D047 and links to a copy of the file. The goal, its contracts and the closed cycle records keep those numbers and are not given to it.
 * @param {string} text - The document's text.
 * @returns {string[]} Every number and every file name found, in the order they stand; empty when the document cites none.
 * @example
 * retiredLogCitations('resumed on a Windows host (D047), see DECISIONS.md') // => ['D047', 'DECISIONS.md']
 */
const retiredLogCitations = (text) =>
  text.match(/\bD0[0-4]\d\b|DECISIONS\.md/g) ?? []

/**
 * Returns README's whole "Implementation status" section, from its heading to the next heading of the same level, so a check of the status also sees a paragraph added below the first one.
 * @param {string} readme - The root README's text.
 * @returns {string} The section with its heading line (without the `## ` mark), or an empty string when the heading is gone.
 * @example
 * statusSection('## Implementation status\n\nA private preview.\n\nMore.\n\n## Start here\n') // => 'Implementation status\n\nA private preview.\n\nMore.\n\n'
 */
const statusSection = (readme) =>
  readme
    .split(/^## /m)
    .find((part) => part.startsWith('Implementation status\n')) ?? ''

/**
 * Returns the first paragraph under README's "Implementation status" heading: the one a reader takes as the current state.
 * @param {string} readme - The root README's text.
 * @returns {string} The paragraph, or an empty string when the heading is gone.
 * @example
 * statusParagraph('## Implementation status\n\nA private preview.\n\nMore.') // => 'A private preview.'
 */
const statusParagraph = (readme) => statusSection(readme).split('\n\n')[1] ?? ''

// Cycle 0045 (DOC-3, DX-21): red while README cited "(D047)" and "(D044)", the packaged README "D034", and README's status ended at Cycle 0043 and 0.2.27.
test("README and the packaged README cite no number of the retired decision log, and README's status names the delivered version", async () => {
  // Arrange
  const readme = await readDocument('README.md')
  const packagedReadme = await readDocument('extension/README.md')
  // The version file is the one `/ship` raises with a delivery, so the status must be rewritten in the same step.
  const deliveredVersion = (await readDocument('VERSION')).trim()

  // Act
  const citations = {
    'README.md': retiredLogCitations(readme),
    'extension/README.md': retiredLogCitations(packagedReadme),
  }
  const status = statusParagraph(readme)

  // Assert
  assert.deepEqual(citations, { 'README.md': [], 'extension/README.md': [] })
  assert.equal(
    status.includes(`The delivered version is **${deliveredVersion}**`),
    true,
    `the status does not say "The delivered version is **${deliveredVersion}**" (the version in VERSION)`,
  )
})

// Value: protects=an agent that looks for the current state where AGENTS.md says it is, and a reader who follows a link to it; fails_when=a state file comes back beside the cycle records, or a live document (an entry read, a contract, the template, the review policy, the compaction reminder) still names it; why_new=owner direction of 2026-10-19 ("ProjectState.mdいらないから廃止して"): the state is a section of the active cycle record; seam=none
test('no state file stands at the repository root, and no live document names one', async () => {
  // Arrange: the documents an agent or a reviewer reads to find the state.
  const liveDocuments = [
    'AGENTS.md',
    'CLAUDE.md',
    'IMPLEMENTATION.md',
    'DEVELOPMENT.md',
    'PRODUCT_GOAL.md',
    'DESIGN.md',
    'README.md',
    'extension/README.md',
    '.coderabbit.yaml',
    '.codex/restore-product-context.mjs',
    'docs/cycles/TEMPLATE.md',
    'docs/specs/learning-replay.md',
    'docs/specs/llm-wiki.md',
    'docs/specs/keyboard-shortcuts.md',
    'docs/designs/codebook.md',
    'docs/acceptance/FINAL_REVIEW.md',
    'docs/plans/bundled-codebook-skill.md',
  ]
  const rootNames = await readdir(new URL('../../../', import.meta.url))

  // Act
  const namingDocuments = []
  for (const path of liveDocuments)
    if ((await readDocument(path)).includes('PROJECT_STATE'))
      namingDocuments.push(path)

  // Assert
  assert.equal(rootNames.includes('PROJECT_STATE.md'), false)
  assert.deepEqual(namingDocuments, [])
})

// Value: protects=a reader who follows a link to the current state from any document of the repository; fails_when=a Markdown file links PROJECT_STATE.md by a relative path, which no longer exists since the owner removed it on 2026-10-19; why_new=Cycle 0047 row 203 (S2RT-1): three documents and every closed cycle record still linked the removed file; seam=none; no_claim=links to the state file's last published form on GitHub, which are kept on purpose
test('no Markdown document links the removed state file by a relative path, apart from the snapshots kept byte for byte', async () => {
  // Arrange: the Markdown files at the root and under docs/; a snapshot whose bytes a record pins with its SHA-256 (docs/history, the evidence checkpoints of a cycle) keeps its links as they were.
  const rootNames = await readdir(new URL('../../../', import.meta.url))
  const docsNames = await readdir(new URL('../../../docs/', import.meta.url), {
    recursive: true,
  })
  const documents = [
    ...rootNames.filter((name) => name.endsWith('.md')),
    ...docsNames
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/${name.split('\\').join('/')}`),
  ].filter(
    (path) =>
      !path.startsWith('docs/history/') &&
      !/^docs\/cycles\/\d{4}-evidence-checkpoint-/.test(path),
  )

  // Act
  const linkingDocuments = []
  for (const path of documents)
    if (/\]\((?:\.\.\/)*PROJECT_STATE\.md[#)]/.test(await readDocument(path)))
      linkingDocuments.push(path)

  // Assert
  assert.deepEqual(linkingDocuments, [])
})

// Value: protects=the hosted reviewer, which reads the active cycle record as a guideline for every file; fails_when=another cycle record takes the current state and .coderabbit.yaml still maps the earlier record, which only a comment kept in step; why_new=Cycle 0047 row 202 (S2OCR3-2); seam=none; no_claim=the hosted review itself, which this repository does not run
test('the review policy maps, for every file, exactly the cycle record that holds the current state', async () => {
  // Arrange
  const policy = await readDocument('.coderabbit.yaml')
  const { path } = await readCurrentState()

  // Act: every cycle record the policy applies to every file.
  const mappedRecords = [
    ...policy.matchAll(
      /- files: '(docs\/cycles\/\d{4}-[^']+\.md)'\n\s+applyTo: '\*\*\/\*'/g,
    ),
  ].map((match) => match[1])

  // Assert
  assert.deepEqual(mappedRecords, [path])
})

// Value: protects=an agent that reads the current state at every session entry and after every context compaction; fails_when=no record or two records hold a `## Current state` section, or the section stays in an older record while a newer cycle's record exists; why_new=owner direction of 2026-10-19: AGENTS.md names the active cycle record by its section, and a section left behind in a closed record would be read as current; seam=none
test('exactly one cycle record holds the current state, and it is the record of the highest-numbered cycle', async () => {
  // Arrange
  const { holders, highestCycle, cycle } = await readCurrentState()

  // Act: the holder's cycle against the highest number among the records.
  const holderCount = holders.length

  // Assert
  assert.equal(
    holderCount,
    1,
    `records with the section: ${holders.join(', ')}`,
  )
  assert.equal(cycle, highestCycle)
})

// Cycle 0045 (DOC-3, DX-21): red while the state file linked a pinned copy of the retired log and named its directions by number; each direction is stated there in words instead.
test('the current state cites no number of the retired decision log and links no copy of it', async () => {
  // Arrange
  const { state } = await readCurrentState()

  // Act
  const citations = retiredLogCitations(state)

  // Assert
  assert.equal(state.startsWith('## Current state\n'), true)
  assert.deepEqual(citations, [])
})

// Cycle 0045 (CR-2): red while the paragraph "One next action" also held the earlier next actions and the state each had replaced (16,251 characters, with "The rest of this paragraph is the state before…" twice).
test("the current state's one next action is one action, without the earlier next actions and the state each replaced", async () => {
  // Arrange
  const { state } = await readCurrentState()

  // Act
  const nextAction =
    state.split('\n').find((line) => line.startsWith('**One next action:**')) ??
    ''
  const historyMarkers = [
    'The sentence this replaces',
    'The sentences that follow describe the state',
    'The rest of this paragraph is the state',
  ].filter((marker) => nextAction.includes(marker))

  // Assert: the paragraph exists, carries no marker of an earlier state and stays short enough to be one action.
  assert.equal(nextAction.startsWith('**One next action:**'), true)
  assert.deepEqual(historyMarkers, [])
  assert.equal(
    nextAction.length <= 1_500,
    true,
    `the paragraph has ${nextAction.length} characters`,
  )
})

// Value: protects=an agent that must read the current state in full at every session entry and after every context compaction, and a reader who wants the current state without the chronology; fails_when=the state is appended to again instead of overwritten: it links the record of a cycle that is neither the active one nor one of the two before it, leaves one of those three out, or outgrows one read; why_new=owner direction of 2026-10-05, when the state file had 661,091 bytes and linked the records of 15 cycles; Cycle 0046 row 126: the two upper bounds alone passed a file that linked three old records; since 2026-10-19 the state is a section of the active cycle record; seam=none
test('the current state keeps the active cycle and the two before it and stays short enough to read whole at every session entry', async () => {
  // Arrange
  const { cycle, state } = await readCurrentState()

  // Act: the active cycle, the two before it, and every cycle whose record the section links (by a path from the root or from docs/cycles).
  const activeCycle = Number(cycle)
  const activeCycleAndTwoBefore = [
    activeCycle - 2,
    activeCycle - 1,
    activeCycle,
  ].map((number) => String(number).padStart(4, '0'))
  const cyclesWithLinkedRecords = [
    ...new Set(
      [...state.matchAll(/[(/](\d{4})-[\w-]+\.md\b/g)].map((match) => match[1]),
    ),
  ].toSorted()

  // Assert: the records of exactly those three cycles, and no more text than the current state needs.
  assert.equal(Number.isInteger(activeCycle), true, 'no record holds the state')
  assert.deepEqual(cyclesWithLinkedRecords, activeCycleAndTwoBefore)
  assert.equal(
    state.length <= 40_000,
    true,
    `the state has ${state.length} characters`,
  )
})

// Value: protects=an agent that selects work from the gap table of the current state; fails_when=a row of the acceptance map has no row in the gap table, or the gap table names a row the map does not have; why_new=the state moved into the cycle record on 2026-10-19, and IMPLEMENTATION.md asks to keep all 13 rows in both documents; seam=none
test('the gap table of the current state has one row for each row of the acceptance map', async () => {
  // Arrange
  const { state } = await readCurrentState()
  const implementation = await readDocument('IMPLEMENTATION.md')

  // Act
  const mapRows = [...implementation.matchAll(/^\| (AC-[A-Z-]+) — /gm)].map(
    (match) => match[1],
  )
  const gapRows = [...state.matchAll(/^\| (AC-[A-Z-]+) \|/gm)].map(
    (match) => match[1],
  )

  // Assert
  assert.equal(mapRows.length, 13)
  assert.deepEqual(gapRows, mapRows)
})

// Value: protects=a reader of the current state who takes its count of closed defects as the cycle's; fails_when=the carried-defects table of the active bug-fix cycle gains or closes a row and the state keeps the earlier counts, or the state counts rows while it links no table; why_new=the local CodeRabbit review of Cycle 0046 found the state file at 62 closed rows while the table had 63; seam=none
test("the current state counts the rows and the closed rows of the active cycle's carried-defects table as the table has them", async () => {
  // Arrange
  const { state } = await readCurrentState()
  const tableName = /\d{4}-carried-defects\.md/.exec(state)?.[0]
  const table = tableName ? await readDocument(`docs/cycles/${tableName}`) : ''

  // Act: a row is a table line that begins with its number, and it is closed when its last cell begins with FIXED or EVIDENCE.
  const rows = table.split('\n').filter((line) => /^\| \d+ \|/.test(line))
  const closedRows = rows.filter((row) =>
    /^(?:FIXED|EVIDENCE)/.test(
      row
        .replace(/ \|$/, '')
        .split(/(?<!\\)\| /)
        .at(-1) ?? '',
    ),
  )
  const statedCounts = [...state.matchAll(/(\d+) rows, (\d+) closed/g)].map(
    ([, total, closed]) => `${total} rows, ${closed} closed`,
  )
  const tableCounts = `${rows.length} rows, ${closedRows.length} closed`

  // Assert: every count the state gives is the table's; a state that links no table gives none.
  assert.deepEqual(
    statedCounts,
    statedCounts.map(() => tableCounts),
  )
  assert.equal(tableName === undefined, statedCounts.length === 0)
})

// Cycle 0045 (CR-1): red while the status paragraph retold every cycle from 0028 to 0043 (sixteen linked records) instead of leaving that history to the records and the change history.
// Review of Cycle 0045 (tests-1 #2): the check read the first paragraph only, so it was green while the section's second paragraph linked the record of Cycle 0029 and retold what it changed.
test("README's implementation status states the delivered and the open cycle and leaves the history of earlier cycles to their records and the change history", async () => {
  // Arrange
  const readme = await readDocument('README.md')

  // Act: every paragraph from the heading to the next heading counts, not only the first.
  const status = statusSection(readme)
  const cyclesWithLinkedRecords = [
    ...new Set(
      [...status.matchAll(/docs\/cycles\/(\d{4})-/g)].map((match) => match[1]),
    ),
  ]
  const pointsToHistory = [
    '[change history](CHANGELOG.md)',
    '[`docs/cycles`](docs/cycles)',
    "the active cycle's record holds the verified scope and the open gaps in its current state",
  ].map((words) => status.includes(words))

  // Assert: at most the delivered cycle's record and the open cycle's, and nothing older.
  assert.equal(
    cyclesWithLinkedRecords.length <= 2,
    true,
    `the status links the records of ${cyclesWithLinkedRecords.length} cycles: ${cyclesWithLinkedRecords.join(', ')}`,
  )
  assert.deepEqual(pointsToHistory, [true, true, true])
})

// Value: protects=a developer who selects the workspace regressions for a focused run and reads in the guide what each file of them holds; fails_when=a `studyWorkspace*.test.ts` file is added, renamed or retired and the guide's list of the partitions stays as it was; why_new=Cycle 0046 added the partitions of the debug stops and of the Node history admission (rows 183 and 275), and the guide still listed eleven; seam=none
test('the test execution guide names every partition of the workspace regressions, one name for each studyWorkspace test file', async () => {
  // Arrange
  const guide = await readDocument('docs/qa/test-execution.md')
  const testFiles = await readdir(new URL('../../src/tests/', import.meta.url))

  // Act: the guide's list, and the partition each test file holds under the name the guide gives it.
  const namedPartitions = (
    /are divided by behavior into `studyWorkspace\*\.test\.ts`: (.+?)\. They share/.exec(
      guide,
    )?.[1] ?? ''
  ).split(/, | and /)
  const partitionFiles = testFiles
    .filter((name) => /^studyWorkspace\w*\.test\.ts$/.test(name))
    .toSorted()

  // Assert: fifteen files, and for each of them its name in the guide.
  assert.deepEqual(partitionFiles, [
    'studyWorkspace.test.ts',
    'studyWorkspaceDebugStops.test.ts',
    'studyWorkspaceEntry.test.ts',
    'studyWorkspaceEntryObstacles.test.ts',
    'studyWorkspaceFocus.test.ts',
    'studyWorkspaceLayout.test.ts',
    'studyWorkspaceLifecycle.test.ts',
    'studyWorkspaceNavigation.test.ts',
    'studyWorkspaceNodeHistoryAdmission.test.ts',
    'studyWorkspacePixelRetry.test.ts',
    'studyWorkspacePresentation.test.ts',
    'studyWorkspaceRemoval.test.ts',
    'studyWorkspaceReplay.test.ts',
    'studyWorkspaceRepositoryReader.test.ts',
    'studyWorkspaceStorage.test.ts',
  ])
  assert.deepEqual(namedPartitions, [
    'core Node history/save',
    'navigation',
    'entry',
    'entry obstacles',
    'focus',
    'debug stops',
    'replay',
    'storage',
    'layout',
    'pixel retry',
    'presentation',
    'lifecycle',
    'saved-study removal',
    'Node history admission',
    'the Repository Wiki reader on the workspace model',
  ])
})

// Cycle 0045 (test count): red while the guide said "the 193 package and script tests", a count every package of a cycle changes (201 on the merged tree).
test("the test execution guide names the package job's own work without a count of the package and script tests", async () => {
  // Arrange
  const guide = await readDocument('docs/qa/test-execution.md')

  // Act
  const namesWork = guide.includes(
    'It keeps its own work: the compaction-hook test, the compiler build, the emit comparison, the package and script tests (`pnpm --dir extension test:package`) and the VSIX.',
  )
  const countedTests = guide.match(/\d+ package and script tests/g) ?? []

  // Assert
  assert.equal(namesWork, true)
  assert.deepEqual(countedTests, [])
})

// Value: protects=a maintainer who sees a red coverage step reading in the guide that it cannot fail the job and where a lasting failure shows; fails_when=the guide no longer states the rule, or the workflow's upload step can fail the job again while the guide says it cannot; why_new=Cycle 0046 row 45: only the CHANGELOG said that the upload is not a gate (Cycle 0045, documentation audit DA-2); seam=none
test('the test execution guide says that a failed coverage upload does not fail a Test job, as the Test workflow has it', async () => {
  // Arrange
  const guide = await readDocument('docs/qa/test-execution.md')
  const workflow = await readDocument('.github/workflows/test.yml')

  // Act
  const statesRule = guide.includes(
    '- **A failed coverage upload does not fail a Test job.** The step "Upload coverage to Codecov" has `continue-on-error: true`: coverage is a report, and the tests before it have already decided the job.',
  )
  const namesWarning = guide.includes(
    'The step after it prints the warning "Coverage upload failed" when the upload failed, so a lasting failure (an expired token, for example) stays visible in the run.',
  )
  const uploadStep =
    /- name: Upload coverage to Codecov\n((?: {8}.*\n)+)/.exec(workflow)?.[1] ??
    ''

  // Assert
  assert.equal(statesRule, true)
  assert.equal(namesWarning, true)
  assert.equal(uploadStep.includes('        continue-on-error: true\n'), true)
  assert.equal(
    workflow.includes('::warning title=Coverage upload failed::'),
    true,
  )
})

// Value: protects=a maintainer or an agent who sees every test of package.test.mjs fail together reading in the guide that a checkout changed during the shared build does that, with the sentence to look for; fails_when=the guide no longer says that the checkout must stay as it is while the package tests run, quotes another sentence than the build's guard has, or the tests stop sharing one build; why_new=Cycle 0046 row 124: all 32 tests failed together at a merge because a tracked document was regenerated while the build compiled, and the record kept only the failed titles; seam=none
test('the test execution guide says that a checkout changed while the package tests build fails every test of package.test.mjs with the sentence of the build, as the build and the test file have it', async () => {
  // Arrange
  const guide = await readDocument('docs/qa/test-execution.md')
  const build = await readDocument('extension/scripts/utils/buildPackage.mjs')
  const guard = await readDocument(
    'extension/scripts/utils/assertStableCheckout.mjs',
  )
  const constants = await readDocument(
    'extension/scripts/utils/packageConstants.mjs',
  )
  const commandRunner = await readDocument(
    'extension/scripts/utils/runPackageCommand.mjs',
  )
  const packageTests = await readDocument(
    'extension/scripts/tests/package.test.mjs',
  )

  // Act: the guide's paragraph, where the build asks the guard, how many paths the guard names, and how often the test file builds for its tests.
  const paragraph =
    guide
      .split('\n\n')
      .find((part) =>
        part.startsWith(
          'The checkout must also stay as it is while the package tests run.',
        ),
      ) ?? ''
  const guardCalls = build.match(/await assertStableCheckout\([^)]*\)/g)
  const shownPathLimit =
    /^export const CHECKOUT_CHANGE_SHOWN_PATH_LIMIT = (\d+)$/m.exec(
      constants,
    )?.[1]
  const sharedBuilds = packageTests.match(
    /^ {2}receipt = await buildPackage\(repository, artifact\)$/gm,
  )

  // Assert
  assert.equal(
    paragraph,
    'The checkout must also stay as it is while the package tests run. `extension/scripts/tests/package.test.mjs` builds one VSIX in a hook that every test of the file shares, and that build reads the checkout\'s identity before and after its compilation: the revision, whether Git reports any change (a tracked file that differs or an untracked file that is not ignored, anywhere in the repository) and the hashes of the package\'s sources. When the two readings differ, for example because a document was regenerated or a commit was made while the compiler ran, the build is refused with one sentence that names what changed, for example `The checkout changed during compilation: Git reported no change before and reports changes now ("README.md"). Retry from a stable checkout.` (`during packaging` when the change came after the compiler had ended; a new revision is named as `the revision went from <before> to <now>` and changed bytes of a source as `the package\'s sources changed ("<path>")`; at most five paths are named), and every test of the file fails with that one message. The list of failed titles does not show it: read the first failure. It is no defect of the package: leave the checkout untouched until the run has ended, then run it again. A command of the build that fails (`Package command failed: pnpm (<code>)`) or runs longer than three minutes (`Package command exceeded its time limit.`) fails every test of the file in the same way, with its own sentence.',
  )
  // The guide's example is put together from the guard's own words, and the build asks the guard after both of its phases.
  assert.deepEqual(
    [
      "`The checkout changed during ${phase}: ${changes.join('; ')}. Retry from a stable checkout.`",
      '`Git reported no change before and reports changes now (${namedPaths(paths)})`',
      '`the revision went from ${before.revision} to ${now.revision}`',
      "`the package's sources changed (${namedPaths([...new Set(changedPaths)].toSorted())})`",
    ].filter((words) => !guard.includes(words)),
    [],
  )
  assert.equal(shownPathLimit, '5')
  assert.deepEqual(guardCalls, [
    "await assertStableCheckout(repository, before, directory, 'compilation')",
    "await assertStableCheckout(repository, before, directory, 'packaging')",
  ])
  assert.equal(
    commandRunner.includes(
      '`Package command failed: ${executable} (${signal ?? code})`',
    ),
    true,
  )
  assert.equal(
    commandRunner.includes("'Package command exceeded its time limit.'"),
    true,
  )
  assert.deepEqual(sharedBuilds, [
    '  receipt = await buildPackage(repository, artifact)',
  ])
})

// Value: protects=an author of the generation skill reading in its plan where a Wiki run's temporary scripts go, which the editor's approvals depend on; fails_when=the plan no longer names the folder, or the bundled skill names another folder than the plan; why_new=Cycle 0046 row 45: the rule of skill 1.0.42 stood in the skill and the CHANGELOG only (documentation audit DA-2); seam=none
test("the generation skill's plan names the workspace folder of a Wiki run's temporary scripts, as the bundled skill does", async () => {
  // Arrange
  const plan = await readDocument('docs/plans/deepwiki-generation-skill.md')
  const skill = await readDocument('extension/skills/codebook/SKILL.md')

  // Act
  const statesRule = plan.includes(
    "Temporary scripts of a Wiki run (delivered with skill 1.0.42): code with loops, regular expressions, HTML quotes or template literals is written as a script into the project's hidden `.codebook/scratch/` folder and run with its interpreter named, read-only scans included; the agent removes the folder once the Wiki is published.",
  )
  const forbidsOtherPlaces = plan.includes(
    'A temporary script is never written into project source or outside the workspace.',
  )

  // Assert
  assert.equal(statesRule, true)
  assert.equal(forbidsOtherPlaces, true)
  assert.equal(
    skill.includes(
      "write a temporary script into the project's hidden `.codebook/scratch/` folder",
    ),
    true,
  )
})

// Value: protects=a reader of the Wiki contract finding the rail's entry that opens a page's source, which only the CHANGELOG named; fails_when=the contract no longer names the entry, or the publisher prints another label than the contract names; why_new=Cycle 0046 row 45 (documentation audit DA-2); seam=none
test('the LLM Wiki contract names the rail entry that opens the first cited source of a page, with the label the publisher prints', async () => {
  // Arrange
  const contract = await readDocument('docs/specs/llm-wiki.md')
  const publisher = await readDocument(
    'extension/skills/codebook/render-wiki.mjs',
  )

  // Act
  const namesEntry = contract.includes(
    "Delivered reference, no further requirement: besides the inline citations, every page's right rail has the entry **Open in VS Code** (**Open in Cursor** when Cursor's reader serves the page), which opens the page's first cited source at its cited line and names that file and line under its label.",
  )

  // The label is read from the template that prints the entry: the publisher's text also quotes it in a docstring.
  const printedLabel =
    /const openSourceEntry = \(source, line\) => `<p class="open-in-editor"><a [^>]*>([^<]*)<\/a>/.exec(
      publisher,
    )?.[1]

  // Assert
  assert.equal(namesEntry, true)
  assert.equal(printedLabel, 'Open in VS Code')
})

// Value: protects=a later reader of the Cycle 0045 record who wants to know that a private evidence folder is still the one the record describes; fails_when=the record names an evidence folder of its final round without the file count and the SHA-256 of that folder's list, or says again that the red team added PL-28 and PL-29; why_new=Cycle 0046 row 46: the folders after N14-c were named without a per-file SHA-256; seam=none
test('the Cycle 0045 record names, for every evidence folder of its final round, the file count and the SHA-256 of its per-file list', async () => {
  // Arrange
  const record = await readDocument(
    'docs/cycles/0045-natural-request-and-carried-defects.md',
  )

  // Act
  const listedFolders = [
    ...record.matchAll(/^ {2}\| `([^`]+)` \| (\d+) \| `([a-f0-9]{64})` \|$/gm),
  ].map(([, folder, files, listHash]) => ({ folder, files, listHash }))

  // Assert
  assert.deepEqual(listedFolders, [
    {
      folder: 'n14/candF/',
      files: '20',
      listHash:
        '5cc4e4a0529995ee7d70cadc08d72302402b75b2af98e178ac93026923342435',
    },
    {
      folder: 'n14/prepF/',
      files: '101',
      listHash:
        'a72e5b8619dd8a0535187de691f1c687ec431554f6a648a8a86f08f7b1c8a6b9',
    },
    {
      folder: 'n14/prepG/',
      files: '88',
      listHash:
        'ceb35ba7f6bd329e5906d3e8de1613a2037435981facc9c892f0213a8b5e0de6',
    },
    {
      folder: 'n14/prepH/',
      files: '11',
      listHash:
        '7482c43ad72aa1beb9b77173f39748bc3e9da1a390a1cc5e596bf722887455b3',
    },
    {
      folder: 'n14/N14-d/',
      files: '191',
      listHash:
        '471110d5b6ac8272e0f9a960c71026627f9f6ef2e8f6cdf8606fd5b477d1ca6e',
    },
    {
      folder: 'n14/owedF/',
      files: '315',
      listHash:
        'a3deda6ba3768f15e66d33cbc6e8a1e1e496564fb3a5ec80129b3ae132add34c',
    },
    {
      folder: 'n14/owedW/',
      files: '210',
      listHash:
        '405c9b7bac247c04124f75b53f6ab960f13631dc5fd35e085d17e209a5a8d693',
    },
    {
      folder: 'n14/c20/',
      files: '690',
      listHash:
        '967f35fe57434cedf840dde973c63c3287087774d189c0011b70e432988fa4e8',
    },
    {
      folder: 'f23-next/',
      files: '59',
      listHash:
        'fcb933d047c7b3987a1a5c353ae22455fb005b73a31ecfcf8442d0275ab20692',
    },
  ])
  assert.equal(record.includes('The red team added PL-24 and PL-25.'), true)
  assert.equal(record.includes('The red team added PL-28 and PL-29.'), false)
})
