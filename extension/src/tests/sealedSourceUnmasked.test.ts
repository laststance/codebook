import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE } from '../constants'
import { readResource } from '../resources'

import { createHarness } from './helpers'

// protects=a sealed source resource is returned as its exact bytes even when a learner secret equals a word of the code; fails_when=masking rewrites the source so it no longer matches its seal hash; no_claim=a real typed secret (the runtime stand-in lists the word as a secret)
test('a sealed source resource keeps its exact bytes when a learner secret equals a word of the code', async () => {
  // Arrange
  const harness = await createHarness()
  const service = harness.service
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: REPOSITORY_BROWSER_PROFILE,
      configuration: harness.configuration,
      key: 'sealed',
    })
    await service.record(receipt).preparation
    service.action({ ...receipt, key: 'click', action: 'repository-click' })
    const snapshotUri = service.state(service.record(receipt)).participants
      .browser.snapshotUri!
    Object.assign(harness.runtimes[0]!, {
      learnerSecrets: new Set(['nextTheme']),
    })
    // Act
    const source = await readResource(
      service,
      `${snapshotUri}/source/typescript`,
    )
    // Assert
    assert.ok('text' in source)
    assert.equal(source.text, 'const nextTheme = "dark";\n')
    assert.equal(source.masked, true)
    assert.equal(
      service.maskLearnerSecretsInText('word nextTheme'),
      'word [masked]',
    )
  } finally {
    await harness.close()
  }
})
