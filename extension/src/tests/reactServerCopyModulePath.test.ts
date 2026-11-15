import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reactServerCopyModulePath } from '../utils/reactServerCopyModulePath'

// protects=F2 (Cycle 0136): a page pause in React's copy of a declared server stop's module is known by the module path inside the copy's address, so it gets the bound of a pause the run resumes itself; fails_when=the copy's path keeps its "./" or query, a module's own address or a copy of no development module is read as a copy, and the pause falls back to the 250 ms bound of a pause nobody owns; no_claim=addresses React may write in a later version
test('reads the module path inside React’s server copy address and nothing from other addresses', () => {
  // Arrange
  const urls = [
    'about://React/Server/webpack-internal:///(rsc)/./app/ui/invoices/table.tsx?107',
    'about://React/Server/webpack-internal:///(rsc)/app/lib/data.ts?3',
    'webpack-internal:///(rsc)/./app/ui/invoices/table.tsx',
    'about://React/Server/file:///app/ui/invoices/table.tsx?3',
    undefined,
  ]
  // Act
  const paths = urls.map((url) => reactServerCopyModulePath(url))
  // Assert
  assert.deepEqual(paths, [
    'app/ui/invoices/table.tsx',
    'app/lib/data.ts',
    undefined,
    undefined,
    undefined,
  ])
})
