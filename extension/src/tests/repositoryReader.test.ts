import assert from 'node:assert/strict'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, matchesGlob, relative, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { RepositorySelection } from '../learnerSchemas'
import { LearningLibrary } from '../learningLibrary'
import type * as RepositoryReaderModule from '../repositoryReader'
import type { BookDocument, BookObservationBinding } from '../repositorySchemas'
import type { RepositoryViewMessage } from '../repositoryView'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'
import { repositoryHarness } from './utils/repositoryHarness'

/** Exercises the real reader/storage while mocking only editor effects, retaining explicit source/render receipts. @example const harness = await readerHarness(context) */
async function readerHarness(context: TestContext) {
  const source = await repositoryHarness(context),
    root = await realpath(source.directory)
  await source.track('src/module.ts', 'export const price = 24;\n')
  await source.track('src/order.ts', 'export const total = 48;\n')
  const library = new LearningLibrary(join(root, '.learning'), sha256(root))
  const disposable = () => ({ dispose(): void {} })
  /** How many Repository Wiki views are registered with the fake editor: one a reader, until that reader's dispose releases it. */
  let wikiViewsRegistered = 0
  class EventEmitter {
    event = () => disposable()
    fire(): void {}
    dispose(): void {}
  }
  class RelativePattern {
    constructor(
      readonly base: string,
      readonly pattern: string,
    ) {}
  }
  class Uri {
    readonly fsPath: string
    constructor(
      readonly scheme: string,
      readonly authority: string,
      readonly path: string,
      readonly query = '',
      readonly fragment = '',
    ) {
      this.fsPath = path
    }
    static from(value: {
      scheme: string
      authority?: string
      path?: string
      query?: string
    }) {
      return new Uri(
        value.scheme,
        value.authority ?? '',
        value.path ?? '',
        value.query,
      )
    }
    static file(path: string) {
      return new Uri('file', '', path)
    }
    toString() {
      return `${this.scheme}://${this.authority}${this.path}?${this.query}`
    }
  }
  class TabInputText {
    constructor(readonly uri: Uri) {}
  }
  // Native Wiki activation is a webview tab, independently of the last text-editor pointer.
  class TabInputWebview {
    constructor(readonly viewType: string) {}
  }
  class Position {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
    isEqual(other: Position) {
      return this.line === other.line && this.character === other.character
    }
  }
  class Range {
    readonly start: Position
    readonly end: Position
    constructor(
      startLine: number,
      startCharacter: number,
      endLine: number,
      endCharacter: number,
    ) {
      this.start = new Position(startLine, startCharacter)
      this.end = new Position(endLine, endCharacter)
    }
  }
  type NativeDocument = { uri: Uri; version: number; getText(): string }
  type NativeEditor = {
    document: NativeDocument
    viewColumn: number
    selections: { anchor: Position; active: Position }[]
  }
  type NativeSelectionEvent = { kind: number; textEditor: NativeEditor }
  let activeEditor: NativeEditor | undefined
  const focusListeners = new Set<() => void>(),
    windowFocusListeners = new Set<(state: { focused: boolean }) => void>(),
    selectionListeners = new Set<(event?: NativeSelectionEvent) => void>(),
    tabListeners = new Set<() => void>(),
    groupListeners = new Set<() => void>()
  const sourceGroup: {
    viewColumn: number
    tabs: { input: TabInputText | TabInputWebview }[]
    activeTab?: { input: TabInputText | TabInputWebview }
  } = { viewColumn: 1, tabs: [] }
  const otherGroup: typeof sourceGroup = { viewColumn: 2, tabs: [] }
  let activeGroup = sourceGroup
  let windowFocused = true
  let activateWikiPanel = (): void => {}
  let focusStudyPanel = (): void => {}
  let hideWikiPanel = (): void => {}
  let nativeWikiSelection = false
  let requiresSourceFocus = false,
    coldLayout = false,
    arrangements = 0
  let sourceDocumentGate: { entered(): void; wait: Promise<void> } | undefined
  let sourceDisplayGate: { entered(): void; wait: Promise<void> } | undefined
  let arrangementGate: { entered(): void; wait: Promise<void> } | undefined
  let layoutResponseGate: { entered(): void; wait: Promise<void> } | undefined
  let nativeCitationActivation = false
  let rendererGate:
    { entered(): void; wait: Promise<void>; loadedOnly: boolean } | undefined
  let citationActivationGate:
    | {
        stage: 'target tab' | 'text gap' | 'initial caret'
        entered(): void
        wait: Promise<void>
      }
    | undefined
  const panelColumns: number[] = [],
    reveals: number[] = [],
    revealFocus: boolean[] = []
  let provider = async (_uri: Uri) => '',
    workspace = source.directory,
    connections = 0
  let receive = (_message: unknown): void => {}
  const shown: { uri: Uri; text: string }[] = [],
    openedSources: { uri: Uri; text: string }[] = [],
    panels = new Set<object>(),
    linked: { binding: BookObservationBinding; recording: boolean }[] = []
  const textDocuments: { isDirty: boolean; uri: Uri; getText(): string }[] = []
  const watchers: {
    pattern: RelativePattern
    listeners: ((uri: Uri) => void)[]
  }[] = []
  const boundary = await loadModule<typeof RepositoryReaderModule>(
    resolve(__dirname, '../repositoryReader.js'),
    {
      './environment': { requireWorkspace: () => workspace },
      vscode: {
        EventEmitter,
        Uri,
        TabInputText,
        TabInputWebview,
        ViewColumn: { One: 1, Two: 2 },
        RelativePattern,
        Range,
        TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
        workspace: {
          textDocuments,
          registerTextDocumentContentProvider: (
            _scheme: string,
            value: { provideTextDocumentContent(uri: Uri): Promise<string> },
          ) => {
            provider = value.provideTextDocumentContent
            return disposable()
          },
          onDidChangeTextDocument: disposable,
          createFileSystemWatcher: (pattern: RelativePattern) => {
            const watcher = { pattern, listeners: Array<(uri: Uri) => void>() }
            watchers.push(watcher)
            const listen = (callback: (uri: Uri) => void) => {
              watcher.listeners.push(callback)
              return disposable()
            }
            return {
              dispose(): void {
                watcher.listeners = []
              },
              onDidChange: listen,
              onDidCreate: listen,
              onDidDelete: listen,
            }
          },
          openTextDocument: async (uri: Uri) => {
            const text =
              uri.scheme === 'file'
                ? await readFile(uri.fsPath, 'utf8')
                : await provider(uri)
            const held = sourceDocumentGate
            sourceDocumentGate = undefined
            if (held) {
              held.entered()
              await held.wait
            }
            const normalized = text
                .replace(/^\uFEFF/, '')
                .replace(/\r\n?/g, '\n'),
              lines = normalized.split('\n')
            openedSources.push({ uri, text: normalized })
            return {
              uri,
              version: 1,
              getText: () => normalized,
              validateRange: (range: Range) => {
                const startLine = Math.min(range.start.line, lines.length - 1),
                  endLine = Math.min(range.end.line, lines.length - 1)
                return new Range(
                  startLine,
                  Math.min(range.start.character, lines[startLine]!.length),
                  endLine,
                  Math.min(range.end.character, lines[endLine]!.length),
                )
              },
            }
          },
        },
        window: {
          get state() {
            return { focused: windowFocused }
          },
          onDidChangeWindowState(
            callback: (state: { focused: boolean }) => void,
          ) {
            windowFocusListeners.add(callback)
            return {
              dispose(): void {
                windowFocusListeners.delete(callback)
              },
            }
          },
          registerTreeDataProvider: () => {
            wikiViewsRegistered += 1
            return {
              dispose(): void {
                wikiViewsRegistered -= 1
              },
            }
          },
          get activeTextEditor() {
            return activeEditor
          },
          tabGroups: {
            all: [sourceGroup, otherGroup],
            get activeTabGroup() {
              return activeGroup
            },
            onDidChangeTabs(callback: () => void) {
              tabListeners.add(callback)
              return {
                dispose(): void {
                  tabListeners.delete(callback)
                },
              }
            },
            onDidChangeTabGroups(callback: () => void) {
              groupListeners.add(callback)
              return {
                dispose(): void {
                  groupListeners.delete(callback)
                },
              }
            },
          },
          onDidChangeActiveTextEditor(callback: () => void) {
            focusListeners.add(callback)
            return {
              dispose(): void {
                focusListeners.delete(callback)
              },
            }
          },
          onDidChangeTextEditorSelection(
            callback: (event?: NativeSelectionEvent) => void,
          ) {
            selectionListeners.add(callback)
            return {
              dispose(): void {
                selectionListeners.delete(callback)
              },
            }
          },
          showTextDocument: async (
            document: NativeDocument,
            options?: {
              viewColumn?: number
              preserveFocus?: boolean
              selection?: Range
            },
          ) => {
            shown.push({ uri: document.uri, text: document.getText() })
            const editor = {
                document,
                viewColumn: options?.viewColumn ?? 1,
                selections: [
                  {
                    anchor: options?.selection?.start ?? new Position(0, 0),
                    active: options?.selection?.end ?? new Position(0, 0),
                  },
                ],
              },
              tab = { input: new TabInputText(document.uri) }
            sourceGroup.tabs.push(tab)
            sourceGroup.activeTab = tab
            // A foreground native source display activates its main group before its text-editor receipt.
            if (!options?.preserveFocus) activeGroup = sourceGroup
            if (!options?.preserveFocus && nativeCitationActivation) {
              const pauseAt = async (
                stage: NonNullable<typeof citationActivationGate>['stage'],
              ): Promise<void> => {
                const held = citationActivationGate
                if (held?.stage === stage) {
                  citationActivationGate = undefined
                  held.entered()
                  await held.wait
                }
              }
              // Replay the ordinary Cursor trace: target tab, missing text editor, initial caret, requested command selection.
              for (const listener of tabListeners) listener()
              await pauseAt('target tab')
              activeEditor = undefined
              for (const listener of focusListeners) listener()
              await pauseAt('text gap')
              activeEditor = {
                ...editor,
                selections: [
                  { anchor: new Position(0, 0), active: new Position(0, 0) },
                ],
              }
              for (const listener of focusListeners) listener()
              await pauseAt('initial caret')
              activeEditor = editor
              for (const listener of selectionListeners)
                listener({ kind: 3, textEditor: editor })
            } else if (!options?.preserveFocus) {
              activeEditor = editor
              for (const listener of focusListeners) listener()
            }
            const held = sourceDisplayGate
            sourceDisplayGate = undefined
            if (held) {
              held.entered()
              await held.wait
            }
            return editor
          },
          createWebviewPanel: (
            _kind: string,
            _title: string,
            options: number | { viewColumn: number; preserveFocus?: boolean },
          ) => {
            const column =
              typeof options === 'number' ? options : options.viewColumn
            panelColumns.push(column)
            if (typeof options === 'number' || !options.preserveFocus) {
              activeEditor = undefined
              for (const listener of focusListeners) listener()
            }
            let disposed = (): void => {}
            const viewStateListeners = new Set<() => void>()
            const viewStateChanged = (): void => {
              for (const listener of viewStateListeners) listener()
            }
            let receivePanelMessage = (_message: unknown): void => {}
            let documentReady = false
            // Native webview content is recreated after hiding; readiness precedes its first model receipt.
            const beginDocument = async (): Promise<void> => {
              const held = rendererGate
              if (held && !held.loadedOnly) {
                held.entered()
                await held.wait
              }
              if (!panel.visible || documentReady || !panels.has(panel)) return
              documentReady = true
              receivePanelMessage({ type: 'ready' })
            }
            const panel = {
              title: '',
              viewColumn: column,
              active: false,
              visible: true,
              onDidChangeViewState(callback: () => void) {
                viewStateListeners.add(callback)
                return {
                  dispose(): void {
                    viewStateListeners.delete(callback)
                  },
                }
              },
              reveal(column: number, preserveFocus = false): void {
                reveals.push(column)
                revealFocus.push(preserveFocus)
                panel.visible = true
                // Cursor selects the revealed native tab even when its old document keeps keyboard focus.
                if (nativeWikiSelection) {
                  activeGroup = otherGroup
                  otherGroup.activeTab = wikiTab
                  for (const listener of tabListeners) listener()
                  for (const listener of groupListeners) listener()
                  // Native tab/group callbacks can precede the pane's own view-state callback.
                  queueMicrotask(() => {
                    panel.active = !preserveFocus
                    viewStateChanged()
                  })
                }
                void beginDocument()
              },
              dispose(): void {
                panels.delete(panel)
                disposed()
              },
              onDidDispose(callback: () => void): void {
                disposed = callback
              },
              webview: {
                html: '',
                postMessage: async (message: RepositoryViewMessage) => {
                  // Default editor-effect fixtures acknowledge actual published models; a held renderer cannot certify a new document.
                  const held = rendererGate
                  if (held && (!held.loadedOnly || !message.loading)) {
                    held.entered()
                    await held.wait
                  }
                  if (!panel.visible || !documentReady) return false
                  receivePanelMessage({
                    type: 'rendered',
                    revision: message.revision,
                    selection: message.selection,
                    width: 1024,
                  })
                  return true
                },
                onDidReceiveMessage: (callback: (value: unknown) => void) => {
                  receive = callback
                  receivePanelMessage = callback
                  return disposable()
                },
              },
            }
            Object.defineProperty(panel.webview, 'html', {
              get: () => '',
              set: () => {
                void beginDocument()
              },
            })
            const wikiTab = {
              input: new TabInputWebview(
                'mainThreadWebview-codebook.repositoryWiki',
              ),
            }
            otherGroup.tabs.push(wikiTab)
            otherGroup.activeTab = wikiTab
            focusStudyPanel = (): void => {
              const studyTab = {
                input: new TabInputWebview(
                  'mainThreadWebview-codebook.studyContext',
                ),
              }
              otherGroup.tabs.push(studyTab)
              otherGroup.activeTab = studyTab
              activeGroup = otherGroup
              activeEditor = undefined
              for (const listener of tabListeners) listener()
              for (const listener of groupListeners) listener()
            }
            activateWikiPanel = (): void => {
              activeEditor = undefined
              activeGroup = otherGroup
              panel.active = true
              panel.visible = true
              void beginDocument()
              for (const listener of focusListeners) listener()
              for (const listener of groupListeners) listener()
              viewStateChanged()
            }
            hideWikiPanel = (): void => {
              panel.active = false
              panel.visible = false
              documentReady = false
              viewStateChanged()
            }
            panels.add(panel)
            return panel
          },
        },
      },
    },
  )
  const createReader = () =>
    new boundary.RepositoryReader({
      storage: async () => library,
      connect: async () => {
        connections++
      },
      arrange: async (_signal, _selection, focus) => {
        arrangements++
        const held = arrangementGate
        arrangementGate = undefined
        if (held) {
          held.entered()
          await held.wait
        }
        focus?.begin()
        const retained = coldLayout ? focus?.retainCurrentFocus?.() : undefined
        const response = layoutResponseGate
        layoutResponseGate = undefined
        if (response) {
          response.entered()
          await response.wait
        }
        retained?.assertRetained()
        if (requiresSourceFocus) {
          assert.ok(
            focus?.acquireSourceFocus,
            'Ambiguous main focus requires the actual selected citation.',
          )
          const assertFocused = await focus.acquireSourceFocus()
          assertFocused()
        }
      },
      evidence: async (binding, recording) => {
        linked.push({ binding, recording })
      },
    })
  const reader = createReader(),
    store = await reader.storage()
  context.after(() => reader.dispose())
  const first = await source.sources.read('src/module.ts'),
    second = await source.sources.read('src/order.ts')
  const document: BookDocument = {
    title: 'Architecture',
    summary: 'Source-derived architecture.',
    nodes: [
      {
        id: 'module',
        title: 'Module',
        sections: [
          { title: 'Price', text: 'The module exports price 24.' },
          { title: 'Order', text: 'Order exports total 48.' },
        ],
        anchors: [first, second].map((value) => ({
          path: value.path,
          hash: value.hash,
          startLine: 1,
          endLine: 2,
        })),
        observations: [],
      },
      {
        id: 'order',
        title: 'Order',
        sections: [{ title: 'Total', text: 'The order exports total 48.' }],
        anchors: [
          { path: second.path, hash: second.hash, startLine: 1, endLine: 2 },
        ],
        observations: [],
      },
    ],
    edges: [
      {
        from: 'module',
        to: 'order',
        relationship: 'related',
        explanation: 'Both export pricing values.',
      },
    ],
  }
  await store.publish({
    bookId: 'architecture',
    key: 'first',
    expectedRevision: 0,
    document,
  })
  const selection: RepositorySelection = {
    bookId: 'architecture',
    revision: 1,
    nodeId: 'module',
    anchorIndex: 0,
  }
  return {
    ...source,
    library,
    reader,
    store,
    selection,
    document,
    shown,
    openedSources,
    panels,
    linked,
    textDocuments,
    Uri,
    createReader,
    wikiViewsRegistered: (): number => wikiViewsRegistered,
    panelColumns,
    reveals,
    revealFocus,
    receive: (message: unknown): void => receive(message),
    requireSourceFocus(): void {
      requiresSourceFocus = true
    },
    /** Holds real reader-message acknowledgements during entry so readiness regressions can emulate a recreated native document. @example const renderer = harness.holdRenderer(); renderer.release() */
    holdRenderer(loadedOnly = false) {
      let entered!: () => void, unblock!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          unblock = resolve
        }),
        held = { entered, wait, loadedOnly }
      rendererGate = held
      return {
        started,
        release(): void {
          if (rendererGate === held) rendererGate = undefined
          unblock()
        },
      }
    },
    arrangements: () => arrangements,
    useColdLayout(): void {
      coldLayout = true
    },
    useNativeCitationActivation(): void {
      nativeCitationActivation = true
    },
    holdCitationActivation(
      stage: NonNullable<typeof citationActivationGate>['stage'],
    ) {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      citationActivationGate = { stage, entered, wait }
      return { started, release }
    },
    holdLayoutResponse() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      layoutResponseGate = { entered, wait }
      return { started, release }
    },
    holdArrangement() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      arrangementGate = { entered, wait }
      return { started, release }
    },
    holdSourceDocument() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      sourceDocumentGate = { entered, wait }
      return { started, release }
    },
    holdSourceDisplay() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      sourceDisplayGate = { entered, wait }
      return { started, release }
    },
    focusedSource: () => activeEditor,
    focusListenerCount: () =>
      focusListeners.size +
      windowFocusListeners.size +
      selectionListeners.size +
      tabListeners.size +
      groupListeners.size,
    selectSource(line: number, character: number, kind = 3): void {
      assert.ok(activeEditor)
      activeEditor.selections = [
        {
          anchor: new Position(line, character),
          active: new Position(line, character),
        },
      ]
      for (const listener of selectionListeners)
        listener({ kind, textEditor: activeEditor })
    },
    focusSourceEditor(editor: NativeEditor): void {
      activeEditor = editor
      for (const listener of focusListeners) listener()
    },
    roundtripCitationTab(): void {
      const citation = sourceGroup.activeTab,
        editor = activeEditor
      sourceGroup.activeTab = {
        input: new TabInputText(Uri.file(join(root, 'unrelated-draft.txt'))),
      }
      for (const listener of tabListeners) listener()
      activeEditor = editor
      sourceGroup.activeTab = citation
      for (const listener of tabListeners) listener()
    },
    switchTabGroup(toSource = false): void {
      activeGroup = toSource ? sourceGroup : otherGroup
      for (const listener of groupListeners) listener()
    },
    focusChat(): void {
      activeEditor = undefined
      // Side-view chat leaves the last Wiki main group selected while its input owns keyboard.
      activeGroup = otherGroup
      for (const listener of focusListeners) listener()
    },
    setWindowFocus(focused: boolean): void {
      windowFocused = focused
      for (const listener of windowFocusListeners) listener({ focused })
    },
    focusWiki(): void {
      activateWikiPanel()
    },
    focusStudy(): void {
      focusStudyPanel()
    },
    useNativeWikiSelection(): void {
      nativeWikiSelection = true
    },
    hideWiki(): void {
      hideWikiPanel()
    },
    focusUnrelatedDraft(filename = 'unrelated-draft.txt'): void {
      const document = {
          uri: Uri.file(join(root, filename)),
          version: 1,
          getText: () => 'Keep my draft.',
        },
        tab = { input: new TabInputText(document.uri) }
      activeEditor = {
        document,
        viewColumn: 1,
        selections: [
          { anchor: new Position(0, 0), active: new Position(0, 0) },
        ],
      }
      sourceGroup.tabs.push(tab)
      sourceGroup.activeTab = tab
      for (const listener of focusListeners) listener()
    },
    connections: () => connections,
    changeWorkspace: (): void => {
      workspace = '/another/workspace'
    },
    provider: (uri: Uri) => provider(uri),
    fileEvent: (path: string, kind: number): void => {
      for (const watcher of watchers)
        if (
          matchesGlob(
            relative(watcher.pattern.base, path),
            watcher.pattern.pattern,
          )
        )
          watcher.listeners[kind]?.(Uri.file(path))
    },
  }
}

