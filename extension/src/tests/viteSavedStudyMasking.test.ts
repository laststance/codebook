import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REDACTED_MODULE_LABEL } from '../constants'
import { EvidenceIntegrityError } from '../errors'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureStudy } from '../utils/captureStudy'

import { pausedViteRun } from './utils/pausedViteRun'

const SECRET = 'plainsecret1'

// Value: protects=a VITE_ value from .env that the debugger captured as a variable or an inspected value never reaches the saved study JSON; fails_when=the run records captured strings without the env-file mask; why_new=captured values and debugger variables were redacted by name and shape only; seam=the controlled runtime reports the secret as the debugger value, as a paused `const apiKey = import.meta.env.VITE_API_KEY` does; no_claim=native debugger capture
test('a .env value the debugger captured at a Vite pause is masked in the saved study JSON', async (context) => {
  // Arrange
  const { service, record, library } = await pausedViteRun(context, SECRET)
  // Act
  const archive = await captureStudy(service, record, library.workspaceKey)
  // Assert
  assert.ok(archive)
  const savedStudyJson = JSON.stringify(archive)
  assert.equal(savedStudyJson.includes(SECRET), false)
  assert.equal(archive.observations[0]?.values['value:nextTheme'], '[masked]')
  assert.equal(
    archive.observations[0]?.debugger?.variables[0]?.value,
    '[masked]',
  )
})

// Value: protects=the served JavaScript resource of a redacted module shows the masked text with its label and does not fail the integrity check that the executed bytes' hash would fail; fails_when=the resource hashes the masked text against the seal or serves it without the label; why_new=Cycle 0064 task 18 keeps the seal hash of the executed bytes beside a masked copy; seam=none; no_claim=the map resource
test('the JavaScript source resource of a redacted Vite module is served masked with its label although its text no longer hashes to the seal', async (context) => {
  // Arrange
  const { service, record, harness } = await pausedViteRun(context, SECRET)
  const snapshotUri = service.state(record).observations[0]!.snapshotUri
  // Act
  const resource = await readResource(
    service,
    `${snapshotUri}/source/javascript`,
  )
  // Assert
  assert.ok('text' in resource)
  assert.equal(
    resource.text,
    `const nextTheme = "[masked]";\n${REDACTED_MODULE_LABEL}\n`,
  )
  // The seal identity is still the hash of the executed bytes.
  assert.equal(
    harness.run.view().snapshots[0]?.source.javascriptHash,
    sha256(`const nextTheme = "${SECRET}";`),
  )
})

// Value: protects=the TypeScript source resource of a redacted Vite module is still checked against its sealed hash, so changed bytes are refused; fails_when=a redacted module skips the hash check for all three source resources; why_new=Cycle 0064 round 1 B3; seam=the test edits the retained bundle's TypeScript text in memory, as corrupted retained bytes would; no_claim=the JavaScript and map resources
test('the TypeScript source resource of a redacted Vite module is refused when its text no longer matches the sealed hash', async (context) => {
  // Arrange
  const { service, record, harness } = await pausedViteRun(context, SECRET)
  const snapshot = service.state(record).observations[0]!
  const retained = harness.run as unknown as {
    snapshotBundles: Map<string, { source: string }>
  }
  const bundle = retained.snapshotBundles.get(
    harness.run.view().snapshots[0]!.id,
  )
  assert.ok(bundle)
  bundle.source += '\n// changed after sealing'
  // Act
  const reading = readResource(
    service,
    `${snapshot.snapshotUri}/source/typescript`,
  )
  // Assert
  await assert.rejects(reading, EvidenceIntegrityError)
})

// Value: protects=the JavaScript resource of a redacted Vite module is refused when the retained unmasked bytes changed after sealing, although the served text is masked; fails_when=a redacted module skips the sealed-hash check for its masked kinds; why_new=Cycle 0064 round 2 (CodeRabbit); seam=the test edits the retained bundle's javascript in memory, as corrupted retained bytes would; no_claim=the TypeScript resource
test('the JavaScript resource of a redacted Vite module is refused when the retained bytes changed after sealing', async (context) => {
  // Arrange
  const { service, record, harness } = await pausedViteRun(context, SECRET)
  const snapshot = service.state(record).observations[0]!
  const retained = harness.run as unknown as {
    snapshotBundles: Map<string, { javascript: string }>
  }
  const bundle = retained.snapshotBundles.get(
    harness.run.view().snapshots[0]!.id,
  )
  assert.ok(bundle)
  bundle.javascript += ' '
  // Act
  const reading = readResource(
    service,
    `${snapshot.snapshotUri}/source/javascript`,
  )
  // Assert
  await assert.rejects(reading, EvidenceIntegrityError)
})

// Value: protects=the source map resource of a redacted Vite module is refused when the retained unmasked bytes changed after sealing, although the served text is masked; fails_when=a redacted module skips the sealed-hash check for its masked kinds; why_new=Cycle 0064 round 2 (CodeRabbit); seam=the test edits the retained bundle's sourceMap in memory, as corrupted retained bytes would; no_claim=the TypeScript resource
test('the source map resource of a redacted Vite module is refused when the retained bytes changed after sealing', async (context) => {
  // Arrange
  const { service, record, harness } = await pausedViteRun(context, SECRET)
  const snapshot = service.state(record).observations[0]!
  const retained = harness.run as unknown as {
    snapshotBundles: Map<string, { sourceMap: string }>
  }
  const bundle = retained.snapshotBundles.get(
    harness.run.view().snapshots[0]!.id,
  )
  assert.ok(bundle)
  bundle.sourceMap += ' '
  // Act
  const reading = readResource(service, `${snapshot.snapshotUri}/source/map`)
  // Assert
  await assert.rejects(reading, EvidenceIntegrityError)
})
