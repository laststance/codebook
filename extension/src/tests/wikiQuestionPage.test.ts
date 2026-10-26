import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  openFakeWikiPage,
  type FakeWikiPage,
  type FakeWikiQuestionAnswer,
} from './utils/fakeWikiPage'
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
        text: 'Open this Wiki through Codebook: Open LLM Wiki in Browser to connect the editor model.',
        isShown: true,
        isInADisclosure: false,
      },
      isAnswerDisclosureShown: false,
    },
  )
})

/** The page forms the reader serves a question from: a Wiki published before this build, with that shell's script, and one of this build, with the bundled shell's script. */
const SERVED_FORMS = [
  {
    published: 'before this build',
    composer: 'published-before-the-question-status',
    shell: 'scripts/fixtures/reader-shell-0.2.29.0.txt',
  },
  {
    published: 'by this build',
    composer: 'current-shell',
    shell: 'skills/codebook/reader-shell.html',
  },
] as const

// Value: protects=a screen reader user whose question the reader refuses at once (a question too long, a reader that is gone): the reason is announced from the question status line, which was in the page, drawn and empty, before the question, and no empty answer stays open; fails_when=the reason is written into the answer's status region, whose disclosure the same question showed a moment before, so a refusal that comes back within the same frame lands in a region that entered the page with it and is not announced; why_new=D2 (the residual gap of the first fix: an immediate reply); seam=openFakeWikiPage with the shell's script and the served codebook-qa.js, the fake reader's refusal of api/ask (an error status and its reason, answered at once); no_claim=what a given screen reader announces, and the timing of a browser's frames
for (const form of SERVED_FORMS)
  test(`a question the reader refuses at once on a served Wiki published ${form.published} is announced from the status line that was in the page before it, and no empty answer stays open`, async () => {
    // Arrange
    const script = `${await shellScriptOf(form.shell)}\n${await readServedWikiScript()}`
    const page = await openFakeWikiPage(
      script,
      'current-shell',
      { questionAnswer: { error: 'The Wiki question is too long.' } },
      { composer: form.composer },
    )
    const statusBeforeTheQuestion = questionStatusOf(page)

    // Act
    await page.ask('Where is the order created?')

    // Assert
    assert.deepEqual(
      {
        statusBeforeTheQuestion,
        statusAfterTheRefusal: questionStatusOf(page),
        answer: page.find('.qa-answer')?.textContent,
        isAnswerDisclosureShown: page.isShown(page.find('#qa-response')),
      },
      {
        statusBeforeTheQuestion: {
          role: 'status/polite',
          text: '',
          isShown: true,
          isInADisclosure: false,
        },
        statusAfterTheRefusal: {
          role: 'status/polite',
          text: 'Error: The Wiki question is too long.',
          isShown: true,
          isInADisclosure: false,
        },
        answer: '',
        isAnswerDisclosureShown: false,
      },
    )
  })

// Value: protects=a screen reader user in an editor that exposes no model to the Wiki reader: the sentence that the question waits in the editor chat comes back at once and is announced from the question status line, which was in the page before it, and no empty answer stays open; fails_when=the hand-off sentence is written into the answer's status region that the same question showed a moment before, so it enters the page together with its text and is not announced; why_new=D2 (the residual gap of the first fix: an immediate hand-off); seam=openFakeWikiPage with the shell's script and the served codebook-qa.js, the fake reader's hand-off answer of api/ask, answered at once; no_claim=what a given screen reader announces
for (const form of SERVED_FORMS)
  test(`a question handed to the editor chat at once on a served Wiki published ${form.published} is announced from the status line that was in the page before it, and no empty answer stays open`, async () => {
    // Arrange
    const handoff =
      'This editor exposes no model to the Wiki reader. Your question is ready in the editor chat. Send it there for a source-cited answer.'
    const script = `${await shellScriptOf(form.shell)}\n${await readServedWikiScript()}`
    const page = await openFakeWikiPage(
      script,
      'current-shell',
      { questionAnswer: { handoff } },
      { composer: form.composer },
    )
    const statusBeforeTheQuestion = questionStatusOf(page)

    // Act
    await page.ask('Where is the order created?')

    // Assert
    assert.deepEqual(
      {
        statusBeforeTheQuestion,
        statusAfterTheHandoff: questionStatusOf(page),
        answer: page.find('.qa-answer')?.textContent,
        isAnswerDisclosureShown: page.isShown(page.find('#qa-response')),
      },
      {
        statusBeforeTheQuestion: {
          role: 'status/polite',
          text: '',
          isShown: true,
          isInADisclosure: false,
        },
        statusAfterTheHandoff: {
          role: 'status/polite',
          text: handoff,
          isShown: true,
          isInADisclosure: false,
        },
        answer: '',
        isAnswerDisclosureShown: false,
      },
    )
  })