test('repository articles open retained source without connecting an agent or marking understanding', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  // Act
  await harness.reader.open()
  const state = harness.reader.inspect()
  // Assert
  assert.equal(state.view.selection?.nodeId, 'module')
  assert.equal(state.view.loading, false)
  assert.equal(harness.shown[0]?.text, 'export const price = 24;\n')
  assert.equal(harness.connections(), 0)
  assert.equal(state.view.sources[0]?.status, 'current')
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
  assert.equal('sources' in state.view.book!.revision, false)
})

// Regression: Cycle0046 native331 — opening an article through MCP must not take the learner's keyboard.
// Found by /qa on 2026-10-10.
// Report: private native-final/n331-n332-c15/vscode/agent-open1-host-focus.json.
for (const input of ['chat', 'file'] as const)
  test(`an agent opening another article in the existing Wiki preserves the learner's ${input} input`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    if (input === 'chat') harness.focusChat()
    else harness.focusUnrelatedDraft()
    harness.requireSourceFocus()
    const originalInput = harness.focusedSource(),
      shownBefore = harness.shown.length,
      revealsBefore = harness.reveals.length

    // Act
    const receipt = await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })

    // Assert
    assert.equal(harness.focusedSource(), originalInput)
    assert.equal(harness.shown.length, shownBefore + (input === 'chat' ? 1 : 0))
    assert.equal(harness.reveals.length, revealsBefore)
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
    assert.equal(
      harness.openedSources.at(-1)?.text,
      'export const total = 48;\n',
    )
    assert.equal(
      harness.openedSources.at(-1)?.uri.toString(),
      receipt.sourceUri,
    )
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  })

