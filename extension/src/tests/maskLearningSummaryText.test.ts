import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LearningSummary } from '../learningSummarySchemas'
import { maskLearnerSecretData } from '../utils/maskLearnerSecretData'
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
  const masked = maskLearningSummaryText(summary, (value) =>
    maskLearnerSecretData(value, new Set([SHORT_SECRET])),
  )
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
