import assert from 'node:assert/strict'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { realRunInService } from './utils/realRunInService'

// protects=the cleanup of the saved-session confirmation tests that host a real run (OCR 51): the service shuts down and flushes its book store while the harness folder still exists; fails_when=the harness removes its folder (after hooks run in registration order) before service.shutdown runs, the ENOTEMPTY or missing-folder flake shape; no_claim=the run's behaviour, the service's shutdown itself
test('a real run hosted in the service shuts the service down before the harness removes the folder it writes to', async (context) => {
  // Arrange
  const learningFolderAtShutdown: boolean[] = []
  // Act
  await context.test('a hosted real run ends its test', async (inner) => {
    const { service, harness } = await realRunInService(inner)
    const shutdown = service.shutdown.bind(service)
    service.shutdown = async (): Promise<void> => {
      learningFolderAtShutdown.push(
        await lstat(join(harness.directory, '.learning')).then(
          () => true,
          () => false,
        ),
      )
      await shutdown()
    }
  })
  // Assert
  assert.deepEqual(learningFolderAtShutdown, [true])
})
