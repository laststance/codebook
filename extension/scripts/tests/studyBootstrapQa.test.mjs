import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Read as text and never imported: loading the script starts its server and its browser.
const scriptUrl = new URL('../study-bootstrap-qa.mjs', import.meta.url)

test('the pane DOM check derives every awaited revision from the first message', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: a revision compared with a number of its own stops matching as soon as the first message's revision changes.
  const comparedWithNumbers = script
    .split('\n')
    .flatMap((line, index) =>
      /[Rr]evision\s*[!=]==?\s*\d/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    )
  const messageRevisionsStatedAsNumbers = script.match(/\brevision: \d+/g)

  // Assert: only the first message states its revision; every later one and every comparison is revisionAt(n).
  assert.deepEqual(comparedWithNumbers, [])
  assert.deepEqual(messageRevisionsStatedAsNumbers, ['revision: 1'])
  assert.ok(
    script.includes(
      'const revisionAt = (step) => options.message.revision + step',
    ),
    'revisionAt no longer starts from the first message',
  )
})
