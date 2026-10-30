import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REDACTED_MODULE_LABEL } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { captureStudy } from '../utils/captureStudy'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const SECRET = 'plainsecret1'

/**
 * Runs a Vite stop on the controlled runtime until its first pause is committed, with an env-file value as the debugger's captured value and as the inlined text of the executed module.
 * @param context - The test context, which shuts the service down when the test ends.
 * @returns The service, the run's record and receipt, the library and the controlled run.
 * @example
 * const { service, record, library } = await pausedViteRun(context)
 */
async function pausedViteRun(context: TestContext) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    capturedValue: SECRET,
    moduleJavascript: `const nextTheme = "${SECRET}";`,
    maskedValues: [SECRET],
  })
  const directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64))
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'vite-secret-study',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'one', action: 'repository-click' })
  await waitUntil(
    () => harness.run.view().snapshots.length === 1,
    'committed Vite pause',
  )
  return { service, record, receipt, library, harness }
}

// Value: protects=a VITE_ value from .env that the debugger captured as a variable or an inspected value never reaches the saved study JSON; fails_when=the run records captured strings without the env-file mask; why_new=captured values and debugger variables were redacted by name and shape only; seam=the controlled runtime reports the secret as the debugger value, as a paused `const apiKey = import.meta.env.VITE_API_KEY` does; no_claim=native debugger capture
test('a .env value the debugger captured at a Vite pause is masked in the saved study JSON', async (context) => {
  // Arrange
  const { service, record, library } = await pausedViteRun(context)
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
  const { service, record, harness } = await pausedViteRun(context)
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
