import assert from 'node:assert/strict'
import { test } from 'node:test'

import { routeHandlerMethodsOf } from '../utils/routeHandlerMethodsOf'

// Value: protects=FX-G1 which methods a local function serves is read from the export forms; fails_when=an alias list, a plain export, a declaration export or a commented export is read wrongly; no_claim=re-exports from other files
test('local handler names map to the methods they are exported as', () => {
  // Arrange
  const source = [
    'async function handle() {}',
    'const readTodos = () => {}',
    '// export { ghost as DELETE }',
    'export { handle as POST, handle as PUT, readTodos as GET, other as helper }',
    'export async function PATCH() {}',
    'export { HEAD } from "./head"',
  ].join('\n')
  // Act
  const methods = routeHandlerMethodsOf(source)
  // Assert
  assert.deepEqual(
    [...methods],
    [
      ['PATCH', ['PATCH']],
      ['handle', ['POST', 'PUT']],
      ['readTodos', ['GET']],
    ],
  )
})
