import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { readerDomCommandOptions } from '../utils/readerDomCommandOptions.mjs'
import { readerDomFlowText } from '../utils/readerDomFlowText.mjs'
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

// Value: protects=the Reader DOM job's time limits: the one browser call that runs every case of the check may take five minutes, any other call thirty seconds; fails_when=the flow's call falls under the limit of a single browser command and is ended in the middle of its cases, or every call may hang for five minutes; why_new=Cycle 0045 review PA-1 (row 38 of Cycle 0046): the limits were checked as a line of the script's text; seam=none
test('the browser call that runs the whole pane DOM flow may take five minutes, and every other call thirty seconds', () => {
  // Act
  const limits = Object.fromEntries(
    ['open', 'video-start', 'flow', 'video-stop', 'close'].map((label) => [
      label,
      readerDomCommandOptions(label),
    ]),
  )

  // Assert
  assert.deepEqual(limits, {
    open: { timeout: 30_000, maxBuffer: 4_194_304 },
    'video-start': { timeout: 30_000, maxBuffer: 4_194_304 },
    flow: { timeout: 300_000, maxBuffer: 4_194_304 },
    'video-stop': { timeout: 30_000, maxBuffer: 4_194_304 },
    close: { timeout: 30_000, maxBuffer: 4_194_304 },
  })
})

// Value: protects=the Reader DOM report when a step of the flow throws inside the browser CLI: the file the CLI loads runs the flow inside the case keeper; fails_when=the file's text calls the flow directly, is no single expression, hands the options over as anything but data, or needs something of Node's module system that the CLI's context does not have; why_new=Cycle 0045 review PA-1 (row 38 of Cycle 0046): the wrapper was checked as a line of the script's text; seam=a new context without Node's globals, which runs the text as the browser CLI's run-code does
test('the file the browser CLI loads runs the pane DOM flow inside the case keeper, with the options as data and nothing of Node’s module system', async () => {
  // Arrange: a flow that passes one case from its options and the page, and then throws.
  const flow = async (page, options, collected) => {
    collected.cases.push({
      name: `${options.kind} first paint`,
      actual: page.title,
      passed: true,
    })
    throw new Error('locator.click: Timeout 5000ms exceeded.')
  }

  // Act: run-code wraps the file's text in parentheses and calls the function with the page.
  const flowText = readerDomFlowText(flow, { kind: 'context' })
  const runInBrowserCli = runInNewContext(`(${flowText})`)
  const report = await runInBrowserCli({ title: 'Loading study…' })

  // Assert: the report was built in the other context, so its plain data is compared.
  assert.deepEqual(JSON.parse(JSON.stringify(report)), {
    cases: [
      { name: 'context first paint', actual: 'Loading study…', passed: true },
      {
        name: 'the flow stopped after the case "context first paint"',
        actual: 'Error: locator.click: Timeout 5000ms exceeded.',
        passed: false,
      },
    ],
    errors: [],
  })
})

// The script cannot be imported (loading it starts its server and its browser), so that it uses the two utilities above, and that its flow adds to the lists it is handed, is read from its text, whatever its line breaks are.
test('the pane DOM check takes each call’s limits and the flow file’s text from their utilities, and its flow adds its cases and page errors to the lists the case keeper answers', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act
  const wiring = {
    commandLimits:
      /execFile\(\s*'playwright-cli',[^)]*?\breaderDomCommandOptions\(\s*label\s*\)/.test(
        script,
      ),
    flowFile: /writeFile\(\s*flowPath,\s*readerDomFlowText\(\s*check,/.test(
      script,
    ),
    flowParameters:
      /async function check\(\s*page,\s*options,\s*collected,?\s*\)/.test(
        script,
      ),
    collectedErrors: /\{\s*errors\s*\}\s*=\s*collected\b/.test(script),
    collectedCases: /\{\s*cases\s*\}\s*=\s*collected\b/.test(script),
    listsOfItsOwn: script.match(/\b(?:cases|errors)\s*=\s*\[\s*\]/g),
  }

  // Assert
  assert.deepEqual(wiring, {
    commandLimits: true,
    flowFile: true,
    flowParameters: true,
    collectedErrors: true,
    collectedCases: true,
    listsOfItsOwn: null,
  })
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

// Value: protects=the Reader DOM job when a disclosure does not toggle at its key press: that case fails after five seconds and names the disclosure; fails_when=the flow waits for the toggle event without a bound of its own (a promise of the page awaited through `page.evaluate`, which no limit of the browser tool ends), so one disclosure that stays as it is holds the whole flow until the five-minute limit of its browser call; why_new=Cycle 0046 row 88 (the local CodeRabbit review); seam=the helper's own text from the script, run against a page that records its calls and lets the bounded wait run out
test('the pane DOM check waits five seconds at most for a disclosure to toggle after its key press, and a disclosure that does not toggle fails with a sentence that names it', async () => {
  // Arrange: the helper as the script states it, and a page whose bounded wait runs out the way the browser tool's does.
  const script = await readFile(scriptUrl, 'utf8')
  const helperStart = script.indexOf('const toggleByKeyboard = async ('),
    helperEnd = script.indexOf('\n  }\n', helperStart)
  const helperText = script.slice(helperStart, helperEnd + '\n  }'.length)
  const calls = []
  const page = {
    evaluate: async (callback) => {
      calls.push(
        `evaluate ${callback.toString().includes('addEventListener') ? 'listens for toggle' : 'other'}`,
      )
    },
    locator: (selector) => ({
      focus: async () => {
        calls.push(`focus ${selector}`)
      },
    }),
    keyboard: {
      press: async (key) => {
        calls.push(`press ${key}`)
      },
    },
    waitForFunction: async (_callback, _argument, waitOptions) => {
      calls.push(`wait ${JSON.stringify(waitOptions)}`)
      throw new Error('page.waitForFunction: Timeout 5000ms exceeded.')
    },
  }

  // Act
  const toggleByKeyboard = runInNewContext(`${helperText}; toggleByKeyboard`, {
    page,
    Error,
  })
  const outcome = await toggleByKeyboard('study-files').then(
    () => 'resolved',
    (error) => error.message,
  )

  // Assert
  assert.deepEqual(calls, [
    'evaluate listens for toggle',
    'focus #study-files > summary',
    'press Enter',
    'wait {"timeout":5000}',
  ])
  assert.equal(
    outcome,
    'The disclosure #study-files did not toggle within 5000 ms of Enter on its summary (page.waitForFunction: Timeout 5000ms exceeded.)',
  )
})
