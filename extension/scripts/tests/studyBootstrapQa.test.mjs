import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { runFlowKeepingCases } from '../utils/runFlowKeepingCases.mjs'

// Read as text and never imported: loading the script starts its server and its browser.
const scriptUrl = new URL('../study-bootstrap-qa.mjs', import.meta.url)

test('the pane DOM check loads its flow without eval', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: the two ways a script turns text into code on its own.
  const textRunAsCode = script
    .split('\n')
    .flatMap((line, index) =>
      /\beval\b|\bnew Function\b/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    )
  const flowCommands = script.match(/command\(\['run-code', .*\], 'flow'\)/g)

  // Assert: the flow is a file in the output folder that the browser CLI reads itself.
  assert.deepEqual(textRunAsCode, [])
  assert.deepEqual(flowCommands, [
    "command(['run-code', `--filename=${flowPath}`], 'flow')",
  ])
  assert.ok(
    script.includes('const flowPath = `${output}/flow.js`'),
    'the flow file is no longer written into the output folder',
  )
})

// Local CodeRabbit review of Cycle 0045: the script read the compiled reader and the Wiki shell by a path from the working directory, so it ran from the repository root only.
test('the pane DOM check reads the compiled reader and the Wiki shell beside the script, so it runs from any folder', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: every file the script reads, by the first argument of the read: a place beside the script, or a path in quotes.
  const readTargets = [
    ...script.matchAll(/readFile\(\s*(new URL\([^)]*\)|'[^']*')/g),
  ].map(([, target]) => target)

  // Assert
  assert.deepEqual(readTargets, [
    "new URL('../dist/ui/studyHtml.js', import.meta.url)",
    "new URL('../skills/codebook/reader-shell.html', import.meta.url)",
  ])
})

// Review of Cycle 0045 (tests-1 #1): the earlier form of this test knew `revision === 3` and `revision: 3` only, so it stayed green for `await waitUntilRendered(3)`, `revision >= 3` and `expectedRevision: 6`.
test('the pane DOM check states every awaited and compared revision by its distance from the first message, and only the Saved studies cases count from a number of their own', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')
  const lines = script.split('\n')
  /**
   * Lists the script's lines a pattern matches, each with its number, so a failing assertion names the place.
   * @param {(line: string) => boolean} isMatch - Decides for one line.
   * @returns {string[]} `<line number>: <trimmed line>` for every matching line, in file order.
   */
  const linesWhere = (isMatch) =>
    lines.flatMap((line, index) =>
      isMatch(line) ? [`${index + 1}: ${line.trim()}`] : [],
    )

  // Act: a revision compared with, or awaited as, a number of its own stops matching as soon as the first message's revision changes.
  const comparedWithNumbers = linesWhere((line) =>
    /[Rr]evision\s*(?:[!=]==?|[<>]=?)\s*\d/.test(line),
  )
  // A wait takes revisionAt(n) written out: a bare number and a number held in a variable are both refused.
  const awaitedWithoutDistance = linesWhere(
    (line) =>
      line.includes('waitUntilRendered(') &&
      !/waitUntilRendered\(revisionAt\(\d+\)\)/.test(line),
  )
  const revisionsStatedAsNumbers = script.match(/\b\w*[Rr]evision:\s*\d+/g)
  const countersStartedAtNumbers = script.match(/\b\w*[Rr]evision\s*=\s*\d+/g)

  // Assert: only the first message states its revision (the presentation's control revision is another counter, which no wait reads);
  // every later message, wait and comparison is revisionAt(n), and the one counter with a start of its own is the Saved studies cases'.
  assert.deepEqual(comparedWithNumbers, [])
  assert.deepEqual(awaitedWithoutDistance, [])
  assert.deepEqual(revisionsStatedAsNumbers, [
    'revision: 1',
    'presentationControlRevision: 1',
  ])
  assert.deepEqual(countersStartedAtNumbers, ['savedRevision = 100'])
  assert.ok(
    script.includes(
      'const revisionAt = (step) => options.message.revision + step',
    ),
    'revisionAt no longer starts from the first message',
  )
})

