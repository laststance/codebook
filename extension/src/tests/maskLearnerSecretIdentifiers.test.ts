import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  learningSummarySchema,
  type LearningSummary,
} from '../learningSummarySchemas'
import { maskLearnerSecretData } from '../utils/maskLearnerSecretData'
import { maskLearnerSecretJsonText } from '../utils/maskLearnerSecretJsonText'
import { maskLearningSummaryText } from '../utils/maskLearningSummaryText'

const SHORT_SECRET = 'cafe'
const SOURCE_HASH = `00${SHORT_SECRET}${'1'.repeat(58)}`
const SNAPSHOT_URI = `codebook://studies/run-1/snapshots/${SHORT_SECRET}-stop`

// protects=a learner secret short enough to occur inside a hash or a URI masks the summary's text but never rewrites a step's reference, so the saved study's reference check still finds the observation; fails_when=value masking turns sourceHash or snapshotUri into a string with [masked] and every save of that run fails; no_claim=the service's own mask and the saved-study validation, which other tests cover
test('a short learner secret is masked in the summary text and every step reference keeps its bytes', () => {
  // Arrange
  const summary: LearningSummary = {
    question: 'How does the sign-in check the password?',
    title: 'Sign-in check',
    summary: `The learner typed ${SHORT_SECRET} into the password control.`,
    participants: [
      { id: 'form', label: 'Login form' },
      { id: 'action', label: 'authenticate' },
    ],
    steps: [
      {
        id: 'submit',
        from: 'form',
        to: 'action',
        label: 'Submit',
        explanation: `The form sent ${SHORT_SECRET} as the password.`,
        evidence: 'observed',
        reference: { snapshotUri: SNAPSHOT_URI, sourceHash: SOURCE_HASH },
      },
    ],
  }
  // Act
  const masked = maskLearnerSecretData(summary, new Set([SHORT_SECRET]))
  // Assert
  assert.deepEqual(
    {
      summary: masked.summary,
      explanation: masked.steps[0]?.explanation,
      reference: masked.steps[0]?.reference,
    },
    {
      summary: 'The learner typed [masked] into the password control.',
      explanation: 'The form sent [masked] as the password.',
      reference: { snapshotUri: SNAPSHOT_URI, sourceHash: SOURCE_HASH },
    },
  )
})

// protects=a secret inside a generated run id leaves runUri, continueArguments and every id, hash and key usable while a real copy in a value is still masked; fails_when=masking rewrites an identifier so the URI or the continuation stops working, or leaves the copy in a message; no_claim=the identifier rule for keys outside the listed suffixes
test('a secret inside a run id keeps runUri and continueArguments and still masks a copy in a message', () => {
  // Arrange
  const value = {
    runUri: 'codebook://studies/run-4821-a',
    sessionId: '00004821-aaaa',
    message: 'bad 4821',
    state: {
      continueArguments: {
        participant: 'browser',
        pauseId: '4821',
        generation: 3,
      },
    },
  }
  // Act
  const masked = maskLearnerSecretData(value, new Set(['4821']))
  // Assert
  assert.deepEqual(masked, {
    runUri: 'codebook://studies/run-4821-a',
    sessionId: '00004821-aaaa',
    message: 'bad [masked]',
    state: {
      continueArguments: {
        participant: 'browser',
        pauseId: '4821',
        generation: 3,
      },
    },
  })
})

// protects=a JSON text keeps parsing when the secret equals a JSON token, and a text without a secret is returned byte for byte; fails_when=the text is masked as characters, turning "ok":true into "ok":[masked]; no_claim=text that is not a JSON object or array, which is masked as text
test('the JSON text mask produces its text from the masked structure', () => {
  // Arrange
  const text = '{"ok":true,"uri":"codebook://x/true-1","note":"typed true"}'
  // Act
  const masked = maskLearnerSecretJsonText(text, new Set(['true']))
  const untouched = maskLearnerSecretJsonText(text, new Set(['absent-secret']))
  // Assert
  assert.equal(
    masked,
    '{"ok":true,"uri":"codebook://x/true-1","note":"typed [masked]"}',
  )
  assert.equal(untouched, text)
})

// protects=a learner secret equal to an evidence enum or a participant id masks the summary's prose but leaves its structure, so the saved summary still passes its schema; fails_when=the evidence, from, to or an id becomes [masked] and the schema refuses the summary; no_claim=the service's own text mask, replaced here by a plain string replace
test('a learner secret equal to an evidence value or a participant id leaves the summary structure valid and masks its text', () => {
  // Arrange
  const summary: LearningSummary = {
    question: 'Why does observed matter?',
    title: 'The observed step',
    summary: 'The learner typed observed.',
    participants: [{ id: 'observed', label: 'observed' }],
    steps: [
      {
        id: 'step-1',
        from: 'observed',
        to: 'observed',
        label: 'observed',
        explanation: 'The page showed observed.',
        evidence: 'observed',
        reference: { snapshotUri: SNAPSHOT_URI, sourceHash: SOURCE_HASH },
      },
    ],
  }
  // Act
  const masked = maskLearningSummaryText(summary, (text) =>
    text.replaceAll('observed', '[masked]'),
  )
  const parsed = learningSummarySchema.safeParse(masked)
  // Assert
  assert.equal(parsed.success, true)
  assert.deepEqual(
    {
      title: masked.title,
      participant: masked.participants[0],
      step: masked.steps[0],
    },
    {
      title: 'The [masked] step',
      participant: { id: 'observed', label: '[masked]' },
      step: {
        id: 'step-1',
        from: 'observed',
        to: 'observed',
        label: '[masked]',
        explanation: 'The page showed [masked].',
        evidence: 'observed',
        reference: { snapshotUri: SNAPSHOT_URI, sourceHash: SOURCE_HASH },
      },
    },
  )
})
