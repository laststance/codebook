import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { openFakeWikiPage, type FakeWikiPage } from './utils/fakeWikiPage'
import { readServedWikiScript } from './utils/readServedWikiScript'

/**
 * Reads the one inline script of a reader shell as a browser runs it: every CRLF and lone CR read as LF. Tests run from `dist/tests`.
 * @param pathFromExtension - The shell's path under `extension/`.
 * @returns The script's text between its tags.
 * @throws When the shell holds no inline script.
 * @example await shellScriptOf('skills/codebook/reader-shell.html')
 */
async function shellScriptOf(pathFromExtension: string): Promise<string> {
  const shell = (
    await readFile(join(__dirname, '..', '..', pathFromExtension), 'utf8')
  ).replace(/\r\n?/g, '\n')
  const script = /<script>([\s\S]*?)<\/script>/.exec(shell)?.[1]
  if (script === undefined)
    throw new Error(`The shell ${pathFromExtension} holds no inline script.`)
  return script
}

/**
 * Reads the question status line of a fake page as assistive technology meets it: its role, its text, whether it is drawn, and whether a disclosure holds it.
 * @param page - The fake page.
 * @returns What the line is, or `'no question status line'` when the page has none.
 * @example questionStatusOf(page) // => { role: 'status/polite', text: '', isShown: true, isInADisclosure: false }
 */
function questionStatusOf(page: FakeWikiPage) {
  const line = page.find('[data-codebook-question-status]')
  return line
    ? {
        role: `${line.getAttribute('role')}/${line.getAttribute('aria-live')}`,
        text: line.textContent,
        isShown: page.isShown(line),
        isInADisclosure: line.closest('details') !== null,
      }
    : 'no question status line'
}

// Value: protects=a screen reader user who asks a question on a served Wiki published before this build: "Asking the editor model…" is written into a status line that was in the page, drawn and empty, before the question, and the answer into an answer region that was shown and empty before the answer; fails_when=the reader writes the progress sentence into the answer's status region in the same handler that shows its hidden, closed disclosure, so the region enters the page together with its first text and is not announced; why_new=D2; seam=openFakeWikiPage with the 0.2.29.0 shell's script and the served codebook-qa.js, the composer of a Wiki published before the question status line, holdNext('api/ask'); no_claim=what a given screen reader announces, and the timing of a browser's accessibility tree
test('a question asked on a served Wiki published before this build is announced from a status line the reader added, which was in the page, drawn and empty, before the question', async () => {
  // Arrange: the page of a Wiki published by 0.2.29.0 runs that shell's own script before the reader's.
  const script = `${await shellScriptOf('scripts/fixtures/reader-shell-0.2.29.0.txt')}\n${await readServedWikiScript()}`
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {},
    { composer: 'published-before-the-question-status' },
  )
  page.holdNext('api/ask')
  const statusBeforeTheQuestion = questionStatusOf(page)

  // Act
  const submission = await page.ask('Where is the order created?')
  const statusWhileAsking = questionStatusOf(page)
  const answerRegion = page.find('.qa-answer')
  const answerWhileAsking = {
    text: answerRegion?.textContent,
    isShown: page.isShown(answerRegion),
  }
  await page.release('api/ask')

  // Assert
  assert.deepEqual(
    {
      submission,
      statusBeforeTheQuestion,
      statusWhileAsking,
      answerWhileAsking,
      statusAfterTheAnswer: questionStatusOf(page),
      answerAfterTheAnswer: answerRegion?.textContent,
      statusLines: page.body.querySelectorAll('[data-codebook-question-status]')
        .length,
      // The older shell has no rules for the line, so the reader brings them: empty, the line takes no room.
      isStatusLineStyled: page
        .injectedStyles()
        .includes(
          '.qa-status{font-size:.85rem;margin:.4rem 0 0;overflow-wrap:anywhere}.qa-status:empty{margin:0}',
        ),
    },
    {
      submission: { wasSubmissionPrevented: true },
      statusBeforeTheQuestion: {
        role: 'status/polite',
        text: '',
        isShown: true,
        isInADisclosure: false,
      },
      statusWhileAsking: {
        role: 'status/polite',
        text: 'Asking the editor model…',
        isShown: true,
        isInADisclosure: false,
      },
      answerWhileAsking: { text: '', isShown: true },
      statusAfterTheAnswer: {
        role: 'status/polite',
        text: '',
        isShown: true,
        isInADisclosure: false,
      },
      answerAfterTheAnswer:
        'The order is created in src/order.ts.src/order.ts:3',
      statusLines: 1,
      isStatusLineStyled: true,
    },
  )
})

