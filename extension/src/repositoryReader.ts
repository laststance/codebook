import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import * as vscode from 'vscode'
import type { z } from 'zod'

import {
  REPOSITORY_FIXED_READING_SECTIONS,
  REPOSITORY_READER_DEBOUNCE_MS,
  REPOSITORY_READER_READY_TIMEOUT_MS,
  REPOSITORY_SOURCE_SCHEME,
  REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE,
  REPOSITORY_WIKI_COVERED_STUDY_PANE_MESSAGE,
  REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE,
  REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE,
} from './constants'
import { requireWorkspace } from './environment'
import {
  repositorySelectionSchema,
  type LearnerDecision,
  type LearnerProgress,
  type RepositorySelection,
} from './learnerSchemas'
import type { LearningLibrary } from './learningLibrary'
import { RepositoryBookStore } from './repositoryBook'
import type { BookObservationBinding, OpenBookInput } from './repositorySchemas'
import { RepositorySourceService } from './repositorySource'
import {
  repositoryMessageSchema,
  type repositoryActionSchema,
  type RepositoryViewMessage,
} from './repositoryView'
import { sha256 } from './runtimeSupport/utils/sha256'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { repositoryHtml } from './ui/repositoryHtml'
import { adoptLateNameOfAcquiredGroup } from './utils/adoptLateNameOfAcquiredGroup'
import { adoptOwnQuietCopyShow } from './utils/adoptOwnQuietCopyShow'
import { adoptWikiGroupReturn } from './utils/adoptWikiGroupReturn'
import { citationLearningState } from './utils/citationLearningState'
import { editorTabInputKinds } from './utils/editorTabInputKinds'
import { holdsEditorTab } from './utils/holdsEditorTab'
import { isCodebookPaneViewType } from './utils/isCodebookPaneViewType'
import { isLearnersSelectionIn } from './utils/isLearnersSelectionIn'
import { isStaleGroupNameOfCitation } from './utils/isStaleGroupNameOfCitation'
import { normalizeNativeSourceText } from './utils/normalizeNativeSourceText'
import { showPlainNotice } from './utils/showPlainNotice'
import { textEditorColumn } from './utils/textEditorColumn'

/** Separates the requested text and tab receipts so native notification order cannot admit another learner target. */
export interface RepositoryFocusTarget {
  matchesEditor(): boolean
  matchesGroup(): boolean
  /** Lets citation display acquire its initial caret before the requested selection without changing layout targets. @example target.matchesEditorIdentity?.() */
  matchesEditorIdentity?: () => boolean
  /** Confirms the requested citation tab before its group activates; used only by {@link RepositoryReader.openSource}'s native focus receipt. @example target.matchesPreparedTab?.() */
  matchesPreparedTab?: () => boolean
  /** Says that {@link matchesGroup} holds only through the group the editor still names from before the target took the keyboard, as Cursor names its chat part's group until its tab model is rebuilt (Cycle 0046 row 660); the receipt then follows the editor's later name of the target's own group once. @example target.namesStaleGroup?.() // => true right after the measurement focused the first group beside Cursor's chat part */
  namesStaleGroup?: () => boolean
}

/** Hands preparation focus from {@link RepositoryReader.open} to queued native layout work without a synthetic editor. */
export interface RepositoryLayoutFocus {
  begin(): void
  acquireSourceFocus?: () => Promise<() => void>
  /** Retains passive cold-layout work until {@link RepositoryReader.open} hands it to its actual citation. @example const retained = focus.retainCurrentFocus?.() */
  retainCurrentFocus?: (acquire?: RepositoryFocusTarget) => {
    assertRetained(): void
    dispose(): void
  }
}

/**
 * Gives back the keyboard a Wiki arrangement's measurement borrowed; {@link StudyWorkspace.arrangeRepository} answers it before any effect, and {@link RepositoryReader.open} asks it once an agent's Wiki is shown (codebook_open_book, row 620).
 * @returns
 * - `true` when the keyboard is where the learner had it: nothing borrowed it, the measurement gave it back itself, or a chat tab got it back.
 * - `false` when it stays in the main editor where the measurement left it.
 * @example await keyboardReturn() // => true after Cursor's chat tab got its keyboard back
 */
export type RepositoryKeyboardReturn = () => Promise<boolean>

/** The keyboard sentences of an agent's Wiki entry that {@link RepositoryReader} told in this editor session ({@link REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE}, {@link REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE}, {@link REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE}): kept with the module, which the extension host loads once, so a reader made after a change of the workspace's folders tells none of them a second time. */
const toldAgentWikiKeyboardSentences = new Set<string>()

/**
 * Tells the learner one keyboard sentence of an agent's Wiki entry, at most once in the editor session ({@link toldAgentWikiKeyboardSentences}); called by {@link RepositoryReader}'s keyboard settling after an agent's cold Wiki entry.
 * @param sentence - One of the entry's keyboard sentences.
 * @example tellAgentWikiKeyboardOnce(REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE) // told now; a second call tells nothing
 */
function tellAgentWikiKeyboardOnce(sentence: string): void {
  if (toldAgentWikiKeyboardSentences.has(sentence)) return
  toldAgentWikiKeyboardSentences.add(sentence)
  void showPlainNotice(vscode.window, 'information', sentence)
}

/** The text editor the editor reported as active, or the Study pane that reported the keyboard, when an agent's cold Wiki entry began ({@link RepositoryReader.noteAgentEntryKeyboardEditor}): the place the keyboard was in, or may have been in, before the Wiki was shown (Cycle 0046 rows 694 and 705). */
interface AgentEntryKeyboardEditor {
  /** The view column of its group. */
  column: vscode.ViewColumn
  /** Whether the learner was known to type in it then ({@link RepositoryControls.knowsLearnerTypesInActiveEditor}, or the Study pane's own report). */
  learnerTypesThere: boolean
  /** `'study pane'` for the Study pane's report ({@link RepositoryControls.studyPaneKeyboardColumn}); `'file'` for the active text editor. */
  place: 'file' | 'study pane'
}

interface RepositoryControls {
  storage(): Promise<LearningLibrary>
  connect(): Promise<void>
  arrange(
    signal: AbortSignal,
    returnSelection?: RepositorySelection,
    focus?: RepositoryLayoutFocus,
  ): Promise<RepositoryKeyboardReturn | undefined>
  evidence(
    binding: BookObservationBinding,
    recording: boolean,
    signal: AbortSignal,
    origin: RepositorySelection,
  ): Promise<void>
  /** Says whether the learner is known to type in the active text editor now, by a fresh sign of the learner's own hand there ({@link StudyWorkspace.knowsLearnerTypesInActiveEditor}); asked when an agent's cold Wiki entry begins (row 694). Without it nothing is known. */
  knowsLearnerTypesInActiveEditor?(): boolean
  /** Names the column of the Study pane while its document reports that it has the keyboard ({@link StudyWorkspace.studyPaneKeyboardColumn}); asked first whenever an agent's cold Wiki entry begins, before the active text editor, which the editor goes on reporting while the learner works in the pane (rows 705 and 729). Without it no pane is known. */
  studyPaneKeyboardColumn?(): vscode.ViewColumn | undefined
}

/** Owns repository reading/navigation while {@link RepositoryBookStore} seals content and {@link LearningLibrary} owns shared choices. @example await reader.open() */
export class RepositoryReader {
  private initializing?: Promise<RepositoryBookStore>
  private store?: RepositoryBookStore
  private workspacePath?: string
  private panel?: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []
  private readonly watchers: vscode.Disposable[] = []
  private readonly changes = new vscode.EventEmitter<void>()
  private catalog: RepositoryViewMessage['catalog'] = []
  private book?: Awaited<ReturnType<RepositoryBookStore['read']>>
  private selection?: RepositorySelection
  private progress?: LearnerProgress
  private pendingDecision?: LearnerDecision
  private sourceStates: RepositoryViewMessage['sources'] = []
  private error?: string
  private loading = false
  private saving = false
  private disposed = false
  private generation = 0
  private navigation = new AbortController()
  private revision = 0
  private statusGeneration = 0
  private refreshTimer?: ReturnType<typeof setTimeout>
  private sourceUri?: vscode.Uri
  /** The URIs of the cited-source copies this reader showed ({@link openSource}) that are still open: the copies its Wiki's close and its next citation retire, and no other (Cycle 0046 row 662). Each citation has a URI of its own ({@link openSourceDocument}); a URI whose last copy closed is forgotten ({@link forgetClosedCitedSources}, row 677). */
  private readonly shownCitedSources = new Set<string>()
  /** The citation's copy an agent's read of the open Wiki shows without the keyboard ({@link showQuietCopy}), for the open that shows it, until that open settles: the native focus changes its show explains ({@link isOwnQuietCopyShowPlace}), and whether the show opened a tab that a refused open must close again ({@link retireCopyOfRefusedOpen}); Cycle 0046 row 696. */
  private quietCopyShow?: {
    uri: string
    generation: number
    opensTab: boolean
    shown: boolean
  }
  /** A primary file keeps its native input until the learner selects the Wiki; {@link revealDeferredSource} then pays this preview. */
  private sourceDeferred = false
  /** A command outside Study defers its original layout until the learner selects Wiki; {@link revealDeferredSource} completes that Return. */
  private deferredReturn?: RepositorySelection
  /** Prevents a focus callback from superseding an {@link open} whose final source checks are still pending. */
  private openingGeneration?: number
  private sourcePreviewRequest = 0
  /** Only the current visible document may acknowledge the model that {@link revealReadyPanel} will activate. */
  private documentReady = false
  private rendered?: {
    revision: number
    selection?: RepositorySelection
    width: number
  }

