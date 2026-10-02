import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { evidenceInUseElsewhere } from '../utils/evidenceInUseElsewhere'
import { studyEvidenceDirectory } from '../utils/studyEvidenceDirectory'

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111',
  RUN_ID = '22222222-2222-4222-8222-222222222222'

/** Creates an empty agent storage directory that the test's teardown removes. @example const agentRoot = await agentStorage(context) */
async function agentStorage(context: TestContext): Promise<string> {
  const agentRoot = await mkdtemp(join(tmpdir(), 'codebook-agent-'))
  context.after(() => rm(agentRoot, { recursive: true, force: true }))
  return agentRoot
}

// Value: protects=a deletion names exactly the run directory of the deleted study and never a path outside one; fails_when=the instance and run parts are swapped or joined wrongly, or a text that is no study id yields a path; why_new=the removal did not derive an evidence directory before; seam=none
test('the evidence directory of a saved study is its instance and run below the agent storage, and no other text names one', () => {
  // Arrange / Act
  const directory = studyEvidenceDirectory(
    '/storage/agent',
    `${INSTANCE_ID}_${RUN_ID}`,
  )
  // Assert
  assert.equal(
    directory,
    '/storage/agent/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
  )
  assert.equal(
    studyEvidenceDirectory('/storage/agent', '../elsewhere'),
    undefined,
  )
  assert.equal(studyEvidenceDirectory('/storage/agent', INSTANCE_ID), undefined)
  assert.equal(
    studyEvidenceDirectory('/storage/agent', `${INSTANCE_ID}_${RUN_ID}/..`),
    undefined,
  )
})

// Value: protects=evidence another Codebook window may still be using is recognised by that window's connection descriptor; fails_when=evidence of a running window is reported as free to move, or this window's own run is held back by its own descriptor; why_new=the removal did not look at other windows before; seam=none
test('evidence counts as in use elsewhere only while it exists and another instance’s connection descriptor is present', async (context) => {
  // Arrange: the run's evidence and its instance's descriptor both exist.
  const agentRoot = await agentStorage(context)
  const evidenceDirectory = join(agentRoot, INSTANCE_ID, RUN_ID),
    descriptor = join(agentRoot, `${INSTANCE_ID}.connection.json`)
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(descriptor, '{}')
  // Act
  const forAnotherWindow = await evidenceInUseElsewhere(
      evidenceDirectory,
      '33333333-3333-4333-8333-333333333333',
    ),
    withoutOwnInstance = await evidenceInUseElsewhere(
      evidenceDirectory,
      undefined,
    ),
    forOwnWindow = await evidenceInUseElsewhere(evidenceDirectory, INSTANCE_ID),
    forMissingEvidence = await evidenceInUseElsewhere(
      join(agentRoot, INSTANCE_ID, '44444444-4444-4444-8444-444444444444'),
      undefined,
    )
  await rm(descriptor)
  const afterThatWindowStopped = await evidenceInUseElsewhere(
    evidenceDirectory,
    undefined,
  )
  // Assert
  assert.equal(forAnotherWindow, true)
  assert.equal(withoutOwnInstance, true)
  assert.equal(forOwnWindow, false)
  assert.equal(forMissingEvidence, false)
  assert.equal(afterThatWindowStopped, false)
})
