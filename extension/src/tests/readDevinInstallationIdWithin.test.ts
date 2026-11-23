import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { DevinInstallationRead } from '../utils/readDevinInstallationId'
import { readDevinInstallationIdWithin } from '../utils/readDevinInstallationIdWithin'

import { within } from './utils/within'

// Value: protects=a setup whose first installation-id read never returns gets an answer at the bound, so it can refuse with the retry sentence and take back what it saved instead of holding the setup lock (Cycle 0146 task 1b); fails_when=the read has no deadline, so the setup never settles, or the timeout answers anything but no answer for the MCP receipt; no_claim=the setup's own refusal and take-back (the onboarding test covers them) and the length of the real bound
test('a first installation-id read that never returns answers no answer for the MCP receipt at the bound', async () => {
  // Arrange
  const neverAnswers = (): Promise<DevinInstallationRead> =>
    new Promise(() => undefined)
  // Act
  const answer = await within(
    readDevinInstallationIdWithin(neverAnswers, '/storage', 50),
    2_000,
  )
  // Assert
  assert.deepEqual(answer, {
    installationId: undefined,
    state: {
      state: 'no-answer',
      // Built as the helper builds it, so the path reads the same on Windows.
      receiptPath: join('/storage', 'devin-mcp', 'receipt.json'),
    },
  })
})

// Value: protects=a read that answers within the bound keeps its own answer, so a standing setup is still marked; fails_when=the bound replaces an answer that came in time; no_claim=a read that answers near the bound
test('a first installation-id read that answers within the bound keeps its installation id', async () => {
  // Arrange
  const answersInTime = async (): Promise<DevinInstallationRead> => ({
    installationId: 'installation-a',
    state: {
      state: 'installed',
      receipt: { installed: true, installationId: 'installation-a' },
    },
  })
  // Act
  const answer = await readDevinInstallationIdWithin(
    answersInTime,
    '/storage',
    2_000,
  )
  // Assert
  assert.deepEqual(answer, {
    installationId: 'installation-a',
    state: {
      state: 'installed',
      receipt: { installed: true, installationId: 'installation-a' },
    },
  })
})

// Value: protects=a read that fails within the bound still fails the setup with its own error, as before the bound; fails_when=the failure is turned into no answer and its reason is lost; no_claim=which errors a real read gives
test('a first installation-id read that fails within the bound rejects with its error', async () => {
  // Arrange
  const fails = (): Promise<DevinInstallationRead> =>
    Promise.reject(new Error('Injected receipt read failure'))
  // Act
  const failure = await readDevinInstallationIdWithin(
    fails,
    '/storage',
    2_000,
  ).then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : 'other'),
  )
  // Assert
  assert.equal(failure, 'Injected receipt read failure')
})
