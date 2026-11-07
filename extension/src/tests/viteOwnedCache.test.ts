import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assessViteSettings, type ViteFacts } from '../utils/assessViteSettings'

const facts: ViteFacts = {
  viteVersion: '8.3.5',
  root: '/repo/app',
  base: '/',
  cacheDir: '/tmp/run/vite-cache',
  port: 3010,
  https: false,
  host: '127.0.0.1',
  hmrOwnListener: false,
  wsOwnListener: false,
  middlewareMode: false,
  appType: 'spa',
}

// protects=a library run's own private cache outside the package root passes the settings check; fails_when=every library run is refused as VITE_UNSUPPORTED for its cacheDir; no_claim=that the cache is really private (the run chooses its path)
test('accepts a cacheDir outside the package root when it is the run own cache', async () => {
  // Act
  const unsupported = await assessViteSettings(
    facts,
    '/repo/app',
    '/tmp/run/vite-cache',
  )
  // Assert
  assert.deepEqual(unsupported, [])
})

// protects=a project cacheDir outside the package root stays refused with an owned cache given (a different folder) and without one; fails_when=the owned-cache exception admits any outside folder; no_claim=symlink handling (the root and cache comparison use real paths as before)
test('still refuses a project cacheDir outside the package root with and without an owned cache', async () => {
  // Arrange
  const projectCache: ViteFacts = { ...facts, cacheDir: '/elsewhere/.vite' }
  // Act
  const withOwned = await assessViteSettings(
    projectCache,
    '/repo/app',
    '/tmp/run/vite-cache',
  )
  const withoutOwned = await assessViteSettings(projectCache, '/repo/app')
  // Assert
  assert.deepEqual(withOwned, ['cacheDir is outside the package root'])
  assert.deepEqual(withoutOwned, ['cacheDir is outside the package root'])
})
