import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONFIGURED_PROFILE } from '../configuredProfile'

// Value: protects=an agent reading codebook_status learns from the public catalog that the repository-browser profile also runs a Vite app; fails_when=the catalog names only next-dev-webpack or a Next-only scope; why_new=no test read the catalog text; seam=none; no_claim=adapter readiness
test('the public repository-browser catalog names the vite-dev adapter and its scope', () => {
  // Arrange
  const expectedAdapters = ['next-dev-webpack', 'vite-dev']
  // Act
  const { adapters, scope } = CONFIGURED_PROFILE
  // Assert
  assert.deepEqual(adapters, expectedAdapters)
  assert.match(scope, /vite-dev \(Vite 8, since API 1\.11\)/)
  assert.match(scope, /no SSR, no server participant/)
  assert.match(scope, /up to eight ordered verified pauses/)
  assert.doesNotMatch(scope, /eight ordered verified browser pauses/)
  assert.match(
    scope,
    /version 2 takes browser stops and uses the owned Next worker for server-action stops/,
  )
})

// Value: protects=an agent reading codebook_status learns which Next routers next-dev-webpack serves, and re-reads the help when the marker differs from what it remembers; fails_when=the marker is absent or lists other routers, or the scope still reads App-only; why_new=Cycle 0065 capability marker for the Pages Router; seam=none; no_claim=the run's own route resolution
test('the public repository-browser catalog names the Next routers next-dev-webpack serves', () => {
  // Arrange
  const expectedRouters = ['app', 'pages']
  // Act
  const { nextRouters, scope } = CONFIGURED_PROFILE
  // Assert
  assert.deepEqual(nextRouters, expectedRouters)
  assert.match(
    scope,
    /next-dev-webpack: installed Next webpack development runtime, default \.next\/dev output, retained original source maps, serving App Router and Pages Router pages;/,
  )
  assert.match(scope, /a Pages Router page takes client stops only\./)
})
