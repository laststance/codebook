import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { RepositorySelection } from '../learnerSchemas'
import { LearningLibrary } from '../learningLibrary'
import type * as RepositoryReaderModule from '../repositoryReader'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { loadModule } from './utils/loadModule'
import { repositoryHarness } from './utils/repositoryHarness'

/** Drives failed webview clicks through the real reader and ledger; notification tests replace only native editor effects. @example const harness = await feedbackHarness(context) */
async function feedbackHarness(context: TestContext) {
  const source = await repositoryHarness(context),
    root = await realpath(source.directory)
  await source.track('src/module.ts')
  const library = new LearningLibrary(join(root, '.learning'), sha256(root)),
    notifications: string[] = []
  const disposable = () => ({ dispose(): void {} })
  class Uri {
    readonly fragment = ''
    constructor(
      readonly scheme: string,
      readonly authority: string,
      readonly path: string,
      readonly query = '',
    ) {}
    static from(value: {
      scheme: string
      authority: string
      path: string
      query: string
    }) {
      return new Uri(value.scheme, value.authority, value.path, value.query)
    }
    toString() {
      return `${this.scheme}://${this.authority}${this.path}?${this.query}`
    }
  }
  let receive = (_value: unknown): void => {},
    enteredEvidence = 0
  let provider = async (_uri: Uri) => ''
  const boundary = await loadModule<typeof RepositoryReaderModule>(
    resolve(__dirname, '../repositoryReader.js'),
    {
      './environment': { requireWorkspace: () => source.directory },
      vscode: {
        Uri,
        ViewColumn: { One: 1, Two: 2 },
        Range: class {},
        RelativePattern: class {},
        EventEmitter: class {
          event = disposable
          fire(): void {}
          dispose(): void {}
        },
        workspace: {
          textDocuments: [],
          onDidChangeTextDocument: disposable,
          registerTextDocumentContentProvider: (
            _scheme: string,
            value: { provideTextDocumentContent(uri: Uri): Promise<string> },
          ) => {
            provider = value.provideTextDocumentContent
            return disposable()
          },
          createFileSystemWatcher: () => ({
            dispose(): void {},
            onDidChange: disposable,
            onDidCreate: disposable,
            onDidDelete: disposable,
          }),
          openTextDocument: async (uri: Uri) => {
            const text = await provider(uri)
            return {
              uri,
              getText: () => text,
              validateRange: (range: unknown) => range,
            }
          },
        },
        window: {
          tabGroups: {
            activeTabGroup: { viewColumn: 1 },
            onDidChangeTabs: disposable,
            onDidChangeTabGroups: disposable,
          },
          onDidChangeActiveTextEditor: disposable,
          onDidChangeTextEditorSelection: disposable,
          registerTreeDataProvider: disposable,
          showTextDocument: async () => {},
          showErrorMessage: async (message: string) => {
            notifications.push(message)
          },
          createWebviewPanel: () => {
            let disposed = (): void => {}
            return {
              reveal(): void {},
              onDidChangeViewState: disposable,
              dispose(): void {
                disposed()
              },
              onDidDispose(callback: () => void): void {
                disposed = callback
              },
              webview: {
                html: '',
                postMessage: async () => true,
                onDidReceiveMessage(callback: (value: unknown) => void) {
                  receive = callback
                  return disposable()
                },
              },
            }
          },
        },
      },
    },
  )
  const reader = new boundary.RepositoryReader({
    storage: async () => library,
    connect: async () => {},
    arrange: async () => {},
    evidence: async () => {
      enteredEvidence++
    },
  })
  context.after(() => reader.dispose())
  const store = await reader.storage(),
    citation = await source.sources.read('src/module.ts')
  await store.publish({
    bookId: 'architecture',
    key: 'first',
    expectedRevision: 0,
    document: {
      title: 'Architecture',
      summary: 'Retained evidence.',
      nodes: [
        {
          id: 'module',
          title: 'Module',
          sections: [{ title: 'Price', text: 'The captured price is 24.' }],
          anchors: [
            {
              path: citation.path,
              hash: citation.hash,
              startLine: 1,
              endLine: 2,
            },
          ],
          observations: [],
        },
      ],
      edges: [],
    },
  })
  const selection: RepositorySelection = {
    bookId: 'architecture',
    revision: 1,
    nodeId: 'module',
    anchorIndex: 0,
    location: {
      sectionIndex: 3,
      fraction: 0.65,
      focusId: 'evidence-0-recording',
    },
  }
  await reader.open(selection)
  await reader.understand(true)
  return {
    reader,
    store,
    library,
    selection,
    notifications,
    enteredEvidence: () => enteredEvidence,
    receive: (value: unknown): void => receive(value),
  }
}

for (const recording of [true, false]) {
  test(`failed ${recording ? 'recording' : 'observation'} clicks notify the learner without changing the reading origin or understanding`, async (context) => {
    // Arrange
    const harness = await feedbackHarness(context),
      progress = await harness.library.readProgress()
    harness.store.read = async () => {
      throw new Error(
        'Recording unavailable: invalid_union discriminator version /private/raw-diagnostic',
      )
    }
    // Act
    harness.receive({
      type: 'evidence',
      revision: harness.reader.inspect().view.revision,
      selection: harness.selection,
      linkIndex: 0,
      recording,
    })
    await waitUntil(
      () => Boolean(harness.reader.inspect().view.error),
      'evidence failure',
      1_000,
    )
    // Assert
    const expected = recording
      ? 'Recording could not be opened. Refresh the article or ask your agent for a new recording.'
      : 'Observation could not be opened. Refresh the article or ask your agent for a new study.'
    assert.deepEqual(harness.notifications, [expected])
    assert.equal(harness.reader.inspect().view.error, expected)
    assert.deepEqual(
      (await harness.library.readProgress()).repositorySelection,
      harness.selection,
    )
    assert.deepEqual(
      (await harness.library.readProgress()).decisions,
      progress.decisions,
    )
    assert.equal(harness.enteredEvidence(), 0)
  })
}

for (const navigation of ['close', 'reopen']) {
  test(`a delayed evidence failure after article ${navigation} cannot publish an obsolete notification`, async (context) => {
    // Arrange
    const harness = await feedbackHarness(context),
      read = harness.store.read.bind(harness.store)
    let entered = (): void => {},
      rejectRead = (_error: Error): void => {}
    const started = new Promise<void>((resolveEntered) => {
      entered = resolveEntered
    })
    const failed = new Promise<never>((_resolve, reject) => {
      rejectRead = reject
    })
    harness.store.read = async () => {
      entered()
      return failed
    }
    harness.receive({
      type: 'evidence',
      revision: harness.reader.inspect().view.revision,
      selection: harness.selection,
      linkIndex: 0,
      recording: true,
    })
    await started
    // Act
    harness.store.read = read
    if (navigation === 'close') harness.reader.close()
    else
      await harness.reader.open({
        ...harness.selection,
        location: { sectionIndex: 1, fraction: 0.2, focusId: 'section-0' },
      })
    rejectRead(new Error('Obsolete recording failure'))
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn))
    // Assert
    assert.deepEqual(harness.notifications, [])
    assert.equal(harness.reader.inspect().view.error, '')
    assert.equal(harness.enteredEvidence(), 0)
  })
}
