import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
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
  const module = await loadModule<
    typeof import('../utils/resolveExternalNodeExecutable')
  >(
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
