import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  reactScriptsNodeModulesRefusal,
  reactScriptsSealedNodeModulesRefusal,
} from '../reactScriptsRefusals'
import { publishedStopFiles } from '../utils/publishedStopFiles'

/**
 * Maps a repository-relative path under `app/` to its app-relative form, as a resolved react-scripts package does; `undefined` outside it.
 * @param path - A repository-relative path.
 * @returns The app-relative path, or `undefined` outside `app/`.
 * @example insideApp('app/src/App.js') // => 'src/App.js'
 */
function insideApp(path: string): string | undefined {
  return path.startsWith('app/') ? path.slice('app/'.length) : undefined
}

// Value: protects=a react-scripts stop in the app's node_modules is found before the server starts, once per file and in declared order; fails_when=a node_modules stop is missed, repeated, or a file whose name merely contains node_modules is refused; no_claim=the run's own call (the helper is called with the run's resolved package mapper)
test('the stops a react-scripts run refuses before starting are exactly those in the app node_modules', () => {
  // Arrange
  const paths = [
    'app/src/App.js',
    'app/node_modules/@reduxjs/toolkit/src/index.ts',
    'app/src/node_modules_notes.js',
    'app/node_modules/@reduxjs/toolkit/src/index.ts',
    'lib/node_modules/x.js',
  ]
  // Act
  const published = publishedStopFiles(paths, insideApp)
  // Assert
  assert.deepEqual(published, [
    'app/node_modules/@reduxjs/toolkit/src/index.ts',
  ])
})

// Value: protects=the node-modules refusal says truthfully whether a server ran: none before the start, partial at the seal; fails_when=the seal-time refusal claims nothing started or the pre-start one claims a stopped server; no_claim=which path raised it in a live run
test('a node_modules stop refused before the start reports no side effects, and one found at the seal reports the stopped server', () => {
  // Arrange
  const files = ['app/node_modules/lib/index.js']
  // Act
  const beforeStart = reactScriptsNodeModulesRefusal(files)
  const atSeal = reactScriptsSealedNodeModulesRefusal(files)
  // Assert
  assert.equal(beforeStart.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.equal(beforeStart.details?.reason, 'node-modules')
  assert.equal(beforeStart.details?.sideEffects, 'none')
  assert.equal(atSeal.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.equal(atSeal.details?.reason, 'node-modules')
  assert.equal(atSeal.details?.sideEffects, 'partial')
  assert.match(
    atSeal.message,
    /the owned server was stopped and no click was sent/,
  )
})
