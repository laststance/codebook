import assert from 'node:assert/strict'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, join, matchesGlob, relative, resolve } from 'node:path'
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
    tabListeners = new Set<(event: NativeTabChange) => void>(),
    groupListeners = new Set<() => void>()
  type NativeTab = { input: TabInputText | TabInputWebview; isPinned?: boolean }
  /** The tab-model change the editor reports with onDidChangeTabs: the tabs it opened, closed and changed (vscode.TabChangeEvent). */
  type NativeTabChange = {
    opened: NativeTab[]
    closed: NativeTab[]
    changed: NativeTab[]
  }
  /** Reports a change of the fake tab model to every onDidChangeTabs listener, with the tabs it opened, closed or changed (row 677: the reader forgets a copy whose last tab closed). @example fireTabChange({ closed: [copy] }) */
  const fireTabChange = (change: Partial<NativeTabChange> = {}): void => {
    const event = { opened: [], closed: [], changed: [], ...change }
    for (const listener of tabListeners) listener(event)
  }
  const sourceGroup: {
    viewColumn: number
    tabs: NativeTab[]
    activeTab?: NativeTab
  } = { viewColumn: 1, tabs: [] }
  /** The text editor of each learner tab, with the caret the editor restores when the tab comes to the front again. */
  const learnerEditors = new Map<NativeTab, NativeEditor>()
  /** The tabs the reader asked the editor to close, as their URIs. */
  const closedTabs: string[] = []
  /** Every tab closed, by the reader or by the learner, the last one last: the editor's list for Reopen Closed Editor. */
  const recentlyClosedTabs: NativeTab[] = []
  const otherGroup: typeof sourceGroup = { viewColumn: 2, tabs: [] }
  /** Names a group's tabs in their order as `scheme:file name` (a text tab) or view type (a pane), and its front tab, for {@link firstGroupTabs} and {@link wikiGroupTabs}. @example namedGroupTabs(sourceGroup) // => { tabs: ['file:login-form.tsx'], front: 'file:login-form.tsx' } */
  const namedGroupTabs = (
    group: typeof sourceGroup,
  ): { tabs: string[]; front: string | undefined } => {
    const name = (tab: NativeTab): string =>
      tab.input instanceof TabInputText
        ? `${tab.input.uri.scheme}:${basename(tab.input.uri.path)}`
        : tab.input.viewType
    return {
      tabs: group.tabs.map(name),
      front: group.activeTab && name(group.activeTab),
    }
  }
  /**
   * Removes the tab of a webview panel the extension disposed from its group, with the tab-close event, as both editors do; called by each fake Wiki panel's `dispose`, a microtask after the panel's own onDidDispose (Cycle 0046 row 676).
   * The extension host fires the panel's onDidDispose and then asks the editor to dispose the pane (VS Code 1.140.0 `extensionHostProcess.js` 295:115246; Cursor 3.23.12 203:121183). The editor disposes the pane's editor input (VS Code `workbench.desktop.main.js` 777:41448; Cursor 17281:31514), its group's model reports that input's disposal (VS Code 705:23270) and the group closes the disposed editor (VS Code 1106:69601, 1106:71100; Cursor 17501:32411, 17501:33153). A group whose front tab closed brings its most recently active other tab to the front, as the fake's tabGroups.close does. Not modeled: the keyboard a closed pane with the keyboard hands to that tab, and the removal of a group the close empties (closeEmptyGroups).
   * @param tab - The disposed panel's tab; a tab already gone is left as it is.
   * @example closeDisposedPaneTab(wikiTab) // the Wiki's group no longer lists 'mainThreadWebview-codebook.repositoryWiki'
   */
  const closeDisposedPaneTab = (tab: NativeTab): void => {
    for (const group of [sourceGroup, otherGroup]) {
      if (!group.tabs.includes(tab)) continue
      group.tabs = group.tabs.filter((value) => value !== tab)
      if (group.activeTab === tab) group.activeTab = group.tabs.at(-1)
      fireTabChange({ closed: [tab] })
    }
  }
  let activeGroup = sourceGroup
  /** The group of Cursor's Agent chat part at column 3, once `focusCursorChatPart` added it; Cursor gives its composer tab no input, which the reader does not read on these paths, so a webview input stands in for it. */
  let chatPartGroup: typeof sourceGroup | undefined
  /** Says that the editor names the group of Cursor's chat part, which a foreground display in the main editor keeps named. @example namesChatPartGroup() // => true after focusCursorChatPart */
  const namesChatPartGroup = (): boolean =>
    chatPartGroup !== undefined && activeGroup === chatPartGroup
  let windowFocused = true
  let activateWikiPanel = (): void => {}
  let blurWikiPanel = (): void => {}
  let focusStudyPanel = (): void => {}
  let closeStudyPanel = (): void => {}
  let clickWikiTab = (): void => {}
  let hideWikiPanel = (): void => {}
  let nativeWikiSelection = false
  let retireWikiTextEditor = false
  let requiresSourceFocus = false,
    coldLayout = false,
    arrangements = 0
  /** What the arrangement's keyboard return answers ({@link RepositoryReaderModule.RepositoryKeyboardReturn}): `undefined` while the arrangement gives none, `true` when it gives the chat its keyboard back, `false` when it cannot. */
  let keyboardReturnAnswer: boolean | undefined,
    keyboardReturns = 0
  /** What happens in the editor while the arrangement's keyboard return runs, before it answers; see `answerKeyboardReturn`. */
  let duringKeyboardReturn: (() => void) | undefined
  const notices: string[] = []
  let sourceDocumentGate: { entered(): void; wait: Promise<void> } | undefined
  let sourceDisplayGate: { entered(): void; wait: Promise<void> } | undefined
  /** The editor's refusal of the next document show, once; see `rejectNextSourceDisplay`. */
  let sourceDisplayRefusal: Error | undefined
  /** Whether the next document show opens its tab and is refused after that, once; see `rejectNextSourceDisplayAfterOpeningItsTab`. */
  let refusesSourceDisplayAfterOpening = false
  let arrangementGate: { entered(): void; wait: Promise<void> } | undefined
  let layoutResponseGate: { entered(): void; wait: Promise<void> } | undefined
  let nativeCitationActivation = false
  let nativeCitationOrder: 'group-first' | 'editor-first' = 'group-first'
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
    revealFocus: boolean[] = [],
    publishedMessages: RepositoryViewMessage[] = []
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
          showInformationMessage: async (message: string) => {
            notices.push(message)
            return undefined
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
            get all() {
              return chatPartGroup
                ? [sourceGroup, otherGroup, chatPartGroup]
                : [sourceGroup, otherGroup]
            },
            get activeTabGroup() {
              return activeGroup
            },
            /**
             * Closes tabs as both editors do: a group whose front tab closes brings its most recently active other tab to the front with that editor's view state, the caret and scroll (VS Code 1.140.0 `workbench.desktop.main.js` 705:24141, 988:96536), and the editor that had the keyboard hands it to that tab's editor. Tabs are pushed in the order they came to the front, so the last remaining one is the most recently active.
             */
            close: async (tabs: NativeTab | NativeTab[]): Promise<boolean> => {
              const closing = Array.isArray(tabs) ? tabs : [tabs]
              for (const group of [sourceGroup, otherGroup]) {
                const frontClosed =
                  group.activeTab !== undefined &&
                  closing.includes(group.activeTab)
                group.tabs = group.tabs.filter((tab) => !closing.includes(tab))
                if (!frontClosed) continue
                group.activeTab = group.tabs.at(-1)
                const closedEditorHadKeyboard = closing.some(
                  (tab) =>
                    tab.input instanceof TabInputText &&
                    activeEditor?.document.uri.toString() ===
                      tab.input.uri.toString(),
                )
                if (closedEditorHadKeyboard) {
                  activeEditor = group.activeTab
                    ? learnerEditors.get(group.activeTab)
                    : undefined
                  for (const listener of focusListeners) listener()
                }
              }
              for (const tab of closing)
                closedTabs.push(
                  tab.input instanceof TabInputText
                    ? tab.input.uri.toString()
                    : tab.input.viewType,
                )
              recentlyClosedTabs.push(...closing)
              fireTabChange({ closed: closing })
              return true
            },
            onDidChangeTabs(callback: (event: NativeTabChange) => void) {
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
            // A show the editor refuses puts no tab on screen and changes no focus.
            const refusal = sourceDisplayRefusal
            sourceDisplayRefusal = undefined
            if (refusal) throw refusal
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
              // Both editors bring the tab of a document already open in the target group to the front instead of opening another one: a resource has one editor input (VS Code 1.140.0 `workbench.desktop.main.js` 990:44441; Cursor 3.23.12 17388:52352), and the group's model finds an open editor of that input before it adds one (VS Code 705:21932, 705:28547; Cursor 17264:10648, 17264:17400), Cycle 0046 row 675.
              openTab = sourceGroup.tabs.find(
                (value) =>
                  value.input instanceof TabInputText &&
                  value.input.uri.toString() === document.uri.toString(),
              ),
              tab = openTab ?? { input: new TabInputText(document.uri) }
            const frontBefore = sourceGroup.activeTab
            if (!openTab) sourceGroup.tabs.push(tab)
            sourceGroup.activeTab = tab
            // The editor opened the copy's tab, the learner's tab came to the front again before the answer, and the extension host refuses the editor it no longer knows (`rejectNextSourceDisplayAfterOpeningItsTab`).
            if (refusesSourceDisplayAfterOpening) {
              refusesSourceDisplayAfterOpening = false
              fireTabChange(openTab ? { changed: [tab] } : { opened: [tab] })
              sourceGroup.activeTab = frontBefore
              if (frontBefore) fireTabChange({ changed: [frontBefore] })
              throw new Error(
                `Could NOT open editor for "${document.uri.toString()}" because another editor opened in the meantime.`,
              )
            }
            // A foreground native source display activates its main group before its text-editor receipt; Cursor keeps naming its chat part's group instead, since a tab that opens in the main editor's active group is no group activation for its tab model (Cursor 3.23.12 17269:31013).
            if (
              !options?.preserveFocus &&
              (!nativeCitationActivation ||
                nativeCitationOrder === 'group-first') &&
              !namesChatPartGroup()
            )
              activeGroup = sourceGroup
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
              fireTabChange(openTab ? { changed: [tab] } : { opened: [tab] })
              await pauseAt('target tab')
              activeEditor = undefined
              for (const listener of focusListeners) listener()
              await pauseAt('text gap')
              // VS Code can clear the old editor before selecting the already prepared source tab's group.
              if (nativeCitationOrder === 'editor-first') {
                activeGroup = sourceGroup
                for (const listener of groupListeners) listener()
              }
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
                  fireTabChange({ changed: [wikiTab] })
                  for (const listener of groupListeners) listener()
                  // The recording Summary keeps keyboard while Wiki replaces its selected source tab, then the editor disappears.
                  if (retireWikiTextEditor) {
                    activeEditor = undefined
                    for (const listener of focusListeners) listener()
                  }
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
                // The panel's own onDidDispose fires first, in the extension host, which only then asks the editor to dispose the pane; its tab leaves the tab model later, with the editor's tab-close event (row 676).
                queueMicrotask(() => closeDisposedPaneTab(wikiTab))
              },
              onDidDispose(callback: () => void): void {
                disposed = callback
              },
              webview: {
                html: '',
                postMessage: async (message: RepositoryViewMessage) => {
                  publishedMessages.push(message)
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
              fireTabChange({ opened: [studyTab] })
              for (const listener of groupListeners) listener()
            }
            closeStudyPanel = (): void => {
              // Close removes the Study tab, so its group selects the Wiki tab again before the focus command lands.
              const isStudyTab = (tab: NativeTab): boolean =>
                tab.input instanceof TabInputWebview &&
                tab.input.viewType === 'mainThreadWebview-codebook.studyContext'
              const studyTabs = otherGroup.tabs.filter(isStudyTab)
              otherGroup.tabs = otherGroup.tabs.filter(
                (tab) => !isStudyTab(tab),
              )
              otherGroup.activeTab = wikiTab
              fireTabChange({ closed: studyTabs })
              activateWikiPanel()
            }
            clickWikiTab = (): void => {
              // The learner's click selects the Wiki's tab in its group, in front of the Study's, and the Wiki takes the keyboard.
              otherGroup.activeTab = wikiTab
              fireTabChange({ changed: [wikiTab] })
              activateWikiPanel()
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
            blurWikiPanel = (): void => {
              // Native view-state notifications require an actual state change.
              if (!panel.active) return
              panel.active = false
              viewStateChanged()
            }
            panels.add(panel)
            return panel
          },
        },
      },
    },
  )
  /** The onDidChangeTabs listeners a reader registers while it is made, for its own lifetime (row 677: it forgets a copy whose last tab closed); {@link focusListenerCount} leaves them out, since it counts the receipts a navigation takes and must give back. */
  const readerLifetimeListeners = new Set<(event: NativeTabChange) => void>()
  /** Makes a reader on the fake editor and notes the tab listeners its construction registered ({@link readerLifetimeListeners}). @example const fresh = createReader() */
  const createReader = () => {
    const listenersBefore = new Set(tabListeners)
    const made = createReaderOnFakeEditor()
    for (const listener of tabListeners)
      if (!listenersBefore.has(listener)) readerLifetimeListeners.add(listener)
    return made
  }
  const createReaderOnFakeEditor = () =>
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
        const answer = keyboardReturnAnswer
        if (answer === undefined) return undefined
        // The arrangement's return, asked after the Wiki is shown: a chat tab that gets its keyboard back has it, and no text editor is active.
        return async () => {
          keyboardReturns++
          duringKeyboardReturn?.()
          if (answer) {
            activeEditor = undefined
            for (const listener of focusListeners) listener()
          }
          return answer
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
    publishedMessages,
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
    /**
     * Makes the arrangement answer a keyboard return the way {@link StudyWorkspace.arrangeRepository} does after its measurement borrowed the keyboard from Cursor's chat tab: `true` gives the chat its keyboard back, `false` says that it stays where the measurement left it.
     * @param answer - The return's answer.
     * @param during - What happens in the editor while the return runs, before it answers: a learner's click into a file, for the reader's check of a newer choice (Cycle 0046 T5).
     * @example harness.answerKeyboardReturn(false, () => harness.focusUnrelatedDraft('notes.ts'))
     */
    answerKeyboardReturn(answer: boolean, during?: () => void): void {
      keyboardReturnAnswer = answer
      duringKeyboardReturn = during
    },
    keyboardReturns: () => keyboardReturns,
    notices,
    useNativeCitationActivation(
      order: 'group-first' | 'editor-first' = 'group-first',
    ): void {
      nativeCitationActivation = true
      nativeCitationOrder = order
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
    /**
     * Makes the editor refuse the next `showTextDocument`, once, before it opens or activates any tab, as it does for a document it cannot show: the call rejects with the given error.
     * @param message - The refusal's message.
     * @example harness.rejectNextSourceDisplay('Could not open the document.')
     */
    rejectNextSourceDisplay(message: string): void {
      sourceDisplayRefusal = new Error(message)
    },
    /**
     * Makes the next `showTextDocument` open the document's tab in the first group and then reject, once, as both editors' extension hosts do when the editor they opened is no longer the current one by the time the main side answers (Cursor's server `extensionHostProcess.js` 201:91131, VS Code 1.140.0 295:85754: "Could NOT open editor for … because another editor opened in the meantime."): the learner switched back to the tab in front before it meanwhile, and the document's tab stays in the group behind that tab (Cycle 0046 row 701).
     * @example harness.rejectNextSourceDisplayAfterOpeningItsTab() // the order.ts copy stays in the first group, behind login-form.tsx
     */
    rejectNextSourceDisplayAfterOpeningItsTab(): void {
      refusesSourceDisplayAfterOpening = true
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
    /** Counts the editor listeners a navigation's focus receipts hold, without each reader's own lifetime tab listener ({@link readerLifetimeListeners}). @example harness.focusListenerCount() // => 0 once an open completed */
    focusListenerCount: () =>
      focusListeners.size +
      windowFocusListeners.size +
      selectionListeners.size +
      [...tabListeners].filter(
        (listener) => !readerLifetimeListeners.has(listener),
      ).length +
      groupListeners.size,
    /** Counts the lifetime tab listeners of the readers that are not disposed yet ({@link readerLifetimeListeners}). @example harness.readerTabListenerCount() // => 1 for the harness's own reader */
    readerTabListenerCount: () =>
      [...tabListeners].filter((listener) =>
        readerLifetimeListeners.has(listener),
      ).length,
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
      const unrelated = {
        input: new TabInputText(Uri.file(join(root, 'unrelated-draft.txt'))),
      }
      sourceGroup.activeTab = unrelated
      fireTabChange({ changed: [unrelated] })
      activeEditor = editor
      sourceGroup.activeTab = citation
      fireTabChange({ changed: citation ? [citation] : [] })
    },
    switchTabGroup(toSource = false): void {
      activeGroup = toSource ? sourceGroup : otherGroup
      for (const listener of groupListeners) listener()
    },
    focusChat(): void {
      activeEditor = undefined
      // Side-view chat leaves the last Wiki main group selected while its input owns keyboard.
      activeGroup = otherGroup
      blurWikiPanel()
      for (const listener of focusListeners) listener()
    },
    /**
     * Gives Cursor's Agent chat, a tab of its own editor part at column 3, the keyboard: the editor names the chat's group and no text editor is active. A citation shown with the keyboard in the first group afterwards is reported as the active text editor while the editor goes on naming the chat's group (row 660).
     * @example harness.focusCursorChatPart()
     */
    focusCursorChatPart(): void {
      const chatTab = { input: new TabInputWebview('cursor.composer') }
      chatPartGroup ??= { viewColumn: 3, tabs: [chatTab], activeTab: chatTab }
      activeEditor = undefined
      activeGroup = chatPartGroup
      blurWikiPanel()
      for (const listener of groupListeners) listener()
      for (const listener of focusListeners) listener()
    },
    /** Names the group the editor names as active, by its view column. @example harness.namedColumn() // => 3 while Cursor names its chat part's group */
    namedColumn: (): number => activeGroup.viewColumn,
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
    /**
     * Models the native end of a completed registered Study Close over the Wiki: the Study tab leaves the Wiki's group, the Wiki tab is selected again, and Close's group-focus command gives keyboard to the recreated Wiki document.
     *
     * Called by the Cycle 0046 row 444 regressions after {@link focusStudy}; the recreated document then reports `ready` and renders the old article.
     *
     * @example
     * ```ts
     * harness.focusStudy()
     * harness.closeStudy()
     * ```
     */
    closeStudy(): void {
      closeStudyPanel()
    },
    /**
     * Models the learner's click on the Wiki's tab while the Study's tab stands in front of the same group ({@link focusStudy}): the Wiki's tab comes to the front of its group, the editor reports that tab change, and the Wiki becomes the active panel with the keyboard (Cycle 0046 R6).
     * @example
     * ```ts
     * harness.focusStudy()
     * harness.clickWikiTab()
     * ```
     */
    clickWikiTab(): void {
      clickWikiTab()
    },
    /** Models the selected Wiki tab callbacks for Return regressions; recording Return also retires that group's text editor. @param retiresEditor - Emits the observed text-editor loss after tab selection. @example harness.useNativeWikiSelection(true) */
    useNativeWikiSelection(retiresEditor = false): void {
      nativeWikiSelection = true
      retireWikiTextEditor = retiresEditor
    },
    /** Places the recording's captured source behind its same-group Wiki before a Summary Return; called by the native-retirement regressions. @example harness.focusRecordingSource() */
    focusRecordingSource(): void {
      const document = {
          uri: new Uri('codebook-source', 'saved', '/src/module.ts'),
          version: 1,
          getText: () => 'export const price = 24;',
        },
        tab = { input: new TabInputText(document.uri) }
      activeEditor = {
        document,
        viewColumn: 2,
        selections: [
          { anchor: new Position(0, 0), active: new Position(0, 0) },
        ],
      }
      otherGroup.tabs.push(tab)
      otherGroup.activeTab = tab
      activeGroup = otherGroup
      for (const listener of focusListeners) listener()
      fireTabChange({ opened: [tab] })
    },
    hideWiki(): void {
      hideWikiPanel()
    },
    focusUnrelatedDraft(filename = 'unrelated-draft.txt'): NativeEditor {
      const document = {
          uri: Uri.file(join(root, filename)),
          version: 1,
          getText: () => 'Keep my draft.',
        },
        tab = { input: new TabInputText(document.uri) },
        editor = {
          document,
          viewColumn: 1,
          selections: [
            { anchor: new Position(0, 0), active: new Position(0, 0) },
          ],
        }
      activeEditor = editor
      learnerEditors.set(tab, editor)
      sourceGroup.tabs.push(tab)
      sourceGroup.activeTab = tab
      for (const listener of focusListeners) listener()
      return editor
    },
    /** Names the first group's tabs in their order as `scheme:file name`, and its front tab, as the learner sees them. @example harness.firstGroupTabs() // => { tabs: ['file:login-form.tsx'], front: 'file:login-form.tsx' } */
    firstGroupTabs: () => namedGroupTabs(sourceGroup),
    /** Names the Wiki group's tabs in their order as `scheme:file name` or view type, and its front tab, as the learner sees them. @example harness.wikiGroupTabs() // => { tabs: ['mainThreadWebview-codebook.repositoryWiki'], front: 'mainThreadWebview-codebook.repositoryWiki' } */
    wikiGroupTabs: () => namedGroupTabs(otherGroup),
    /** Pins the cited-source tab in front of the first group, as the learner's Pin Editor does. @example harness.pinFrontSourceTab() */
    pinFrontSourceTab(): void {
      assert.ok(sourceGroup.activeTab)
      sourceGroup.activeTab.isPinned = true
    },
    /**
     * Drags the cited-source tab in front of the first group into the Wiki's group and clicks into its text, as the learner does to read that citation beside the Wiki: the copy is the Wiki group's front tab and has the keyboard, and the first group shows its tab before.
     * @example harness.moveFrontSourceTabToWikiGroup() // the module.ts copy is in front of the Wiki's group with the keyboard
     */
    moveFrontSourceTabToWikiGroup(): void {
      const copy = sourceGroup.activeTab
      assert.ok(copy && copy.input instanceof TabInputText)
      sourceGroup.tabs = sourceGroup.tabs.filter((tab) => tab !== copy)
      sourceGroup.activeTab = sourceGroup.tabs.at(-1)
      otherGroup.tabs.push(copy)
      otherGroup.activeTab = copy
      activeGroup = otherGroup
      blurWikiPanel()
      const text = 'export const price = 24;\n'
      activeEditor = {
        document: { uri: copy.input.uri, version: 1, getText: () => text },
        viewColumn: 2,
        selections: [
          { anchor: new Position(0, 0), active: new Position(0, 0) },
        ],
      }
      // A move to another group opens the tab there before it closes it in its own group (VS Code 1.140.0 `workbench.desktop.main.js` 1106:78557; Cursor 3.23.12 17501:40995).
      fireTabChange({ opened: [copy] })
      fireTabChange({ closed: [copy] })
      for (const listener of groupListeners) listener()
      for (const listener of focusListeners) listener()
    },
    /**
     * Closes the tab in front of the first group by hand, as the learner's click on its close button does: the group brings its most recently active other tab to the front with that tab's editor and the keyboard, and the editor reports the closed tab; the reader asked for nothing, so {@link closedTabs} records nothing.
     * @example harness.closeFrontSourceTabByHand() // the module.ts copy closed; the learner's login-form.tsx is in front again
     */
    closeFrontSourceTabByHand(): void {
      const closing = sourceGroup.activeTab
      assert.ok(closing)
      sourceGroup.tabs = sourceGroup.tabs.filter((tab) => tab !== closing)
      sourceGroup.activeTab = sourceGroup.tabs.at(-1)
      recentlyClosedTabs.push(closing)
      activeEditor = sourceGroup.activeTab
        ? learnerEditors.get(sourceGroup.activeTab)
        : undefined
      fireTabChange({ closed: [closing] })
      for (const listener of focusListeners) listener()
    },
    /**
     * Runs Reopen Closed Editor in the first group: the editor opens the resource of the tab closed last again, a new tab with the same URI, in front of the group and with the keyboard (VS Code 1.140.0 `workbench.desktop.main.js` 1598:87610; Cursor 3.23.12 18385:80118), and reports the opened tab.
     * @example harness.reopenClosedEditor() // the module.ts copy is in front of the first group again
     */
    reopenClosedEditor(): void {
      const closed = recentlyClosedTabs.pop()
      assert.ok(closed && closed.input instanceof TabInputText)
      const uri = closed.input.uri,
        // The reader's content provider gives the reopened copy the text it gave the closed one.
        text =
          openedSources.find((value) => value.uri.toString() === uri.toString())
            ?.text ?? '',
        reopened = { input: new TabInputText(uri) }
      sourceGroup.tabs.push(reopened)
      sourceGroup.activeTab = reopened
      activeEditor = {
        document: { uri, version: 1, getText: () => text },
        viewColumn: 1,
        selections: [
          { anchor: new Position(0, 0), active: new Position(0, 0) },
        ],
      }
      fireTabChange({ opened: [reopened] })
      for (const listener of focusListeners) listener()
    },
    /** Closes the Wiki's tab by hand, as the learner's click on its close button does: the editor disposes the panel. @example harness.closeWikiTabByHand() */
    closeWikiTabByHand(): void {
      const [panel] = panels
      assert.ok(panel)
      Reflect.apply(Reflect.get(panel, 'dispose'), panel, [])
    },
    /**
     * Waits until the tab-close events the editor sends after a Wiki panel's disposal have reached the extension ({@link closeDisposedPaneTab}), as they have before the learner's or an agent's next action; called by the tests that read the Wiki's group after a close, or act again right after one.
     * @example harness.reader.close(); await harness.deliverTabEvents() // the Wiki's tab is gone from its group
     */
    deliverTabEvents: (): Promise<void> =>
      new Promise((resolve) => setImmediate(resolve)),
    closedTabs,
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

// Value: protects=the learner's keyboard when an agent opens an article through codebook_open_book while no Wiki is open: in VS Code the chat view's input keeps it (the learner's file stays the active text editor there, which is why Codebook cannot tell the chat from the file), and the Wiki is created and shown beside it without the keyboard; fails_when=the cold entry creates the Wiki with the keyboard and its ready handoff reveals it with the focus, so the keyboard leaves the chat without a word; why_new=Cycle 0046 finding on codebook_open_book (the cold agent entry, beside row 612's rule); seam=readerHarness with focusChat (a view's input) and focusUnrelatedDraft (the active text editor while the chat view types), openFromAgent, the created panels' focus and the reveals' preserveFocus
for (const input of ['chat', 'file'] as const)
  test(`an agent opening an article while no Wiki is open shows the Wiki without taking the learner's ${input} input`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    if (input === 'chat') harness.focusChat()
    else harness.focusUnrelatedDraft()
    const originalInput = harness.focusedSource()

    // Act
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })

    // Assert: the Wiki was created in column 2 and shown there by its creation, no reveal gave it the focus, and the learner's input is the one before.
    assert.equal(harness.focusedSource(), originalInput)
    assert.deepEqual(harness.panelColumns, [2])
    assert.deepEqual(harness.revealFocus, [])
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
    assert.equal(harness.reader.inspect().view.loading, false)
  })

