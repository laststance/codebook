import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { before, test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { runScriptHistory } from './utils/nodeScriptHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { openServerReplay, repositoryOf } from './utils/serverWorkspaceHarness'
import { lastView } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

const BROWSER_ONLY_V7_PATH = join(
  resolve(__dirname, '../../src/tests/fixtures'),
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

const FACTS: LibraryRunFacts = {
  package: '@acme/widgets',
  packageRoot: 'packages/widgets',
  prepared: true,
  version: '2.14.0',
  revision: '7114787aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 7000,
  packMs: 900,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '2.12.0',
  observation: 'complete',
  loaded: true,
  loadCount: 12,
  publishedCopyLoaded: false,
  cleanup: 'removed',
}

// protects=a Node (Script) replay opened after a saved Vite library study does not show that study's library line under its title; fails_when=the message of the Script replay still carries the saved study's libraryLine; no_claim=the webview paint
test('a Script replay opened after a saved Vite library study carries no library line', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const storage = await harness.reader.learningStorage()
    const saved: ConfiguredStudy = JSON.parse(
      await readFile(BROWSER_ONLY_V7_PATH, 'utf8'),
    )
    // Reseal the saved browser study as a format 16 Vite library study
    const configuration = {
      ...saved.configuration,
      adapter: 'vite-dev',
      packageRoot: 'examples/widgets-vite',
      library: { packageRoot: 'packages/widgets' },
    }
    const study = {
      ...saved,
      version: 16,
      configuration,
      configurationHash: sha256(JSON.stringify(configuration)),
      workspaceKey: storage.workspaceKey,
      library: FACTS,
    } as ConfiguredStudy
    await storage.saveStudy(study)
    await harness.reader.open()
    harness.receive({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: study.id,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view!.model.selection.studyId === study.id &&
        !harness.reader.inspect().view!.loading,
      'the saved library study is selected',
      1_000,
    )
    const libraryLineBefore = lastView(harness)?.study?.libraryLine
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 1,
        hits: [0],
        output: ['a\n'],
        end: {
          kind: 'exited',
          exitCode: 0,
          stopsReached: [0],
          stopsNeverReached: [],
        },
      },
      repositoryOf(harness),
    )

    // Act
    await openServerReplay(harness, studyId)
    const libraryLineAfter = lastView(harness)?.study?.libraryLine

    // Assert
    assert.equal(
      libraryLineBefore,
      'Ran on the checked-out @acme/widgets 2.14.0 built from 7114787 (packed by pnpm)',
    )
    assert.equal(libraryLineAfter, undefined)
  } finally {
    await harness.close()
  }
})
