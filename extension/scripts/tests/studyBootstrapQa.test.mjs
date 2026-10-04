import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

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
