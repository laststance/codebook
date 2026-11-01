import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { createSavedSessionOperationsAsker } from '../utils/createSavedSessionOperationsAsker'
import { describeOperationsConfirmationNotice } from '../utils/describeOperationsConfirmationNotice'
import { describeSavedSessionOperations } from '../utils/describeSavedSessionOperations'
import { listSavedSessionOperations } from '../utils/listSavedSessionOperations'

import { defer } from './utils/defer'
import { loadModule } from './utils/loadModule'

const FOUR_LINES = [
  { index: 1, kind: 'choose', title: 'Customer', value: 'Evil Rabbit' },
  { index: 2, kind: 'text', title: 'Amount', value: '120' },
  { index: 3, kind: 'click', title: 'Pending' },
  { index: 4, kind: 'text', title: 'Password', value: '(hidden)' },
] as const

// protects=DES-4: the message, detail lines and button label of a four-operation question; fails_when=a line is missing, reordered or reworded; no_claim=how the editor draws it
test('the confirmation text lists the count, repository, page, the two data sentences and one numbered line per operation', () => {
  // Arrange
  const question = {
    runId: 'r1',
    repository: 'nextjs-dashboard',
    entryPath: '/dashboard/invoices/create',
    operations: FOUR_LINES,
  }
  // Act
  const text = describeSavedSessionOperations(question)
  // Assert
  assert.deepEqual(text, {
    message: 'Run 4 operations in nextjs-dashboard as your saved session?',
    detail: [
      'Page: /dashboard/invoices/create',
      "Changes this run makes to the app's data are real; the replay does not undo them.",
      'The app keeps the data it already had.',
      '1. choose Customer: Evil Rabbit',
      '2. text Amount: 120',
      '3. click Pending',
      '4. text Password: (hidden)',
    ].join('\n'),
    confirmLabel: 'Run 4 operations',
  })
})

// protects=readable dialog values: one operation reads singular and a long multi-line value becomes one line cut with an ellipsis; fails_when=a newline reaches the dialog or a value is unbounded; no_claim=none beyond protects
test('one operation reads singular, and a long multi-line value is put on one line and cut with an ellipsis', () => {
  // Arrange
  const question = {
    runId: 'r1',
    repository: 'shop',
    entryPath: '/',
    operations: [
      {
        index: 1,
        kind: 'text' as const,
        title: 'Note',
        value: `${'a\n'.repeat(100)}`,
      },
    ],
  }
  // Act
  const text = describeSavedSessionOperations(question)
  // Assert
  assert.equal(text.message, 'Run 1 operation in shop as your saved session?')
  assert.equal(text.confirmLabel, 'Run 1 operation')
  assert.equal(text.detail.includes('\n1. text Note: '), true)
  assert.equal(text.detail.split('\n').length, 4)
  assert.equal(text.detail.endsWith('…'), true)
})

// protects=ENG-8/DX-1: a secret is never listed, a choice shows its label, and an option not on the page yet says chosen when sent; fails_when=a secret or an option value is shown; no_claim=the page read
test('listed values hide secrets, show a choice by its label and say chosen when sent for an option not on the page yet', () => {
  // Arrange
  const operations: RepositoryOperation[] = [
    { kind: 'choose', title: 'Customer', selector: '#c', value: 'c1' },
    { kind: 'choose', title: 'Plan', selector: '#plan', value: 'p9' },
    { kind: 'choose', title: 'Key', selector: '#api', value: 'k-secret-value' },
    { kind: 'text', title: 'Amount', selector: '#a', text: '120' },
    { kind: 'text', title: 'Code', selector: '#code', text: 'visible-text' },
    { kind: 'text', title: 'Password', selector: '#p', secret: 'ask-learner' },
    { kind: 'click', title: 'Pay', selector: '#pay' },
  ]
  const facts = [
    { index: 1, found: true, secret: false, optionLabel: 'Alice' },
    { index: 2, found: false, secret: false },
    { index: 3, found: true, secret: true },
    { index: 5, found: true, secret: true },
  ]
  // Act
  const lines = listSavedSessionOperations(operations, facts)
  const withoutFacts = listSavedSessionOperations(
    operations.slice(0, 2),
    undefined,
  )
  // Assert
  assert.deepEqual(
    lines.map((line) => line.value),
    [
      'Alice',
      '(chosen when sent)',
      '(hidden)',
      '120',
      '(hidden)',
      '(hidden)',
      undefined,
    ],
  )
  assert.deepEqual(
    withoutFacts.map((line) => line.value),
    ['(chosen when sent)', '(chosen when sent)'],
  )
})