// Regression: Cycle0046 native423 — a Return command must preserve input until the learner selects the Wiki.
// Found by /qa on 2026-10-10; private native-final/n331-n332-c17/vscode/return-reproduction.json.
for (const input of ['chat', 'file'] as const)
  test(`returning to Wiki from ${input} keeps its input and restores the article layout only when Wiki is selected`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    if (input === 'chat') harness.focusChat()
    else harness.focusUnrelatedDraft()
    harness.requireSourceFocus()
    const originalInput = harness.focusedSource(),
      arrangementsBefore = harness.arrangements(),
      shownBefore = harness.shown.length,
      revealsBefore = harness.reveals.length,
      selection = {
        ...harness.selection,
        nodeId: 'order',
        location: { sectionIndex: 0, fraction: 0.5, focusId: 'anchor-0' },
      }

    // Act
    await harness.reader.open(selection, undefined, true, true)

    // Assert
    assert.equal(harness.focusedSource(), originalInput)
    assert.equal(harness.arrangements(), arrangementsBefore)
    assert.equal(harness.reveals.length, revealsBefore)
    assert.equal(harness.shown.length, shownBefore)
    assert.deepEqual(harness.reader.inspect().view.selection, selection)

    // Act
    harness.focusWiki()
    await waitUntil(
      () =>
        harness.arrangements() === arrangementsBefore + 1 &&
        !harness.reader.inspect().view.loading,
      'original article layout restored after native Wiki selection',
    )

    // Assert
    assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
    assert.deepEqual(harness.reader.inspect().view.selection, selection)
    assert.equal(harness.reader.inspect().view.error, '')
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  })

test('selecting Wiki during a Return freshness check completes that Return without superseding its caller', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.focusChat()
  harness.requireSourceFocus()
  const inspect = harness.store.sources.inspect.bind(harness.store.sources)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  context.mock.method(
    harness.store.sources,
    'inspect',
    async (...args: Parameters<typeof inspect>) => {
      entered()
      await held
      return inspect(...args)
    },
  )
  const opening = harness.reader.open(harness.selection, undefined, true, true)
  try {
    await started

    // Act
    harness.focusWiki()
    release()
    await opening

    // Assert
    assert.equal(harness.arrangements(), 2)
    assert.equal(harness.reader.inspect().view.loading, false)
    assert.equal(harness.reader.inspect().view.error, '')
    assert.equal(harness.shown.at(-1)?.text, 'export const price = 24;\n')
  } finally {
    release()
    await opening.catch(() => undefined)
  }
})

test('a newer article retires an unvisited Return so later Wiki focus cannot restore its old layout', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.focusUnrelatedDraft()
  await harness.reader.open(harness.selection, undefined, true, true)

  // Act
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })
  const arrangements = harness.arrangements(),
    shownBeforeFocus = harness.shown.length
  assert.equal(harness.shown.at(-1)?.text, 'export const price = 24;\n')
  harness.focusWiki()
  await waitUntil(
    () =>
      harness.shown.length > shownBeforeFocus &&
      !harness.reader.inspect().view.loading,
    'new native source display after Wiki selection',
  )

  // Assert
  assert.equal(harness.arrangements(), arrangements)
  assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
  assert.equal(harness.reader.inspect().view.error, '')
})

test('selecting the Wiki after a quiet agent article displays its exact citation without another article request', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.focusUnrelatedDraft()
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })
  const shownBefore = harness.shown.length

  // Act
  harness.focusWiki()
  await waitUntil(
    () => harness.shown.length === shownBefore + 1,
    'deferred exact source preview',
  )

  // Assert
  assert.equal(harness.focusedSource(), undefined)
  assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
})

test('selecting the Wiki while its requested article is loading completes that article and displays its cited source', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.focusUnrelatedDraft()
  const pendingSource = harness.holdSourceDocument()
  const opening = harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })
  await pendingSource.started

  // Act
  harness.focusWiki()
  pendingSource.release()
  await opening

  // Assert
  assert.equal(harness.focusedSource(), undefined)
  assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
  assert.equal(harness.reader.inspect().view.error, '')
})