// Value: protects=the learner's keyboard when an agent opens an article through codebook_open_book in a window where neither the Wiki nor a Study arrangement is open: StudyWorkspace.arrangeRepository's cold layout keeps a receipt of the learner's focus, and the entry handed that receipt to the cited source and then activated the Wiki, so VS Code's chat view input (and a file the learner typed in) lost the keyboard without a word; fails_when=an agent's cold entry still gives the cited source the keyboard after the cold layout, or activates the Wiki; why_new=Cycle 0046 row 620 (054da12f's test arranged without the cold receipt the real cold layout keeps); seam=readerHarness with useColdLayout (the cold branch's retainCurrentFocus), focusChat (a view's input) and focusUnrelatedDraft, openFromAgent, the focused editor, the source displays and the reveals' preserveFocus
for (const input of ['chat', 'file'] as const)
  test(`an agent opening an article where no Wiki and no Study arrangement is open keeps the learner's ${input} input`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.useColdLayout()
    if (input === 'chat') harness.focusChat()
    else harness.focusUnrelatedDraft()
    const originalInput = harness.focusedSource()

    // Act
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })

    // Assert: the cited source was shown once without the keyboard, the Wiki was created in column 2 without it, no reveal activated it, and nothing was told.
    assert.equal(harness.focusedSource(), originalInput)
    assert.equal(harness.shown.length, 1)
    assert.deepEqual(harness.panelColumns, [2])
    assert.deepEqual(harness.revealFocus, [])
    assert.deepEqual(harness.notices, [])
    assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
    assert.equal(harness.reader.inspect().view.loading, false)
  })