  constructor(private readonly controls: RepositoryControls) {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        REPOSITORY_SOURCE_SCHEME,
        { provideTextDocumentContent: (uri) => this.sourceText(uri) },
      ),
      vscode.window.registerTreeDataProvider('codebook.repositoryWiki', {
        onDidChangeTreeData: this.changes.event,
        getChildren: () =>
          this.catalog.length
            ? this.catalog
            : [
                {
                  bookId: '',
                  title: 'Open Repository Wiki',
                  status: 'available' as const,
                },
              ],
        getTreeItem: (entry) => ({
          label: entry.title ?? entry.bookId,
          description:
            entry.status === 'unavailable'
              ? 'Unavailable'
              : entry.revision
                ? `Revision ${entry.revision}`
                : undefined,
          tooltip: entry.reason,
          command: {
            command: 'codebook.openRepositoryWiki',
            title: 'Open Repository Wiki',
            arguments:
              entry.revision && entry.firstNodeId
                ? [
                    {
                      bookId: entry.bookId,
                      revision: entry.revision,
                      nodeId: entry.firstNodeId,
                      anchorIndex: 0,
                    },
                  ]
                : [],
          },
        }),
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.selectedNode()?.anchors.some(
            (anchor) =>
              join(this.store!.sources.workspace, anchor.path) ===
              event.document.uri.fsPath,
          )
        )
          this.scheduleRefresh()
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) =>
        this.forgetClosedCitedSources(event.closed),
      ),
    )
    // A reader made after a change of the folders or a restart of the extension host retires the copies the reader before it left (row 652).
    this.retireCopiesOfEarlierReaders()
  }

  /** Lazily shares the existing ledger without starting Chrome, a debugger, or a study run. @example service.repository = await reader.storage() */
  async storage(): Promise<RepositoryBookStore> {
    if (this.disposed) throw new Error('Repository reader is disposed.')
    this.initializing ??= (async () => {
      const workspacePath = requireWorkspace(),
        root = await realpath(workspacePath),
        library = await this.controls.storage()
      if (
        this.disposed ||
        requireWorkspace() !== workspacePath ||
        library.workspaceKey !== sha256(root)
      )
        throw new Error('Repository workspace changed during initialization.')
      this.workspacePath = workspacePath
      return (this.store = new RepositoryBookStore(
        new RepositorySourceService(root),
        library,
      ))
    })()
    try {
      const store = await this.initializing
      this.assertOwner()
      return store
    } catch (error) {
      if (!this.store) this.initializing = undefined
      throw error
    }
  }

  /**
   * Opens an exact article; {@link openFromAgent} keeps existing native input while learner navigation activates the Wiki.
   * @param restoreReadingLayout - Restore the actual Study Return's saved native arrangement.
   * @param preserveNativeInput - Existing-Wiki agent reads and external Return commands keep native input; cold entry still activates its reader.
   * @param forAgent - `true` for codebook_open_book ({@link openFromAgent}): a cold entry shows the cited source and the Wiki without the keyboard, which stays where the learner had it (the chat view's input in VS Code); a keyboard its layout's measurement borrowed goes back through the arrangement's {@link RepositoryKeyboardReturn} (Cursor's chat tab), or to the Wiki with a notice told once (row 620). An external Return command's cold entry still activates the Wiki.
   * @example await reader.open(selection)
   */
  async open(
    input?: RepositorySelection,
    signal?: AbortSignal,
    restoreReadingLayout = false,
    preserveNativeInput = false,
    forAgent = false,
  ): Promise<void> {
    signal?.throwIfAborted()
    this.navigation.abort()
    this.navigation = new AbortController()
    const navigation = this.navigation,
      cancel = (): void => navigation.abort(signal?.reason)
    signal?.addEventListener('abort', cancel, { once: true })
    const generation = ++this.generation
    this.openingGeneration = generation
    const background = preserveNativeInput && Boolean(this.panel),
      coldAgentEntry = forAgent && !this.panel,
      initiatingEditor = vscode.window.activeTextEditor,
      agentEntryKeyboardEditor =
        this.noteAgentEntryKeyboardEditor(coldAgentEntry)
    this.sourceDeferred = false
    this.deferredReturn = undefined
    this.sourcePreviewRequest++
    this.loading = true
    this.error = undefined
    const initialFocus = this.retainNativeFocus()
    let sourceFocus:
      ReturnType<RepositoryReader['retainNativeFocus']> | undefined
    let coldFocus:
      | ReturnType<NonNullable<RepositoryLayoutFocus['retainCurrentFocus']>>
      | undefined
    let anchoredSource: { uri: vscode.Uri; assertFocused(): void } | undefined
    let keyboardReturn: RepositoryKeyboardReturn | undefined
    try {
      const store = await this.storage()
      this.assertCurrent(generation)
      const [catalog, learner] = await Promise.all([
        store.list(),
        store.library.readProgress().then(
          (progress) => ({ progress, error: undefined }),
          (error) => ({
            progress: undefined,
            error: `Learning storage unavailable: ${String(error)}`,
          }),
        ),
      ])
      this.assertCurrent(generation)
      initialFocus.assertRetained()
      const { progress } = learner
      this.catalog = catalog
      this.progress = progress
      this.error = learner.error
      this.changes.fire()
      const first = catalog.find((entry) => entry.status === 'available')
      const requested =
        input ??
        progress?.repositorySelection ??
        this.selection ??
        (first?.revision && first.firstNodeId
          ? {
              bookId: first.bookId,
              revision: first.revision,
              nodeId: first.firstNodeId,
              anchorIndex: 0,
            }
          : undefined)
      const selection = requested && repositorySelectionSchema.parse(requested)
      const book =
        selection && (await store.read(selection.bookId, selection.revision))
      this.assertCurrent(generation)
      initialFocus.assertRetained()
      // Invalid article/citation/section input must fail before any native effect or temporary focus anchor.
      this.assertRequestedArticle(selection, book)
      // Disable the old article and its queued focus restoration before native layout acquisition.
      this.publish()
      const acquireSourceFocus =
        selection && book
          ? async () => {
              this.assertCurrent(generation)
              coldFocus?.assertRetained()
              const preparingFocus = this.retainNativeFocus()
              let opened: Awaited<ReturnType<RepositoryReader['openSource']>>
              try {
                opened = await this.openSource(
                  selection,
                  book,
                  generation,
                  false,
                  () => {
                    preparingFocus.assertRetained()
                    coldFocus?.assertRetained()
                    // The pre-display citation listener owns the intended focus change; never adopt response-time learner input.
                    coldFocus?.dispose()
                  },
                )
              } finally {
                preparingFocus.dispose()
              }
              sourceFocus?.dispose()
              sourceFocus = opened.focus
              this.assertCurrent(generation)
              const editor = vscode.window.activeTextEditor,
                group = vscode.window.tabGroups.activeTabGroup,
                nativeInput = vscode.window.tabGroups.all.find(
                  (candidate) => candidate.viewColumn === vscode.ViewColumn.One,
                )?.activeTab?.input
              // The citation's group is the first one, or the group Cursor still names from before the citation took the keyboard there (row 660).
              if (
                editor !== opened.editor ||
                editor.viewColumn !== vscode.ViewColumn.One ||
                (group.viewColumn !== vscode.ViewColumn.One &&
                  !isStaleGroupNameOfCitation(
                    {
                      namedBefore: opened.namedColumnBefore,
                      namedNow: group.viewColumn,
                      citation: vscode.ViewColumn.One,
                    },
                    true,
                  )) ||
                !(nativeInput instanceof vscode.TabInputText) ||
                nativeInput.uri.toString() !== opened.uri.toString()
              )
                throw new Error(
                  'The selected citation did not acquire identifiable primary editor focus.',
                )
              const assertFocused = (): void => {
                this.assertCurrent(generation)
                sourceFocus!.assertRetained()
              }
              anchoredSource = { uri: opened.uri, assertFocused }
              return assertFocused
            }
          : undefined
      // Quiet agent reads keep the owned Wiki's arrangement and the learner's existing native input.
      if (background && selection && book) {
        // An external Return cannot arrange source panes over the input it must preserve.
        this.deferredReturn = restoreReadingLayout ? selection : undefined
        anchoredSource = await this.prepareBackgroundSource(
          selection,
          book,
          generation,
          initialFocus,
          initiatingEditor,
        )
      } else {
        keyboardReturn = await this.controls.arrange(
          navigation.signal,
          restoreReadingLayout ? input : undefined,
          {
            // Check after native initialization/queueing, before scope work can capture newer learner focus as its own.
            begin: () => {
              this.assertCurrent(generation)
              initialFocus.assertRetained()
              initialFocus.dispose()
            },
            acquireSourceFocus,
            retainCurrentFocus: (acquire) => {
              this.assertCurrent(generation)
              coldFocus?.assertRetained()
              coldFocus?.dispose()
              const retained = this.retainNativeFocus(acquire),
                receipt = {
                  assertRetained: (): void => {
                    this.assertCurrent(generation)
                    retained.assertRetained()
                  },
                  dispose: (): void => {
                    retained.dispose()
                    if (coldFocus === receipt) coldFocus = undefined
                  },
                }
              coldFocus = receipt
              return receipt
            },
          },
        )
      }
      this.assertCurrent(generation)
      coldFocus?.assertRetained()
      anchoredSource?.assertFocused()
      if (!background) initialFocus.dispose()
      // Only the cold-layout receipt changes entry order; retained Study and actual Return keep their existing handoff. An agent's entry gives the cited source no keyboard (row 620).
      if (coldFocus && acquireSourceFocus && !anchoredSource && !coldAgentEntry)
        await acquireSourceFocus()
      // An empty catalog has no later I/O or citation, and an agent's entry takes no keyboard for one: release immediately before the Wiki is shown.
      if (!selection || !book || coldAgentEntry) {
        coldFocus?.assertRetained()
        coldFocus?.dispose()
      }
      // An agent's cold entry shows the Wiki without taking the keyboard from the learner (codebook_open_book).
      this.ensurePanel(Boolean(anchoredSource) || coldAgentEntry)
      this.publish()
      if (selection && book) {
        await this.load(selection, book, generation, anchoredSource)
        await this.payReadyBackgroundPreview(background, initialFocus)
      } else {
        this.book = undefined
        this.selection = undefined
        this.loading = false
        this.publish()
      }
      this.assertCurrent(generation)
      coldFocus?.assertRetained()
      anchoredSource?.assertFocused()
      // Hand the settled source/layout input directly to the renderer phase's own native focus receipt.
      coldFocus?.dispose()
      sourceFocus?.dispose()
      if (!background) {
        // Native reveal can recreate a hidden document; keep input ownership until that exact article acknowledges rendering.
        await this.revealReadyPanel(
          generation,
          navigation.signal,
          undefined,
          !coldAgentEntry,
        )
        if (coldAgentEntry)
          await this.settleAgentEntryKeyboard(
            keyboardReturn,
            this.panel,
            agentEntryKeyboardEditor,
          )
      } else {
        await this.completeDeferredReturn(signal, initialFocus)
      }
      // The citation shown for this article replaces an earlier citation's copy; a citation that waits for the Wiki's selection replaces it once shown (row 652).
      if (
        generation === this.generation &&
        !this.sourceDeferred &&
        this.sourceUri
      )
        this.retireStaleCitedSources(this.sourceUri)
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        this.error = String(error)
        this.loading = false
        // A refused agent's read leaves no copy of its own behind (row 696).
        this.retireCopyOfRefusedOpen(generation)
        this.publish()
      }
      throw error
    } finally {
      // A superseded caller cannot clear a newer opening's focus guard.
      if (this.openingGeneration === generation)
        this.openingGeneration = undefined
      this.endQuietCopyShow(generation)
      initialFocus.dispose()
      coldFocus?.dispose()
      sourceFocus?.dispose()
      signal?.removeEventListener('abort', cancel)
    }
  }

  /**
   * Hands intentional {@link open} input to a ready Wiki document, including one recreated after hiding.
   * @param generation - Rejects a Close or newer navigation instead of activating its old panel.
   * @param signal - Cancels the current navigation's bounded renderer wait.
   * @param assertSelectedInput - Retains an already-selected Wiki during deferred citation work without another quiet selection.
   * @param activate - `false` for an agent's cold entry ({@link open} with `forAgent`): the Wiki is shown and rendered without the keyboard, and no activating reveal follows.
   * @returns Completion of the current article's render acknowledgement and native handoff, not a pixel-paint guarantee.
   * @throws A renderer timeout, cancellation or newer native-input error; no activating reveal follows a failed wait.
   * @example await this.revealReadyPanel(generation, navigation.signal)
   */
  private async revealReadyPanel(
    generation: number,
    signal: AbortSignal,
    assertSelectedInput?: () => void,
    activate = true,
  ): Promise<void> {
    this.assertCurrent(generation)
    const panel = this.panel
    if (!panel) throw new Error('Repository Wiki panel is unavailable.')
    let quietRevealIssued = false,
      quietSelectionAccepted = false,
      quietRevealAcknowledged = false
    const revision = this.revision,
      focus = this.retainNativeFocus(undefined, () => {
        const expected = quietRevealIssued && this.hasNativeWikiFocus()
        quietSelectionAccepted ||= expected
        return expected
      })
    const windowFocus = this.retainWindowFocus(),
      revealState = panel.onDidChangeViewState(() => {
        // A quiet display can be visible without keyboard focus; confirm its own native view-state notification.
        if (quietRevealIssued && panel.visible && this.hasNativeWikiFocus())
          quietRevealAcknowledged = true
      }),
      assertInputRetained = (): void => {
        assertSelectedInput?.()
        focus.assertRetained()
        windowFocus.assertRetained()
      }
    try {
      assertInputRetained()
      // Ready visible documents receive updated models without a queued tab selection that could cover newer input.
      if (this.needsNativeDocumentReveal(panel, Boolean(assertSelectedInput))) {
        quietRevealIssued = true
        this.revealPanel(panel, true)
      }
      await waitUntil(
        () => {
          this.assertCurrent(generation)
          assertInputRetained()
          return this.rendered?.revision === revision
        },
        'the current Repository Wiki article to render',
        REPOSITORY_READER_READY_TIMEOUT_MS,
        signal,
      )
      // A renderer acknowledgement cannot authorize activation over a newer learner choice.
      this.assertCurrent(generation)
      assertInputRetained()
      focus.dispose()
      windowFocus.dispose()
      revealState.dispose()
      // An agent's cold entry leaves the keyboard where the learner had it; the learner selects the Wiki when ready.
      if (activate)
        this.activateReadyPanel(
          panel,
          quietSelectionAccepted,
          quietRevealAcknowledged,
        )
    } finally {
      focus.dispose()
      windowFocus.dispose()
      revealState.dispose()
    }
  }

  /** Retains window ownership across source acquisition and rendering for {@link revealDeferredCitation} and {@link revealReadyPanel}. @returns A sticky departure assertion and its listener cleanup. @example const focus = this.retainWindowFocus(); focus.assertRetained(); focus.dispose() */
  private retainWindowFocus() {
    let departed = !vscode.window.state.focused
    const listener = vscode.window.onDidChangeWindowState((state) => {
      // A later window return cannot revive the earlier input handoff.
      departed ||= !state.focused
    })
    return {
      assertRetained(): void {
        if (departed || !vscode.window.state.focused)
          throw new Error(
            'Native window focus changed while the Repository Wiki loaded; the newer learner focus was preserved.',
          )
      },
      dispose(): void {
        listener.dispose()
      },
    }
  }

  /** Prevents {@link revealReadyPanel} from reselecting a ready visible document while its updated model is pending. @param panel - The navigation-owned native pane. @param alreadySelected - A deferred citation already owns its visible native selection. @returns Whether a hidden or unready document needs an actual native display. @example this.needsNativeDocumentReveal(panel) */
  private needsNativeDocumentReveal(
    panel: vscode.WebviewPanel,
    alreadySelected = false,
  ): boolean {
    return !panel.visible || (!alreadySelected && !this.documentReady)
  }

  /** Tests whether {@link revealDeferredCitation} must complete the current document's handoff before native activation. @param panel - The same navigation-owned native pane. @param revision - The article whose receipt can permit handoff. @returns True when visibility or the current render receipt is missing. @example this.needsDocumentHandoff(panel, revision) */
  private needsDocumentHandoff(
    panel: vscode.WebviewPanel,
    revision: number,
  ): boolean {
    return !panel.visible || this.rendered?.revision !== revision
  }

  /** Applies the current native column policy for both quiet and activating {@link revealReadyPanel} displays. @param panel - The current navigation's pane, whose latest placement is respected. @param preserveFocus - Keeps input while the document loads; false pays the validated ready handoff. @example this.revealPanel(panel, true) */
  private revealPanel(
    panel: vscode.WebviewPanel,
    preserveFocus: boolean,
  ): void {
    panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Two, preserveFocus)
  }

  /** Commits {@link revealReadyPanel}'s handoff after the own visible-state and selected-tab confirmation. @param panel - The current ready pane. @param selectionAccepted - Whether a quiet reveal changed the native group selection. @param visibleAcknowledged - Whether that display received its native view-state notification. @example this.activateReadyPanel(panel, true, true) */
  private activateReadyPanel(
    panel: vscode.WebviewPanel,
    selectionAccepted: boolean,
    visibleAcknowledged: boolean,
  ): void {
    // Preserving focus does not promise an active panel; it must still be the acknowledged selected Wiki tab.
    if (
      selectionAccepted &&
      (!visibleAcknowledged || !this.hasNativeWikiFocus())
    )
      throw new Error(
        'Native focus changed during repository navigation; the newer learner focus was preserved.',
      )
    this.revealPanel(panel, false)
  }

  /**
   * Settles the keyboard once an agent's cold Wiki is shown ({@link open} with `forAgent`, codebook_open_book, row 620): the arrangement's {@link RepositoryKeyboardReturn} gives back what its measurement borrowed (Cursor's chat tab); a keyboard it cannot give back goes to the Wiki, no file, and the learner is told once in the editor session ({@link REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE}). A keyboard that stayed where the learner had it is settled by {@link settleCoveredEditorKeyboard}: the Wiki may stand in front of that file now (row 694).
   * @param keyboardReturn - The arrangement's return, `undefined` when the entry arranged nothing.
   * @param panel - The Wiki the entry showed.
   * @param keyboardEditor - The text editor the editor reported as active when the entry began ({@link noteAgentEntryKeyboardEditor}).
   * @example await this.settleAgentEntryKeyboard(keyboardReturn, this.panel, keyboardEditor) // Cursor: the chat tab has its keyboard again
   */
  private async settleAgentEntryKeyboard(
    keyboardReturn: RepositoryKeyboardReturn | undefined,
    panel: vscode.WebviewPanel | undefined,
    keyboardEditor: AgentEntryKeyboardEditor | undefined,
  ): Promise<void> {
    if (!panel) return
    const answer = await this.returnAgentEntryKeyboard(keyboardReturn)
    // A newer choice of the learner keeps its keyboard and is told nothing.
    if (answer === 'newer' || this.panel !== panel) return
    if (answer === 'returned') {
      this.settleCoveredEditorKeyboard(panel, keyboardEditor)
      return
    }
    this.revealPanel(panel, false)
    tellAgentWikiKeyboardOnce(REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE)
  }

  /**
   * Asks the arrangement to give back the keyboard its measurement borrowed, for {@link settleAgentEntryKeyboard}.
   * @param keyboardReturn - The arrangement's return, `undefined` when the entry arranged nothing.
   * @returns
   * - `'returned'` when the keyboard is where the learner had it, or back there, and when nothing was arranged
   * - `'kept'` when it stays where the measurement left it, with no newer choice of the learner's since
   * - `'newer'` when the learner chose another place meanwhile, or the return failed
   * @example await this.returnAgentEntryKeyboard(keyboardReturn) // => 'returned' after Cursor's chat tab got its keyboard back
   */
  private async returnAgentEntryKeyboard(
    keyboardReturn: RepositoryKeyboardReturn | undefined,
  ): Promise<'returned' | 'kept' | 'newer'> {
    if (!keyboardReturn) return 'returned'
    const unchanged = this.retainNativeFocus()
    try {
      if (await keyboardReturn()) return 'returned'
      unchanged.assertRetained()
      return 'kept'
    } catch {
      return 'newer'
    } finally {
      unchanged.dispose()
    }
  }

  /**
   * Notes where the keyboard is when an agent's cold Wiki entry begins, for {@link settleCoveredEditorKeyboard}; called first by {@link open}, before any effect (Cycle 0046 row 694).
   * The Study pane, while it is the editor's active pane and its document reports the keyboard ({@link RepositoryControls.studyPaneKeyboardColumn}), is noted first: its report is the learner's sign (row 705), and the editor goes on reporting the last text editor while the learner works in the pane they reached by its tab (rows 659 and 671; row 729). Otherwise the text editor the editor reports as active is noted, with whether the learner is known to type in it ({@link RepositoryControls.knowsLearnerTypesInActiveEditor}); a side of a diff editor, which both editors report with no view column, is noted in its diff's group ({@link textEditorColumn}, row 709).
   * @param coldAgentEntry - Whether the entry is an agent's into a window without the Wiki.
   * @returns The pane's or the editor's column and the learner's sign; `undefined` for any other entry, and with neither a Study pane that reports the keyboard nor an active text editor.
   * @example this.noteAgentEntryKeyboardEditor(true) // => { column: 2, learnerTypesThere: true, place: 'file' } a second after the learner typed in auth.ts in front of the second group
   */
  private noteAgentEntryKeyboardEditor(
    coldAgentEntry: boolean,
  ): AgentEntryKeyboardEditor | undefined {
    if (!coldAgentEntry) return undefined
    // A Study pane that reports the keyboard is where the learner works, whatever text editor the editor still reports (rows 705 and 729).
    const paneColumn = this.controls.studyPaneKeyboardColumn?.()
    if (paneColumn !== undefined)
      return {
        column: paneColumn,
        learnerTypesThere: true,
        place: 'study pane',
      }
    // A side of a diff editor has no view column of its own; its diff's group places it (row 709).
    const column = textEditorColumn(
      vscode.window.activeTextEditor,
      vscode.window.tabGroups.all,
      Reflect.get(vscode, 'TabInputTextDiff'),
    )
    return column === undefined
      ? undefined
      : {
          column,
          learnerTypesThere: Boolean(
            this.controls.knowsLearnerTypesInActiveEditor?.(),
          ),
          place: 'file',
        }
  }

  /**
   * Settles the keyboard of the file an agent's cold Wiki was created in front of, for {@link settleAgentEntryKeyboard} once that keyboard stayed where the learner had it (Cycle 0046 row 694).
   * The Wiki is created in the second group without the keyboard ({@link ensurePanel}); a webview created in front of the text editor that has the keyboard hides that editor, and the keyboard falls to the page body, where nothing types (C60, both hosts: `auth.ts` in front of column 2 with the keyboard, then BODY to the end). Both editors report the learner's last file as the active text editor also while a view, the terminal or VS Code's chat view has the keyboard (rows 612 and 656), which the Wiki leaves where it is, so only a known sign of the learner's own hand in that file decides: then the Wiki gets the keyboard and the learner is told so ({@link REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE}); otherwise nothing is focused and the learner is told what may have happened ({@link REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE}). A Study pane the Wiki covers while its document reported the keyboard loses it the same way, and its report is the learner's sign: the Wiki gets the keyboard and the pane's sentence is told ({@link REPOSITORY_WIKI_COVERED_STUDY_PANE_MESSAGE}, row 705). Each sentence is told once in the editor session.
   * @param panel - The Wiki the entry showed.
   * @param keyboardEditor - The Study pane or the text editor noted when the entry began ({@link noteAgentEntryKeyboardEditor}).
   * @example this.settleCoveredEditorKeyboard(panel, { column: 2, learnerTypesThere: true, place: 'file' }) // the Wiki has the keyboard, and the learner is told once
   */
  private settleCoveredEditorKeyboard(
    panel: vscode.WebviewPanel,
    keyboardEditor: AgentEntryKeyboardEditor | undefined,
  ): void {
    if (!keyboardEditor || !this.coversEditorColumn(panel, keyboardEditor))
      return
    if (keyboardEditor.learnerTypesThere) {
      this.revealPanel(panel, false)
      tellAgentWikiKeyboardOnce(
        keyboardEditor.place === 'study pane'
          ? REPOSITORY_WIKI_COVERED_STUDY_PANE_MESSAGE
          : REPOSITORY_WIKI_COVERED_TYPED_FILE_MESSAGE,
      )
    } else tellAgentWikiKeyboardOnce(REPOSITORY_WIKI_COVERED_OPEN_FILE_MESSAGE)
  }

  /**
   * Says whether the Wiki now stands in front of the group of the text editor or the Study pane that had the keyboard when an agent's entry began, with no text editor active since; asked by {@link settleCoveredEditorKeyboard}.
   * @param panel - The Wiki the entry showed.
   * @param keyboardEditor - That text editor's or pane's column.
   * @returns `true` while the Wiki is that group's front tab and no text editor is active; `false` once the learner brought a text editor to the front, there or elsewhere, and for the Wiki in another group.
   * @example this.coversEditorColumn(panel, { column: 2, learnerTypesThere: false, place: 'file' }) // => true right after the Wiki was created in front of auth.ts
   */
  private coversEditorColumn(
    panel: vscode.WebviewPanel,
    keyboardEditor: AgentEntryKeyboardEditor,
  ): boolean {
    const front = vscode.window.tabGroups.all.find(
      (group) => group.viewColumn === keyboardEditor.column,
    )?.activeTab
    return (
      panel.viewColumn === keyboardEditor.column &&
      this.isWikiTab(front) &&
      !vscode.window.activeTextEditor
    )
  }

  /** Returns the exact prepared source URI after MCP article navigation; a focused primary file defers its preview until native Wiki selection, and a cold Wiki is shown without the keyboard. @example await reader.openFromAgent(input) */
  async openFromAgent(input: OpenBookInput, signal?: AbortSignal) {
    await this.open(
      {
        bookId: input.bookId,
        revision: input.revision,
        nodeId: input.nodeId,
        anchorIndex: input.anchorIndex ?? 0,
      },
      signal,
      false,
      true,
      true,
    )
    signal?.throwIfAborted()
    if (
      !this.selection ||
      this.selection.bookId !== input.bookId ||
      this.selection.revision !== input.revision ||
      this.selection.nodeId !== input.nodeId ||
      this.selection.anchorIndex !== (input.anchorIndex ?? 0) ||
      !this.sourceUri
    )
      throw new Error('Article changed before open receipt.')
    return {
      bookId: input.bookId,
      revision: input.revision,
      nodeId: input.nodeId,
      anchorIndex: this.selection.anchorIndex,
      sourceUri: this.sourceUri.toString(),
    }
  }

  /** Refreshes discovery after publication without changing the learner's selected historical revision. @example await reader.published() */
  async published(): Promise<void> {
    const generation = this.generation,
      store = await this.storage(),
      catalog = await store.list()
    if (generation !== this.generation || this.disposed) return
    this.catalog = catalog
    this.changes.fire()
    if (this.book)
      this.book = {
        ...this.book,
        latestRevision:
          catalog.find((entry) => entry.bookId === this.book!.bookId)
            ?.revision ?? this.book.latestRevision,
      }
    this.publish()
  }

  /** Writes an explicit complete-citation intent, preserving its original identity for Retry after any navigation. @example await reader.understand(true) */
  async understand(understood: boolean): Promise<void> {
    this.assertOwner()
    const node = this.selectedNode(),
      selection = this.selection,
      store = this.store
    if (
      this.loading ||
      this.saving ||
      !node ||
      !selection ||
      !store ||
      !this.progress
    )
      throw new Error('Wait for readable article and learning storage.')
    if (this.pendingDecision)
      throw new Error(
        'Retry the previous unsaved understanding choice before creating another.',
      )
    const state = citationLearningState(
      this.progress,
      node.learningItemId ?? `repository/${selection.bookId}/${node.id}`,
      node.anchors,
    )
    this.pendingDecision = {
      id: randomUUID(),
      item: node.learningItemId ?? `repository/${selection.bookId}/${node.id}`,
      sourceHash: node.anchors[0]!.hash,
      context: state.context,
      understood,
      at: new Date().toISOString(),
    }
    await this.saveDecision()
  }

  /** Executes explicit reader actions without borrowing live runtime authority. @example await reader.action('latest') */
  async action(action: z.infer<typeof repositoryActionSchema>): Promise<void> {
    this.assertOwner()
    if (action === 'connect') {
      await this.controls.connect()
      return
    }
    if (action === 'retry' && this.pendingDecision) await this.saveDecision()
    if (action === 'refresh' || action === 'retry') {
      await this.open(this.selection)
      return
    }
    if (!this.selection || !this.book)
      throw new Error('Select an article first.')
    if (action === 'latest') {
      await this.open({
        ...this.selection,
        revision: this.book.latestRevision,
        location: undefined,
      })
      return
    }
    if (action === 'source') await this.revealSource(this.generation)
    if (action === 'current-file') {
      const generation = this.generation,
        anchor = this.selectedNode()!.anchors[this.selection.anchorIndex]!
      const source = await this.store!.sources.read(anchor.path, anchor.hash)
      this.assertCurrent(generation)
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(join(this.store!.sources.workspace, anchor.path)),
      )
      this.assertCurrent(generation)
      // Native text models omit BOM and normalize mixed line endings; exact disk bytes were verified above.
      if (
        document.isDirty ||
        normalizeNativeSourceText(document.getText()) !==
          normalizeNativeSourceText(source.text)
      )
        throw new Error(
          'Current editor text differs from the citation; retained source remains available.',
        )
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
        selection: this.range(anchor.startLine, anchor.endLine),
      })
      this.assertCurrent(generation)
    }
  }

  /** Saves the exact return location before validating and opening retained observation/replay evidence. @example await reader.evidence(selection, 0, true) */
  async evidence(
    input: RepositorySelection,
    linkIndex: number,
    recording: boolean,
  ): Promise<void> {
    const generation = this.generation
    this.assertSelection(input)
    await this.remember(input)
    this.assertCurrent(generation)
    const book = await this.store!.read(input.bookId, input.revision)
    this.assertCurrent(generation)
    const binding = book.links.find(
      (value) => value.nodeId === input.nodeId && value.linkIndex === linkIndex,
    )
    if (!binding || binding.status !== 'available')
      throw new Error(binding?.reason ?? 'Selected observation is unavailable.')
    if (recording && binding.recording.status !== 'available')
      throw new Error(binding.recording.reason)
    // Only admitted history navigation cancels a preview; refused evidence keeps even an already-started citation.
    this.sourcePreviewRequest++
    this.sourceDeferred = false
    this.deferredReturn = undefined
    await this.controls.evidence(
      binding,
      recording,
      this.navigation.signal,
      input,
    )
    this.assertCurrent(generation)
  }

  /**
   * Cancels pending navigation before panel disposal so old successes/errors cannot reopen the reader; called by Close Repository Wiki and by {@link dispose}.
   * The Wiki's close also retires the cited-source tabs the reader showed ({@link retireCitedSourceTabs}, row 641); a {@link dispose} for the window's close or a change of its folders leaves the editor's tabs as they are: neither editor restores such a tab in the next window, and the reader made after a folder change retires what is left ({@link retireStaleCitedSources}, row 652).
   * @example reader.close()
   */
  close(): void {
    this.sourceDeferred = false
    this.deferredReturn = undefined
    this.sourcePreviewRequest++
    this.navigation.abort()
    this.generation++
    this.statusGeneration++
    clearTimeout(this.refreshTimer)
    this.loading = false
    const panel = this.panel
    this.panel = undefined
    panel?.dispose()
    this.clearWatchers()
    if (panel && !this.disposed) this.retireCitedSourceTabs()
  }

  /**
   * Closes the read-only cited-source tabs this reader showed once its Wiki closes, so the learner's own front tab of their groups comes back; called by {@link close} (Close Repository Wiki) and when the Wiki's tab is closed by hand ({@link ensurePanel}), Cycle 0046 row 641.
   * The reader shows a citation in front of the first group without preview (`openSource`), over the learner's own file, also for an agent's open the learner never chose; it serves the Wiki beside it, whose article, refresh and navigation no longer reach it once the Wiki is gone, and the learner's current file stays one Open Current File away. The editor brings the group's most recently active other tab to the front with its view state, the caret and scroll (VS Code 1.140.0 `workbench.desktop.main.js` 705:24141, 988:96536; Cursor 3.23.12 17264:12900, 11678:22600). A tab the learner pinned stays, and so does every cited source of a group that holds nothing else: its close would remove that group under `closeEmptyGroups` (VS Code 1106:79878). Only the copies this reader showed go ({@link shownCitedSources}, row 662): a copy an earlier reader left was settled when this reader was made ({@link retireCopiesOfEarlierReaders}), and one that stayed then, because the learner read in it, stays. A close the editor refuses leaves the tabs as they are.
   * The closing Wiki's own tab is no other tab of its group: the editor still lists it right after the panel's disposal, which reaches the editor after this call (VS Code 1.140.0 `extensionHostProcess.js` 295:115246; Cursor 3.23.12 203:121183), and it leaves with the Wiki, so a copy the learner moved beside the Wiki is its group's only tab once the Wiki is gone and stays (Cycle 0046 row 687).
   * @example this.retireCitedSourceTabs() // the learner's login-form.tsx is in front of the first group again
   */
  private retireCitedSourceTabs(): void {
    this.closeCitedSourceTabs(
      (uri) => !this.shownCitedSources.has(uri),
      (tab) => this.isWikiTab(tab),
    )
  }

  /**
   * Closes the cited-source copies of this reader's earlier citations once {@link open} or {@link revealDeferredCitation} has shown another, Cycle 0046 row 652: each citation has a copy of its own (its article, revision and citation are in the URI, {@link openSourceDocument}), so every citation followed added a tab until the Wiki closed.
   * Only the copies this reader showed go ({@link shownCitedSources}, row 662). Besides the rules of {@link retireCitedSourceTabs} (a pinned tab and the only tabs of a group stay), the copy on screen stays, and so does a copy that has the keyboard: the learner reads in it ({@link isReadInByLearner}).
   * @param shown - The copy of the citation on screen.
   * @example this.retireStaleCitedSources(opened.uri) // the module.ts copy leaves; the order.ts copy stays in front of the learner's login-form.tsx
   */
  private retireStaleCitedSources(shown: vscode.Uri): void {
    const keyboard = vscode.window.activeTextEditor
    this.closeCitedSourceTabs(
      (uri, group) =>
        !this.shownCitedSources.has(uri) ||
        uri === shown.toString() ||
        this.isReadInByLearner(uri, group, keyboard),
    )
  }

  /**
   * Closes, when a reader is made, the cited-source copies a reader before it left in the window, Cycle 0046 row 652; called once by the constructor, when this reader has shown no copy yet, so every copy present is an earlier reader's.
   * A disposed reader leaves its copies at a change of the workspace's folders and when a change of the first folder or the entry into a workspace restarts the extension host while the window stays (VS Code 1.140.0 `workbench.desktop.main.js` 4406:37553, 5281:6726; Cursor 3.23.12 20081:12211, 20392:3521); the extension makes the next reader at once. A window's close or reload brings no copy back: an editor group saves only the editors that have a serializer (VS Code 705:29495; Cursor 17264:18404), and a content provider's document opens as a resource editor input (VS Code 990:43737; Cursor 17388:51646), `workbench.editors.resourceEditorInput`, for which neither editor registers one (VS Code 705:31939 beside 993:5962; Cursor 11678:61617 beside 17388:58117).
   * A pinned copy, the only tabs of a group and a copy that has the keyboard stay ({@link isReadInByLearner}); this reader's later closes leave such a copy alone, since it never showed it ({@link retireCitedSourceTabs}, row 662).
   * @example this.retireCopiesOfEarlierReaders() // the module.ts copy the disposed reader showed leaves; the learner's login-form.tsx is in front again
   */
  private retireCopiesOfEarlierReaders(): void {
    const keyboard = vscode.window.activeTextEditor
    this.closeCitedSourceTabs((uri, group) =>
      this.isReadInByLearner(uri, group, keyboard),
    )
  }

  /**
   * Says whether a cited-source copy is the text editor that has the keyboard, which the learner reads in; asked by {@link retireStaleCitedSources} and {@link retireCopiesOfEarlierReaders}, which keep such a copy.
   * @param uri - The copy's URI.
   * @param group - The copy's group.
   * @param keyboard - The active text editor when the retirement began, `undefined` when none is active.
   * @returns `true` when the active text editor shows that copy in that group; `false` otherwise.
   * @example this.isReadInByLearner(uri, wikiGroup, vscode.window.activeTextEditor) // => true for the module.ts copy the learner clicked into beside the Wiki
   */
  private isReadInByLearner(
    uri: string,
    group: vscode.TabGroup,
    keyboard: vscode.TextEditor | undefined,
  ): boolean {
    return (
      uri === keyboard?.document.uri.toString() &&
      group.viewColumn === keyboard.viewColumn
    )
  }

  /**
   * Forgets the cited-source copies whose last tab closed, so that {@link retireCitedSourceTabs} and {@link retireStaleCitedSources} retire only the copies this reader showed that are still its own and {@link shownCitedSources} holds no URI of a closed copy; called for every change of the editor's tabs (Cycle 0046 row 677).
   * A copy the learner closed and brings back is the learner's: Reopen Closed Editor opens the closed editor's resource again, with the same URI (VS Code 1.140.0 `workbench.desktop.main.js` 1598:87610; Cursor 3.23.12 18385:80118), and the reader's content provider gives it its text. A copy the learner drags to another group stays this reader's: the editor opens it in the target group before it closes it in its own (VS Code 1106:78557; Cursor 17501:40995), so it is still open when that close is reported. A copy this reader shows again is its own again ({@link openSource}).
   * @param closed - The tabs the change closed.
   * @example this.forgetClosedCitedSources(event.closed) // the module.ts copy the learner closed is no longer this reader's
   */
  private forgetClosedCitedSources(closed: readonly vscode.Tab[]): void {
    for (const tab of closed) {
      const uri =
        tab.input instanceof vscode.TabInputText
          ? tab.input.uri.toString()
          : undefined
      // A URI still shown by another tab, such as the copy the learner moved to another group, stays this reader's.
      if (uri && !this.isOpenInAnyGroup(uri)) this.shownCitedSources.delete(uri)
    }
  }

  /**
   * Says whether any group of the window shows a text tab of a URI; asked by {@link forgetClosedCitedSources} once a tab of that URI closed.
   * @param uri - The tab's URI, as a string.
   * @returns `true` while a text tab of the URI is open in any group; `false` once none is.
   * @example this.isOpenInAnyGroup(copy.toString()) // => true while the module.ts copy the learner moved stands in the Wiki's group
   */
  private isOpenInAnyGroup(uri: string): boolean {
    return vscode.window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === uri,
      ),
    )
  }

  /**
   * Closes the cited-source tabs of every group that {@link retirableCitedSources} picks; called by {@link retireCitedSourceTabs} when the Wiki closes, by {@link retireStaleCitedSources} and by {@link retireCopiesOfEarlierReaders}. A close the editor refuses leaves the tabs as they are.
   * @param isKept - Says whether a copy stays, by its URI and its group.
   * @param isLeaving - Says whether a tab leaves its group with this retirement, so it counts as no other tab there (the closing Wiki's own, {@link retireCitedSourceTabs}); none by default.
   * @example this.closeCitedSourceTabs((uri) => !this.shownCitedSources.has(uri)) // every unpinned copy this reader showed beside another tab leaves
   */
  private closeCitedSourceTabs(
    isKept: (uri: string, group: vscode.TabGroup) => boolean,
    isLeaving: (tab: vscode.Tab) => boolean = () => false,
  ): void {
    const retired = vscode.window.tabGroups.all.flatMap((group) =>
      this.retirableCitedSources(group, isKept, isLeaving),
    )
    if (retired.length)
      void vscode.window.tabGroups.close(retired, true).then(
        () => undefined,
        () => undefined,
      )
  }

  /**
   * Picks the cited-source tabs of one group that {@link closeCitedSourceTabs} closes. Every `codebook-repository-source` tab of the window counts, whichever workspace's reader showed it, unless the caller keeps it: a copy of another workspace is one no reader serves any more ({@link sourceText} refuses its authority), and the callers keep what is not theirs to retire ({@link shownCitedSources}).
   * @param group - An editor group of the window.
   * @param isKept - Says whether a copy stays, by its URI and its group.
   * @param isLeaving - Says whether a tab leaves the group with this retirement, so it is no other tab of the group.
   * @returns
   * - The group's unpinned cited-source tabs that are not kept, while the group holds another tab too that is not leaving.
   * - No tab for a group that holds only such tabs and leaving ones, and for a group without them.
   * @example this.retirableCitedSources(firstGroup, () => false, () => false) // => [the order.ts citation tab] beside the learner's login-form.tsx
   */
  private retirableCitedSources(
    group: vscode.TabGroup,
    isKept: (uri: string, group: vscode.TabGroup) => boolean,
    isLeaving: (tab: vscode.Tab) => boolean,
  ): vscode.Tab[] {
    const cited = group.tabs.filter(
      (tab) =>
        !tab.isPinned &&
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.scheme === REPOSITORY_SOURCE_SCHEME &&
        !isKept(tab.input.uri.toString(), group),
    )
    const staying = group.tabs.filter((tab) => !isLeaving(tab))
    // A group the retirement would empty, its leaving tabs gone too, keeps its tabs.
    return cited.length < staying.length ? cited : []
  }
  /**
   * Drains publication and shared learner writes while disposing only this reader's UI ownership; called when the window closes and when a change of the workspace's folders replaces the reader.
   * What the reader registered with the editor (its source provider, its Repository Wiki view and its listeners) is released whatever closing and draining did: kept after a failure, it would be shared with the reader made in its place.
   * @throws What closing the pane or draining the writes threw, after the registrations were released.
   * @example await reader.dispose()
   */
  async dispose(): Promise<void> {
    this.disposed = true
    try {
      this.close()
      await this.initializing?.catch(() => undefined)
      await this.store?.dispose()
      await this.store?.library.flush()
    } finally {
      this.disposables.forEach((value) => value.dispose())
      this.changes.dispose()
    }
  }
  /** Tells the Study workspace whether this reader owns its Repository Wiki panel, so the live pane is never taken for one an earlier extension host left behind. @example reader.panelOpen() // false until an article is opened */
  panelOpen(): boolean {
    return Boolean(this.panel)
  }
  /**
   * Tells the Study workspace whether this reader's Repository Wiki panel is the active editor, so a Wiki tab the editor names while its panel is not active is read as the place of another editor part's chat input, not of the Wiki (Cycle 0046 row 680).
   * @returns `true` while the panel exists and the editor reports it active; `false` without a panel and while another editor or part is active.
   * @example reader.panelActive() // => false after Cursor's Focus Agent gave its chat the keyboard while the Wiki's group stays the named one
   */
  panelActive(): boolean {
    return Boolean(this.panel?.active)
  }
  /** Exposes sanitized model/render receipts for native evidence without claiming pixel verification. @example reader.inspect().rendered */
  inspect() {
    return {
      view: this.message(),
      opened: Boolean(this.panel),
      sourceUri: this.sourceUri?.toString(),
      rendered: this.rendered,
    }
  }

  /** Applies the validated article from {@link open}, retaining its actual cited-source anchor when native scope needed it. @example await this.load(selection, book, generation) */
  private async load(
    selection: RepositorySelection,
    book: NonNullable<RepositoryReader['book']>,
    generation: number,
    source?: { uri: vscode.Uri; assertFocused(): void },
  ): Promise<void> {
    this.assertCurrent(generation)
    source?.assertFocused()
    this.book = book
    this.selection = selection
    this.revision++
    this.rendered = undefined
    this.sourceUri = undefined
    this.sourceStates = []
    this.publish()
    try {
      await this.remember(selection)
    } catch (error) {
      this.assertCurrent(generation)
      this.error = `Return location not saved: ${String(error)}`
    }
    this.assertCurrent(generation)
    source?.assertFocused()
    if (source) this.sourceUri = source.uri
    else await this.revealSource(generation)
    this.assertCurrent(generation)
    source?.assertFocused()
    this.loading = false
    // Loading receipts cannot authorize keyboard handoff before the usable article is rendered.
    this.revision++
    this.rendered = undefined
    this.watchSources()
    this.publish()
    await this.refreshSources(generation)
    this.assertCurrent(generation)
    source?.assertFocused()
  }

  /** Reuses the single ledger for section-relative position and focus without changing understanding. @example await this.remember(selection) */
  private async remember(input: RepositorySelection): Promise<void> {
    this.assertSelection(input)
    const selection = repositorySelectionSchema.parse(input),
      generation = this.generation
    if (
      selection.location &&
      selection.location.sectionIndex >=
        this.selectedNode()!.sections.length + REPOSITORY_FIXED_READING_SECTIONS
    )
      throw new Error('Reading location names a missing section.')
    await this.store!.library.selectRepository(selection)
    if (generation === this.generation && !this.disposed)
      this.selection = selection
  }

  /** Persists the already accepted learner intent atomically and leaves failures explicitly retryable. @example await this.saveDecision() */
  private async saveDecision(): Promise<void> {
    if (this.saving || !this.pendingDecision)
      throw new Error('No unsaved decision is ready to retry.')
    this.saving = true
    this.publish()
    try {
      this.progress = await this.store!.library.decide(this.pendingDecision)
      this.pendingDecision = undefined
      this.error = undefined
    } catch (error) {
      this.error = `Understanding not saved: ${String(error)}`
      throw error
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /** Reveals exact copied bytes in a native read-only document with the inclusive citation selected. @example await this.revealSource(generation) */
  private async revealSource(generation: number): Promise<void> {
    const opened = await this.openSource(
      this.selection!,
      this.book!,
      generation,
      true,
    )
    this.assertCurrent(generation)
    this.sourceUri = opened.uri
  }

  /** Opens the real immutable citation for {@link revealSource} or cold scope acquisition without publishing navigation success. @example await this.openSource(selection, book, generation, false) */
  private async openSource(
    selection: RepositorySelection,
    book: NonNullable<RepositoryReader['book']>,
    generation: number,
    preserveFocus: boolean,
    assertFocus?: () => void,
  ) {
    const { uri, document, anchor } = await this.openSourceDocument(
      selection,
      book,
      generation,
    )
    assertFocus?.()
    const documentVersion = document.version,
      requestedSelection = document.validateRange(
        this.range(anchor.startLine, anchor.endLine),
      )
    const matchesEditorIdentity = () => {
      const editor = vscode.window.activeTextEditor
      return (
        editor?.document.uri.toString() === uri.toString() &&
        editor.document.version === documentVersion &&
        editor.viewColumn === vscode.ViewColumn.One
      )
    }
    /** Confirms the exact primary citation tab during {@link openSource}'s native activation, before its group owns focus. @returns Whether the prepared tab belongs to this citation. @example matchesPreparedTab() */
    const matchesPreparedTab = (): boolean => {
      const input = vscode.window.tabGroups.all.find(
        (group) => group.viewColumn === vscode.ViewColumn.One,
      )?.activeTab?.input
      return (
        input instanceof vscode.TabInputText &&
        input.uri.toString() === uri.toString()
      )
    }
    // Cursor keeps naming the group it named before (its chat part's) while the citation takes the keyboard in the first group: tab opens are no group activation for its tab model (Cursor 3.23.12 `workbench.desktop.main.js` 17269:31013), so that unchanged name is the citation's own group too (row 660).
    const namedColumnBefore = vscode.window.tabGroups.activeTabGroup.viewColumn
    /** Tells that the editor still names its group from before while the citation is in front of the first group with the keyboard. */
    const namesStaleGroup = (): boolean =>
      isStaleGroupNameOfCitation(
        {
          namedBefore: namedColumnBefore,
          namedNow: vscode.window.tabGroups.activeTabGroup.viewColumn,
          citation: vscode.ViewColumn.One,
        },
        matchesPreparedTab() && matchesEditorIdentity(),
      )
    // Observe the requested citation before display; a late response cannot adopt later learner input as its baseline.
    const focus = preserveFocus
      ? undefined
      : this.retainNativeFocus({
          matchesEditorIdentity,
          matchesPreparedTab,
          matchesEditor: () => {
            const editor = vscode.window.activeTextEditor
            return (
              matchesEditorIdentity() &&
              editor?.selections.length === 1 &&
              Boolean(
                editor.selections[0]?.anchor.isEqual(
                  requestedSelection.start,
                ) &&
                editor.selections[0].active.isEqual(requestedSelection.end),
              )
            )
          },
          namesStaleGroup,
          matchesGroup: () => {
            const group = vscode.window.tabGroups.activeTabGroup,
              input = group.activeTab?.input
            if (namesStaleGroup()) return true
            return (
              group.viewColumn === vscode.ViewColumn.One &&
              input instanceof vscode.TabInputText &&
              input.uri.toString() === uri.toString()
            )
          },
        })
    // Native editors may normalize BOM/CRLF in getText; the provider/hash seal retains original bytes.
    try {
      const editor = await this.showCitedSourceCopy(uri, () =>
        vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One,
          preview: false,
          preserveFocus,
          selection: requestedSelection,
        }),
      )
      this.assertCurrent(generation)
      focus?.assertRetained()
      return { uri, editor, focus, namedColumnBefore }
    } catch (error) {
      focus?.dispose()
      throw error
    }
  }

  /**
   * Shows a citation's copy and notes its URI as one this reader showed ({@link shownCitedSources}); called by {@link openSource} for every display of a citation.
   * The URI is noted before the display, so a copy the editor shows although a later check refuses the citation is this reader's too (row 662). A show the editor refuses before it opens anything put no copy on screen: the URI is forgotten again unless this reader had shown it before, so a copy of that URI an earlier reader left, which the learner reads in, is not retired with this reader's Wiki (row 683). The extension host can refuse after the editor opened the copy, too: when the editor it got back is no longer the current one, because the learner switched tabs meanwhile ("Could NOT open editor for … because another editor opened in the meantime.", Cursor's server `extensionHostProcess.js` 201:91131, VS Code 1.140.0 295:85754). A copy that was not open before the show and is open now is that display's, and stays this reader's, so its Wiki's close and the next citation retire it (Cycle 0046 row 701).
   * @param uri - The citation's copy.
   * @param show - The display, `vscode.window.showTextDocument` with the citation's options.
   * @returns The editor the display answered.
   * @throws The display's refusal, once the URI is forgotten again where this display alone noted it and left no copy of its own.
   * @example const editor = await this.showCitedSourceCopy(uri, () => vscode.window.showTextDocument(document, options))
   */
  private async showCitedSourceCopy(
    uri: vscode.Uri,
    show: () => Thenable<vscode.TextEditor>,
  ): Promise<vscode.TextEditor> {
    const key = uri.toString(),
      shownBefore = this.shownCitedSources.has(key),
      openBefore = this.isOpenInAnyGroup(key)
    this.shownCitedSources.add(key)
    try {
      return await show()
    } catch (error) {
      // Only a URI this display noted goes, and only while the display left no copy of its own: an earlier display's URI, and a copy the refused display still opened, stay the reader's.
      if (!shownBefore && (openBefore || !this.isOpenInAnyGroup(key)))
        this.shownCitedSources.delete(key)
      throw error
    }
  }

  /** Prepares exact immutable bytes for {@link openSource} and quiet {@link openFromAgent} without selecting a native tab. @example const prepared = await this.openSourceDocument(selection, book, generation) */
  private async openSourceDocument(
    selection: RepositorySelection,
    book: NonNullable<RepositoryReader['book']>,
    generation: number,
  ) {
    this.assertCurrent(generation)
    const { anchor } = this.requestedArticle(selection, book)
    const uri = vscode.Uri.from({
      scheme: REPOSITORY_SOURCE_SCHEME,
      authority: this.store!.library.workspaceKey,
      path: `/${selection.bookId}/${selection.revision}/${selection.nodeId}/${selection.anchorIndex}/${basename(anchor.path)}`,
      query: `hash=${anchor.hash}`,
    })
    const document = await vscode.workspace.openTextDocument(uri)
    this.assertCurrent(generation)
    return { uri, document, anchor }
  }

  /** Validates retained content for {@link open} before native source/layout effects; empty-library entry has no article to validate. @example this.assertRequestedArticle(selection, book) */
  private assertRequestedArticle(
    selection: RepositorySelection | undefined,
    book: RepositoryReader['book'],
  ): void {
    if (!selection || !book) return
    const { node } = this.requestedArticle(selection, book)
    this.assertReadingSection(selection, node.sections.length)
  }

  /** Resolves the required retained node/citation for {@link assertRequestedArticle} and {@link openSourceDocument} before URI or native effects. @example const { anchor } = this.requestedArticle(selection, book) */
  private requestedArticle(
    selection: RepositorySelection,
    book: NonNullable<RepositoryReader['book']>,
  ) {
    const node = book.revision.document.nodes.find(
      (value) => value.id === selection.nodeId,
    )
    if (!node)
      throw new Error(
        'The selected article, citation, or section is unavailable in this revision.',
      )
    const anchor = node.anchors[selection.anchorIndex]
    if (!anchor)
      throw new Error(
        'The selected article, citation, or section is unavailable in this revision.',
      )
    return { node, anchor }
  }

  /** Checks the retained reading section for {@link assertRequestedArticle}; missing location uses the article's normal entry. @example this.assertReadingSection(selection, node.sections.length) */
  private assertReadingSection(
    selection: RepositorySelection,
    sectionCount: number,
  ): void {
    if (
      selection.location &&
      selection.location.sectionIndex >=
        sectionCount + REPOSITORY_FIXED_READING_SECTIONS
    )
      throw new Error(
        'The selected article, citation, or section is unavailable in this revision.',
      )
  }

  /**
   * Prepares an existing Wiki's quiet agent source for {@link open}, retaining input or an explicit handoff to that Wiki.
   * @param initialFocus - The original native input lease; unrelated newer input retires the request.
   * @param initiatingEditor - The text editor that owned input before source/storage awaits.
   * @returns Exact copied URI and the guard used throughout reading-state publication.
   * @example const source = await this.prepareBackgroundSource(selection, book, generation, initialFocus, initiatingEditor)
   */
  private async prepareBackgroundSource(
    selection: RepositorySelection,
    book: NonNullable<RepositoryReader['book']>,
    generation: number,
    initialFocus: ReturnType<RepositoryReader['retainNativeFocus']>,
    initiatingEditor: vscode.TextEditor | undefined,
  ) {
    const assertBackgroundInput = (): void => {
      // Selecting this Wiki explicitly hands the reading to it; unrelated newer input still retires the request.
      if (!this.hasNativeWikiFocus()) initialFocus.assertRetained()
    }
    const prepared = await this.openSourceDocument(selection, book, generation)
    assertBackgroundInput()
    this.sourceDeferred = this.shouldDeferSourcePreview(initiatingEditor)
    if (!this.sourceDeferred)
      await this.showQuietCopy(
        selection,
        book,
        generation,
        prepared.uri,
        assertBackgroundInput,
      )
    return { uri: prepared.uri, assertFocused: assertBackgroundInput }
  }

  /**
   * Shows a citation's copy without the keyboard for an agent's read of the open Wiki, for {@link prepareBackgroundSource}, and notes it for the rest of that open ({@link quietCopyShow}): the native focus changes its own show causes are no learner's ({@link isOwnQuietCopyShowPlace}), and a refused open closes the tab its show opened ({@link retireCopyOfRefusedOpen}); Cycle 0046 row 696.
   * @param selection - The citation to show.
   * @param book - Its book.
   * @param generation - The open's generation.
   * @param uri - The copy's URI ({@link openSourceDocument}).
   * @param assertBackgroundInput - The open's check of the learner's input before the show.
   * @example await this.showQuietCopy(selection, book, generation, prepared.uri, assertBackgroundInput) // order.ts in front of the first group, the chat keeps the keyboard
   */
  private async showQuietCopy(
    selection: RepositorySelection,
    book: NonNullable<RepositoryReader['book']>,
    generation: number,
    uri: vscode.Uri,
    assertBackgroundInput: () => void,
  ): Promise<void> {
    const show = {
      uri: uri.toString(),
      generation,
      opensTab: !this.isOpenInAnyGroup(uri.toString()),
      shown: false,
    }
    this.quietCopyShow = show
    await this.openSource(selection, book, generation, true, () => {
      assertBackgroundInput()
      // The show is about to put the copy on screen: from here on a refused open closes it again.
      show.shown = true
    })
  }

  /**
   * Says whether the editor names a group that the reader's own quiet copy show explains while no text editor is active ({@link showQuietCopy}), for {@link adoptOwnQuietCopyShow} in {@link retainNativeFocus}: the first group with the copy in front, or, beside Cursor's chat part, the group of its chat, whose tab has no input of an editor (Cursor gives its composer tab none, 3.23.12 `workbench.desktop.main.js` 17269:27859), which Cursor's rebuild names after Focus Agent (C60 c60-cu-7d2, row 696). The keyboard was already in that chat: no text editor was active before the show, or the receipt would see its loss. A terminal in the editor area, a notebook, a notebook diff or a custom editor in front of another group has no active text editor either, and is the learner's own choice (row 714): {@link holdsEditorTab} with {@link editorTabInputKinds} tells it from the chat's tab, as row 689's proof does.
   * @returns `true` during such a show for those groups; `false` without one, while a text editor is active, and for any other group.
   * @example this.isOwnQuietCopyShowPlace() // => true right after Cursor's rebuild named its chat part's group for the order.ts copy
   */
  private isOwnQuietCopyShowPlace(): boolean {
    const show = this.quietCopyShow
    if (!show || vscode.window.activeTextEditor) return false
    const group = vscode.window.tabGroups.activeTabGroup,
      input = group.activeTab?.input
    // The copy came to the front of the first group, which the editor names.
    if (group.viewColumn === vscode.ViewColumn.One)
      return (
        input instanceof vscode.TabInputText &&
        input.uri.toString() === show.uri
      )
    // Only the chat's tab, which has no editor's input, is that place; any editor in front of another group is the learner's (row 714).
    return (
      group.activeTab !== undefined &&
      !holdsEditorTab({ tabs: [group.activeTab] }, editorTabInputKinds(vscode))
    )
  }

  /**
   * Closes the copy a refused agent's read showed, when its show opened that tab, so the refused open leaves no copy behind (Cycle 0046 row 696); called by {@link open} when an open of its own generation fails. The rules of {@link closeCitedSourceTabs} hold: a pinned copy, a copy the learner reads in ({@link isReadInByLearner}) and a group's only tab stay. A copy that was open before the show stays too, and so does the reader's record of the copy, which forgets its URI once its last tab closed ({@link forgetClosedCitedSources}).
   * @param generation - The refused open's generation.
   * @example this.retireCopyOfRefusedOpen(generation) // the order.ts copy the refused read showed leaves the first group
   */
  private retireCopyOfRefusedOpen(generation: number): void {
    const show = this.quietCopyShow
    if (show?.generation !== generation || !show.shown || !show.opensTab) return
    const keyboard = vscode.window.activeTextEditor
    this.closeCitedSourceTabs(
      (uri, group) =>
        uri !== show.uri || this.isReadInByLearner(uri, group, keyboard),
    )
  }

  /**
   * Ends the note of an open's quiet copy show once that open settled ({@link quietCopyShow}); called by {@link open}'s end, which leaves a newer open's note as it is.
   * @param generation - The settled open's generation.
   * @example this.endQuietCopyShow(generation)
   */
  private endQuietCopyShow(generation: number): void {
    if (this.quietCopyShow?.generation === generation)
      this.quietCopyShow = undefined
  }

  /** Keeps a Return layout or focused primary file untouched during {@link prepareBackgroundSource}. @example this.shouldDeferSourcePreview(vscode.window.activeTextEditor) */
  private shouldDeferSourcePreview(
    initiatingEditor: vscode.TextEditor | undefined,
  ): boolean {
    return Boolean(
      this.deferredReturn ||
      (initiatingEditor?.viewColumn === vscode.ViewColumn.One &&
        !this.hasNativeWikiFocus()),
    )
  }

  /** Pays an explicit Wiki handoff received during loading after {@link open} publishes the same ready article; unrelated input keeps its original lease. @example await this.payReadyBackgroundPreview(background, initialFocus) */
  private async payReadyBackgroundPreview(
    background: boolean,
    initialFocus: ReturnType<RepositoryReader['retainNativeFocus']>,
  ): Promise<void> {
    if (!background || this.deferredReturn || !this.canRevealDeferredSource())
      return
    // A focus event during loading could not pay the preview; pay it only after the same article is ready.
    initialFocus.dispose()
    await this.revealDeferredSource()
  }

  /** Recognizes the actual Wiki main-group tab for {@link revealDeferredSource}; stale text-editor pointers cannot activate a preview. @example if (this.hasNativeWikiFocus()) await this.revealDeferredSource() */
  private hasNativeWikiFocus(): boolean {
    const group = vscode.window.tabGroups.activeTabGroup
    if (!this.panel) return false
    return (
      group.viewColumn === this.panel.viewColumn &&
      this.isWikiTab(group.activeTab)
    )
  }

  /** Certifies a native Wiki input for {@link hasNativeWikiFocus}; unrelated or absent tabs cannot authorize preview. @example this.isWikiTab(group.activeTab) */
  private isWikiTab(tab: vscode.Tab | undefined): boolean {
    const input = tab?.input
    return (
      input instanceof vscode.TabInputWebview &&
      isCodebookPaneViewType(input.viewType, 'codebook.repositoryWiki')
    )
  }

  /** Pays an agent's deferred primary-file preview only after genuine native Wiki selection; newer input or evidence navigation revokes it. @example await this.revealDeferredSource() */
  private async revealDeferredSource(): Promise<void> {
    if (!this.canRevealDeferredSource()) return
    // Only actual Wiki selection resumes a command's saved layout and ordinary reader handoff.
    if (this.deferredReturn) {
      // The active opening pays a loading-time handoff after its final checks; a nested open would reject that caller.
      if (this.openingGeneration === this.generation) return
      await this.completeDeferredReturn()
      return
    }
    await this.revealDeferredCitation()
  }

  /** Pays the ordinary source-only preview after {@link revealDeferredSource} rules out a pending Return layout. @example await this.revealDeferredCitation() */
  private async revealDeferredCitation(): Promise<void> {
    const generation = this.generation,
      request = ++this.sourcePreviewRequest,
      signal = this.navigation.signal,
      panel = this.panel!,
      needsDocumentHandoff = this.needsDocumentHandoff(panel, this.revision),
      focus = this.retainNativeFocus(),
      windowFocus = this.retainWindowFocus()
    let departed = false
    const viewState = panel.onDidChangeViewState(() => {
        // Switching away and back cannot revive the first selected document's pending handoff.
        departed ||= !panel.active || !panel.visible
      }),
      assertSelectedInput = (): void => {
        try {
          focus.assertRetained()
          windowFocus.assertRetained()
          this.assertSelectedPreview(request, departed)
        } catch (error) {
          departed = true
          throw error
        }
      }
    try {
      assertSelectedInput()
      const opened = await this.openSource(
        this.selection!,
        this.book!,
        generation,
        true,
        assertSelectedInput,
      )
      assertSelectedInput()
      // Retire the preview before the ready handoff can emit another native view-state callback.
      this.commitDeferredPreview(generation, request, opened.uri)
      if (needsDocumentHandoff)
        await this.revealReadyPanel(generation, signal, assertSelectedInput)
      // The citation shown at last replaces an earlier citation's copy, unless a newer request owns the source (row 652).
      if (
        generation === this.generation &&
        request === this.sourcePreviewRequest
      )
        this.retireStaleCitedSources(opened.uri)
    } catch (error) {
      // A newer native choice cancels automatic preview without reporting a user action as a source failure.
      if (this.previewRetired(generation, request, departed)) return
      throw error
    } finally {
      focus.dispose()
      windowFocus.dispose()
      viewState.dispose()
    }
  }

  /** Rejects an obsolete or abandoned native selection during {@link revealDeferredCitation}'s source and renderer waits. @param request - The source preview that originally acquired the selected Wiki. @param departed - Whether that selection was left, even if the learner has since returned. @throws When a newer preview or native input owns the handoff. @example this.assertSelectedPreview(request, false) */
  private assertSelectedPreview(request: number, departed: boolean): void {
    if (
      departed ||
      request !== this.sourcePreviewRequest ||
      !this.hasActiveWikiFocus()
    )
      throw new Error(
        'The newer native input was preserved instead of opening an old citation.',
      )
  }

  /** Completes a command's original layout from {@link open} or {@link revealDeferredSource} after the learner selects Wiki. @param initialFocus - Releases the finishing background request before its normal Return begins. @example await this.completeDeferredReturn() */
  private async completeDeferredReturn(
    signal?: AbortSignal,
    initialFocus?: ReturnType<RepositoryReader['retainNativeFocus']>,
  ): Promise<void> {
    const selection = this.deferredReturn
    if (!selection || !this.hasActiveWikiFocus()) return
    initialFocus?.dispose()
    await this.open(selection, signal, true)
  }

  /** Requires both native tab identity and active-panel state before {@link completeDeferredReturn} can move the saved layout. @example this.hasActiveWikiFocus() // false while side chat owns input */
  private hasActiveWikiFocus(): boolean {
    return Boolean(this.panel?.active) && this.hasNativeWikiFocus()
  }

  /** Tests the current preview obligation for {@link revealDeferredSource}; loading or another native input cannot pay it. @example if (this.canRevealDeferredSource()) await this.revealDeferredSource() */
  private canRevealDeferredSource(): boolean {
    return this.sourceDeferred && !this.loading && this.hasNativeWikiFocus()
  }

  /** Keeps superseded/native-departure completion silent for {@link revealDeferredSource}, while real source failures remain observable. @example this.previewRetired(generation, request, departed) */
  private previewRetired(
    generation: number,
    request: number,
    departed: boolean,
  ): boolean {
    return (
      departed ||
      generation !== this.generation ||
      request !== this.sourcePreviewRequest
    )
  }

  /** Commits only the same preview after native display for {@link revealDeferredSource}; evidence/newer requests retain their source state. @example this.commitDeferredPreview(generation, request, opened.uri) */
  private commitDeferredPreview(
    generation: number,
    request: number,
    uri: vscode.Uri,
  ): void {
    this.assertCurrent(generation)
    if (request !== this.sourcePreviewRequest) return
    this.sourceUri = uri
    this.sourceDeferred = false
  }

  /** Confirms the native selected text tab before {@link retainSelectedTextEditor} can retain its identity. @param editor - The actual active editor whose same-group selected tab must match. @returns Whether both native receipts identify this editor. @example this.hasSelectedTextTab(editor) // => true for the currently selected source tab */
  private hasSelectedTextTab(editor: vscode.TextEditor): boolean {
    const group = vscode.window.tabGroups.activeTabGroup,
      input = group.activeTab?.input
    return (
      input instanceof vscode.TabInputText &&
      input.uri.toString() === editor.document.uri.toString() &&
      editor.viewColumn === group.viewColumn
    )
  }

  /** Retains a selected text tab's identity behind Wiki for {@link retainNativeFocus}'s own quiet editor retirement. @returns A predicate requiring the unchanged editor and original text tab in its same native group. @example const retained = this.retainSelectedTextEditor(); retained() // => true while the original source remains behind Wiki */
  private retainSelectedTextEditor(): () => boolean {
    const editor = vscode.window.activeTextEditor,
      group = vscode.window.tabGroups.activeTabGroup
    if (!editor || !this.hasSelectedTextTab(editor)) return () => false
    const identity = JSON.stringify([
        editor.document.version,
        editor.selections,
      ]),
      uri = editor.document.uri.toString(),
      column = group.viewColumn
    return () => {
      const current = vscode.window.tabGroups.activeTabGroup
      return (
        current.viewColumn === column &&
        current.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === uri,
        ) &&
        JSON.stringify([editor.document.version, editor.selections]) ===
          identity
      )
    }
  }

  /** Retains initial or acquired focus for {@link open}; later input irrevocably retires it, while the editor's own late selection of this Wiki's group beside the unchanged text editor is no input ({@link adoptWikiGroupReturn}). @param acquire - The requested citation whose native activation may be observed in stages. @param acceptGroupSelection - Admits once the own quiet Wiki selection and disappearance of its unchanged same-group text editor. @example const retained = this.retainNativeFocus(); retained.assertRetained() */
  private retainNativeFocus(
    acquire?: RepositoryFocusTarget,
    acceptGroupSelection?: () => boolean,
  ) {
    const snapshot = () => {
      const editor = vscode.window.activeTextEditor,
        group = vscode.window.tabGroups.activeTabGroup
      return {
        editor: JSON.stringify([
          editor?.document.uri.toString(),
          editor?.document.version,
          editor?.viewColumn,
          editor?.selections,
        ]),
        group: JSON.stringify([
          group.viewColumn,
          group.activeTab?.label,
          group.activeTab?.input,
        ]),
      }
    }
    // The editor's own selection of this Wiki's group leaves the text editor active; a learner's choice takes its keyboard.
    const wikiSelectedBesideTextEditor = (): boolean =>
      Boolean(vscode.window.activeTextEditor) && this.hasNativeWikiFocus()
    const pending = snapshot()
    let selectedEditorRetained: (() => boolean) | undefined
    let initial = acquire ? undefined : pending,
      changed = false,
      // The target was acquired under the editor's stale name of another group (row 660).
      staleNameAccepted = false,
      groupSelectionAccepted = false,
      editorAcquired = false,
      groupAcquired = false
    let intermediateEditor = acquire?.matchesEditorIdentity?.()
        ? pending.editor
        : undefined,
      missingEditorObserved = false
    const observe = (
      event?: 'active-editor' | vscode.TextEditorSelectionChangeEvent,
    ): void => {
      // Freeze text-tab ownership on the first observation, before a quiet reveal can hide its editor.
      selectedEditorRetained ??= acceptGroupSelection
        ? this.retainSelectedTextEditor()
        : () => false
      const current = snapshot(),
        activeEditor = vscode.window.activeTextEditor,
        selectionEvent = typeof event === 'object' ? event : undefined
      // Explicit learner selection never proves ownership, even when it happens to match the requested range.
      if (isLearnersSelectionIn(selectionEvent, activeEditor)) changed = true
      if (initial === undefined && acquire) {
        const editorMatches = acquire.matchesEditor(),
          groupMatches = acquire.matchesGroup()
        let intermediateMatches = false
        // Native citation activation may briefly remove the editor, then expose its first caret before applying the range.
        if (
          !editorMatches &&
          !editorAcquired &&
          acquire.matchesEditorIdentity
        ) {
          if (
            !activeEditor &&
            (groupMatches ||
              (current.group === pending.group &&
                acquire.matchesPreparedTab?.())) &&
            intermediateEditor === undefined
          ) {
            // The owned tab can be ready before the old group releases focus and reports the target group.
            missingEditorObserved = true
            intermediateMatches = true
          } else if (acquire.matchesEditorIdentity()) {
            // Only the activation event can establish the initial caret; later selection events cannot replace it.
            if (intermediateEditor === undefined && event === 'active-editor')
              intermediateEditor = current.editor
            intermediateMatches = intermediateEditor === current.editor
          }
        }
        // Each component advances once; observed third states, selection detours and retreats permanently retire navigation.
        changed ||=
          (!editorMatches &&
            !intermediateMatches &&
            (editorAcquired ||
              missingEditorObserved ||
              intermediateEditor !== undefined ||
              current.editor !== pending.editor)) ||
          (!groupMatches && (groupAcquired || current.group !== pending.group))
        editorAcquired ||= editorMatches
        groupAcquired ||= groupMatches
        if (editorMatches && groupMatches) {
          initial = current
          staleNameAccepted = Boolean(acquire.namesStaleGroup?.())
        }
        return
      }
      // A quiet reveal selects its tab before the native editor-loss event; earlier departures remain sticky.
      if (
        initial &&
        current.group !== initial.group &&
        !groupSelectionAccepted &&
        acceptGroupSelection?.()
      ) {
        initial = { ...initial, group: current.group }
        groupSelectionAccepted = true
      }
      // Only the unchanged selected text tab behind this same-group Wiki can explain its own editor disappearance.
      if (
        initial &&
        groupSelectionAccepted &&
        !activeEditor &&
        selectedEditorRetained()
      )
        initial = { ...initial, editor: current.editor }
      // A late return to this Wiki's group beside the untouched text editor is no newer input (row 444); earlier departures stay sticky.
      initial = adoptWikiGroupReturn(
        initial,
        current,
        wikiSelectedBesideTextEditor(),
      )
      // The reader's own quiet copy show for an agent's read changes only the named group: the copy's or, in Cursor, its chat part's (row 696).
      initial = adoptOwnQuietCopyShow(
        initial,
        current,
        this.isOwnQuietCopyShowPlace(),
      )
      // The editor naming the acquired target's own group late, once, after the receipt took its stale name of another group (Cursor names its chat part's group until its tab model is rebuilt), is no newer input either (row 660).
      ;({ retained: initial, staleNameAccepted } = adoptLateNameOfAcquiredGroup(
        initial,
        current,
        acquire,
        staleNameAccepted,
      ))
      changed ||=
        current.editor !== initial?.editor || current.group !== initial?.group
    }
    const listeners = [
      vscode.window.onDidChangeActiveTextEditor(() => observe('active-editor')),
      vscode.window.onDidChangeTextEditorSelection(observe),
      vscode.window.tabGroups.onDidChangeTabs(() => observe()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => observe()),
    ]
    observe()
    return {
      assertRetained(): void {
        observe()
        if (initial === undefined || changed)
          throw new Error(
            'Native focus changed during repository navigation; the newer learner focus was preserved.',
          )
      },
      dispose(): void {
        for (const listener of listeners) listener.dispose()
      },
    }
  }

  /** Validates every restored source URI against its exact book, workspace and hash before exposing copied text. @example await this.sourceText(uri) */
  private async sourceText(uri: vscode.Uri): Promise<string> {
    const store = await this.storage(),
      [, bookId, revisionText, nodeId, anchorText, filename, extra] =
        uri.path.split('/')
    if (
      uri.scheme !== REPOSITORY_SOURCE_SCHEME ||
      uri.authority !== store.library.workspaceKey ||
      extra !== undefined ||
      uri.fragment ||
      !revisionText ||
      !/^[1-9]\d*$/.test(revisionText) ||
      !anchorText ||
      !/^(0|[1-9]\d*)$/.test(anchorText)
    )
      throw new Error('Captured repository source URI is invalid.')
    const selection = repositorySelectionSchema.parse({
      bookId,
      revision: Number(revisionText),
      nodeId,
      anchorIndex: Number(anchorText),
    })
    const book = await store.read(selection.bookId, selection.revision)
    this.assertOwner()
    const anchor = book.revision.document.nodes.find(
      (node) => node.id === selection.nodeId,
    )?.anchors[selection.anchorIndex]
    if (
      !anchor ||
      filename !== basename(anchor.path) ||
      uri.query !== `hash=${anchor.hash}`
    )
      throw new Error('Captured source URI differs from the selected citation.')
    const source = book.revision.sources.find(
      (source) => source.path === anchor.path && source.hash === anchor.hash,
    )
    if (!source) throw new Error('Captured source is unavailable.')
    return source.text
  }

  /** Refreshes only selected citations and detects unsaved editor drift; older refreshes cannot replace newer status. @example await this.refreshSources(generation) */
  private async refreshSources(generation: number): Promise<void> {
    const node = this.selectedNode(),
      statusGeneration = ++this.statusGeneration
    if (!node) return
    const states = await this.store!.sources.inspect(node.anchors)
    this.assertCurrent(generation)
    if (statusGeneration !== this.statusGeneration) return
    this.sourceStates = states.map((state) => {
      const document = vscode.workspace.textDocuments.find(
        (document) =>
          document.isDirty &&
          document.uri.fsPath ===
            join(this.store!.sources.workspace, state.path),
      )
      // Unsaved editor text can weaken a verified disk result, never certify missing or changed bytes.
      return document && state.status === 'current'
        ? {
            ...state,
            status: 'changed',
            currentHash: undefined,
            reason: 'The current editor has unsaved changes.',
          }
        : state
    })
    this.publish()
  }

  /** Watches only cited paths so current-file changes refresh without repository scans per render. @example this.watchSources() */
  private watchSources(): void {
    this.clearWatchers()
    const node = this.selectedNode()
    if (!node) return
    for (const path of new Set(node.anchors.map((anchor) => anchor.path))) {
      // RelativePattern's base is literal, so route names such as [id] never become glob operators.
      const target = join(this.store!.sources.workspace, path),
        watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(dirname(target), '*'),
        )
      const changed = (uri: vscode.Uri): void => {
        if (uri.fsPath === target) this.scheduleRefresh()
      }
      this.watchers.push(
        watcher,
        watcher.onDidChange(changed),
        watcher.onDidCreate(changed),
        watcher.onDidDelete(changed),
      )
    }
  }
  /** Coalesces current source changes while retaining article DOM and reading position. @example this.scheduleRefresh() */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer)
    const generation = this.generation
    this.refreshTimer = setTimeout(() => {
      void this.refreshSources(generation).catch((error) => {
        if (generation === this.generation && !this.disposed) {
          this.error = String(error)
          this.publish()
        }
      })
    }, REPOSITORY_READER_DEBOUNCE_MS)
  }
  /** Releases obsolete source observers on article change or Close. @example this.clearWatchers() */
  private clearWatchers(): void {
    for (const watcher of this.watchers.splice(0)) watcher.dispose()
  }

  /** Installs a single nonce-scoped panel whose obsolete callbacks cannot act after Close. @example this.ensurePanel() */
  private ensurePanel(preserveFocus = false): void {
    if (this.panel) return
    this.retireRenderedDocument()
    const panel = vscode.window.createWebviewPanel(
      'codebook.repositoryWiki',
      'codebook · Repository Wiki',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus },
      { enableScripts: true, localResourceRoots: [] },
    )
    this.panel = panel
    panel.onDidChangeViewState(() => {
      if (this.panel !== panel) return
      // A hidden panel loses its document; its last receipt cannot certify the next iframe.
      this.retireHiddenDocument(panel)
      // Selecting the Wiki is the learner's explicit permission to replace the primary file with its cited source.
      if (!panel.active || !panel.visible) return
      const generation = this.generation
      void this.revealDeferredSource().catch((error) => {
        if (this.panel !== panel || this.generation !== generation) return
        this.error = `Citation preview unavailable: ${String(error)}`
        this.publish()
      })
    })
    panel.webview.onDidReceiveMessage((value) => {
      if (this.panel !== panel) return
      const revision = this.revision,
        generation = this.generation
      void this.receive(value).catch((error) => {
        // A failed click must remain perceivable without moving the article's saved reading position.
        if (
          this.panel !== panel ||
          revision !== this.revision ||
          generation !== this.generation
        )
          return
        const request = repositoryMessageSchema.safeParse(value)
        const evidence =
          request.success &&
          request.data.type === 'evidence' &&
          request.data.revision === revision
            ? request.data
            : undefined
        this.error = evidence
          ? evidence.recording
            ? 'Recording could not be opened. Refresh the article or ask your agent for a new recording.'
            : 'Observation could not be opened. Refresh the article or ask your agent for a new study.'
          : String(error)
        if (evidence) void showPlainNotice(vscode.window, 'error', this.error)
        this.publish()
      })
    })
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.navigation.abort()
        this.panel = undefined
        this.retireRenderedDocument()
        this.generation++
        this.statusGeneration++
        this.clearWatchers()
        clearTimeout(this.refreshTimer)
        // The Wiki's tab closed by hand ends the Wiki as Close Repository Wiki does (row 641).
        this.retireCitedSourceTabs()
      }
    })
    panel.webview.html = repositoryHtml()
  }

  /** Retires document-local proof on creation, hiding or disposal for {@link ensurePanel}. @example this.retireRenderedDocument() */
  private retireRenderedDocument(): void {
    this.documentReady = false
    this.rendered = undefined
  }

  /** Invalidates document-local readiness when {@link ensurePanel} observes that native content was hidden. @param panel - The current native panel whose visibility changed. @example this.retireHiddenDocument(panel) */
  private retireHiddenDocument(panel: vscode.WebviewPanel): void {
    if (!panel.visible) this.retireRenderedDocument()
  }

  /** Accepts passive readiness only for the current visible Wiki document for {@link receive}. @param panel - The already validated current panel. @param message - A ready signal or current-revision model acknowledgement. @example this.receiveDocument(panel, { type: 'ready' }) */
  private receiveDocument(
    panel: vscode.WebviewPanel,
    message: Extract<
      z.infer<typeof repositoryMessageSchema>,
      { type: 'ready' | 'rendered' }
    >,
  ): void {
    if (!panel.visible) return
    if (message.type === 'ready') {
      // A new visible document must render the current model before it receives native input.
      this.rendered = undefined
      this.documentReady = true
      this.publish()
      return
    }
    // A not-yet-ready document cannot authorize a native handoff.
    if (this.documentReady) this.rendered = message
  }

  /** Rejects untyped/stale webview actions before source, navigation, understanding, or evidence work. @example await this.receive(value) */
  private async receive(value: unknown): Promise<void> {
    if (!this.panel) return
    const message = repositoryMessageSchema.parse(value)
    this.assertOwner()
    if (message.type === 'ready' || message.type === 'rendered') {
      if (message.type === 'rendered' && message.revision !== this.revision)
        return
      this.receiveDocument(this.panel, message)
      return
    }
    if (message.revision !== this.revision) {
      // Delayed render/scroll notifications are passive; obsolete controls still fail before any action.
      if (message.type === 'location') return
      throw new Error(
        'Article changed; inspect the current view before acting.',
      )
    }
    if (message.type === 'select') await this.open(message.selection)
    if (message.type === 'location') await this.remember(message.selection)
    if (message.type === 'action') await this.action(message.action)
    if (message.type === 'understanding')
      await this.understand(message.understood)
    if (message.type === 'evidence')
      await this.evidence(
        message.selection,
        message.linkIndex,
        message.recording,
      )
  }

  /** Projects compact UI content without sending entire retained source copies into the webview. @example this.message() */
  private message(): RepositoryViewMessage {
    const node = this.selectedNode(),
      selection = this.selection
    return {
      type: 'repository',
      revision: this.revision,
      loading: this.loading,
      saving: this.saving,
      error:
        this.error ??
        (this.pendingDecision && !this.saving
          ? 'Understanding not saved. Retry to save the original article choice.'
          : this.catalog
              .filter((entry) => entry.status === 'unavailable')
              .map((entry) => `${entry.bookId}: ${entry.reason}`)
              .join('\n')),
      catalog: this.catalog,
      selection,
      book: this.book
        ? { ...this.book, revision: this.withoutSources(this.book.revision) }
        : undefined,
      sources: this.sourceStates,
      understanding:
        node && selection
          ? citationLearningState(
              this.progress,
              node.learningItemId ??
                `repository/${selection.bookId}/${node.id}`,
              node.anchors,
            )
          : undefined,
    }
  }
  /** Omits source bytes at the reader boundary while retaining the inferred validated revision shape. @example this.withoutSources(revision) */
  private withoutSources({
    sources: _sources,
    ...revision
  }: NonNullable<RepositoryReader['book']>['revision']) {
    return revision
  }
  /** Publishes only while the native reader still owns its panel. @example this.publish() */
  private publish(): void {
    if (!this.disposed && this.panel)
      void this.panel.webview.postMessage(this.message())
  }
  /** Locates the selected node inside the immutable selected revision. @example this.selectedNode()?.anchors */
  private selectedNode() {
    return this.book?.revision.document.nodes.find(
      (node) => node.id === this.selection?.nodeId,
    )
  }
  /** Guards workspace changes without requiring a running application. @example this.assertOwner() */
  private assertOwner(): void {
    if (
      this.disposed ||
      !this.workspacePath ||
      requireWorkspace() !== this.workspacePath
    )
      throw new Error(
        'Repository reader no longer owns the selected workspace.',
      )
  }
  /** Prevents old navigation I/O from altering a newer selection or reopening closed panels. @example this.assertCurrent(generation) */
  private assertCurrent(generation: number): void {
    this.assertOwner()
    if (generation !== this.generation || this.navigation.signal.aborted)
      throw new Error('Repository navigation was superseded or closed.')
  }
  /** Accepts position updates only for the exact currently selected article and source. @example this.assertSelection(selection) */
  private assertSelection(selection: RepositorySelection): void {
    this.assertOwner()
    if (
      !this.selection ||
      ['bookId', 'revision', 'nodeId', 'anchorIndex'].some(
        (key) =>
          Reflect.get(selection, key) !== Reflect.get(this.selection!, key),
      )
    )
      throw new Error('Return location belongs to another article or citation.')
  }
  /** Converts inclusive one-based citation lines to a native editor range. @example this.range(2, 4) */
  private range(startLine: number, endLine: number): vscode.Range {
    return new vscode.Range(
      startLine - 1,
      0,
      endLine - 1,
      Number.MAX_SAFE_INTEGER,
    )
  }
}
