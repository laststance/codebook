import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EvidenceIntegrityError, StudyError } from '../errors'
import { studyErrorNamingCause } from '../utils/studyErrorNamingCause'

// Value: protects=the run failure that the maintenance turn sets for an evidence write failure naming that failure in its message, which becomes the run's terminal reason and its journaled run.failed reason, with its code and cause kept for the tool error; fails_when=the message stays "Evidence buffering or persistence failed.", or the code or the cause change; why_new=Cycle 0046 row 653; seam=none
test('a run failure with a generic sentence gets a message that names its cause, its code and cause kept', () => {
  // Arrange
  const failure = new StudyError(
    'EVIDENCE_UNAVAILABLE',
    'Evidence buffering or persistence failed.',
    'Error: ENOSPC: no space left on device, write',
  )

  // Act
  const named = studyErrorNamingCause(failure)

  // Assert
  assert.deepEqual(named.describe(), {
    code: 'EVIDENCE_UNAVAILABLE',
    message:
      'Evidence buffering or persistence failed. Cause: ENOSPC: no space left on device, write',
    cause: 'Error: ENOSPC: no space left on device, write',
    recovery:
      'Inspect the evidence failure and storage availability. Do not treat missing evidence as success.',
    docs: 'codebook://help/errors',
  })
})

// Value: protects=a run failure that already says why the run failed staying the very error its path raised, so a subclass that readers tell by its class (EvidenceIntegrityError) keeps it; fails_when=such a failure is replaced by a new plain StudyError or its message gains a repeated cause; why_new=Cycle 0046 row 653; seam=none
test('a run failure whose message is its own cause stays the same error, its class kept', () => {
  // Arrange
  const deadline = new StudyError(
      'RUNTIME_FAILED',
      'Study wall deadline expired; history only.',
    ),
    integrity = new EvidenceIntegrityError(
      'Captured image no longer matches its sealed hash.',
    )

  // Act
  const namedDeadline = studyErrorNamingCause(deadline),
    namedIntegrity = studyErrorNamingCause(integrity)

  // Assert
  assert.equal(namedDeadline, deadline)
  assert.equal(namedIntegrity, integrity)
  assert.equal(
    namedDeadline.message,
    'Study wall deadline expired; history only.',
  )
  assert.equal(namedIntegrity instanceof EvidenceIntegrityError, true)
})