for (const departure of ['another file', 'Close'] as const)
  test(`a pending Wiki citation preview preserves ${departure === 'Close' ? 'a closed reader' : 'newer file input'} instead of revealing its old source`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.focusUnrelatedDraft()
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })
    const shownBefore = harness.shown.length,
      listenerCount = harness.focusListenerCount(),
      pending = harness.holdSourceDocument()
    harness.focusWiki()
    await pending.started

    // Act
    if (departure === 'Close') harness.reader.close()
    else harness.focusUnrelatedDraft('newer-draft.txt')
    const newerInput = harness.focusedSource()
    pending.release()
    await waitUntil(
      () => harness.focusListenerCount() === listenerCount,
      'retired deferred-source ownership',
    )

    // Assert
    assert.equal(harness.shown.length, shownBefore)
    assert.equal(harness.focusedSource(), newerInput)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
    assert.equal(harness.reader.inspect().view.error, '')
  })

for (const refusal of ['another article', 'unavailable observation'] as const)
  test(`a refused ${refusal} evidence request preserves the current Wiki's deferred citation preview`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.focusUnrelatedDraft()
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })
    const shownBefore = harness.shown.length

    // Act
    await assert.rejects(
      harness.reader.evidence(
        {
          ...harness.selection,
          nodeId: refusal === 'another article' ? 'module' : 'order',
        },
        0,
        true,
      ),
      refusal === 'another article'
        ? /another article/
        : /observation is unavailable/,
    )
    harness.focusWiki()
    await waitUntil(
      () => harness.shown.length === shownBefore + 1,
      'current preview after refused evidence navigation',
    )

    // Assert
    assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  })

test('a refused observation request lets an already-started Wiki citation preview finish without leaving and returning again', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.focusUnrelatedDraft()
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })
  const shownBefore = harness.shown.length,
    listenerCount = harness.focusListenerCount(),
    pending = harness.holdSourceDocument()
  harness.focusWiki()
  await pending.started

  // Act
  await assert.rejects(
    harness.reader.evidence({ ...harness.selection, nodeId: 'order' }, 0, true),
    /observation is unavailable/,
  )
  pending.release()
  await waitUntil(
    () => harness.focusListenerCount() === listenerCount,
    'citation preview finished after refused observation',
  )

  // Assert
  assert.equal(harness.shown.length, shownBefore + 1)
  assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
  assert.equal(harness.focusedSource(), undefined)
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
  assert.equal(harness.reader.inspect().view.error, '')
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
})

for (const entry of ['cold ordinary text', 'ambiguous primary'] as const)
  test(`${entry} Wiki opens after native citation activation reports a missing editor and initial caret`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.focusUnrelatedDraft()
    harness.useNativeCitationActivation()
    if (entry === 'cold ordinary text') harness.useColdLayout()
    if (entry === 'ambiguous primary') harness.requireSourceFocus()
    const listeners = harness.focusListenerCount()
    // Act
    await harness.reader.open(harness.selection)
    // Assert
    assert.deepEqual(harness.reveals, [2])
    assert.equal(harness.shown.length, 1)
    assert.equal(harness.reader.inspect().view.loading, false)
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
    assert.equal(harness.reader.inspect().view.sources[0]?.status, 'current')
    assert.equal(harness.focusListenerCount(), listeners)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  })

for (const interaction of [
  'selection',
  'selection roundtrip',
  'tab roundtrip',
  'group',
  'group roundtrip',
  'editor retreat',
  'text gap',
  'Keyboard',
  'Mouse',
  'document version roundtrip',
] as const)
  test(`cold Wiki preserves ${interaction} during native citation initial caret before the requested range arrives`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.useColdLayout()
    harness.focusUnrelatedDraft()
    harness.useNativeCitationActivation()
    const original = harness.focusedSource()!,
      listeners = harness.focusListenerCount(),
      held = harness.holdCitationActivation('initial caret')
    const opening = harness.reader.open(harness.selection),
      rejected = assert.rejects(opening, /focus changed/)
    try {
      await held.started
      // Act
      if (interaction === 'selection' || interaction === 'selection roundtrip')
        harness.selectSource(0, 6)
      if (interaction === 'selection roundtrip') harness.selectSource(0, 0)
      if (interaction === 'tab roundtrip') harness.roundtripCitationTab()
      if (interaction === 'group' || interaction === 'group roundtrip')
        harness.switchTabGroup()
      if (interaction === 'group roundtrip') harness.switchTabGroup(true)
      if (interaction === 'editor retreat') harness.focusSourceEditor(original)
      if (interaction === 'text gap') harness.focusChat()
      if (interaction === 'Keyboard' || interaction === 'Mouse')
        harness.selectSource(0, 0, interaction === 'Keyboard' ? 1 : 2)
      if (interaction === 'document version roundtrip') {
        const editor = harness.focusedSource()!
        editor.document.version = 2
        harness.focusSourceEditor(editor)
        editor.document.version = 1
        harness.focusSourceEditor(editor)
      }
      held.release()
      await rejected
      // Assert: the accepted host display can drain, but no later Wiki activation or learning-state write follows.
      assert.deepEqual(harness.reveals, [])
      assert.equal(harness.panels.size, 0)
      assert.equal(harness.shown.length, 1)
      assert.equal(
        (await harness.library.readProgress()).repositorySelection,
        undefined,
      )
      assert.equal(harness.focusListenerCount(), listeners)
    } finally {
      held.release()
      await opening.catch(() => undefined)
    }
  })

for (const stage of ['target tab', 'text gap'] as const)
  test(`cold Wiki rejects newer editor input during citation ${stage} before the target editor appears`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.useColdLayout()
    harness.focusUnrelatedDraft()
    harness.useNativeCitationActivation()
    const original = harness.focusedSource()!,
      held = harness.holdCitationActivation(stage),
      listeners = harness.focusListenerCount()
    const opening = harness.reader.open(harness.selection),
      rejected = assert.rejects(opening, /focus changed/)
    try {
      await held.started
      // Act
      if (stage === 'target tab') harness.selectSource(0, 6)
      else harness.focusSourceEditor(original)
      held.release()
      await rejected
      // Assert
      assert.deepEqual(harness.reveals, [])
      assert.equal(harness.panels.size, 0)
      assert.equal(harness.focusListenerCount(), listeners)
      assert.equal(
        (await harness.library.readProgress()).repositorySelection,
        undefined,
      )
    } finally {
      held.release()
      await opening.catch(() => undefined)
    }
  })

for (const interaction of [
  'different file',
  'selection',
  'tab roundtrip',
  'none',
] as const)
  test(`cold Wiki reservation ${interaction === 'none' ? 'opens the actual citation without losing navigation ownership' : `preserves newer ${interaction} instead of revealing stale Wiki`}`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.useColdLayout()
    harness.focusUnrelatedDraft('original-draft.txt')
    const draft = harness.focusedSource(),
      listeners = harness.focusListenerCount(),
      held = harness.holdLayoutResponse()
    const opening = harness.reader.open(harness.selection),
      outcome =
        interaction === 'none'
          ? opening
          : assert.rejects(opening, /focus changed/)
    try {
      await held.started
      // Act
      if (interaction === 'different file') harness.focusUnrelatedDraft()
      if (interaction === 'selection') harness.selectSource(0, 6)
      if (interaction === 'tab roundtrip') harness.roundtripCitationTab()
      const latestFocus = harness.focusedSource()
      held.release()
      await outcome
      // Assert
      assert.equal(harness.focusListenerCount(), listeners)
      assert.equal((await harness.library.readProgress()).decisions.length, 0)
      if (interaction === 'none') {
        assert.equal(harness.shown.length, 1)
        assert.deepEqual(harness.reveals, [2])
        assert.equal(
          harness.reader.inspect().sourceUri,
          harness.shown[0]!.uri.toString(),
        )
      } else {
        assert.equal(harness.shown.length, 0)
        assert.deepEqual(harness.reveals, [])
        assert.equal(harness.panels.size, 0)
        assert.equal(
          (await harness.library.readProgress()).repositorySelection,
          undefined,
        )
        assert.equal(harness.focusedSource(), latestFocus)
        if (interaction === 'selection')
          assert.equal(draft!.selections[0]!.active.character, 6)
      }
    } finally {
      held.release()
      await opening.catch(() => undefined)
    }
  })

