import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createHarness } from './helpers'

// Value: protects=DX-6 and DX-12 (the chat reads codebook_status.savedSession); fails_when=the field is absent while a store is set, or carries more than available, state and setupAt; no_claim=the store's own reading (signInProfile tests)
test('codebook_status reports savedSession with available, state and setupAt only', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.savedSessions = {
    describe: async () => ({
      available: true,
      state: 'saved',
      setupAt: '2026-11-02T12:10:00.000Z',
    }),
  }

  // Act
  const status = await harness.service.status()

  // Assert
  assert.deepEqual(status.savedSession, {
    available: true,
    state: 'saved',
    setupAt: '2026-11-02T12:10:00.000Z',
  })
})

// Value: protects=DX-6; fails_when=a store that throws makes codebook_status fail, or its failure reads as available; no_claim=which error the store threw
test('codebook_status reports savedSession as unusable when the store cannot answer', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.savedSessions = {
    describe: async () => {
      throw new Error('storage unreadable')
    },
  }

  // Act
  const status = await harness.service.status()

  // Assert
  assert.deepEqual(status.savedSession, { available: false, state: 'unusable' })
})
