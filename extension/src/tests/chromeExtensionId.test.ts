import assert from 'node:assert/strict'
import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  chromeExtensionIdFromKey,
  chromeExtensionIdFromPath,
} from '../utils/chromeExtensionId'

import { createRepositoryFixture } from './utils/chromeExtensionFixture'

test('the id of the task 0 path equals the id Chrome returned for it', () => {
  // protects=SR28 path rule against the measured Chrome id; fails_when=the hash, the 32-digit cut or the 0-f to a-p mapping changes; no_claim=other platforms or Windows paths
  // Arrange
  const canonicalPath = '/Users/lume/qa/c61/bookmark-xp-explorer'
  // Act
  const extensionId = chromeExtensionIdFromPath(canonicalPath)
  // Assert
  assert.equal(extensionId, 'kgdakicbeoenmomkdpkiobphgcknpomd')
})

test('an id is 32 letters from a to p', () => {
  // protects=the id alphabet; fails_when=a digit or a letter beyond p leaks through; no_claim=that Chrome accepts the id
  // Arrange
  const canonicalPath = '/tmp/some folder/extension'
  // Act
  const extensionId = chromeExtensionIdFromPath(canonicalPath)
  // Assert
  assert.match(extensionId, /^[a-p]{32}$/)
})

test('a path with spaces gets an id different from the path without them', () => {
  // protects=spaces stay part of the hashed bytes; fails_when=spaces are trimmed or encoded before hashing; no_claim=Chrome's own id for this path
  // Arrange
  const spaced = '/Users/lume/my extension'
  const joined = '/Users/lume/myextension'
  // Act
  const spacedId = chromeExtensionIdFromPath(spaced)
  const joinedId = chromeExtensionIdFromPath(joined)
  // Assert
  assert.notEqual(spacedId, joinedId)
  assert.match(spacedId, /^[a-p]{32}$/)
})

test('NFC and NFD spellings of a non-ASCII path are hashed as given, with no normalization', () => {
  // protects=the id follows the exact bytes of the realpath that is also passed to loadUnpacked; fails_when=the function normalizes and the passed path differs from the hashed one; no_claim=how Chrome normalizes a path on a filesystem that rewrites names
  // Arrange
  const composed = '/Users/lume/café'
  const decomposed = '/Users/lume/café'
  // Act
  const composedId = chromeExtensionIdFromPath(composed)
  const decomposedId = chromeExtensionIdFromPath(decomposed)
  // Assert
  assert.notEqual(composedId, decomposedId)
})

test('a symlinked root gets the id of its real path, not of the link', async (context) => {
  // protects=SR28 canonical root; fails_when=the id is derived from the link path; no_claim=Chrome resolves links itself
  // Arrange
  const repositoryRoot = await createRepositoryFixture(context, {
    'real/manifest.json': '{}',
  })
  await mkdir(join(repositoryRoot, 'links'))
  await symlink(join(repositoryRoot, 'real'), join(repositoryRoot, 'links/ext'))
  // Act
  const resolved = await realpath(join(repositoryRoot, 'links/ext'))
  // Assert
  assert.equal(resolved, join(repositoryRoot, 'real'))
  assert.equal(
    chromeExtensionIdFromPath(resolved),
    chromeExtensionIdFromPath(join(repositoryRoot, 'real')),
  )
  assert.notEqual(
    chromeExtensionIdFromPath(resolved),
    chromeExtensionIdFromPath(join(repositoryRoot, 'links/ext')),
  )
})

test('a manifest key yields the id of the SHA-256 of its DER bytes', () => {
  // protects=the key rule; fails_when=the key is hashed as base64 text or the digest is cut wrongly; no_claim=that the key is an RSA key Chrome accepts
  // Arrange
  const base64Key =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEiKYWXViZDGo+fKfo+yjXGHIWEhElf9adfvj+Slcs3aEUECCbujVVGtNthnH7j41p5W774RZLk7EcWG/Zw+t0Gg=='
  // Act
  const extensionId = chromeExtensionIdFromKey(base64Key)
  // Assert
  assert.equal(extensionId, 'lkbpbcmlmcgphmfmhjejoinopdjlmpac')
})
