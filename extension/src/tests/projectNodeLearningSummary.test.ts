import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_TEST_LEARNING_MATERIAL_VERSION } from '../constants'
import type { NodeTestLearningMaterial } from '../nodeTestHistorySchemas'
import { projectNodeLearningSummary } from '../utils/projectNodeLearningSummary'

// Value: protects=the learning material the editor agent wrote reaches the Study pane's summary, its sequence diagram and the Study section without terminal or bidirectional controls, as the recorded texts do, so a U+202E the agent copied from test output cannot reorder what the learner reads; fails_when=a control survives in the question, the title, the summary, a participant's label or a step's label or explanation, or the saved material is changed; why_new=F341 (PR-2 /ship Step 11 Claude adversarial): F131 stripped the history's recorded texts and left the material's; seam=none; no_claim=how the summary renderer lays the text out
test('a test replay’s learning material reaches the summary without terminal and bidirectional controls', () => {
  // Arrange
  const material: NodeTestLearningMaterial = {
    version: NODE_TEST_LEARNING_MATERIAL_VERSION,
    studyId: 'study',
    revision: 1,
    updatedAt: '2026-10-23T00:00:00.000Z',
    content: {
      question: 'Where \u202Edoes it switch?',
      title: 'Theme\u202E switch',
      summary: 'Reads the theme \u001b[31mtwice',
      participants: [{ id: 'test', label: 'Theme\u2066 test\u2069' }],
      steps: [
        {
          id: 'read',
          from: 'test',
          to: 'test',
          label: 'Read\u200F the theme',
          explanation: 'The stop shows\u202C dark.',
          evidence: 'unknown',
        },
      ],
    },
  }

  // Act
  const content = projectNodeLearningSummary(material, { entries: [] })?.content

  // Assert
  assert.deepEqual(
    {
      question: content?.question,
      title: content?.title,
      summary: content?.summary,
      participant: content?.participants[0]?.label,
      label: content?.steps[0]?.label,
      explanation: content?.steps[0]?.explanation,
      evidence: content?.steps[0]?.evidence,
    },
    {
      question: 'Where does it switch?',
      title: 'Theme switch',
      summary: 'Reads the theme twice',
      participant: 'Theme test',
      label: 'Read the theme',
      explanation: 'The stop shows dark.',
      evidence: 'unknown',
    },
  )
  assert.equal(material.content.title, 'Theme\u202E switch')
})