// Value: protects=the Reader DOM report after one step of the flow throws (a control that is not offered, a wait past its limit); fails_when=the flow's one browser call ends without a result, so result.json names no case and a single missing control reads like a failure of the harness; why_new=Cycle 0045 local review other-1 #8; seam=none
test('a step of the pane DOM flow that throws ends as one failed case after the cases collected before it', async () => {
  // Arrange: a flow that passes two cases, notes a page error and then throws at a missing control.
  const flow = async (page, options, collected) => {
    collected.cases.push({
      name: `${options.kind} first paint`,
      actual: page.title,
      passed: true,
    })
    collected.errors.push('ReferenceError: render is not defined')
    collected.cases.push({ name: 'Saved studies', actual: 2, passed: true })
    throw new Error('locator.click: Timeout 5000ms exceeded.')
  }

  // Act
  const report = await runFlowKeepingCases(
    flow,
    { title: 'Loading study…' },
    { kind: 'context' },
  )

  // Assert
  assert.deepEqual(report, {
    cases: [
      { name: 'context first paint', actual: 'Loading study…', passed: true },
      { name: 'Saved studies', actual: 2, passed: true },
      {
        name: 'the flow stopped after the case "Saved studies"',
        actual: 'Error: locator.click: Timeout 5000ms exceeded.',
        passed: false,
      },
    ],
    errors: ['ReferenceError: render is not defined'],
  })
})

test('a pane DOM flow that runs to its end answers its cases as collected, and one that throws at once says so', async () => {
  // Arrange
  const completes = async (_page, _options, collected) => {
    collected.cases.push({ name: 'first paint', actual: 1, passed: true })
  }
  const throwsAtOnce = async () => {
    throw new Error('page.goto: net::ERR_CONNECTION_REFUSED')
  }

  // Act
  const completed = await runFlowKeepingCases(completes, {}, {})
  const stopped = await runFlowKeepingCases(throwsAtOnce, {}, {})

  // Assert
  assert.deepEqual(completed, {
    cases: [{ name: 'first paint', actual: 1, passed: true }],
    errors: [],
  })
  assert.deepEqual(stopped, {
    cases: [
      {
        name: 'the flow stopped before its first case',
        actual: 'Error: page.goto: net::ERR_CONNECTION_REFUSED',
        passed: false,
      },
    ],
    errors: [],
  })
})

test('the pane DOM check runs its flow inside the case keeper and gives that one call its own, longer limit', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act
  const limits = Object.fromEntries(
    [...script.matchAll(/^const (COMMAND|FLOW)_TIMEOUT_MS = ([\d_]+)$/gm)].map(
      ([, name, value]) => [name, Number(value.replaceAll('_', ''))],
    ),
  )

  // Assert
  assert.deepEqual(limits, { COMMAND: 30_000, FLOW: 300_000 })
  assert.ok(
    script.includes(
      "timeout: label === 'flow' ? FLOW_TIMEOUT_MS : COMMAND_TIMEOUT_MS,",
    ),
    'the flow call has no limit of its own',
  )
  assert.ok(
    script.includes(
      '`async (page) => (${runFlowKeepingCases.toString()})(${check.toString()}, page, ${JSON.stringify(',
    ),
    'the flow is not run inside runFlowKeepingCases',
  )
  assert.ok(
    script.includes('async function check(page, options, collected) {') &&
      script.includes('  const { errors } = collected\n') &&
      script.includes('  const { cases } = collected,\n'),
    'the flow keeps lists of its own, which are lost when it throws',
  )
  // The keeper's text is run outside Node's module system: it may name nothing of its file.
  assert.doesNotMatch(runFlowKeepingCases.toString(), /\bimport\b|\brequire\b/)
})

// Value: protects=the measured case of the Wiki reader's right rail in the Reader DOM check (the unit suites read the shell's style sheet, never its layout); fails_when=the check stops laying out the shell, or lays it out at a width where the rail is no row; why_new=Cycle 0045 local review other-1 #6; seam=none
test('the pane DOM check lays out the Wiki reader’s shell at a width where its right rail is a row and measures the open control and the outline', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')
  const shell = await readFile(
    new URL('../../skills/codebook/reader-shell.html', import.meta.url),
    'utf8',
  )

  // Act: the fields the shell names and the fields the check's page has a text for.
  const shellFields = [
    ...new Set(
      [...shell.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(([, name]) => name),
    ),
  ].toSorted()
  const pageFields = [
    ...script
      .slice(
        script.indexOf('function wikiShellPage(shell) {'),
        script.indexOf('return shell.replace('),
      )
      .matchAll(/^ {4}([A-Z_]+):/gm),
  ]
    .map(([, name]) => name)
    .toSorted()

  // Assert
  assert.deepEqual(pageFields, shellFields)
  assert.ok(
    script.includes(
      "name: 'in the Wiki reader at 720 px the open control of the right rail keeps its label on one line, and the outline is no narrower than it',",
    ),
    'the case of the right rail is gone',
  )
  assert.ok(
    script.includes(
      '  await page.setViewportSize({ width: 720, height: 720 })\n  await page.goto(options.url)\n  await page.setContent(options.wikiShell)\n',
    ),
    'the shell is no longer laid out at 720 px',
  )
})