// Value: protects=Cursor's chat tab keyboard when an agent opens an article through codebook_open_book while no Wiki is open and the cold layout's measurement had to give the cited source the keyboard (the chat tab of Cursor's chat editor part had it, and the first group showed nothing the measurement could focus); fails_when=the entry activates the Wiki over the borrowed source and never asks the arrangement to give the chat tab its keyboard back; why_new=Cycle 0046 row 620; seam=readerHarness with useColdLayout, requireSourceFocus (the measurement's citation borrow), answerKeyboardReturn(true) (StudyWorkspace.arrangeRepository's give-back to the chat tab), focusChat, openFromAgent
test("an agent's cold Wiki open whose layout borrowed the cited source's focus gives Cursor's chat tab its keyboard back", async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.requireSourceFocus()
  harness.answerKeyboardReturn(true)
  harness.focusChat()

  // Act
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })

  // Assert: the Wiki was shown without the keyboard, and the arrangement was asked once, after it, to give the chat its keyboard back.
  assert.equal(harness.keyboardReturns(), 1)
  assert.equal(harness.focusedSource(), undefined)
  assert.deepEqual(harness.panelColumns, [2])
  assert.deepEqual(harness.revealFocus, [])
  assert.deepEqual(harness.notices, [])
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
})

// Value: protects=the learner's knowledge of where the keyboard is when an agent's cold Wiki open (codebook_open_book) borrowed it for the layout and the arrangement cannot give it back (the chat tab moved, the host has no command for its chat): the keyboard goes to the Wiki, not to a file, and the learner is told once in the editor session; fails_when=the cited source keeps the keyboard silently, the Wiki is not activated, or the sentence is told again at the next such open; why_new=Cycle 0046 row 620; seam=readerHarness with useColdLayout, requireSourceFocus, answerKeyboardReturn(false), the fake window's information notices, Close between the two opens
test("an agent's cold Wiki open that cannot give back the keyboard its layout borrowed gives it to the Wiki and says so once", async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.requireSourceFocus()
  harness.answerKeyboardReturn(false)
  harness.focusChat()
  const article = {
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  }

  // Act: the editor's close of the first Wiki's tab reaches the extension before the learner goes back to the chat.
  await harness.reader.openFromAgent(article)
  harness.reader.close()
  await harness.deliverTabEvents()
  harness.focusChat()
  await harness.reader.openFromAgent(article)

  // Assert: each open asked the arrangement once and then activated its Wiki; the sentence was told for the first open only.
  assert.equal(harness.keyboardReturns(), 2)
  assert.deepEqual(harness.panelColumns, [2, 2])
  assert.deepEqual(harness.revealFocus, [false, false])
  assert.deepEqual(harness.notices, [
    'Codebook opened the Repository Wiki an agent asked for, and the Wiki has the keyboard now: arranging the Wiki beside its cited source needed the focus of the first editor group, and Codebook could not give the keyboard back to where you were typing. Click where you want to type.',
  ])
})

// Value: protects=the learner's newer choice during an agent's cold Wiki open (codebook_open_book) whose arrangement cannot give back the keyboard its layout borrowed: while the give-back runs, the learner clicks into notes.ts; that file keeps the keyboard, no reveal takes the focus to the Wiki, and the learner is told nothing; fails_when=returnAgentEntryKeyboard does not check the focus it retained before the give-back (unchanged.assertRetained), so it answers 'kept', the Wiki is revealed with the focus over the learner's file and the sentence that the Wiki has the keyboard is told; why_new=Cycle 0046 T5 (/ship's pre-landing review: the 'newer' answer had no test); seam=readerHarness with useColdLayout, requireSourceFocus, answerKeyboardReturn(false, during) (the new hook that runs inside the arrangement's give-back), focusUnrelatedDraft, focusChat, openFromAgent, revealFocus and the fake window's information notices; no_claim=the native order of a click that lands while the editor answers the give-back's commands
test("an agent's cold Wiki open whose give-back fails while the learner clicks into a file leaves the keyboard in that file, reveals no Wiki with the focus and tells nothing", async (context) => {
  // Arrange: as above; while the arrangement's give-back runs, the learner clicks into notes.ts in the first group, and the give-back then answers that the keyboard stays where the measurement left it.
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.requireSourceFocus()
  harness.answerKeyboardReturn(false, () => {
    harness.focusUnrelatedDraft('notes.ts')
  })
  harness.focusChat()

  // Act
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })

  // Assert: the arrangement was asked once; notes.ts keeps the keyboard, no reveal took the focus, and nothing was told.
  assert.deepEqual(
    {
      keyboardReturns: harness.keyboardReturns(),
      focusedFile: harness.focusedSource()?.document.uri.path.split('/').at(-1),
      revealFocus: harness.revealFocus,
      notices: harness.notices,
    },
    {
      keyboardReturns: 1,
      focusedFile: 'notes.ts',
      revealFocus: [],
      notices: [],
    },
  )
})

