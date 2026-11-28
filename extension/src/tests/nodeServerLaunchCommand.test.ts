import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  journaledLaunchOf,
  launchCommandOf,
} from '../utils/nodeServerLaunchCommand'

/** The fields every launch below shares: the repository, its package folder, the entry and the external Node. */
const SHARED = {
  workspace: '/repo',
  packageRoot: '/repo/apps/api',
  entry: '/repo/apps/api/src/index.ts',
  node: { executable: '/usr/local/bin/node', version: '24.22.1' },
}

// Value: protects=a Bun launch runs the learner's Bun with Codebook's inspector bootstrap preloaded and no Node inspector flag; fails_when=the launch runs node, passes --inspect-brk to Bun (Bun's flag speaks the WebKit protocol the debugger cannot use), or drops the bootstrap; seam=the pure command builder; no_claim=that Bun accepts the command (the real-Bun launch test runs it)
test('a Bun launch runs the learner Bun with the inspector bootstrap preloaded before the entry', () => {
  // Arrange
  const launch = {
    ...SHARED,
    loader: {
      kind: 'bun',
      executable: '/Users/learner/.bun/bin/bun',
      version: '1.4.5',
      bootstrap: '/extension/dist/bunInspectorBootstrap.js',
    },
  } as const
  // Act
  const command = launchCommandOf(launch)
  // Assert
  assert.deepEqual(command, {
    program: '/Users/learner/.bun/bin/bun',
    args: [
      '--no-install',
      '--preload',
      '/extension/dist/bunInspectorBootstrap.js',
      '/repo/apps/api/src/index.ts',
    ],
  })
})

// Value: protects=node and tsx launches keep their exact command when Bun support is added; fails_when=the tsx loader or the inspector flag moves or disappears; seam=the pure command builder; no_claim=node's own flag handling
test('node and tsx launches keep node --inspect-brk with the tsx loader first', () => {
  // Arrange
  const tsxLaunch = {
    ...SHARED,
    loader: {
      kind: 'tsx',
      path: '/repo/node_modules/tsx/dist/loader.mjs',
      url: 'file:///repo/node_modules/tsx/dist/loader.mjs',
    },
  } as const
  // Act
  const command = launchCommandOf(tsxLaunch)
  // Assert
  assert.deepEqual(command, {
    program: '/usr/local/bin/node',
    args: [
      '--inspect-brk=127.0.0.1:0',
      '--import',
      'file:///repo/node_modules/tsx/dist/loader.mjs',
      '/repo/apps/api/src/index.ts',
    ],
  })
})

// Value: protects=the start journal of a Bun launch names the loader and Bun's release and keeps every path private (workspace placeholder, the bootstrap by role); fails_when=an absolute home or extension path reaches the journal, or the Bun release is missing; seam=the pure journal builder; no_claim=the journal writer
test('the start journal of a Bun launch names bun, its release and only workspace-relative paths', () => {
  // Arrange
  const launch = {
    ...SHARED,
    loader: {
      kind: 'bun',
      executable: '/Users/learner/.bun/bin/bun',
      version: '1.4.5',
      bootstrap:
        '/Users/learner/.vscode/extensions/laststance.codebook/dist/bunInspectorBootstrap.js',
    },
  } as const
  // Act
  const journaled = journaledLaunchOf(launch)
  // Assert
  assert.deepEqual(journaled, {
    args: [
      '--no-install',
      '--preload',
      '<inspector-bootstrap>',
      '<workspace>/apps/api/src/index.ts',
    ],
    cwd: '<workspace>/apps/api',
    loader: 'bun',
    bunVersion: '1.4.5',
  })
})
