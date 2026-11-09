import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readSystemCertificates } from '../utils/readSystemCertificates'

import { removeTestFolder } from './utils/removeTestFolder'

/** Makes a fake Node executable (a shell script) and runs {@link readSystemCertificates} against it. */
async function readWithFakeNode(script: string, timeoutMs = 5_000) {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-fake-node-'))
  try {
    const executable = join(folder, 'node')
    await writeFile(executable, `#!/bin/sh\n${script}\n`)
    await chmod(executable, 0o755)
    return await readSystemCertificates(
      { nodeExecutable: executable, environment: process.env, timeoutMs },
      new AbortController().signal,
    )
  } finally {
    await removeTestFolder(folder)
  }
}

// Value: protects=the learner's Node output is parsed into the proof's trust anchors; fails_when=the JSON list is not returned as given; no_claim=the real operating system store
test("a JSON list printed by the learner's Node becomes the trust anchors", async () => {
  // Arrange
  const script = `printf '%s' '["-----BEGIN CERTIFICATE-----A","-----BEGIN CERTIFICATE-----B"]'`
  // Act
  const result = await readWithFakeNode(script)
  // Assert
  assert.deepEqual(result, {
    ok: true,
    certificates: [
      '-----BEGIN CERTIFICATE-----A',
      '-----BEGIN CERTIFICATE-----B',
    ],
  })
})

// Value: protects=an empty store never lets a proof run with no anchors; fails_when=[] is returned as ok; no_claim=why the store is empty
test('an empty certificate list is reported as an unreadable store', async () => {
  // Arrange
  const script = `printf '%s' '[]'`
  // Act
  const result = await readWithFakeNode(script)
  // Assert
  assert.deepEqual(result, { ok: false })
})

// Value: protects=garbage output ends in the unreadable-store outcome instead of a throw; fails_when=JSON.parse errors escape; no_claim=the content of the output
test("invalid JSON from the learner's Node is reported as an unreadable store", async () => {
  // Arrange
  const script = `printf '%s' 'not json'`
  // Act
  const result = await readWithFakeNode(script)
  // Assert
  assert.deepEqual(result, { ok: false })
})

// Value: protects=a failing child (old Node without the API) is an unreadable store; fails_when=a non-zero exit is read as success or throws; no_claim=which Node versions have getCACertificates
test("a non-zero exit of the learner's Node is reported as an unreadable store", async () => {
  // Arrange
  const script = `printf '%s' '["-----BEGIN CERTIFICATE-----A"]'\nexit 3`
  // Act
  const result = await readWithFakeNode(script)
  // Assert
  assert.deepEqual(result, { ok: false })
})

// Value: protects=a hung child is killed at the bound; fails_when=the timeout is not applied so the test hangs; no_claim=the 5 s production value
test("a learner's Node that never finishes is reported as an unreadable store at the bound", async () => {
  // Arrange
  const script = `exec sleep 30`
  // Act
  const result = await readWithFakeNode(script, 200)
  // Assert
  assert.deepEqual(result, { ok: false })
})

// Value: protects=a cancelled run is no store failure; fails_when=the abort is swallowed into {ok:false}; no_claim=that the child is gone (the kill is Node's)
test('a run cancelled while the child runs rejects with the signal reason', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-fake-node-'))
  const executable = join(folder, 'node')
  await writeFile(executable, '#!/bin/sh\nexec sleep 30\n')
  await chmod(executable, 0o755)
  const controller = new AbortController()
  try {
    // Act
    const pending = readSystemCertificates(
      {
        nodeExecutable: executable,
        environment: process.env,
        timeoutMs: 5_000,
      },
      controller.signal,
    )
    controller.abort(new Error('run cancelled'))
    // Assert
    await assert.rejects(pending, { message: 'run cancelled' })
  } finally {
    await removeTestFolder(folder)
  }
})