for (const boundary of [
  'source lookup',
  'progress storage',
  'source refresh',
] as const)
  test(`cold Wiki preserves chat focus during ${boundary} after its native reservation`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.useColdLayout()
    harness.focusUnrelatedDraft()
    const listeners = harness.focusListenerCount()
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
        entered = resolve
      }),
      held = new Promise<void>((resolve) => {
        release = resolve
      })
    const sourceLookup =
      boundary === 'source lookup' ? harness.holdSourceDocument() : undefined
    if (boundary === 'progress storage') {
      const save = harness.library.selectRepository.bind(harness.library)
      harness.library.selectRepository = async (selection): Promise<void> => {
        entered()
        await held
        await save(selection)
      }
    }
    if (boundary === 'source refresh') {
      const inspect = harness.store.sources.inspect.bind(harness.store.sources)
      harness.store.sources.inspect = async (anchors) => {
        entered()
        await held
        return inspect(anchors)
      }
    }
    const opening = harness.reader.open(harness.selection),
      rejected = assert.rejects(opening, /focus changed/)
    try {
      await Promise.race([sourceLookup?.started ?? started, opening])
      // Act
      harness.focusChat()
      sourceLookup?.release()
      release()
      await rejected
      // Assert
      assert.deepEqual(harness.reveals, [])
      assert.equal(harness.focusedSource(), undefined)
      assert.equal(harness.focusListenerCount(), listeners)
      assert.equal((await harness.library.readProgress()).decisions.length, 0)
      assert.equal(harness.shown.length, boundary === 'source lookup' ? 0 : 1)
    } finally {
      sourceLookup?.release()
      release()
      await opening.catch(() => undefined)
    }
  })

test('cold Wiki with an empty library activates its empty reader without inventing a citation or retaining listeners', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.focusUnrelatedDraft()
  harness.store.list = async () => []
  const listeners = harness.focusListenerCount()
  // Act
  await harness.reader.open()
  // Assert
  assert.equal(harness.shown.length, 0)
  assert.deepEqual(harness.reveals, [2])
  assert.equal(harness.panels.size, 1)
  assert.equal(harness.reader.inspect().view.loading, false)
  assert.equal(harness.reader.inspect().sourceUri, undefined)
  assert.equal(harness.focusListenerCount(), listeners)
  assert.equal(
    (await harness.library.readProgress()).repositorySelection,
    undefined,
  )
})

for (const retirement of ['abort', 'Close', 'new Open'] as const)
  test(`${retirement} during cold Wiki reservation releases its own focus receipt without a stale reveal`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.useColdLayout()
    harness.focusUnrelatedDraft()
    const listeners = harness.focusListenerCount(),
      held = harness.holdLayoutResponse(),
      cancellation = new AbortController()
    const opening = harness.reader.open(harness.selection, cancellation.signal),
      rejected = assert.rejects(opening, /abort|cancel|superseded|changed/i)
    try {
      await held.started
      // Act
      if (retirement === 'abort') cancellation.abort()
      if (retirement === 'Close') harness.reader.close()
      if (retirement === 'new Open')
        await harness.reader.open({ ...harness.selection, nodeId: 'order' })
      held.release()
      await rejected
      // Assert
      assert.equal(harness.focusListenerCount(), listeners)
      assert.equal((await harness.library.readProgress()).decisions.length, 0)
      assert.deepEqual(harness.reveals, retirement === 'new Open' ? [2] : [])
      assert.equal(harness.shown.length, retirement === 'new Open' ? 1 : 0)
    } finally {
      held.release()
      await opening.catch(() => undefined)
    }
  })

for (const entry of ['ordinary open', 'Return without an open Wiki'] as const)
  test(`Wiki ${entry} opens its real retained citation before resolving an otherwise ambiguous primary pane`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    // Act
    await harness.reader.open(
      harness.selection,
      undefined,
      entry !== 'ordinary open',
      entry !== 'ordinary open',
    )
    // Assert
    assert.deepEqual(harness.panelColumns, [2])
    assert.deepEqual(harness.reveals, [2])
    assert.equal(harness.shown.length, 1)
    assert.equal(harness.shown[0]!.text, 'export const price = 24;\n')
    assert.equal(
      harness.reader.inspect().sourceUri,
      harness.shown[0]!.uri.toString(),
    )
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
    assert.equal(harness.reader.inspect().view.loading, false)
    assert.equal(harness.connections(), 0)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  })

test('an unavailable Wiki citation cannot acquire native layout or focus as a temporary anchor', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  // Act
  await assert.rejects(
    harness.reader.open({ ...harness.selection, revision: 9 }),
    /revision 9 is unavailable/,
  )
  // Assert
  assert.equal(harness.arrangements(), 0)
  assert.equal(harness.shown.length, 0)
  assert.equal(harness.panels.size, 0)
})

for (const entry of ['ambiguous scope', 'cold ordinary text'] as const)
  for (const interaction of ['selection', 'tab roundtrip', 'none'] as const)
    test(`${entry} Wiki citation display response preserves later ${interaction} without adopting new learner ownership`, async (context) => {
      // Arrange
      const harness = await readerHarness(context)
      if (entry === 'ambiguous scope') harness.requireSourceFocus()
      else {
        harness.useColdLayout()
        harness.focusUnrelatedDraft()
      }
      const held = harness.holdSourceDisplay()
      const listeners = harness.focusListenerCount(),
        opening = harness.reader.open(harness.selection)
      const outcome =
        interaction === 'none'
          ? opening
          : assert.rejects(opening, /focus changed/)
      try {
        await held.started
        const source = harness.focusedSource()
        assert.ok(source)
        // Act
        if (interaction === 'selection') harness.selectSource(0, 6)
        if (interaction === 'tab roundtrip') harness.roundtripCitationTab()
        held.release()
        await outcome
        // Assert
        assert.equal(harness.focusListenerCount(), listeners)
        assert.equal(harness.shown.length, 1)
        assert.equal((await harness.library.readProgress()).decisions.length, 0)
        if (interaction === 'none') {
          assert.deepEqual(harness.reveals, [2])
          assert.equal(harness.reader.inspect().view.loading, false)
          assert.equal(
            (await harness.library.readProgress()).repositorySelection?.nodeId,
            'module',
          )
        } else {
          assert.equal(harness.panels.size, 0)
          assert.deepEqual(harness.reveals, [])
          assert.equal(harness.focusedSource(), source)
          assert.equal(
            (await harness.library.readProgress()).repositorySelection,
            undefined,
          )
          assert.deepEqual(
            source.selections.map((selection) => [
              selection.active.line,
              selection.active.character,
            ]),
            interaction === 'selection' ? [[0, 6]] : [[1, 0]],
          )
        }
      } finally {
        held.release()
        await opening.catch(() => undefined)
      }
    })

test('chat focus during Wiki progress storage prevents the old Open from revealing its reader again', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  const save = harness.library.selectRepository.bind(harness.library)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  harness.library.selectRepository = async (selection): Promise<void> => {
    entered()
    await held
    await save(selection)
  }
  const opening = harness.reader.open(harness.selection)
  void opening.catch(() => undefined)
  try {
    // Act
    await Promise.race([started, opening])
    harness.focusChat()
    release()
    await assert.rejects(opening, /focus changed/)
    // Assert
    assert.deepEqual(harness.reveals, [])
    assert.equal(harness.shown.length, 1)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    release()
    await opening.catch(() => undefined)
  }
})

test('manual draft focus while the Wiki catalog loads prevents later source focus acquisition', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  const list = harness.store.list.bind(harness.store)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  harness.store.list = async () => {
    entered()
    await held
    return list()
  }
  const opening = harness.reader.open(harness.selection),
    rejected = assert.rejects(opening, /focus changed/)
  try {
    // Act
    await started
    harness.focusUnrelatedDraft()
    release()
    await rejected
    // Assert
    assert.equal(harness.arrangements(), 0)
    assert.equal(harness.shown.length, 0)
    assert.equal(harness.panels.size, 0)
    assert.equal(
      (await harness.library.readProgress()).repositorySelection,
      undefined,
    )
  } finally {
    release()
    await opening.catch(() => undefined)
  }
})

for (const primary of ['opaque', 'text'] as const)
  test(`manual draft focus while ${primary}-primary Wiki layout waits prevents a later citation or reader reveal`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    if (primary === 'opaque') harness.requireSourceFocus()
    const held = harness.holdArrangement()
    const opening = harness.reader.open(harness.selection),
      rejected = assert.rejects(opening, /focus changed/)
    try {
      // Act
      await held.started
      harness.focusUnrelatedDraft()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.shown.length, 0)
      assert.equal(harness.panels.size, 0)
      assert.deepEqual(harness.reveals, [])
      assert.equal(
        (await harness.library.readProgress()).repositorySelection,
        undefined,
      )
    } finally {
      held.release()
      await opening.catch(() => undefined)
    }
  })

for (const interruption of ['manual focus', 'Close'] as const)
  test(`${interruption} during actual citation acquisition prevents a late native source or Wiki reveal`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    const held = harness.holdSourceDocument()
    const opening = harness.reader.open(harness.selection),
      rejected = assert.rejects(opening, /focus changed|superseded or closed/)
    try {
      // Act
      await held.started
      if (interruption === 'Close') harness.reader.close()
      else harness.focusUnrelatedDraft()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.shown.length, 0)
      assert.equal(harness.panels.size, 0)
      assert.deepEqual(harness.reveals, [])
      assert.equal(
        (await harness.library.readProgress()).repositorySelection,
        undefined,
      )
    } finally {
      held.release()
      await opening.catch(() => undefined)
    }
  })

