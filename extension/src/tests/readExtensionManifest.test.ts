import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { readExtensionManifest } from '../utils/readExtensionManifest'

import {
  BASELINE_MANIFEST,
  createRepositoryFixture,
} from './utils/chromeExtensionFixture'

/** Reads the manifest of a fixture whose manifest.json holds the given text and returns the StudyError, failing when it is accepted. */
async function refusalOfManifest(
  context: TestContext,
  manifestText: string,
): Promise<StudyError> {
  const root = await createRepositoryFixture(context, {
    'manifest.json': manifestText,
  })
  try {
    await readExtensionManifest(root)
  } catch (error) {
    assert.ok(error instanceof StudyError)
    return error
  }
  throw new assert.AssertionError({ message: 'the manifest was accepted' })
}

test('the baseline manifest reads its name, permissions, host permissions, popup and classic worker', async (context) => {
  // protects=the fields the run needs; fails_when=a field is missed or misnamed; no_claim=the files exist
  // Arrange
  const root = await createRepositoryFixture(context, {
    'manifest.json': JSON.stringify(BASELINE_MANIFEST),
  })
  // Act
  const manifest = await readExtensionManifest(root)
  // Assert
  assert.equal(manifest.name, 'Fixture Extension')
  assert.deepEqual(manifest.permissions, ['storage'])
  assert.deepEqual(manifest.hostPermissions, ['https://example.com/*'])
  assert.equal(manifest.popupPath, 'popup/popup.html')
  assert.equal(manifest.workerPath, 'background/worker.js')
  assert.equal(manifest.workerType, 'classic')
  assert.equal(manifest.key, undefined)
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/)
})

test('a module worker is reported as module', async (context) => {
  // protects=ER3 module workers follow static imports; fails_when=type module is ignored; no_claim=the worker loads
  // Arrange
  const root = await createRepositoryFixture(context, {
    'manifest.json': JSON.stringify({
      ...BASELINE_MANIFEST,
      background: { service_worker: './worker.js', type: 'module' },
    }),
  })
  // Act
  const manifest = await readExtensionManifest(root)
  // Assert
  assert.equal(manifest.workerType, 'module')
  assert.equal(manifest.workerPath, 'worker.js')
})

test('a manifest with no action and no background reports neither surface', async (context) => {
  // protects=MANIFEST_SURFACE_MISSING input; fails_when=an absent popup is invented; no_claim=nothing
  // Arrange
  const root = await createRepositoryFixture(context, {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Bare',
      version: '1',
    }),
  })
  // Act
  const manifest = await readExtensionManifest(root)
  // Assert
  assert.equal(manifest.popupPath, undefined)
  assert.equal(manifest.workerPath, undefined)
  assert.deepEqual(manifest.permissions, [])
  assert.deepEqual(manifest.hostPermissions, [])
})

test('a malformed manifest is refused as MANIFEST_UNREADABLE', async (context) => {
  // protects=malformed JSON refusal; fails_when=the parse error escapes or is accepted; no_claim=the error position is shown
  // Arrange / Act
  const refusal = await refusalOfManifest(context, '{ "manifest_version": 3,')
  // Assert
  assert.equal(refusal.code, 'MANIFEST_UNREADABLE')
  assert.equal(refusal.message, 'The manifest.json could not be read.')
})

test('a missing manifest is refused as MANIFEST_UNREADABLE', async (context) => {
  // protects=missing file refusal; fails_when=ENOENT escapes; no_claim=nothing
  // Arrange
  const root = await createRepositoryFixture(context, { 'other.txt': 'x' })
  // Act
  const refusal = await readExtensionManifest(root).catch((error) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'MANIFEST_UNREADABLE')
  assert.equal(refusal.message, 'The manifest.json could not be read.')
})

test('a manifest whose root is not an object is refused as MANIFEST_UNREADABLE', async (context) => {
  // protects=shape check; fails_when=an array manifest is read; no_claim=nothing
  // Arrange / Act
  const refusal = await refusalOfManifest(context, '[]')
  // Assert
  assert.equal(refusal.code, 'MANIFEST_UNREADABLE')
})

test('a manifest of version 2 is refused as MANIFEST_NOT_V3', async (context) => {
  // protects=MV3 only; fails_when=a version 2 manifest is accepted; no_claim=a version 3 manifest is otherwise valid
  // Arrange / Act
  const refusal = await refusalOfManifest(
    context,
    JSON.stringify({ ...BASELINE_MANIFEST, manifest_version: 2 }),
  )
  // Assert
  assert.equal(refusal.code, 'MANIFEST_NOT_V3')
  assert.equal(
    refusal.message,
    'The extension root needs a Manifest V3 manifest.json.',
  )
})

test('a manifest key that is not a public key is refused as MANIFEST_UNREADABLE', async (context) => {
  // protects=malformed key refusal; fails_when=the id is computed from garbage; no_claim=the key is an RSA key
  // Arrange / Act
  const refusal = await refusalOfManifest(
    context,
    JSON.stringify({ ...BASELINE_MANIFEST, key: 'not a key' }),
  )
  // Assert
  assert.equal(refusal.code, 'MANIFEST_UNREADABLE')
  assert.equal(refusal.message, 'The manifest key is not a valid public key.')
})

test('a valid manifest key is passed through', async (context) => {
  // protects=key id rule input; fails_when=a valid key is refused or dropped; no_claim=Chrome accepts the key
  // Arrange
  const key =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEiKYWXViZDGo+fKfo+yjXGHIWEhElf9adfvj+Slcs3aEUECCbujVVGtNthnH7j41p5W774RZLk7EcWG/Zw+t0Gg=='
  const root = await createRepositoryFixture(context, {
    'manifest.json': JSON.stringify({ ...BASELINE_MANIFEST, key }),
  })
  // Act
  const manifest = await readExtensionManifest(root)
  // Assert
  assert.equal(manifest.key, key)
})

test('optional permissions and optional host permissions are read as lists', async (context) => {
  // protects=ER5 optional entries reach the acknowledgement check; fails_when=optional_permissions or optional_host_permissions are dropped; no_claim=acknowledgement
  // Arrange
  const root = await createRepositoryFixture(context, {
    'manifest.json': JSON.stringify({
      ...BASELINE_MANIFEST,
      optional_permissions: ['downloads', 7],
      optional_host_permissions: ['<all_urls>'],
    }),
  })
  // Act
  const manifest = await readExtensionManifest(root)
  // Assert
  assert.deepEqual(manifest.optionalPermissions, ['downloads'])
  assert.deepEqual(manifest.optionalHostPermissions, ['<all_urls>'])
})