// protects=ENG-6 at the editor boundary: the primary answer confirms, Cancel does not, an abort answers false and reports the later answer without confirming, an aborted signal shows no modal, a failing modal rejects; fails_when=a late answer resolves the call true or a fault reads as Cancel; no_claim=the native dialog
test('the asker confirms only on the primary button, answers false for Cancel and an abort, and reports a later answer without confirming', async () => {
  // Arrange
  const question = {
    runId: 'r1',
    repository: 'shop',
    entryPath: '/',
    operations: [{ index: 1, kind: 'click' as const, title: 'Pay' }],
  }
  const label = 'Run 1 operation'
  const shownMessages: string[] = []
  const answers: Record<string, string | undefined> = {
    primary: label,
    cancel: undefined,
  }
  const asker = (choice: string | undefined) =>
    createSavedSessionOperationsAsker(async (message) => {
      shownMessages.push(message)
      return choice
    })
  const late = defer<string | undefined>()
  const lateAnswers: boolean[] = []
  const abortController = new AbortController()
  const abortedAsker = createSavedSessionOperationsAsker(() => late.promise)
  const alreadyAborted = AbortSignal.abort()
  // Act
  const confirmed = await asker(answers.primary)(
    question,
    new AbortController().signal,
  )
  const cancelled = await asker(answers.cancel)(
    question,
    new AbortController().signal,
  )
  const pending = abortedAsker(question, abortController.signal, (value) =>
    lateAnswers.push(value),
  )
  abortController.abort()
  const aborted = await pending
  late.resolve(label)
  await late.promise
  await Promise.resolve()
  const shownBefore = shownMessages.length
  const skipped = await asker(label)(question, alreadyAborted)
  const faulty = createSavedSessionOperationsAsker(() =>
    Promise.reject(new Error('modal failed')),
  )
  // Assert
  assert.equal(confirmed, true)
  assert.equal(cancelled, false)
  assert.equal(aborted, false)
  assert.deepEqual(lateAnswers, [true])
  assert.equal(skipped, false)
  assert.equal(shownMessages.length, shownBefore)
  await assert.rejects(
    faulty(question, new AbortController().signal),
    /modal failed/,
  )
})

// protects=DES-4: the Operations not confirmed notices offer Review again and the confirmed notice offers nothing; fails_when=a kind lacks the action or its words; no_claim=the notification UI
test('the Operations not confirmed notices offer Review again, and the confirmed notice offers nothing', () => {
  // Arrange
  const notice = (
    kind: 'declined' | 'timed-out' | 'expired-answer' | 'confirmed',
  ) =>
    describeOperationsConfirmationNotice({
      runId: 'r',
      repository: 'shop',
      kind,
    })
  // Act
  const results = {
    declined: notice('declined'),
    timedOut: notice('timed-out'),
    expired: notice('expired-answer'),
    confirmed: notice('confirmed'),
  }
  // Assert
  assert.deepEqual(
    [
      results.declined.actions,
      results.timedOut.actions,
      results.expired.actions,
    ],
    [['Review again'], ['Review again'], ['Review again']],
  )
  assert.equal(
    results.declined.message,
    'Operations not confirmed for shop. Nothing was sent and the run is waiting. Choose Review again to see its operations again.',
  )
  assert.match(results.timedOut.message, /not answered in time/)
  assert.match(results.expired.message, /your answer was not used/)
  assert.deepEqual(results.confirmed, {
    severity: 'information',
    message:
      'Operations confirmed for shop. Your AI chat can send them now; ask it to continue if it stopped waiting.',
    actions: [],
  })
})

// protects=OCR 44: every Operations not confirmed notice tells the learner to choose the button it shows, whatever that button's label is; fails_when=a message hard-codes the label, so a renamed or localized REVIEW_AGAIN_LABEL leaves the notice naming a button that no longer exists; no_claim=how the editor draws the notice
test('each Operations not confirmed notice names the button it shows, also under another button label', async () => {
  // Arrange
  const relabeled = await loadModule<{
    describeOperationsConfirmationNotice: typeof describeOperationsConfirmationNotice
  }>(resolve(__dirname, '../utils/describeOperationsConfirmationNotice.js'), {
    '../constants': { ...constants, REVIEW_AGAIN_LABEL: 'Show operations' },
  })
  // Act
  const notices = (['declined', 'timed-out', 'expired-answer'] as const).map(
    (kind) =>
      relabeled.describeOperationsConfirmationNotice({
        runId: 'r',
        repository: 'shop',
        kind,
      }),
  )
  // Assert
  // The loaded module's arrays belong to its own context: copied, they compare as plain values.
  assert.deepEqual(
    notices.map((notice) => [...notice.actions]),
    [['Show operations'], ['Show operations'], ['Show operations']],
  )
  assert.deepEqual(
    notices.map((notice) => notice.message),
    [
      'Operations not confirmed for shop. Nothing was sent and the run is waiting. Choose Show operations to see its operations again.',
      'Operations not confirmed for shop: the dialog was not answered in time, so nothing was sent and the run is waiting. Choose Show operations to see its operations again.',
      'Operations not confirmed for shop: Codebook had stopped waiting for that dialog, so your answer was not used and nothing was sent. Choose Show operations to confirm the operations.',
    ],
  )
})
