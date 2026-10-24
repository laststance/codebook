import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDevelopmentServerEnvironment } from '../utils/developmentServerEnvironment'

// Value: protects=no host credential or unrelated variable reaching the owned next dev; fails_when=the host environment is copied whole; why_new=helper was inlined, never read; seam=none; no_claim=child behavior
test('keeps host credentials and unrelated variables out of the development server environment', () => {
  // Arrange
  const host = {
    PATH: '/usr/bin',
    HOME: '/home/learner',
    GITHUB_TOKEN: 'x',
    DATABASE_URL: 'postgres://db.example/app',
    NODE_OPTIONS: '--require ./preload.js',
  }

  // Act
  const environment = buildDevelopmentServerEnvironment(host)

  // Assert
  assert.deepEqual(
    Object.keys(environment).sort(),
    [
      'CI',
      'HOME',
      'HUSKY',
      'LANG',
      'LC_ALL',
      'LOGNAME',
      'NEXT_EXIT_TIMEOUT_MS',
      'NEXT_TELEMETRY_DISABLED',
      'PATH',
      'PNPM_HOME',
      'SHELL',
      'TMPDIR',
      'USER',
    ].sort(),
  )
  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.HOME, '/home/learner')
  assert.equal(environment.GITHUB_TOKEN, undefined)
  assert.equal(environment.DATABASE_URL, undefined)
  assert.equal(environment.NODE_OPTIONS, undefined)
})

// Value: protects=fixed dev-server settings: no telemetry or hooks, CI mode, 10 s exit; fails_when=a host value overrides one; why_new=values unpinned; seam=none; no_claim=Next honoring them
test('sets the fixed development server settings whatever the host holds', () => {
  // Arrange
  const host = { CI: 'false', HUSKY: '1', NEXT_EXIT_TIMEOUT_MS: '100' }

  // Act
  const environment = buildDevelopmentServerEnvironment(host)

  // Assert
  assert.equal(environment.CI, 'true')
  assert.equal(environment.HUSKY, '0')
  assert.equal(environment.NEXT_TELEMETRY_DISABLED, '1')
  assert.equal(environment.NEXT_EXIT_TIMEOUT_MS, '10000')
})