test('publishing clearer prose advertises a newer revision without replacing the selected historical article or its understanding', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  await harness.reader.understand(true)
  // Act
  await harness.store.publish({
    bookId: 'architecture',
    key: 'second',
    expectedRevision: 1,
    document: { ...harness.document, title: 'Clearer architecture' },
  })
  await harness.reader.published()
  const historical = harness.reader.inspect().view
  await harness.reader.action('latest')
  const latest = harness.reader.inspect().view
  // Assert
  assert.equal(historical.selection?.revision, 1)
  assert.equal(historical.book?.latestRevision, 2)
  assert.equal(historical.understanding?.understood, true)
  assert.equal(latest.selection?.revision, 2)
  assert.equal(latest.understanding?.understood, true)
  assert.equal((await harness.library.readProgress()).decisions.length, 1)
})

test('secondary citation edits and unsaved editor changes require review while historical understanding stays retained', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  await harness.reader.understand(true)
  // Act
  await writeFile(
    join(harness.directory, 'src/order.ts'),
    'export const total = 72;\n',
  )
  await harness.reader.action('refresh')
  const edited = harness.reader.inspect().view
  harness.textDocuments.push({
    uri: harness.Uri.file(
      join(harness.store.sources.workspace, 'src/module.ts'),
    ),
    isDirty: true,
    getText: () => 'export const price = 30;',
  })
  await harness.reader.action('refresh')
  // Assert
  assert.equal(edited.sources[1]?.status, 'changed')
  assert.equal(edited.understanding?.understood, true)
  assert.equal(harness.reader.inspect().view.sources[0]?.status, 'changed')
  assert.equal((await harness.library.readProgress()).decisions.length, 1)
})

test('a fresh reader restores exact revision article citation section-relative position and focus from the shared ledger', async (context) => {
  // Arrange
  const harness = await readerHarness(context),
    selection = {
      ...harness.selection,
      anchorIndex: 1,
      location: { sectionIndex: 1, fraction: 0.4, focusId: 'section-1' },
    }
  await harness.reader.open(selection)
  harness.reader.close()
  const fresh = harness.createReader()
  context.after(() => fresh.dispose())
  // Act
  await fresh.open()
  // Assert
  assert.equal(
    JSON.stringify(fresh.inspect().view.selection),
    JSON.stringify(selection),
  )
  assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
})

test('an unchanged BOM source opens in the current native editor while retained bytes keep their original hash', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.track('src/module.ts', '\uFEFFexport const price = 24;\n')
  const source = await harness.sources.read('src/module.ts')
  harness.document.nodes[0]!.anchors[0]!.hash = source.hash
  await harness.store.publish({
    bookId: 'architecture',
    key: 'bom',
    expectedRevision: 1,
    document: harness.document,
  })
  await harness.reader.open({ ...harness.selection, revision: 2 })
  // Act
  await harness.reader.action('current-file')
  // Assert
  assert.equal(harness.shown.at(-1)?.uri.scheme, 'file')
  assert.equal(harness.shown.at(-1)?.text, 'export const price = 24;\n')
  assert.equal(
    (await harness.store.read('architecture', 2)).revision.sources[0]?.text,
    '\uFEFFexport const price = 24;\n',
  )
})

test('an old dirty buffer cannot certify a changed or unavailable cited file as current', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  harness.textDocuments.push({
    uri: harness.Uri.file(
      join(harness.store.sources.workspace, 'src/module.ts'),
    ),
    isDirty: true,
    getText: () => 'export const price = 24;\n',
  })
  const inspect = harness.store.sources.inspect.bind(harness.store.sources),
    values = await inspect(harness.document.nodes[0]!.anchors)
  // Act / Assert
  for (const status of ['changed', 'unavailable'] as const) {
    harness.store.sources.inspect = async () =>
      values.map((value) => ({ ...value, status }))
    await harness.reader.action('refresh')
    assert.equal(harness.reader.inspect().view.sources[0]?.status, status)
  }
})

test('mixed and CR-only line endings retain bytes while citation lines and current-file reveal match the native text model', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.track(
    'src/module.ts',
    'export const price = 24;\rexport const total = 48;\r\n',
  )
  const source = await harness.sources.read('src/module.ts')
  harness.document.nodes[0]!.anchors[0] = {
    path: source.path,
    hash: source.hash,
    startLine: 2,
    endLine: 3,
  }
  // Act
  await harness.store.publish({
    bookId: 'architecture',
    key: 'mixed-eol',
    expectedRevision: 1,
    document: harness.document,
  })
  await harness.reader.open({ ...harness.selection, revision: 2 })
  await harness.reader.action('current-file')
  // Assert
  assert.equal(source.lineCount, 3)
  assert.equal(harness.shown.at(-1)?.uri.scheme, 'file')
  assert.equal(
    harness.shown.at(-1)?.text,
    'export const price = 24;\nexport const total = 48;\n',
  )
  assert.equal(
    (await harness.store.read('architecture', 2)).revision.sources[0]?.text,
    'export const price = 24;\rexport const total = 48;\r\n',
  )
})

test('bracket-named route citations update review status after external edit deletion and recreation without manual refresh', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.track('src/routes/[id]/page.ts', 'export const price = 24;\n')
  const source = await harness.sources.read('src/routes/[id]/page.ts')
  harness.document.nodes[0]!.anchors[0] = {
    path: source.path,
    hash: source.hash,
    startLine: 1,
    endLine: 2,
  }
  await harness.store.publish({
    bookId: 'architecture',
    key: 'bracket-route',
    expectedRevision: 1,
    document: harness.document,
  })
  await harness.reader.open({ ...harness.selection, revision: 2 })
  await harness.reader.understand(true)
  const path = join(harness.store.sources.workspace, source.path)
  // Act / Assert: the mock applies actual glob matching before delivering each filesystem event.
  await writeFile(path, 'export const price = 30;\n')
  harness.fileEvent(path, 0)
  await waitUntil(
    () => harness.reader.inspect().view.sources[0]?.status === 'changed',
    'external route edit requests review',
    2_000,
  )
  await rm(path)
  harness.fileEvent(path, 2)
  await waitUntil(
    () => harness.reader.inspect().view.sources[0]?.status === 'unavailable',
    'deleted route becomes unavailable',
    2_000,
  )
  await writeFile(path, 'export const price = 24;\n')
  harness.fileEvent(path, 1)
  await waitUntil(
    () => harness.reader.inspect().view.sources[0]?.status === 'current',
    'restored cited bytes become current',
    2_000,
  )
  assert.equal(harness.reader.inspect().view.understanding?.understood, true)
  assert.equal((await harness.library.readProgress()).decisions.length, 1)
})

test('retiring an agent open before its checkpoint completes prevents source and selection effects while local reading remains available', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  const shown = harness.shown.length
  const read = harness.store.read.bind(harness.store)
  let release = (): void => {},
    enter = (): void => {},
    held = true
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    cancellation = new AbortController()
  harness.store.read = async (...arguments_: Parameters<typeof read>) => {
    const result = await read(...arguments_)
    if (held) {
      held = false
      enter()
      await waiting
    }
    return result
  }
  // Act
  const pending = harness.reader.openFromAgent(
    {
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    },
    cancellation.signal,
  )
  const rejected = assert.rejects(pending, /superseded or closed/)
  await entered
  cancellation.abort()
  release()
  await rejected
  // Assert
  assert.equal(harness.shown.length, shown)
  assert.equal(
    (await harness.library.readProgress()).repositorySelection?.nodeId,
    'module',
  )
  await harness.reader.open()
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
  assert.equal(harness.reader.inspect().view.error, '')
})

test('missing saved history reports its exact revision instead of silently falling forward to the latest', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.library.selectRepository({ ...harness.selection, revision: 9 })
  // Act / Assert
  await assert.rejects(harness.reader.open(), /revision 9 is unavailable/)
  assert.equal(harness.shown.length, 0)
  assert.equal(
    (await harness.library.readProgress()).repositorySelection?.revision,
    9,
  )
  assert.equal(harness.reader.inspect().view.catalog[0]?.revision, 1)
})

test('late article navigation cannot replace a newer selection or reopen a closed repository panel', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  const read = harness.store.read.bind(harness.store)
  let release = (): void => {},
    enter = (): void => {},
    held = true
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve
    })
  harness.store.read = async (...arguments_: Parameters<typeof read>) => {
    const result = await read(...arguments_)
    if (held) {
      held = false
      enter()
      await waiting
    }
    return result
  }
  // Act
  const old = harness.reader.open(harness.selection)
  const rejected = assert.rejects(old, /superseded or closed/)
  await entered
  await harness.reader.open({ ...harness.selection, nodeId: 'order' })
  release()
  await rejected
  // Assert
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
  assert.equal(harness.reader.inspect().view.error, '')
  harness.reader.close()
  assert.equal(harness.panels.size, 0)
  assert.equal(harness.reader.inspect().opened, false)
})

