import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { resolveDeepWikiDirectory } from '../utils/resolveDeepWikiDirectory'

test('relative Wiki output stays in the opened project', () => {
  // Arrange
  const projectRoot = '/workspace/target'
  // Act
  const output = resolveDeepWikiDirectory(projectRoot, '.codebook/wiki')
  // Assert
  assert.equal(output, '/workspace/target/.codebook/wiki')
})

test('relative Wiki output cannot escape to a different checkout', () => {
  // Arrange
  const projectRoot = '/workspace/target'
  // Act / Assert
  assert.throws(
    () => resolveDeepWikiDirectory(projectRoot, '../other/.codebook/wiki'),
    /inside the opened project/,
  )
  assert.throws(
    () => resolveDeepWikiDirectory(projectRoot, '.'),
    /inside the opened project/,
  )
})

test('an explicitly configured external Wiki output is resolved', () => {
  // Arrange
  const projectRoot = '/workspace/target'
  // Act
  const output = resolveDeepWikiDirectory(projectRoot, '/shared/wiki/target')
  // Assert
  assert.equal(output, '/shared/wiki/target')
})

// Value: protects=the learner who opens a cloned repository in an untrusted workspace, whose `.vscode/settings.json` can name any folder as the Wiki output; fails_when=the extension's manifest no longer lists the setting among the configurations an untrusted workspace may not set, so the reader and an update read and write the folder the repository names, outside the project, which the link guard accepts as the learner's choice; why_new=Cycle 0046 /ship repeat review SC5; seam=none (the editor applies the manifest; no harness of this repository models workspace trust)
test('an untrusted workspace cannot set the Wiki output folder: the manifest restricts codebook.wikiOutputDirectory there, so the workspace’s own value is not used and the learner’s user setting or the default applies', async () => {
  // Arrange
  const manifest: unknown = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )

  // Act
  const untrustedWorkspaces =
    typeof manifest === 'object' &&
    manifest !== null &&
    'capabilities' in manifest &&
    typeof manifest.capabilities === 'object' &&
    manifest.capabilities !== null &&
    'untrustedWorkspaces' in manifest.capabilities
      ? manifest.capabilities.untrustedWorkspaces
      : undefined

  // Assert
  assert.deepEqual(untrustedWorkspaces, {
    supported: 'limited',
    description: 'Agent execution requires a trusted local workspace.',
    restrictedConfigurations: ['codebook.wikiOutputDirectory'],
  })
})