// Value: protects=the learner's own front tab in the first group after an agent's Wiki open (codebook_open_book while no Wiki and no Study arrangement is open) is closed with Close Repository Wiki: the read-only cited-source tab the reader showed in front of the learner's file goes with the Wiki, the learner's file is in front again, and the chat keeps the keyboard; fails_when=RepositoryReader.close disposes only the Wiki panel, so a Codebook tab the learner never chose keeps covering the learner's file after the Wiki is gone (C57 2c in VS Code 1.140.0: `codebook-repository-source://…/login-form.tsx` in front of the learner's app/ui/login-form.tsx); why_new=Cycle 0046 row 641; seam=readerHarness with useColdLayout, focusUnrelatedDraft (the learner's login-form.tsx in front of the first group), focusChat, openFromAgent, close, the fake tabGroups.close, firstGroupTabs and focusedSource
test('an agent’s Wiki open closed with Close Repository Wiki leaves no cited-source tab and brings the learner’s file in the first group to the front again', async (context) => {
  // Arrange: the learner's login-form.tsx is in front of the first group, and the learner typed the request into the chat; the agent opened the article, whose cited source the reader showed in front of the learner's file.
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.focusUnrelatedDraft('login-form.tsx')
  harness.focusChat()
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })
  const whileWikiOpen = harness.firstGroupTabs()

  // Act
  harness.reader.close()

  // Assert: the cited source left with the Wiki, the learner's file is in front again, and the chat keeps the keyboard.
  assert.deepEqual(
    {
      whileWikiOpen,
      afterClose: harness.firstGroupTabs(),
      wikiPanels: harness.panels.size,
      keyboardInAnEditor: harness.focusedSource() !== undefined,
    },
    {
      whileWikiOpen: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:order.ts'],
        front: 'codebook-repository-source:order.ts',
      },
      afterClose: {
        tabs: ['file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
      wikiPanels: 0,
      keyboardInAnEditor: false,
    },
  )
})

