import assert from 'node:assert/strict'
import { test } from 'node:test'

import { savedSessionStatusText } from '../utils/savedSessionStatusText'

const FORMAT = { timeZone: 'UTC', locale: 'en-US' }
const VIEW = {
  available: true,
  state: 'saved' as const,
  setupAt: '2026-11-02T12:10:00.000Z',
  repositoryName: 'shop',
  setupOpenHere: false,
}

// protects=DES-1, DES-5, X7; fails_when=a text claims a sign-in or verification, the setup time is missing, or the item shows for state none; no_claim=status bar placement
test('the saved-session item shows its setup date and time, never claims a sign-in, and hides when there is nothing to show', () => {
  // Arrange / Act
  const saved = savedSessionStatusText({ kind: 'view', view: VIEW }, FORMAT)
  const none = savedSessionStatusText(
    {
      kind: 'view',
      view: { ...VIEW, available: false, state: 'none', setupAt: undefined },
    },
    FORMAT,
  )
  const unconfirmed = savedSessionStatusText(
    { kind: 'view', view: { ...VIEW, available: false, state: 'unconfirmed' } },
    FORMAT,
  )
  // Assert
  assert.deepEqual(saved, {
    text: '$(key) Saved session · set up Nov 2, 12:10 PM',
    tooltip:
      'Saved session for shop. Codebook does not check whether the app still has you signed in.',
  })
  assert.equal(none, undefined)
  assert.equal(unconfirmed?.text, '$(key) Saved session · setup not finished')
})

// protects=DES-2 (Done and Close setup exist only in the window that opened the setup); fails_when=a window whose store reads setup-open for another window's setup tells the learner to choose Done here; no_claim=how the store reads another window's lock
test('a setup open in another editor window says so instead of asking to choose Done in this one', () => {
  // Arrange / Act
  const elsewhere = savedSessionStatusText(
    {
      kind: 'view',
      view: { ...VIEW, available: false, state: 'setup-open' },
    },
    FORMAT,
  )
  const here = savedSessionStatusText(
    {
      kind: 'view',
      view: {
        ...VIEW,
        available: false,
        state: 'setup-open',
        setupOpenHere: true,
      },
    },
    FORMAT,
  )
  // Assert
  assert.deepEqual(elsewhere, {
    text: '$(key) Saved session · setup open',
    tooltip:
      'A setup for shop is open in another editor window. Choose Done or Close setup there.',
  })
  assert.deepEqual(here, {
    text: '$(key) Saved session · setup open',
    tooltip:
      'Sign in to shop in the Codebook browser window, then choose Done.',
  })
})

// protects=DES-2 states, DES-3 needed state; fails_when=a setup phase or a refused run has no item text; no_claim=the notice text
test('the item reads Setup open during a setup and Saved session needed after a refused run', () => {
  // Arrange / Act
  const open = savedSessionStatusText({
    kind: 'setup',
    phase: { phase: 'open', repositoryName: 'shop' },
  })
  const needed = savedSessionStatusText({
    kind: 'needed',
    reason: 'session-cookie-only',
    repositoryName: 'shop',
  })
  // Assert
  assert.equal(open?.text, '$(key) Saved session · setup open')
  assert.deepEqual(needed, {
    text: '$(key) Saved session needed',
    tooltip:
      'shop keeps its sign-in only while the browser stays open, so a saved session cannot keep it.',
  })
})
