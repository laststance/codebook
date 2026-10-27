import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type * as ResolveExternalNodeExecutableModule from '../utils/resolveExternalNodeExecutable'

import { loadModule } from './utils/loadModule'

test('Cursor bridge accepts only an absolute external Node 24 executable', async () => {
  // Arrange
  const electronExecutable = '/Applications/Cursor.app/Contents/MacOS/Cursor'
  const responses = [
    { version: '24.21.0', executable: '/opt/homebrew/bin/node' },
    { version: '22.16.0', executable: '/opt/homebrew/bin/node' },
    { version: '24.21.0', executable: electronExecutable },
    { version: '24.21.0', executable: 'node' },
    { version: 'unknown', executable: '/opt/homebrew/bin/node' },
  ]
  const module = await loadModule<typeof ResolveExternalNodeExecutableModule>(
    resolve(__dirname, '../utils/resolveExternalNodeExecutable.js'),
    {
      'node:util': {
        promisify: () => async () => ({
          stdout: JSON.stringify(responses.shift()),
        }),
      },
    },
    { process: { execPath: electronExecutable } },
  )
  // Act / Assert
  assert.equal(
    await module.resolveExternalNodeExecutable('node'),
    '/opt/homebrew/bin/node',
  )
  await assert.rejects(
    module.resolveExternalNodeExecutable('node'),
    /external Node.js >=24/,
  )
  await assert.rejects(
    module.resolveExternalNodeExecutable('node'),
    /not Electron/,
  )
  await assert.rejects(module.resolveExternalNodeExecutable('node'), /absolute/)
  await assert.rejects(
    module.resolveExternalNodeExecutable('node'),
    /external Node.js >=24/,
  )
})

// protects=the node-server start journal names the Node that ran the server: the resolver returns the verified path with its version; fails_when=the version is dropped or a refused Node still resolves; no_claim=the launcher's journal
test('a node-server run resolves its external Node with the version it records, and refuses Node below 24', async () => {
  // Arrange
  const responses = [
    { version: '26.10.0', executable: '/opt/homebrew/bin/node' },
    { version: '22.16.0', executable: '/opt/homebrew/bin/node' },
  ]
  const module = await loadModule<typeof ResolveExternalNodeExecutableModule>(
    resolve(__dirname, '../utils/resolveExternalNodeExecutable.js'),
    {
      'node:util': {
        promisify: () => async () => ({
          stdout: JSON.stringify(responses.shift()),
        }),
      },
    },
    { process: { execPath: '/Applications/Code.app/Contents/MacOS/Electron' } },
  )
  // Act
  const resolved = await module.resolveExternalNode('node')
  const refused = module.resolveExternalNode('node')
  // Assert
  assert.deepEqual(resolved, {
    version: '26.10.0',
    executable: '/opt/homebrew/bin/node',
  })
  await assert.rejects(refused, /external Node.js >=24/)
})