// Regression: Cycle0046 task428 — activating a not-yet-created native document leaves the Wiki without keyboard focus.
// Value: protects=intentional Wiki entry waits for its current document; fails_when=activation precedes its render receipt; why_new=existing fixtures treated reveal as ready; seam=none.
for (const entry of ['cold article', 'hidden Study Return'] as const)
  test(`${entry} keeps native input until its current Wiki document is rendered, then gives the article its keyboard`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    if (entry === 'hidden Study Return') {
      await harness.reader.open(harness.selection)
      harness.hideWiki()
    }
    const revealsBefore = harness.revealFocus.length,
      renderer = harness.holdRenderer(),
      opening = harness.reader.open(
        harness.selection,
        undefined,
        entry === 'hidden Study Return',
      )
    try {
      await renderer.started
      await waitUntil(
        () => harness.revealFocus.length > revealsBefore,
        'the owned Wiki display',
      )
      // Assert: initial visibility must not activate a document that does not exist yet.
      assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true])
      assert.equal(
        harness.focusedSource()?.document.getText(),
        'export const price = 24;\n',
      )

      // Act
      renderer.release()
      await opening

      // Assert
      assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true, false])
      assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
    } finally {
      renderer.release()
      await opening.catch(() => undefined)
    }
  })

// Value: protects=newer native input while the document loads; fails_when=the readiness handoff ignores a departure; why_new=entry previously activated synchronously; seam=none.
for (const departure of [
  'chat',
  'source key',
  'window',
  'window roundtrip',
  'Close',
] as const)
  test(`a ${departure} while the Wiki document loads prevents the old entry from taking keyboard focus later`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    const renderer = harness.holdRenderer(),
      opening = harness.reader.open(harness.selection),
      failed = assert.rejects(
        opening,
        departure === 'Close'
          ? /abort|obsolete/i
          : departure.startsWith('window')
            ? /Native window focus changed/
            : /Native focus changed/,
      )
    try {
      await renderer.started
      await waitUntil(
        () => harness.revealFocus.length > 0,
        'the owned Wiki display',
      )
      assert.deepEqual(harness.revealFocus, [true])

      // Act: actual editor effects retire ownership even when the original state later returns.
      if (departure === 'chat') harness.focusChat()
      else if (departure === 'source key') harness.selectSource(0, 1, 1)
      else if (departure.startsWith('window')) {
        harness.setWindowFocus(false)
        if (departure === 'window roundtrip') harness.setWindowFocus(true)
      } else harness.reader.close()
      renderer.release()
      await failed

      // Assert
      assert.deepEqual(harness.revealFocus, [true])
      assert.equal(harness.focusListenerCount(), 0)
    } finally {
      renderer.release()
      await failed.catch(() => undefined)
    }
  })

test('an external Return preserves native chat input and completes while the hidden Wiki renderer is still unavailable', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  await harness.reader.open(harness.selection)
  harness.hideWiki()
  harness.focusChat()
  const revealsBefore = harness.revealFocus.length,
    renderer = harness.holdRenderer()
  try {
    // Act
    await harness.reader.open(harness.selection, undefined, true, true)

    // Assert
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [])
    assert.equal(harness.focusedSource(), undefined)
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
  } finally {
    renderer.release()
  }
})

test('intentional Study Return accepts its own quiet native Wiki tab selection before the document is ready', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.hideWiki()
  harness.focusStudy()
  harness.useNativeWikiSelection()
  const revealsBefore = harness.revealFocus.length,
    renderer = harness.holdRenderer(),
    opening = harness.reader.open(harness.selection, undefined, true),
    result = opening.then(
      () => ({ opened: true, error: '' }),
      (error: unknown) => ({ opened: false, error: String(error) }),
    )
  try {
    await renderer.started
    await waitUntil(
      () => harness.revealFocus.length > revealsBefore,
      'the quiet native tab selection',
    )

    // Act
    renderer.release()

    // Assert
    assert.deepEqual(await result, { opened: true, error: '' })
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true, false])
    assert.equal(harness.focusListenerCount(), 0)
  } finally {
    renderer.release()
    await result
  }
})

for (const departure of ['source', 'other group', 'group roundtrip'] as const)
  test(`a newer ${departure} after the own quiet Wiki selection still cancels the old Return`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    harness.focusStudy()
    harness.useNativeWikiSelection()
    const revealsBefore = harness.revealFocus.length,
      renderer = harness.holdRenderer(),
      opening = harness.reader.open(harness.selection, undefined, true),
      failed = assert.rejects(opening, /Native focus changed/)
    try {
      await renderer.started
      await waitUntil(
        () => harness.revealFocus.length > revealsBefore,
        'the own quiet Wiki selection',
      )

      // Act: later learner input stays terminal even when the expected Wiki tab becomes active again.
      if (departure === 'source') harness.focusUnrelatedDraft()
      else harness.switchTabGroup(true)
      if (departure === 'group roundtrip') harness.focusWiki()
      renderer.release()

      // Assert
      await failed
      assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true])
      assert.equal(harness.focusListenerCount(), 0)
    } finally {
      renderer.release()
      await failed.catch(() => undefined)
    }
  })

test('a previous article render receipt cannot release a newer pending Wiki entry', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  await harness.reader.open(harness.selection)
  const previous = harness.reader.inspect().view,
    revealsBefore = harness.revealFocus.length,
    renderer = harness.holdRenderer(),
    opening = harness.reader.open({ ...harness.selection, nodeId: 'order' })
  try {
    await renderer.started
    await waitUntil(
      () => harness.revealFocus.length > revealsBefore,
      'the new article display',
    )

    // Act
    harness.receive({
      type: 'rendered',
      revision: previous.revision,
      selection: previous.selection,
      width: 1024,
    })
    await Promise.resolve()

    // Assert
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true])
    assert.equal(harness.reader.inspect().rendered, undefined)
    renderer.release()
    await opening
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true, false])
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
  } finally {
    renderer.release()
    await opening.catch(() => undefined)
  }
})

test('new native chat input cancels an unanchored Wiki entry while its document is still loading', async (context) => {
  // Arrange: no source-acquisition receipt exists; the renderer wait must retain the actual native input itself.
  const harness = await readerHarness(context),
    renderer = harness.holdRenderer(),
    opening = harness.reader.open(harness.selection),
    failed = assert.rejects(opening, /Native focus changed/)
  try {
    await renderer.started
    await waitUntil(
      () => harness.revealFocus.length > 0,
      'the unanchored Wiki display',
    )

    // Act
    harness.focusChat()
    renderer.release()
    await failed

    // Assert
    assert.deepEqual(harness.revealFocus, [true])
    assert.equal(harness.focusedSource(), undefined)
    assert.equal(harness.focusListenerCount(), 0)
  } finally {
    renderer.release()
    await failed.catch(() => undefined)
  }
})

test('hiding Wiki retires its earlier same-article render receipt before the document is recreated', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  await harness.reader.open(harness.selection)
  const inspect = harness.store.sources.inspect.bind(harness.store.sources)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve
    })
  harness.store.sources.inspect = async (...args) => {
    entered()
    await wait
    return inspect(...args)
  }
  const opening = harness.reader.open(harness.selection)
  try {
    await started
    assert.equal(
      harness.reader.inspect().rendered?.revision,
      harness.reader.inspect().view.revision,
    )

    // Act
    harness.hideWiki()

    // Assert: the hidden document's receipt cannot certify a recreated iframe, even for the same article revision.
    assert.equal(harness.reader.inspect().rendered, undefined)
  } finally {
    release()
    harness.store.sources.inspect = inspect
    await opening.catch(() => undefined)
  }
})

test('late hidden-document receipts cannot certify a visible Wiki before its new document is ready', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  const previous = harness.reader.inspect().view,
    lateReceipt = {
      type: 'rendered',
      revision: previous.revision,
      selection: previous.selection,
      width: 390,
    }
  harness.hideWiki()

  // Act: neither a hidden ready message nor a late model receipt revives the old document.
  harness.receive({ type: 'ready' })
  harness.receive(lateReceipt)

  // Assert
  assert.equal(harness.reader.inspect().rendered, undefined)
  const renderer = harness.holdRenderer()
  try {
    // Act: visibility can precede the new document's actual ready message.
    harness.focusWiki()
    await renderer.started
    harness.receive(lateReceipt)

    // Assert
    assert.equal(harness.reader.inspect().rendered, undefined)
    renderer.release()
    await waitUntil(
      () => harness.reader.inspect().rendered,
      'the recreated Wiki model',
    )
    assert.equal(harness.reader.inspect().rendered?.width, 1024)
  } finally {
    renderer.release()
  }
})

test('a loading article receipt cannot authorize Wiki keyboard before its usable article is rendered', async (context) => {
  // Arrange: allow the ready document to acknowledge its loading model, but hold its usable article.
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  await harness.reader.open(harness.selection)
  const revealsBefore = harness.revealFocus.length,
    renderer = harness.holdRenderer(true),
    opening = harness.reader.open({ ...harness.selection, nodeId: 'order' })
  try {
    await renderer.started
    await waitUntil(
      () => harness.revealFocus.length > revealsBefore,
      'the Wiki display after source preparation',
    )
    // Act: let the ready handoff's promise continuations run while the usable model remains held.
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true])
    renderer.release()
    await opening
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [true, false])
    assert.equal(harness.reader.inspect().view.loading, false)
  } finally {
    renderer.release()
    await opening.catch(() => undefined)
  }
})

