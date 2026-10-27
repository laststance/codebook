import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createHarness } from './helpers'
import { createEnvironmentWith } from './utils/nodeServerEnvironment'
import { startFakeNodeServerRun } from './utils/startFakeNodeServerRun'

// protects=D8: codebook_status lists node-server beside the other two with its limits, one action and the loader note, and http-request among the capabilities; fails_when=the profile or the capability is missing, or the repository tsx is promised at status time; no_claim=the real machine (environment tests)
test('codebook_status lists the node-server profile with its action, limits and the http-request capability', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.environment.createNodeServerRun = async () => {
    throw new Error('not created by status')
  }
  // Act
  const status = await harness.service.status()
  // Assert
  assert.deepEqual(
    status.profiles.map((profile) => profile.id),
    ['repository-browser', 'node-test', 'node-server'],
  )
  const profile = status.profiles[2]!
  assert.equal(profile.helpUri, 'codebook://help/node-server')
  assert.equal(profile.adapter, 'node-server')
  assert.deepEqual(profile.actions, [
    { id: 'http-request', title: 'Send the declared request' },
  ])
  assert.equal(profile.limits.pauseHoldTimeoutMs, 300_000)
  assert.equal(profile.limits.runTimeoutMs, 600_000)
  assert.equal(profile.prerequisites.ready, true)
  assert.deepEqual(profile.prerequisites.missing, [])
  assert.match(
    'repositoryChecks' in profile.prerequisites
      ? profile.prerequisites.repositoryChecks
      : '',
    /^The repository's own tsx is checked at start, for a TypeScript entry only/,
  )
  assert.equal(profile.recording?.available, false)
  assert.ok(status.capabilities.includes('http-request'))
})

// protects=D8: a profile whose machine prerequisites are missing reads not ready with each item named, and one without the owned adapter says so; fails_when=a missing listener tool, ps or system is hidden, or the profile reads ready without its run factory; no_claim=who finds them
test('codebook_status reads node-server not ready with every missing item named', async (context) => {
  // Arrange
  const harness = await createHarness({
    prerequisites: async () => ({
      ready: true,
      missing: [],
      profiles: {
        'node-server': {
          ready: false,
          missing: ['node-server needs lsof or ss.', 'node-server needs ps.'],
        },
      },
    }),
  })
  context.after(() => harness.close())
  // Act
  const profile = (await harness.service.status()).profiles[2]!
  // Assert
  assert.equal(profile.prerequisites.ready, false)
  assert.deepEqual(profile.prerequisites.missing, [
    'node-server needs lsof or ss.',
    'node-server needs ps.',
    'The owned Node server adapter is unavailable.',
  ])
})

// protects=the live run appears in status with its node-server state word; fails_when=status reports a browser state for a server run; no_claim=none
test('codebook_status shows a node-server run with its state', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  // Act
  const status = await harness.service.status()
  // Assert
  assert.deepEqual(
    status.runs.map((entry) => [entry.runId, entry.state]),
    [[record.id, 'paused']],
  )
})

// protects=D8: the real environment reports node-server beside the others, from its Node and the machine's gaps, and exposes the confirmation hook and the run factory; fails_when=profiles['node-server'] is missing, a machine gap does not reach it, or the hook or the factory is absent; no_claim=the real lsof or ps
test('the environment reports node-server prerequisites from Node and the machine, and offers the confirmation hook and the run factory', async (context) => {
  // Arrange
  const ready = await createEnvironmentWith(context, { gaps: [] })
  const missing = await createEnvironmentWith(context, {
    gaps: ['node-server needs lsof or ss.'],
  })
  // Act
  const readyProfiles = (await ready.environment.prerequisites()).profiles
  const missingProfiles = (await missing.environment.prerequisites()).profiles
  // Assert
  assert.deepEqual(
    {
      ready: readyProfiles?.['node-server']?.ready,
      missing: [...(readyProfiles?.['node-server']?.missing ?? [])],
    },
    { ready: true, missing: [] },
  )
  assert.deepEqual(
    {
      ready: missingProfiles?.['node-server']?.ready,
      missing: [...(missingProfiles?.['node-server']?.missing ?? [])],
    },
    { ready: false, missing: ['node-server needs lsof or ss.'] },
  )
  assert.equal(typeof ready.environment.confirmStateChangingRequest, 'function')
  assert.equal(typeof ready.environment.createNodeServerRun, 'function')
  // the machine's gap belongs to node-server alone
  assert.equal(
    missingProfiles?.['repository-browser']?.missing.includes(
      'node-server needs lsof or ss.',
    ),
    false,
  )
})

// protects=TD-6 at the editor boundary: the environment's confirmation hook asks through the editor's modal warning and confirms only Send; fails_when=the hook answers true for Cancel or does not ask; no_claim=how the editor draws the modal
test('the environment confirmation hook asks through the editor modal and confirms only Send', async (context) => {
  // Arrange
  const sending = await createEnvironmentWith(context, {
    gaps: [],
    modalChoice: 'Send',
  })
  const cancelling = await createEnvironmentWith(context, {
    gaps: [],
    modalChoice: undefined,
  })
  const signal = new AbortController().signal
  // Act
  const sent = await sending.environment.confirmStateChangingRequest?.(
    { method: 'POST', path: '/api/items' },
    signal,
  )
  const cancelled = await cancelling.environment.confirmStateChangingRequest?.(
    { method: 'POST', path: '/api/items' },
    signal,
  )
  // Assert
  assert.equal(sent, true)
  assert.equal(cancelled, false)
  assert.equal(sending.questions.length, 1)
  assert.equal(
    sending.questions[0]?.[0],
    "Send POST /api/items to the repository's server?",
  )
  // The editor receives a modal question (the chat cannot answer it) with Send as its one item.
  assert.equal((sending.questions[0]?.[1] as { modal: boolean }).modal, true)
  assert.equal(sending.questions[0]?.[2], 'Send')
})