/** The late replies to an earlier question that a newer question's answer must outlast: a refusal, a hand-off to the editor chat, and an answer of its own with a citation and the source-changed line. */
const LATE_REPLIES: readonly {
  kind: string
  questionAnswer: FakeWikiQuestionAnswer
}[] = [
  {
    kind: 'refusal',
    questionAnswer: { error: 'The editor model could not answer.' },
  },
  {
    kind: 'hand-off',
    questionAnswer: {
      handoff:
        'This editor exposes no model to the Wiki reader. Your question is ready in the editor chat. Send it there for a source-cited answer.',
    },
  },
  {
    kind: 'answer',
    questionAnswer: {
      answer: 'The order is created in src/order.ts.',
      citations: [
        {
          path: 'src/order.ts',
          line: 3,
          uri: 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Forder.ts&line=3',
        },
      ],
      sourceChanged: true,
    },
  },
]

// Value: protects=a learner who asks again before the first question's reply came: the newer answer, its citations and its status line stay as the newer question left them when the earlier question's refusal, hand-off or answer arrives late; fails_when=the reply of an older question still writes the status line and hides the answer's disclosure, or still writes its answer, its source-changed line and its citations into the answer region (the latest-question guard of codebook-qa.js is dropped or skips the answer), so the newer answer vanishes or the older one stands, and is announced, under the newer question; why_new=D2 added the disclosure's hiding; P2D1 the answer's write; every question test asks once; seam=openFakeWikiPage with the bundled shell's script and the served codebook-qa.js, holdNext('api/ask') for the first question, the fake reader's answer changed between the questions; no_claim=what a given screen reader announces
for (const late of LATE_REPLIES)
  test(`a newer question’s answer stays shown with its status line as it left it when an earlier question’s ${late.kind} comes back after it`, async () => {
    // Arrange: the first question's reply is held back; the reader answers the second question at once.
    const script = `${await shellScriptOf('skills/codebook/reader-shell.html')}\n${await readServedWikiScript()}`
    const page = await openFakeWikiPage(
      script,
      'current-shell',
      { questionAnswer: late.questionAnswer },
      { composer: 'current-shell' },
    )
    page.holdNext('api/ask')
    await page.ask('Where is the order created?')
    page.reader.questionAnswer = {
      answer: 'The order is saved in src/store.ts.',
      citations: [
        {
          path: 'src/store.ts',
          line: 8,
          uri: 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Fstore.ts&line=8',
        },
      ],
      sourceChanged: false,
    }
    await page.ask('Where is the order saved?')

    // Act: the first question's reply comes back after the second question's answer.
    await page.release('api/ask')

    // Assert
    assert.deepEqual(
      {
        status: questionStatusOf(page),
        answer: page.find('.qa-answer')?.textContent,
        isAnswerDisclosureShown: page.isShown(page.find('#qa-response')),
      },
      {
        status: {
          role: 'status/polite',
          text: '',
          isShown: true,
          isInADisclosure: false,
        },
        answer: 'The order is saved in src/store.ts.src/store.ts:8',
        isAnswerDisclosureShown: true,
      },
    )
  })