test('a newer article cancels an old renderer wait and only the latest article receives keyboard focus', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  const renderer = harness.holdRenderer(),
    opening = harness.reader.open(harness.selection),
    retired = assert.rejects(opening, /abort|obsolete/i)
  try {
    await renderer.started
    await waitUntil(
      () => harness.revealFocus.length > 0,
      'the first article display',
    )

    // Act
    const newer = harness.reader.open({ ...harness.selection, nodeId: 'order' })
    renderer.release()
    await retired
    await newer

    // Assert: the old quiet display is followed by one current activating handoff.
    assert.deepEqual(
      harness.revealFocus.filter((preserveFocus) => !preserveFocus),
      [false],
    )
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
    assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
    assert.equal(harness.focusListenerCount(), 0)
  } finally {
    renderer.release()
    await retired.catch(() => undefined)
  }
})

test(
  'an unavailable Wiki renderer times out without taking native input, and a late receipt cannot revive that entry',
  { timeout: 10_000 },
  async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    const renderer = harness.holdRenderer(),
      opening = harness.reader.open(harness.selection),
      failed = assert.rejects(
        opening,
        /Timed out waiting for the current Repository Wiki article to render/,
      )
    try {
      // Act: retain the real production renderer deadline instead of replacing it with a test-only budget.
      await renderer.started
      await failed
      renderer.release()
      await Promise.resolve()

      // Assert
      assert.deepEqual(harness.revealFocus, [true])
      assert.equal(
        harness.focusedSource()?.document.getText(),
        'export const price = 24;\n',
      )
      assert.equal(harness.focusListenerCount(), 0)
    } finally {
      renderer.release()
      await failed.catch(() => undefined)
    }
  },
)

test('delayed scroll and render receipts from a previous article do not warn on the new article or overwrite its return context', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  const previous = harness.reader.inspect().view
  await harness.reader.open({ ...harness.selection, nodeId: 'order' })
  // Act
  harness.receive({
    type: 'rendered',
    revision: previous.revision,
    selection: previous.selection,
    width: 390,
  })
  harness.receive({
    type: 'location',
    revision: previous.revision,
    selection: {
      ...previous.selection,
      location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-0' },
    },
  })
  await Promise.resolve()
  await harness.library.flush()
  // Assert
  assert.equal(harness.reader.inspect().view.error, '')
  assert.equal(
    (await harness.library.readProgress()).repositorySelection?.nodeId,
    'order',
  )
  assert.deepEqual(harness.reader.inspect().rendered, {
    type: 'rendered',
    revision: harness.reader.inspect().view.revision,
    selection: { ...harness.selection, nodeId: 'order' },
    width: 1024,
  })
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
})

test('Close during pending source acquisition prevents native source reveal and obsolete error publication', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  const before = harness.shown.length
  const read = harness.store.read.bind(harness.store)
  let enter = (): void => {},
    release = (): void => {},
    calls = 0
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve
    })
  harness.store.read = async (...arguments_: Parameters<typeof read>) => {
    const result = await read(...arguments_)
    if (++calls === 2) {
      enter()
      await waiting
    }
    return result
  }
  // Act
  const pending = harness.reader.open({ ...harness.selection, nodeId: 'order' })
  const rejected = assert.rejects(pending, /superseded or closed/)
  await entered
  harness.reader.close()
  release()
  await rejected
  // Assert
  assert.equal(harness.shown.length, before)
  assert.equal(harness.panels.size, 0)
  assert.equal(harness.reader.inspect().opened, false)
})

test('Retry saves an unsaved choice for its original article exactly once after navigation', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  const decide = harness.library.decide.bind(harness.library)
  harness.library.decide = async () => {
    throw new Error('injected disk failure')
  }
  // Act
  await assert.rejects(harness.reader.understand(true), /injected disk failure/)
  await harness.reader.open({ ...harness.selection, nodeId: 'order' })
  harness.library.decide = decide
  await harness.reader.action('retry')
  await harness.reader.action('retry')
  // Assert
  const decisions = (await harness.library.readProgress()).decisions
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0]?.item, 'repository/architecture/module')
  assert.equal(harness.reader.inspect().view.understanding?.understood, false)
})

test('corrupt shared progress leaves articles readable but understanding disabled without replacing the corrupt file', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await writeFile(
    join(harness.library.directory, 'progress.repository.v4.json'),
    '{corrupt',
  )
  // Act
  await harness.reader.open()
  // Assert
  assert.equal(harness.reader.inspect().view.book?.bookId, 'architecture')
  assert.equal(harness.reader.inspect().view.understanding?.known, false)
  await assert.rejects(harness.reader.understand(true), /learning storage/)
  assert.equal(
    await readFile(
      join(harness.library.directory, 'progress.repository.v4.json'),
      'utf8',
    ),
    '{corrupt',
  )
})

test('captured source URIs reject forged hashes and a reader rejects actions after workspace ownership changes', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open()
  const uri = harness.shown[0]!.uri
  // Act / Assert
  await assert.rejects(
    harness.provider(
      new harness.Uri(
        uri.scheme,
        uri.authority,
        uri.path,
        `hash=${'0'.repeat(64)}`,
      ),
    ),
    /differs from the selected citation/,
  )
  harness.changeWorkspace()
  await assert.rejects(harness.reader.understand(true), /no longer owns/)
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
})

test('evidence navigation persists exact return context and rejects changed checkpoints before entering a study', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  const study = {
      ...createConfiguredStudy(),
      workspaceKey: harness.library.workspaceKey,
      finalOutcome: 'partial' as const,
    },
    observation = study.observations[0]!
  await harness.library.saveStudy(study)
  for (const source of study.descriptor!.sources)
    await harness.track(source.path, source.text)
  const document: BookDocument = {
    title: 'Interface',
    summary: 'Theme selection.',
    nodes: [
      {
        id: 'theme',
        title: 'Theme',
        sections: [
          { title: 'Selection', text: 'Choose the theme.' },
          { title: 'Evidence', text: 'Review the captured selection.' },
        ],
        anchors: study.descriptor!.anchors,
        observations: [
          {
            studyId: study.id,
            observationId: observation.id,
            sourceHash: observation.source.hash,
          },
        ],
      },
    ],
    edges: [],
  }
  await harness.store.publish({
    bookId: 'interface',
    key: 'linked',
    expectedRevision: 0,
    document,
  })
  const selection = {
    bookId: 'interface',
    nodeId: 'theme',
    anchorIndex: 0,
    revision: 1,
    location: {
      sectionIndex: 1,
      fraction: 0.65,
      focusId: 'evidence-0-observation',
    },
  }
  await harness.reader.open(selection)
  // Act
  await harness.reader.evidence(selection, 0, false)
  await writeFile(
    join(harness.library.directory, `${study.id}.study.meta.v3.json`),
    '{broken',
  )
  // Assert
  assert.equal(harness.linked.length, 1)
  assert.equal(harness.linked[0]?.binding.observationId, observation.id)
  assert.equal(harness.linked[0]?.binding.outcome, 'partial')
  assert.equal(
    harness.reader.inspect().view.book?.links[0]?.recording.status,
    'unavailable',
  )
  assert.deepEqual(
    (await harness.library.readProgress()).repositorySelection,
    selection,
  )
  await assert.rejects(
    harness.reader.evidence(selection, 0, true),
    /missing or changed/,
  )
  assert.equal(harness.linked.length, 1)
})

// Value: protects=the editor after a Repository Wiki reader's dispose failed: the reader's Repository Wiki view and listeners are released all the same, so the reader the extension makes in its place does not share them with a disposed one; fails_when=the dispose stops at the failure and leaves what the reader registered with the editor in place; why_new=Cycle 0046 row 312 (the Repository Wiki reader's dispose, read beside row 298's change of the Study reader's); seam=the reader harness's count of registered Repository Wiki views, and the reader's close replaced by one that fails
test('a Repository Wiki reader whose dispose fails while it closes its pane releases what it registered with the editor all the same, and tells the failure', async (context) => {
  // Arrange: a second reader beside the harness's own, whose pane cannot be closed.
  const harness = await readerHarness(context),
    replaced = harness.createReader()
  const viewsBefore = harness.wikiViewsRegistered()
  replaced.close = (): void => {
    throw new Error('The Repository Wiki pane could not be closed.')
  }
  // Act: the workspace folders change, and the extension disposes the reader.
  const disposal = await replaced.dispose().then(
    () => 'disposed',
    (error: unknown) => String(error),
  )
  // Assert
  assert.equal(viewsBefore, 2)
  assert.equal(disposal, 'Error: The Repository Wiki pane could not be closed.')
  assert.equal(harness.wikiViewsRegistered(), 1)
})