// Value: protects=the learner's own file and caret after the learner's own Open Repository Wiki ends with the Wiki tab closed by hand: the cited source the reader showed leaves with the Wiki, and the learner's file is in front of the first group again with its caret; fails_when=the Wiki's own close (its panel's disposal) leaves the read-only cited source in front of the learner's file, as Close Repository Wiki did; why_new=Cycle 0046 row 641 (the Wiki's other close); seam=readerHarness, focusUnrelatedDraft with a caret on line 3 (selectSource), open without forAgent, closeWikiTabByHand (the panel's disposal), the fake tabGroups.close and firstGroupTabs
test('the learner’s own Wiki whose tab the learner closes by hand leaves no cited-source tab and brings the learner’s file in the first group to the front again with its caret', async (context) => {
  // Arrange: the learner works in login-form.tsx with the caret on line 3, then opens the Repository Wiki, whose cited source comes to the front of the first group.
  const harness = await readerHarness(context)
  const draft = harness.focusUnrelatedDraft('login-form.tsx')
  harness.selectSource(2, 4)
  await harness.reader.open(harness.selection)
  const whileWikiOpen = harness.firstGroupTabs()

  // Act
  harness.closeWikiTabByHand()

  // Assert: the cited source left with the Wiki; the learner's file is in front again with its caret on line 3.
  assert.deepEqual(
    {
      whileWikiOpen,
      afterClose: harness.firstGroupTabs(),
      caret: draft.selections.map((selection) => [
        selection.active.line,
        selection.active.character,
      ]),
    },
    {
      whileWikiOpen: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      afterClose: {
        tabs: ['file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
      caret: [[2, 4]],
    },
  )
})

// Value: protects=the fidelity of the reader harness's tab model, on which every Wiki-group verdict of this file rests: a Wiki panel the reader disposes leaves its group with the editor's tab-close event, as both editors close a disposed pane's editor; fails_when=the fake keeps the disposed Wiki's tab in its group, so a later verdict counts a tab no editor still shows (a group the reader takes for one with another tab, a second Wiki tab beside a new Wiki); why_new=Cycle 0046 row 676 (the 652 and 662 forks' finding 2); seam=readerHarness, open, close (Close Repository Wiki), deliverTabEvents and wikiGroupTabs
test('a Repository Wiki closed with Close Repository Wiki leaves its group, as the editors close a disposed pane', async (context) => {
  // Arrange: the learner's Repository Wiki is open in the second group.
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  const whileWikiOpen = harness.wikiGroupTabs()

  // Act
  harness.reader.close()
  await harness.deliverTabEvents()

  // Assert: the Wiki's tab is gone from its group, and no panel is left.
  assert.deepEqual(
    {
      whileWikiOpen,
      afterClose: harness.wikiGroupTabs(),
      wikiPanels: harness.panels.size,
    },
    {
      whileWikiOpen: {
        tabs: ['mainThreadWebview-codebook.repositoryWiki'],
        front: 'mainThreadWebview-codebook.repositoryWiki',
      },
      afterClose: { tabs: [], front: undefined },
      wikiPanels: 0,
    },
  )
})

// Value: protects=a cited-source tab the learner pinned: the learner chose to keep it, so it stays when the Wiki closes; fails_when=row 641's retirement also closes a pinned cited source and unpins the learner's choice; why_new=Cycle 0046 row 641 guard; seam=readerHarness, focusUnrelatedDraft, open, pinFrontSourceTab (the learner's Pin Editor), close, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source tab the learner pinned stays in front of the first group when the Wiki closes', async (context) => {
  // Arrange: the learner opened the Repository Wiki over login-form.tsx and pinned the cited source.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.pinFrontSourceTab()

  // Act
  harness.reader.close()

  // Assert: nothing was closed; the pinned cited source is still in front.
  assert.deepEqual(
    { afterClose: harness.firstGroupTabs(), closedTabs: harness.closedTabs },
    {
      afterClose: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=the learner's arrangement of groups when the Wiki closes over a first group that shows only its cited source: that group keeps the tab, since closing it would remove the group under the editor's closeEmptyGroups; fails_when=row 641's retirement empties a group and changes the learner's layout; why_new=Cycle 0046 row 641 guard; seam=readerHarness (an empty first group), open, close, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source tab that is the only tab of its group stays when the Wiki closes', async (context) => {
  // Arrange: the first group was empty, so the Repository Wiki's cited source is its only tab.
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)

  // Act
  harness.reader.close()

  // Assert: nothing was closed; the group still shows the cited source.
  assert.deepEqual(
    { afterClose: harness.firstGroupTabs(), closedTabs: harness.closedTabs },
    {
      afterClose: {
        tabs: ['codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=the learner's first group while the Wiki stays open and the learner follows one citation after another: the copy of the citation before leaves when the next one is shown, so one read-only copy stands in front of the learner's file; fails_when=every citation followed adds another `codebook-repository-source` tab to the first group and none ever leaves while the Wiki is open; why_new=Cycle 0046 row 652; seam=readerHarness, focusUnrelatedDraft (the learner's login-form.tsx in the first group), open of the module article's first and second citations, firstGroupTabs and the fake tabGroups.close's record
test('following a second citation in the open Wiki leaves one cited-source copy in front of the learner’s file in the first group', async (context) => {
  // Arrange: the learner works in login-form.tsx and opens the Repository Wiki on the module article's first citation, module.ts.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  const whileFirstCitation = harness.firstGroupTabs()

  // Act: the learner follows the article's second citation, order.ts.
  await harness.reader.open({ ...harness.selection, anchorIndex: 1 })

  // Assert: the module.ts copy left; the order.ts copy is the only one, in front of the learner's file.
  assert.deepEqual(
    {
      whileFirstCitation,
      afterSecondCitation: harness.firstGroupTabs(),
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      whileFirstCitation: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      afterSecondCitation: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:order.ts'],
        front: 'codebook-repository-source:order.ts',
      },
      closedTabs: ['module.ts'],
    },
  )
})

// Value: protects=the fidelity of the reader harness's showTextDocument, on which every cited-source tab verdict of this file rests: showing a document that is already open in the target group brings its tab to the front, as both editors do, so the learner's first group keeps one copy of the citation on screen; fails_when=the fake adds a second tab of the same URI, which neither editor does, so a test can pass or fail on a copy no editor makes; why_new=Cycle 0046 row 675 (the 652 and 662 forks' finding 1); seam=readerHarness, focusUnrelatedDraft, open of the same citation twice, firstGroupTabs, the fake's record of shown documents and of closed tabs
test('following the citation on screen again in the open Wiki brings its one copy to the front of the first group, as the editors do', async (context) => {
  // Arrange: the learner works in login-form.tsx and opens the Repository Wiki on the module article's first citation, module.ts.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)

  // Act: the learner follows the same citation again.
  await harness.reader.open(harness.selection)

  // Assert: the reader showed module.ts twice, and the first group holds one copy of it, in front of the learner's file; nothing was closed.
  assert.deepEqual(
    {
      shownCitations: harness.shown.map((value) => basename(value.uri.path)),
      firstGroup: harness.firstGroupTabs(),
      closedTabs: harness.closedTabs,
    },
    {
      shownCitations: ['module.ts', 'module.ts'],
      firstGroup: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=the learner's first group when an agent's quiet article change waited for the learner's selection of the Wiki (the learner's file had the keyboard): the copy of the citation before leaves once the waiting citation is shown; fails_when=the deferred citation's display adds its copy beside the earlier one and the earlier copy stays; why_new=Cycle 0046 row 652 (the deferred citation's display is the other place a copy is shown); seam=readerHarness, open, focusUnrelatedDraft, openFromAgent (deferred preview), focusWiki, the reader's listener count as the end of the handoff, firstGroupTabs
test('the citation an agent’s article change shows once the learner selects the Wiki replaces the copy of the citation before in the first group', async (context) => {
  // Arrange: the learner's Wiki shows module.ts; the learner then types in login-form.tsx, and an agent opens the order article, whose citation waits for the Wiki's selection.
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })
  const whileWaiting = harness.firstGroupTabs(),
    shownBefore = harness.shown.length

  // Act: the learner selects the Wiki.
  harness.focusWiki()
  await waitUntil(
    () =>
      harness.shown.length === shownBefore + 1 &&
      harness.focusListenerCount() === 0,
    'the deferred citation shown and its handoff completed',
  )

  // Assert: the order.ts copy is in front of the learner's file, and the module.ts copy left.
  assert.deepEqual(
    { whileWaiting, afterSelection: harness.firstGroupTabs() },
    {
      whileWaiting: {
        tabs: ['codebook-repository-source:module.ts', 'file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
      afterSelection: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:order.ts'],
        front: 'codebook-repository-source:order.ts',
      },
    },
  )
})

// Value: protects=a cited-source copy the learner pinned while following citations: the learner chose to keep it, so the next citation's copy comes beside it and nothing is closed; fails_when=row 652's retirement of the citation before also closes a pinned copy; why_new=Cycle 0046 row 652 guard; seam=readerHarness, focusUnrelatedDraft, open, pinFrontSourceTab, open of the second citation, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source copy the learner pinned stays when the learner follows the next citation', async (context) => {
  // Arrange: the learner pinned the module.ts copy of the Wiki's first citation.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.pinFrontSourceTab()

  // Act
  await harness.reader.open({ ...harness.selection, anchorIndex: 1 })

  // Assert: both copies stand, and nothing was closed.
  assert.deepEqual(
    {
      afterSecondCitation: harness.firstGroupTabs(),
      closedTabs: harness.closedTabs,
    },
    {
      afterSecondCitation: {
        tabs: [
          'file:login-form.tsx',
          'codebook-repository-source:module.ts',
          'codebook-repository-source:order.ts',
        ],
        front: 'codebook-repository-source:order.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=the learner's keyboard in a cited-source copy the learner moved beside the Wiki and reads in: an agent's next article shows its citation in the first group, and the copy the learner works in stays with the keyboard; fails_when=row 652's retirement of the citation before closes the copy that has the keyboard, so the editor moves the learner's keyboard; why_new=Cycle 0046 row 652 guard; seam=readerHarness, open, moveFrontSourceTabToWikiGroup (the learner's drag and click), openFromAgent, wikiGroupTabs, focusedSource and the fake tabGroups.close's record
test('a cited-source copy the learner moved beside the Wiki and types in keeps its tab and the keyboard when an agent opens another article', async (context) => {
  // Arrange: the learner's Wiki shows module.ts; the learner drags that copy into the Wiki's group and clicks into it.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.moveFrontSourceTabToWikiGroup()

  // Act: an agent opens the order article.
  await harness.reader.openFromAgent({
    instanceId: '11111111-1111-4111-8111-111111111111',
    ...harness.selection,
    nodeId: 'order',
  })

  // Assert: the module.ts copy is still in front of the Wiki's group with the keyboard; the order.ts copy is in the first group.
  assert.deepEqual(
    {
      firstGroup: harness.firstGroupTabs(),
      wikiGroup: harness.wikiGroupTabs(),
      keyboard: harness.focusedSource()?.document.uri.path,
      closedTabs: harness.closedTabs,
    },
    {
      firstGroup: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:order.ts'],
        front: 'codebook-repository-source:order.ts',
      },
      wikiGroup: {
        tabs: [
          'mainThreadWebview-codebook.repositoryWiki',
          'codebook-repository-source:module.ts',
        ],
        front: 'codebook-repository-source:module.ts',
      },
      keyboard: '/architecture/1/module/0/module.ts',
      closedTabs: [],
    },
  )
})

// Value: protects=the learner's group arrangement and reading when the Wiki closes while a cited-source copy the learner moved beside it stands alone with it in its group: the closing Wiki's tab is no other tab of that group, so the copy is the group's only tab and stays, and the group stays with it; fails_when=RepositoryReader.retirableCitedSources counts the closing Wiki's tab, which the editor still lists right after the panel's disposal, as another tab of the group, so Close Repository Wiki closes the copy the learner reads in and the editor removes the emptied group (closeEmptyGroups); why_new=Cycle 0046 row 687 (the 652 and 662 forks' finding 3, probe: open, moveFrontSourceTabToWikiGroup, close closes module.ts); seam=readerHarness, focusUnrelatedDraft, open, moveFrontSourceTabToWikiGroup (the learner's drag and click), close (Close Repository Wiki), deliverTabEvents, firstGroupTabs, wikiGroupTabs, focusedSource and the fake tabGroups.close's record
test('Close Repository Wiki keeps a cited-source copy the learner moved beside the Wiki when it is the only other tab of the Wiki’s group', async (context) => {
  // Arrange: the learner's Wiki shows module.ts in front of login-form.tsx; the learner drags that copy into the Wiki's group and clicks into it.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.moveFrontSourceTabToWikiGroup()

  // Act
  harness.reader.close()
  await harness.deliverTabEvents()

  // Assert: the Wiki's tab left its group; the module.ts copy is that group's only tab, in front, with the keyboard, and nothing was closed by the reader.
  assert.deepEqual(
    {
      firstGroup: harness.firstGroupTabs(),
      wikiGroup: harness.wikiGroupTabs(),
      keyboard: harness.focusedSource()?.document.uri.path,
      closedTabs: harness.closedTabs,
    },
    {
      firstGroup: {
        tabs: ['file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
      wikiGroup: {
        tabs: ['codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      keyboard: '/architecture/1/module/0/module.ts',
      closedTabs: [],
    },
  )
})

// Value: protects=the same group as Close Repository Wiki's case when the learner closes the Wiki's tab by hand instead: the Wiki's own close (its panel's disposal) counts its tab as no other tab of its group, so the copy the learner moved beside the Wiki stays as that group's only tab; fails_when=the retirement on the panel's disposal counts the Wiki's tab and closes the copy, so the group goes too; why_new=Cycle 0046 row 687 (the Wiki's other close, row 641); seam=readerHarness, focusUnrelatedDraft, open, moveFrontSourceTabToWikiGroup, closeWikiTabByHand (the panel's disposal), deliverTabEvents, wikiGroupTabs and the fake tabGroups.close's record
test('the Wiki’s tab closed by hand keeps a cited-source copy the learner moved beside the Wiki when it is the only other tab of the Wiki’s group', async (context) => {
  // Arrange: the learner's Wiki shows module.ts in front of login-form.tsx; the learner drags that copy into the Wiki's group and clicks into it.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.moveFrontSourceTabToWikiGroup()

  // Act
  harness.closeWikiTabByHand()
  await harness.deliverTabEvents()

  // Assert
  assert.deepEqual(
    { wikiGroup: harness.wikiGroupTabs(), closedTabs: harness.closedTabs },
    {
      wikiGroup: {
        tabs: ['codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=the learner's first group after the workspace's folders change while the Wiki is open: the extension disposes that reader (its Wiki goes) and makes another, and the cited-source copy the reader before showed leaves with it, so no copy that no reader serves covers the learner's file; fails_when=the copy stays in front of the learner's file after the reader that showed it is gone (a dispose leaves the editor's tabs as they are), as it also does when a change of the first folder restarts the extension host; why_new=Cycle 0046 row 652; seam=readerHarness, a reader of its own (createReader), focusUnrelatedDraft, open, dispose (the folder change's), createReader (the reader made in its place), firstGroupTabs
test('the reader made after the workspace folders change retires the cited-source copy the reader before it left in front of the learner’s file', async (context) => {
  // Arrange: the learner's Wiki shows module.ts in front of login-form.tsx; then the workspace's folders change and the extension disposes that reader.
  const harness = await readerHarness(context),
    replaced = harness.createReader()
  harness.focusUnrelatedDraft('login-form.tsx')
  await replaced.open(harness.selection)
  await replaced.dispose()
  const afterDispose = harness.firstGroupTabs()

  // Act: the extension makes the reader in its place.
  const fresh = harness.createReader()
  context.after(() => fresh.dispose())

  // Assert: the copy the disposed reader showed left; the learner's file is in front again.
  assert.deepEqual(
    { afterDispose, afterNewReader: harness.firstGroupTabs() },
    {
      afterDispose: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      afterNewReader: {
        tabs: ['file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
    },
  )
})

// Value: protects=a cited-source copy an earlier reader showed that the learner kept reading after the workspace's folders changed: the reader made in its place kept it because it had the keyboard (row 652), and that reader's own Wiki, opened on another citation and closed again, retires only the copy it showed itself; fails_when=Close Repository Wiki, or the next citation's display, picks the copies to close by their scheme and pin alone, so the copy the learner read in, which this reader never showed, is closed too; why_new=Cycle 0046 row 662 (CodeRabbit's review of dc60b8f6..465a6834, row 641's retirement and row 652's design reconciled); seam=readerHarness, a reader of its own (createReader), focusUnrelatedDraft, open, moveFrontSourceTabToWikiGroup (the learner's drag and click), dispose (the folder change's), createReader (the reader made in its place), open of another citation, close, firstGroupTabs, wikiGroupTabs and the fake tabGroups.close's record
test('a cited-source copy an earlier reader showed and the learner reads in stays when the reader made after a folder change shows and closes its own Wiki', async (context) => {
  // Arrange: the learner's Wiki showed module.ts; the learner dragged that copy beside the Wiki and reads in it; then the workspace's folders change, the extension disposes that reader and makes another, which keeps the copy with the keyboard.
  const harness = await readerHarness(context),
    replaced = harness.createReader()
  harness.focusUnrelatedDraft('login-form.tsx')
  await replaced.open(harness.selection)
  harness.moveFrontSourceTabToWikiGroup()
  await replaced.dispose()
  await harness.deliverTabEvents()
  const fresh = harness.createReader()
  context.after(() => fresh.dispose())
  const afterNewReader = {
    firstGroup: harness.firstGroupTabs(),
    wikiGroup: harness.wikiGroupTabs(),
  }

  // Act: the learner opens the new reader's Wiki on the article's second citation, order.ts, and closes it again.
  await fresh.open({ ...harness.selection, anchorIndex: 1 })
  fresh.close()
  await harness.deliverTabEvents()

  // Assert: the earlier reader's module.ts copy stayed through the new Wiki's citation and its close; only the order.ts copy the new reader showed was closed. Each disposed Wiki's tab left the Wiki's group.
  assert.deepEqual(
    {
      afterNewReader,
      afterClose: {
        firstGroup: harness.firstGroupTabs(),
        wikiGroup: harness.wikiGroupTabs(),
      },
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      afterNewReader: {
        firstGroup: {
          tabs: ['file:login-form.tsx'],
          front: 'file:login-form.tsx',
        },
        wikiGroup: {
          tabs: ['codebook-repository-source:module.ts'],
          front: 'codebook-repository-source:module.ts',
        },
      },
      afterClose: {
        firstGroup: {
          tabs: ['file:login-form.tsx'],
          front: 'file:login-form.tsx',
        },
        wikiGroup: {
          tabs: ['codebook-repository-source:module.ts'],
          front: 'codebook-repository-source:module.ts',
        },
      },
      closedTabs: ['order.ts'],
    },
  )
})

// Value: protects=a cited-source copy an earlier reader showed that the learner kept reading after the workspace's folders changed, when the new reader's display of the same citation is refused by the editor: the refused show put no copy of this reader on screen, so Close Repository Wiki leaves the earlier copy where the learner reads it; fails_when=the reader notes the URI as its own before the show and keeps it after the refusal, so the Close takes the earlier reader's copy for this reader's and closes it; why_new=Cycle 0046 row 683 (CodeRabbit's review of 465a6834..5f9e8f05, row 662's note before the display); seam=readerHarness, a reader of its own (createReader), focusUnrelatedDraft, open, moveFrontSourceTabToWikiGroup, dispose (the folder change's), createReader, rejectNextSourceDisplay (the editor's refusal of the show), open of the same citation, close, wikiGroupTabs and the fake tabGroups.close's record
test("a cited-source copy an earlier reader showed and the learner reads in stays at Close Repository Wiki after the new reader's display of the same citation was refused", async (context) => {
  // Arrange: the learner's Wiki showed module.ts; the learner dragged that copy beside the Wiki and reads in it; then the workspace's folders change and the reader made in its place keeps the copy with the keyboard.
  const harness = await readerHarness(context),
    replaced = harness.createReader()
  harness.focusUnrelatedDraft('login-form.tsx')
  await replaced.open(harness.selection)
  harness.moveFrontSourceTabToWikiGroup()
  await replaced.dispose()
  await harness.deliverTabEvents()
  const fresh = harness.createReader()
  context.after(() => fresh.dispose())

  // Act: the new reader's Wiki is opened on the same citation, module.ts, whose display the editor refuses; then the learner closes the Wiki.
  harness.rejectNextSourceDisplay('Could not open the document.')
  const refusal = await fresh.open(harness.selection).then(
    () => undefined,
    (error: unknown) => String(error),
  )
  fresh.close()
  await harness.deliverTabEvents()

  // Assert: the open reported the editor's refusal, and the earlier reader's module.ts copy stayed through the Close; no tab was closed.
  assert.deepEqual(
    {
      refusal,
      wikiGroup: harness.wikiGroupTabs(),
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      refusal: 'Error: Could not open the document.',
      wikiGroup: {
        tabs: ['codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=the bound of row 683: a copy this reader showed stays its own when a later display of the same citation is refused, so Close Repository Wiki still retires it and the learner's file comes to the front of the first group again; fails_when=a refused show forgets every URI it touched, so the reader's own earlier copy stays behind after the Wiki closed; why_new=Cycle 0046 row 683 (its bound); seam=readerHarness, focusUnrelatedDraft, open, rejectNextSourceDisplay, open of the same citation, close, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source copy the reader showed itself still leaves with Close Repository Wiki after a later display of the same citation was refused', async (context) => {
  // Arrange: the learner's Wiki shows module.ts in front of login-form.tsx in the first group.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)

  // Act: the same citation is shown again and the editor refuses that display; then the learner closes the Wiki.
  harness.rejectNextSourceDisplay('Could not open the document.')
  const refusal = await harness.reader.open(harness.selection).then(
    () => undefined,
    (error: unknown) => String(error),
  )
  harness.reader.close()
  await harness.deliverTabEvents()

  // Assert: the reader's own module.ts copy was closed with the Wiki, and login-form.tsx is in front of the first group again.
  assert.deepEqual(
    {
      refusal,
      firstGroup: harness.firstGroupTabs(),
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      refusal: 'Error: Could not open the document.',
      firstGroup: {
        tabs: ['file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
      closedTabs: ['module.ts'],
    },
  )
})

// Value: protects=the learner's first group after a citation's display the extension host refused although the editor had opened the copy: the learner switched back to the tab in front of the first group while the copy opened, so the editor the host got back was no longer the current one ("Could NOT open editor for … because another editor opened in the meantime.", Cursor's server extensionHostProcess.js 201:91131, VS Code 1.140.0 295:85754), and the copy's tab stays behind the learner's tab; that copy is still this reader's, so Close Repository Wiki retires it with the copy before it; fails_when=RepositoryReader.showCitedSourceCopy forgets every URI a rejected show noted for the first time (row 683), so neither Close Repository Wiki nor the next citation retires the copy, which stays in the learner's first group; why_new=Cycle 0046 row 701 (open-code-review of cc231f08..e6a3daeb); seam=readerHarness, focusUnrelatedDraft, open, rejectNextSourceDisplayAfterOpeningItsTab (the editor's open, the learner's tab in front again, the host's refusal), open of the second citation, close, deliverTabEvents, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source copy whose display was refused after the editor opened its tab leaves with Close Repository Wiki', async (context) => {
  // Arrange: the learner's Wiki shows module.ts in front of login-form.tsx; the learner follows the second citation, order.ts, whose copy the editor opens while the learner switches back to the tab in front before it, the module.ts copy, and the extension host refuses the display.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.rejectNextSourceDisplayAfterOpeningItsTab()
  const refusal = await harness.reader
    .open({ ...harness.selection, anchorIndex: 1 })
    .then(
      () => undefined,
      (error: unknown) => String(error).split(' because ')[1],
    )
  const afterRefusal = harness.firstGroupTabs()

  // Act
  harness.reader.close()
  await harness.deliverTabEvents()

  // Assert: both copies the reader showed left with the Wiki, and login-form.tsx is the first group's only tab.
  assert.deepEqual(
    {
      refusal,
      afterRefusal,
      afterClose: harness.firstGroupTabs(),
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      refusal: 'another editor opened in the meantime.',
      afterRefusal: {
        tabs: [
          'file:login-form.tsx',
          'codebook-repository-source:module.ts',
          'codebook-repository-source:order.ts',
        ],
        front: 'codebook-repository-source:module.ts',
      },
      afterClose: {
        tabs: ['file:login-form.tsx'],
        front: 'file:login-form.tsx',
      },
      closedTabs: ['module.ts', 'order.ts'],
    },
  )
})

// Value: protects=a cited-source copy the learner closed and brought back with Reopen Closed Editor while the Wiki stays open: the copy is the learner's now, so Close Repository Wiki leaves it in front of the first group; fails_when=the reader keeps the URI of every copy it ever showed, takes the reopened copy, which has the same URI, for its own and closes it with the Wiki; why_new=Cycle 0046 row 677 (the 652 and 662 forks' finding 3); seam=readerHarness, focusUnrelatedDraft, open, closeFrontSourceTabByHand and reopenClosedEditor (the learner's close and Reopen Closed Editor, with the editor's tab events), close, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source copy the learner closed and reopened stays in front of the first group when the Wiki closes', async (context) => {
  // Arrange: the learner's Wiki shows module.ts in front of login-form.tsx; the learner closes that copy and brings it back with Reopen Closed Editor.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.closeFrontSourceTabByHand()
  harness.reopenClosedEditor()

  // Act
  harness.reader.close()

  // Assert: the reopened module.ts copy is still in front of the learner's file; the reader closed nothing.
  assert.deepEqual(
    { afterClose: harness.firstGroupTabs(), closedTabs: harness.closedTabs },
    {
      afterClose: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: [],
    },
  )
})

// Value: protects=a cited-source copy the reader itself retired when the learner followed the next citation, and which the learner then brought back with Reopen Closed Editor: the copy is the learner's now, so Close Repository Wiki closes only the next citation's copy; fails_when=the URI of the retired copy stays among the copies the reader showed, so the reopened copy is closed with the Wiki; why_new=Cycle 0046 row 677 (a copy the reader's own retirement closed is forgotten too); seam=readerHarness, focusUnrelatedDraft, open of two citations, reopenClosedEditor (the learner's Reopen Closed Editor of the copy the reader closed), close, firstGroupTabs and the fake tabGroups.close's record
test('a cited-source copy the next citation retired and the learner reopened stays when the Wiki closes, and the next citation’s copy leaves', async (context) => {
  // Arrange: the learner follows module.ts and then order.ts, which retires the module.ts copy; the learner brings that copy back with Reopen Closed Editor.
  const harness = await readerHarness(context)
  harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  await harness.reader.open({ ...harness.selection, anchorIndex: 1 })
  harness.reopenClosedEditor()
  const beforeClose = harness.firstGroupTabs()

  // Act
  harness.reader.close()

  // Assert: the reopened module.ts copy stays; the order.ts copy the reader showed left with the Wiki.
  assert.deepEqual(
    {
      beforeClose,
      afterClose: harness.firstGroupTabs(),
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      beforeClose: {
        tabs: [
          'file:login-form.tsx',
          'codebook-repository-source:order.ts',
          'codebook-repository-source:module.ts',
        ],
        front: 'codebook-repository-source:module.ts',
      },
      afterClose: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:module.ts'],
        front: 'codebook-repository-source:module.ts',
      },
      closedTabs: ['module.ts', 'order.ts'],
    },
  )
})

// Value: protects=row 652's retirement of a copy this reader showed that the learner only moved: a move to another group is no close of the copy (the editor opens it in its new group before it closes it in its old one), so the copy stays the reader's and the next citation retires it once the learner has left it; fails_when=the reader forgets a copy at the close half of a move, so a copy the learner dragged beside the Wiki and left stays there for good; why_new=Cycle 0046 row 677 (its bound: only a copy whose last tab closed is forgotten); seam=readerHarness, focusUnrelatedDraft, open, moveFrontSourceTabToWikiGroup (opened, then closed, as the editors report a move), focusSourceEditor and switchTabGroup (the learner's click back into login-form.tsx), open of the next citation, wikiGroupTabs and the fake tabGroups.close's record
test('a cited-source copy the learner moved beside the Wiki and left is retired by the next citation, as a copy the reader showed', async (context) => {
  // Arrange: the learner's Wiki shows module.ts; the learner drags that copy beside the Wiki, reads in it, and clicks back into login-form.tsx.
  const harness = await readerHarness(context)
  const draft = harness.focusUnrelatedDraft('login-form.tsx')
  await harness.reader.open(harness.selection)
  harness.moveFrontSourceTabToWikiGroup()
  harness.switchTabGroup(true)
  harness.focusSourceEditor(draft)

  // Act: the learner follows the article's second citation, order.ts.
  await harness.reader.open({ ...harness.selection, anchorIndex: 1 })

  // Assert: the moved module.ts copy left the Wiki's group; the order.ts copy is in front of the learner's file.
  assert.deepEqual(
    {
      firstGroup: harness.firstGroupTabs(),
      wikiGroup: harness.wikiGroupTabs(),
      closedTabs: harness.closedTabs.map((uri) => basename(uri.split('?')[0]!)),
    },
    {
      firstGroup: {
        tabs: ['file:login-form.tsx', 'codebook-repository-source:order.ts'],
        front: 'codebook-repository-source:order.ts',
      },
      wikiGroup: {
        tabs: ['mainThreadWebview-codebook.repositoryWiki'],
        front: 'mainThreadWebview-codebook.repositoryWiki',
      },
      closedTabs: ['module.ts'],
    },
  )
})

// Value: protects=the editor after the extension disposes a Repository Wiki reader (a change of the workspace's folders): the tab listener by which the reader forgets a closed copy (row 677) is released with its other registrations, so the reader made in its place is the only one that listens; fails_when=the listener is not among the registrations dispose releases, and a disposed reader goes on reacting to the editor's tabs; why_new=Cycle 0046 row 677 (its listener's lifetime); seam=the reader harness's count of each reader's lifetime tab listener, createReader and dispose
test('a Repository Wiki reader the extension disposes stops listening to the editor’s tabs', async (context) => {
  // Arrange: a second reader beside the harness's own.
  const harness = await readerHarness(context),
    replaced = harness.createReader()
  const listenersBefore = harness.readerTabListenerCount()

  // Act
  await replaced.dispose()

  // Assert
  assert.deepEqual(
    { listenersBefore, listenersAfter: harness.readerTabListenerCount() },
    { listenersBefore: 2, listenersAfter: 1 },
  )
})

// Value: protects=the learner's Open Repository Wiki command run while Cursor's Agent chat part has the keyboard and no Wiki is open: the cited source takes the keyboard in the first group, Cursor reports it as the active text editor while it goes on naming the chat's group (a tab opened in the main editor's active group is no group activation for its tab model, Cursor 3.23.12 17269:31013), and the reader takes that stale name for its citation's group, so the Wiki opens; fails_when=the citation's focus receipt and its check wait for the first group to be named, which Cursor does not do, so the open is refused with "Native focus changed during repository navigation; the newer learner focus was preserved." (C58 c58-cu-567 and c58-cu-567-probe, the command run from the extension host); why_new=Cycle 0046 row 660; seam=readerHarness with useColdLayout and focusCursorChatPart (the chat part's group named, kept named by a foreground display)
test("the learner's cold Open Repository Wiki run while Cursor's chat part has the keyboard opens the Wiki after the citation took the keyboard under the chat's group name", async (context) => {
  // Arrange: no Wiki is open; Cursor's chat part has the keyboard and its group is the named one.
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.focusCursorChatPart()

  // Act
  const refusal = await harness.reader.open(harness.selection).then(
    () => undefined,
    (error: unknown) => String(error),
  )

  // Assert: the open answered with the article loaded, the citation has the keyboard in the first group while Cursor still names the chat's group, and the Wiki was then given the keyboard.
  assert.deepEqual(
    {
      refusal,
      loading: harness.reader.inspect().view.loading,
      article: harness.reader.inspect().view.selection?.nodeId,
      shownCitations: harness.shown.length,
      wikiReveals: harness.revealFocus,
    },
    {
      refusal: undefined,
      loading: false,
      article: 'module',
      shownCitations: 1,
      wikiReveals: [false],
    },
  )
})

// Value: protects=the learner's newer choice during a cold Open Repository Wiki beside Cursor's chat part: a click into another group while the citation takes the keyboard is still the learner's change, which the reader refuses, also though it accepts Cursor's stale name of the chat's group for its own citation (row 660); fails_when=the stale name is accepted for any group or any editor, so a learner who went elsewhere loses the keyboard to the Wiki; why_new=Cycle 0046 row 660 (its bound); seam=readerHarness with useColdLayout, focusCursorChatPart, holdSourceDisplay (the learner's change while the citation's display answers) and switchTabGroup
test("a learner's change of group while a cold Open Repository Wiki beside Cursor's chat part shows its citation is still refused as the learner's newer focus", async (context) => {
  // Arrange: as above, with the citation's display held so the learner can change the group meanwhile.
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.focusCursorChatPart()
  const held = harness.holdSourceDisplay()
  const opening = harness.reader.open(harness.selection).then(
    () => undefined,
    (error: unknown) => String(error),
  )
  await held.started

  // Act: the learner selects the second group before the citation's display answers.
  harness.switchTabGroup()
  held.release()
  const refusal = await opening

  // Assert
  assert.deepEqual(
    { refusal, namedColumn: harness.namedColumn() },
    {
      refusal:
        'Error: Native focus changed during repository navigation; the newer learner focus was preserved.',
      namedColumn: 2,
    },
  )
})

// Value: protects=the learner's own Open Repository Wiki in a window without a Wiki: it keeps activating the Wiki after the cited source, and the agent's keyboard return is not asked for it; fails_when=row 620's agent handling leaks into the learner's entry; why_new=Cycle 0046 row 620 guard; seam=readerHarness with useColdLayout, answerKeyboardReturn(true), open without forAgent
test("the learner's cold Open Repository Wiki still gives the Wiki the keyboard and asks for no keyboard return", async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.useColdLayout()
  harness.answerKeyboardReturn(true)
  harness.focusChat()

  // Act
  await harness.reader.open(harness.selection)

  // Assert
  assert.equal(harness.keyboardReturns(), 0)
  assert.deepEqual(harness.revealFocus, [false])
  assert.equal(
    harness.focusedSource()?.document.uri.toString(),
    harness.shown[0]?.uri.toString(),
  )
  assert.deepEqual(harness.notices, [])
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

// Value: protects=the learner's layout and keyboard after Return to Wiki from the Command Palette while the Study pane had the keyboard: the Return waits for the learner's own selection of the Wiki, and a Study close that removes the Study's tab makes the editor select the Wiki by itself, which is no such selection, so the article's layout is not restored and no cited source is shown; fails_when=the deferred Return has no expiry and runs on any later activation of the Wiki, also one the editor made after closing a neighbouring tab, minutes later, rearranging the grid and possibly giving the cited source the keyboard; why_new=Cycle 0046 R6 (the red team review of /ship); seam=readerHarness with hideWiki, focusStudy, requireSourceFocus, open with preserveNativeInput (the palette's Return), closeStudy (the Study tab's close, then the editor's activation of the Wiki), arrangements and shown; no_claim=a time bound for the deferral, which this rule does not need
test('a palette Return to Wiki from the Study pane does not restore the article layout when a Study close makes the editor select the Wiki', async (context) => {
  // Arrange: the Wiki is open behind the Study pane, which has the keyboard; the learner runs Return to Wiki from the Command Palette, which defers the article's layout.
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.hideWiki()
  harness.focusStudy()
  harness.requireSourceFocus()
  const selection = {
    ...harness.selection,
    nodeId: 'order',
    location: { sectionIndex: 0, fraction: 0.5, focusId: 'anchor-0' },
  }
  await harness.reader.open(selection, undefined, true, true)
  const arrangementsBefore = harness.arrangements(),
    shownBefore = harness.shown.length

  // Act: the Study closes; its tab leaves the Wiki's group, and the editor selects the Wiki.
  harness.closeStudy()
  await harness.deliverTabEvents()
  await new Promise((resolve) => setTimeout(resolve, 50))

  // Assert: no layout was restored and no cited source was shown.
  assert.deepEqual(
    {
      arrangements: harness.arrangements() - arrangementsBefore,
      shown: harness.shown.length - shownBefore,
      error: harness.reader.inspect().view.error,
    },
    { arrangements: 0, shown: 0, error: '' },
  )
})

// Value: protects=the article Return the learner asked for from the Command Palette while the Study pane had the keyboard: the learner's own click on the Wiki's tab is the selection the deferred Return waits for, so the article's layout is restored then; fails_when=the expiry of a deferred Return (R6) also takes the learner's own selection of the Wiki for a change away from it, so a palette Return never restores the article's layout; why_new=Cycle 0046 R6 (the other side of the rule); seam=readerHarness with hideWiki, focusStudy, requireSourceFocus, open with preserveNativeInput, clickWikiTab (the new seam: the learner's click on the Wiki's tab in front of the Study's), arrangements; no_claim=the native order of the tab and view-state events of that click
test('a palette Return to Wiki from the Study pane restores the article layout when the learner selects the Wiki', async (context) => {
  // Arrange: as above.
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.hideWiki()
  harness.focusStudy()
  harness.requireSourceFocus()
  const selection = {
    ...harness.selection,
    nodeId: 'order',
    location: { sectionIndex: 0, fraction: 0.5, focusId: 'anchor-0' },
  }
  await harness.reader.open(selection, undefined, true, true)
  const arrangementsBefore = harness.arrangements()

  // Act: the learner clicks the Wiki's tab.
  harness.clickWikiTab()
  await waitUntil(
    () =>
      harness.arrangements() === arrangementsBefore + 1 &&
      !harness.reader.inspect().view.loading,
    'original article layout restored after the learner selected the Wiki',
  )

  // Assert: the layout was restored once, for the selected article.
  assert.deepEqual(
    {
      arrangements: harness.arrangements() - arrangementsBefore,
      selection: harness.reader.inspect().view.selection,
      error: harness.reader.inspect().view.error,
    },
    { arrangements: 1, selection, error: '' },
  )
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

for (const readiness of ['document', 'article'] as const)
  test(`selecting a recreated Wiki gives it keyboard focus after its deferred citation and current ${readiness} are ready`, async (context) => {
    // Arrange: the agent updates an existing hidden Wiki while the learner types in a file.
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    harness.focusUnrelatedDraft()
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })
    harness.useNativeWikiSelection()
    const renderer = harness.holdRenderer(readiness === 'article'),
      shownBefore = harness.shown.length,
      revealsBefore = harness.revealFocus.length
    try {
      // Act: native selection precedes the recreated document, as in the C23 editor trace.
      harness.focusWiki()
      await renderer.started
      await waitUntil(
        () => harness.shown.length === shownBefore + 1,
        'the deferred citation to display before renderer readiness',
      )
      assert.equal(
        harness.revealFocus.slice(revealsBefore).includes(false),
        false,
      )
      renderer.release()
      await waitUntil(
        () =>
          harness.reader.inspect().rendered &&
          harness.focusListenerCount() === 0,
        'the current Wiki document and completed focus handoff',
      )

      // Assert: readiness is followed by one owned activation, without a second article request.
      assert.deepEqual(harness.revealFocus.slice(revealsBefore), [false])
      assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n')
      assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
      assert.equal(harness.reader.inspect().view.error, '')
    } finally {
      renderer.release()
    }
  })

for (const departure of ['window', 'window roundtrip', 'another file'] as const)
  test(`${departure} departure during deferred citation loading prevents the recreated Wiki from taking keyboard later`, async (context) => {
    // Arrange: hold both source acquisition and the new document after native Wiki selection.
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    harness.focusUnrelatedDraft()
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })
    const source = harness.holdSourceDocument(),
      renderer = harness.holdRenderer(),
      shownBefore = harness.shown.length,
      revealsBefore = harness.revealFocus.length
    try {
      harness.focusWiki()
      await source.started
      await renderer.started

      // Act: an intervening learner choice remains terminal even after the window returns.
      if (departure === 'another file') harness.focusUnrelatedDraft('later.txt')
      else {
        harness.setWindowFocus(false)
        if (departure === 'window roundtrip') harness.setWindowFocus(true)
      }
      const newerInput = harness.focusedSource()
      source.release()
      renderer.release()
      await waitUntil(
        () => harness.focusListenerCount() === 0,
        'the retired deferred citation focus ownership',
      )

      // Assert: no late activation or misleading source error replaces the newer input.
      assert.equal(
        harness.revealFocus.slice(revealsBefore).includes(false),
        false,
      )
      assert.equal(harness.shown.length, shownBefore)
      assert.equal(harness.focusedSource(), newerInput)
      assert.equal(harness.reader.inspect().view.error, '')
    } finally {
      source.release()
      renderer.release()
    }
  })

for (const departure of [
  'chat',
  'chat roundtrip',
  'window',
  'window roundtrip',
  'another group',
  'Close',
] as const)
  test(`${departure} while the selected Wiki document loads prevents its deferred preview from taking keyboard later`, async (context) => {
    // Arrange: the source has been acquired, but the selected native Wiki has not created its document yet.
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    harness.focusUnrelatedDraft()
    await harness.reader.openFromAgent({
      instanceId: '11111111-1111-4111-8111-111111111111',
      ...harness.selection,
      nodeId: 'order',
    })
    const renderer = harness.holdRenderer(),
      shownBefore = harness.shown.length,
      revealsBefore = harness.revealFocus.length
    try {
      harness.focusWiki()
      await renderer.started
      await waitUntil(
        () => harness.shown.length === shownBefore + 1,
        'the selected Wiki citation before document readiness',
      )

      // Act: the learner leaves before the pending document can receive keyboard focus.
      if (departure === 'chat' || departure === 'chat roundtrip') {
        harness.focusChat()
        if (departure === 'chat roundtrip') harness.focusWiki()
      } else if (departure === 'window' || departure === 'window roundtrip') {
        harness.setWindowFocus(false)
        if (departure === 'window roundtrip') harness.setWindowFocus(true)
      } else if (departure === 'another group') harness.switchTabGroup(true)
      else harness.reader.close()
      const newerInput = harness.focusedSource()
      renderer.release()
      await waitUntil(
        () => harness.focusListenerCount() === 0,
        'the cancelled selected-Wiki handoff',
      )

      // Assert: late readiness cannot undo that newer native choice.
      assert.equal(
        harness.revealFocus.slice(revealsBefore).includes(false),
        false,
      )
      assert.equal(harness.focusedSource(), newerInput)
      assert.equal(harness.reader.inspect().view.error, '')
    } finally {
      renderer.release()
    }
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

// Regression: C20 native Article Up clears the old text editor before activating the prepared citation group.
test('changing a Wiki article completes when its prepared citation clears the old editor before group activation', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  harness.requireSourceFocus()
  await harness.reader.open({ ...harness.selection, nodeId: 'order' })
  harness.switchTabGroup()
  harness.useNativeCitationActivation('editor-first')
  const listeners = harness.focusListenerCount()

  // Act
  await harness.reader.open(harness.selection)

  // Assert
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
  assert.equal(harness.reader.inspect().view.loading, false)
  assert.equal(harness.reader.inspect().view.error, '')
  assert.equal(harness.shown.at(-1)?.text, 'export const price = 24;\n')
  assert.deepEqual(harness.reveals, [2, 2])
  assert.equal(harness.focusListenerCount(), listeners)
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
})

for (const departure of ['another source', 'citation tab roundtrip'] as const)
  test(`changing a Wiki article preserves ${departure} during the prepared citation's early editor gap`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    await harness.reader.open({ ...harness.selection, nodeId: 'order' })
    harness.switchTabGroup()
    harness.useNativeCitationActivation('editor-first')
    const held = harness.holdCitationActivation('text gap'),
      opening = harness.reader.open(harness.selection),
      rejected = assert.rejects(opening, /focus changed/)
    try {
      await held.started
      // Act: explicit newer input must invalidate the otherwise permitted native transition.
      if (departure === 'another source') harness.focusUnrelatedDraft()
      else harness.roundtripCitationTab()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order')
      assert.deepEqual(harness.reveals, [2])
      assert.equal((await harness.library.readProgress()).decisions.length, 0)
    } finally {
      held.release()
    }
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

for (const recording of [false, true])
  test(`intentional Study Return accepts its own quiet Wiki selection ${recording ? 'and captured source retirement' : 'before the document is ready'}`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    if (recording) harness.focusRecordingSource()
    else harness.focusStudy()
    harness.useNativeWikiSelection(recording)
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

test('a quiet Wiki selection cannot retire a text editor selected in another group', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  harness.hideWiki()
  harness.focusUnrelatedDraft()
  harness.useNativeWikiSelection(true)

  // Act / Assert
  await assert.rejects(
    harness.reader.open(harness.selection, undefined, true),
    /Native focus changed/,
  )
  assert.equal(harness.focusListenerCount(), 0)
})

for (const recording of [false, true])
  for (const departure of ['source', 'other group', 'group roundtrip'] as const)
    test(`a newer ${departure} after the own quiet Wiki selection still cancels the old ${recording ? 'recording' : 'Study'} Return`, async (context) => {
      // Arrange
      const harness = await readerHarness(context)
      await harness.reader.open(harness.selection)
      harness.hideWiki()
      if (recording) harness.focusRecordingSource()
      else harness.focusStudy()
      harness.useNativeWikiSelection(recording)
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
      () =>
        harness.reader.inspect().view.selection?.nodeId === 'order' &&
        harness.reader
          .inspect()
          .view.sources.some(
            (source) =>
              source.path === 'src/order.ts' && source.status === 'current',
          ),
      'the updated citation before accepting render receipts',
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
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [])
    assert.equal(harness.reader.inspect().rendered, undefined)
    renderer.release()
    await opening
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [false])
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

test('a visible Wiki waits for its updated article without selecting its tab or taking keyboard', async (context) => {
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
      () =>
        harness.reader.inspect().view.selection?.nodeId === 'order' &&
        harness.reader
          .inspect()
          .view.sources.some(
            (source) =>
              source.path === 'src/order.ts' && source.status === 'current',
          ),
      'the updated article citation to become current',
    )
    // Act: let the ready handoff's promise continuations run while the usable model remains held.
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [])
    renderer.release()
    await opening
    assert.deepEqual(harness.revealFocus.slice(revealsBefore), [false])
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

test('reopening the Wiki marks its existing article as loading before source and layout navigation', async (context) => {
  // Arrange
  const harness = await readerHarness(context)
  await harness.reader.open(harness.selection)
  assert.equal(harness.publishedMessages.at(-1)?.loading, false)
  const arrangement = harness.holdArrangement()
  const opening = harness.reader.open(harness.selection)
  try {
    // Act
    await arrangement.started
    // Assert: inspect the actual host message, rather than its private loading field.
    assert.equal(harness.publishedMessages.at(-1)?.loading, true)
    arrangement.release()
    await opening
    assert.equal(harness.publishedMessages.at(-1)?.loading, false)
  } finally {
    arrangement.release()
    await opening.catch(() => undefined)
  }
})

// Value: protects=the ordinary Wiki command right after a completed Study Close; fails_when=a Wiki-group transition that leaves the acquired source editor untouched is refused as newer learner input; why_new=Cycle 0046 row 444 (C24 capture 223 failed 104ms after Close with this ordering while the article loaded; the same transition can land while the host waits for the render); seam=none.
for (const phase of ['loads', 'renders'] as const)
  test(`opening the original article right after Study Close completes when the Wiki group becomes active again while the article ${phase} and the acquired source keeps the keyboard`, async (context) => {
    // Arrange: the original article, the Study over its hidden Wiki, then a completed Close that refocuses the recreated Wiki.
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    harness.focusStudy()
    const messagesBeforeClose = harness.publishedMessages.length
    harness.closeStudy()
    await waitUntil(
      () => harness.publishedMessages.length > messagesBeforeClose,
      'the recreated Wiki document to render the old article',
    )
    const revealsBefore = harness.revealFocus.length,
      listenersBefore = harness.focusListenerCount(),
      display = harness.holdSourceDisplay(),
      opening = harness.reader.open(harness.selection),
      result = opening.then(
        () => ({ opened: true, error: '' }),
        (error: unknown) => ({ opened: false, error: String(error) }),
      )
    await display.started
    // The owned source acquisition has made the citation the active text editor.
    assert.equal(
      harness.focusedSource()?.document.getText(),
      'export const price = 24;\n',
    )
    const messagesBeforeArticle = harness.publishedMessages.length,
      renderer = harness.holdRenderer()
    display.release()
    await renderer.started
    // The rendering phase begins once the usable article and its citation states are published.
    if (phase === 'renders')
      await waitUntil(
        () =>
          harness.publishedMessages.length > messagesBeforeArticle &&
          harness.publishedMessages.at(-1)?.loading === false &&
          harness.publishedMessages.at(-1)?.sources.length === 2,
        'the usable article to wait for its render',
      )
    try {
      // Act: the editor reports the Wiki's group as active while activeTextEditor still names the source, the window stays focused and no learner input arrives.
      harness.switchTabGroup()
      renderer.release()

      // Assert
      assert.deepEqual(await result, { opened: true, error: '' })
      assert.deepEqual(harness.revealFocus.slice(revealsBefore), [false])
      assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module')
      assert.equal(harness.reader.inspect().view.error, '')
      assert.equal(harness.focusListenerCount(), listenersBefore)
    } finally {
      renderer.release()
      await result
    }
  })

// Value: protects=newer learner input during the ordinary Wiki command after Study Close; fails_when=the accepted Wiki-group return also forgives a selection, another editor, the learner's own Wiki choice or another group; why_new=Cycle 0046 row 444 (the bound of the accepted late transition); seam=none.
for (const input of [
  'a source selection after the Wiki-group return',
  'another editor after the Wiki-group return',
  'keyboard moved into the Wiki after the Wiki-group return',
  'a source-group choice after the Wiki-group return',
  'keyboard moved into the Wiki without a Wiki-group return',
] as const)
  test(`${input} still cancels opening the original article right after Study Close`, async (context) => {
    // Arrange
    const harness = await readerHarness(context)
    harness.requireSourceFocus()
    await harness.reader.open(harness.selection)
    harness.hideWiki()
    harness.focusStudy()
    const messagesBeforeClose = harness.publishedMessages.length
    harness.closeStudy()
    await waitUntil(
      () => harness.publishedMessages.length > messagesBeforeClose,
      'the recreated Wiki document to render the old article',
    )
    const revealsBefore = harness.revealFocus.length,
      listenersBefore = harness.focusListenerCount(),
      display = harness.holdSourceDisplay(),
      opening = harness.reader.open(harness.selection),
      result = opening.then(
        () => ({ opened: true, error: '' }),
        (error: unknown) => ({ opened: false, error: String(error) }),
      )
    await display.started
    const renderer = harness.holdRenderer()
    display.release()
    await renderer.started
    try {
      // Act
      if (input.endsWith('after the Wiki-group return'))
        harness.switchTabGroup()
      if (input.startsWith('a source selection')) harness.selectSource(0, 6, 1)
      if (input.startsWith('another editor')) harness.focusUnrelatedDraft()
      if (input.startsWith('keyboard moved into the Wiki')) harness.focusWiki()
      if (input.startsWith('a source-group choice'))
        harness.switchTabGroup(true)
      renderer.release()

      // Assert
      assert.deepEqual(await result, {
        opened: false,
        error:
          'Error: Native focus changed during repository navigation; the newer learner focus was preserved.',
      })
      assert.deepEqual(harness.revealFocus.slice(revealsBefore), [])
      assert.equal(harness.focusListenerCount(), listenersBefore)
    } finally {
      renderer.release()
      await result
    }
  })
