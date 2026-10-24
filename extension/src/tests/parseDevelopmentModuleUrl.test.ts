import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseDevelopmentModuleUrl } from '../utils/parseDevelopmentModuleUrl'

// Value: protects=the one reading of a development module address (layer and path) that the page-stub check and the other-layer check share; fails_when=the layer, the "./" or a query is read differently by the two callers; why_new=F446 (WEBPACK_LAYER_URL repeated the parsing of isPageStubOfSource); seam=parseDevelopmentModuleUrl; no_claim=addresses of no development build beyond refusing them
test('reads the layer and the path of a development module address and nothing else', () => {
  // Arrange
  const urls = [
    'webpack-internal:///(middleware)/./auth.config.ts',
    'webpack-internal:///(app-pages-browser)/app/lib/actions.ts?1a2b',
    'webpack-internal:///./theme.tsx',
    'file:///app/auth.config.ts',
    undefined,
  ]
  // Act
  const parsed = urls.map((url) => parseDevelopmentModuleUrl(url))
  // Assert
  assert.deepEqual(parsed, [
    { layer: 'middleware', path: 'auth.config.ts' },
    { layer: 'app-pages-browser', path: 'app/lib/actions.ts' },
    { path: 'theme.tsx' },
    undefined,
    undefined,
  ])
})
