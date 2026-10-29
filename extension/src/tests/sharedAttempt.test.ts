import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SharedAttempt } from '../utils/sharedAttempt'

// protects=two endings asking for one release at once share a single release; fails_when=the release runs twice and stops the sessions twice; no_claim=what the release removes
test('two callers at once share one attempt of the release', async () => {
  // Arrange
  let attempts = 0
  const release = new SharedAttempt(async () => {
    attempts += 1
  })

  // Act
  await Promise.all([release.run(), release.run()])
  await release.run()

  // Assert
  assert.equal(attempts, 1)
})

// protects=a release that failed can be asked for again and then runs anew; fails_when=a failed release is remembered and every later call repeats its error without retrying; no_claim=why the release failed
test('a failed release runs again on the next call', async () => {
  // Arrange
  let attempts = 0
  const release = new SharedAttempt(async () => {
    attempts += 1
    if (attempts === 1)
      throw new Error('the editor refused to stop the session')
  })

  // Act
  await assert.rejects(release.run(), {
    message: 'the editor refused to stop the session',
  })
  await release.run()

  // Assert
  assert.equal(attempts, 2)
})