// Value: protects=a screen reader user who asks a question on a Wiki this build publishes: the reader writes "Asking the editor model…" into the shell's own question status line, in the page and empty before the question, and adds no second line; fails_when=the reader keeps writing the progress sentence into the answer region it shows in the same handler, or adds a line of its own beside the shell's, so the progress is not announced or is announced twice; why_new=D2; seam=openFakeWikiPage with the bundled shell's script and the served codebook-qa.js, the current shell's composer, holdNext('api/ask'); no_claim=what a given screen reader announces
test('a question asked on a served Wiki of this build is announced from the shell’s own status line, and the reader adds no second one', async () => {
  // Arrange: the page runs the bundled shell's script before the reader's.
  const script = `${await shellScriptOf('skills/codebook/reader-shell.html')}\n${await readServedWikiScript()}`
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {},
    { composer: 'current-shell' },
  )
  page.holdNext('api/ask')
  const statusBeforeTheQuestion = questionStatusOf(page)

  // Act
  await page.ask('Where is the order created?')
  const statusWhileAsking = questionStatusOf(page)
  await page.release('api/ask')

  // Assert
  assert.deepEqual(
    {
      statusBeforeTheQuestion,
      statusWhileAsking,
      statusLines: page.body.querySelectorAll('[data-codebook-question-status]')
        .length,
      answerAfterTheAnswer: page.find('.qa-answer')?.textContent,
    },
    {
      statusBeforeTheQuestion: {
        role: 'status/polite',
        text: '',
        isShown: true,
        isInADisclosure: false,
      },
      statusWhileAsking: {
        role: 'status/polite',
        text: 'Asking the editor model…',
        isShown: true,
        isInADisclosure: false,
      },
      statusLines: 1,
      answerAfterTheAnswer:
        'The order is created in src/order.ts.src/order.ts:3',
    },
  )
})

// Value: protects=a screen reader user who asks a question on a Wiki page opened from disk: the shell's script writes its offline sentence into the question status line, in the page and empty before the question, and opens no empty answer disclosure; fails_when=the shell's script shows its hidden, closed answer disclosure and writes the offline sentence into the answer region in the same handler, so the sentence is not announced; why_new=D2 (the shell's half); seam=openFakeWikiPage with the bundled shell's script alone (no reader serves the page), the current shell's composer; no_claim=what a given screen reader announces
test('a question asked on a Wiki page opened from disk tells the offline sentence from the shell’s status line, which was in the page, drawn and empty, before the question, and opens no empty answer', async () => {
  // Arrange: no reader serves the page, so only the shell's own script runs.
  const page = await openFakeWikiPage(
    await shellScriptOf('skills/codebook/reader-shell.html'),
    'current-shell',
    {},
    { composer: 'current-shell' },
  )
  const statusBeforeTheQuestion = questionStatusOf(page)

  // Act
  const submission = await page.ask('Where is the order created?')

  // Assert
  assert.deepEqual(
    {
      submission,
      statusBeforeTheQuestion,
      statusAfterTheQuestion: questionStatusOf(page),
      isAnswerDisclosureShown: page.isShown(page.find('#qa-response')),
    },
    {
      submission: { wasSubmissionPrevented: true },
      statusBeforeTheQuestion: {
        role: 'status/polite',
        text: '',
        isShown: true,
        isInADisclosure: false,
      },
      statusAfterTheQuestion: {
        role: 'status/polite',
        text: 'Open this Wiki through Codebook: Open DeepWiki in Browser to connect the editor model.',
        isShown: true,
        isInADisclosure: false,
      },
      isAnswerDisclosureShown: false,
    },
  )
})
