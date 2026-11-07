import type { StudyWorkspace } from '../studyWorkspace'

/**
 * What {@link ReplayOpening} reads, writes and calls on the workspace it was cut out of.
 *
 * Every member forwards to the live {@link StudyWorkspace} member at call time, so a test that replaces a workspace member is seen by the part. Built by {@link createReplayOpeningHost}.
 */
export interface ReplayOpeningHost {
  recordingActive: StudyWorkspace['recordingActive']
  selection: StudyWorkspace['selection']
  readonly playback: StudyWorkspace['playback']
  readonly browserReplayShown: StudyWorkspace['browserReplayShown']
  readonly assertPresentationIdle: StudyWorkspace['assertPresentationIdle']
  readonly assertStudyNotMoving: StudyWorkspace['assertStudyNotMoving']
  readonly leavePlayback: StudyWorkspace['leavePlayback']
  recordingReloadStudyId: StudyWorkspace['recordingReloadStudyId']
  readonly openRecording: StudyWorkspace['openRecording']
  readonly lifetime: StudyWorkspace['lifetime']
  readonly initialize: StudyWorkspace['initialize']
  readonly assertLifetime: StudyWorkspace['assertLifetime']
  selectedNodeHistoryRequest: StudyWorkspace['selectedNodeHistoryRequest']
  requestedNodeHistorySequence: StudyWorkspace['requestedNodeHistorySequence']
  nodeHistoryLeftFor: StudyWorkspace['nodeHistoryLeftFor']
  nodeHistoryPlaybackController: StudyWorkspace['nodeHistoryPlaybackController']
  selectedNodeHistoryValuesUninspected: StudyWorkspace['selectedNodeHistoryValuesUninspected']
  selectedNodeHistoryDebugAvailable: StudyWorkspace['selectedNodeHistoryDebugAvailable']
  readonly opened: StudyWorkspace['opened']
  repositoryRecordingOpen: StudyWorkspace['repositoryRecordingOpen']
  readonly errors: StudyWorkspace['errors']
  readonly publish: StudyWorkspace['publish']
  readonly openNodeHistoryFromHost: StudyWorkspace['openNodeHistoryFromHost']
  readonly shownRecordingSelectionSaved: StudyWorkspace['shownRecordingSelectionSaved']
  readonly openLearningReplay: StudyWorkspace['openLearningReplay']
  readonly diagnostics: StudyWorkspace['diagnostics']
  readonly privateRoots: StudyWorkspace['privateRoots']
  readonly showTextDocumentNoted: StudyWorkspace['showTextDocumentNoted']
  readonly editorTabName: StudyWorkspace['editorTabName']
  readonly executeEditorCommand: StudyWorkspace['executeEditorCommand']
  readonly nodeHistoryCatalog: StudyWorkspace['nodeHistoryCatalog']
  readonly nodeServerHistoryCatalog: StudyWorkspace['nodeServerHistoryCatalog']
  readonly nodeScriptHistoryCatalog: StudyWorkspace['nodeScriptHistoryCatalog']
  readonly nodeExtensionHistoryCatalog: StudyWorkspace['nodeExtensionHistoryCatalog']
  readonly recordOfStudy: StudyWorkspace['recordOfStudy']
  readonly supersedeNodeHistoryEntries: StudyWorkspace['supersedeNodeHistoryEntries']
  readonly nodeHistoryEntryCancellation: StudyWorkspace['nodeHistoryEntryCancellation']
  readonly controlRefusals: StudyWorkspace['controlRefusals']
  readonly nodeHistoryEntryRequest: StudyWorkspace['nodeHistoryEntryRequest']
  readonly leaveEmptySummaryComposition: StudyWorkspace['leaveEmptySummaryComposition']
  readonly openNodeHistory: StudyWorkspace['openNodeHistory']
  readonly revision: StudyWorkspace['revision']
  readonly dropChoiceRetiredErrors: StudyWorkspace['dropChoiceRetiredErrors']
  readonly moveSummaryBesideChatOnce: StudyWorkspace['moveSummaryBesideChatOnce']
  heldBackReplay: StudyWorkspace['heldBackReplay']
  readonly isHeldBackSelection: StudyWorkspace['isHeldBackSelection']
  readonly closing: StudyWorkspace['closing']
  readonly disposed: StudyWorkspace['disposed']
  lastPublished: StudyWorkspace['lastPublished']
  readonly report: StudyWorkspace['report']
  studyAwaitingEditorArea: StudyWorkspace['studyAwaitingEditorArea']
  readonly closeSlotTabsAwaitingArea: StudyWorkspace['closeSlotTabsAwaitingArea']
  readonly enterSummaryCompositionForReplay: StudyWorkspace['enterSummaryCompositionForReplay']
  readonly returnCurrentSelection: StudyWorkspace['returnCurrentSelection']
  readonly replayOpenDiagnosticIdentity: StudyWorkspace['replayOpenDiagnosticIdentity']
  readonly summaryComposition: StudyWorkspace['summaryComposition']
  readonly liveComposition: StudyWorkspace['liveComposition']
  readonly waitForRecordingWindow: StudyWorkspace['waitForRecordingWindow']
  readonly showLearningSummary: StudyWorkspace['showLearningSummary']
  hostOpeningTestReplay: StudyWorkspace['hostOpeningTestReplay']
  selectedNodeHistory: StudyWorkspace['selectedNodeHistory']
  nodeHistoryOpenToken: StudyWorkspace['nodeHistoryOpenToken']
  readonly open: StudyWorkspace['open']
  readonly standsInEmptySummaryComposition: StudyWorkspace['standsInEmptySummaryComposition']
  readonly forgetUnopenedComposition: StudyWorkspace['forgetUnopenedComposition']
  presentationMode: StudyWorkspace['presentationMode']
  readonly ensureContext: StudyWorkspace['ensureContext']
  historyRequest: StudyWorkspace['historyRequest']
  studyChoices: StudyWorkspace['studyChoices']
  pendingNodeHistory: StudyWorkspace['pendingNodeHistory']
  pendingNodeHistoryStudyId: StudyWorkspace['pendingNodeHistoryStudyId']
  loading: StudyWorkspace['loading']
  readonly replayDebuggers: StudyWorkspace['replayDebuggers']
  readonly readNodeHistoryOpening: StudyWorkspace['readNodeHistoryOpening']
  readonly nodeOutputReadings: StudyWorkspace['nodeOutputReadings']
  selectedServerReplay: StudyWorkspace['selectedServerReplay']
  selectedExtensionReplay: StudyWorkspace['selectedExtensionReplay']
  extensionShownFrame: StudyWorkspace['extensionShownFrame']
  extensionNativeShown: StudyWorkspace['extensionNativeShown']
  extensionFrames: StudyWorkspace['extensionFrames']
  readonly nodeHistoryRepository: StudyWorkspace['nodeHistoryRepository']
  nodeSourceSlotCloseFailure: StudyWorkspace['nodeSourceSlotCloseFailure']
  repositoryObservation: StudyWorkspace['repositoryObservation']
  selectedNodeHistoryLearningDecision: StudyWorkspace['selectedNodeHistoryLearningDecision']
  selectedNodeHistoryLearningMaterial: StudyWorkspace['selectedNodeHistoryLearningMaterial']
  selectedNodeHistoryPage: StudyWorkspace['selectedNodeHistoryPage']
  selectedNodeHistorySequence: StudyWorkspace['selectedNodeHistorySequence']
  nodeSurfacesSequence: StudyWorkspace['nodeSurfacesSequence']
  selectedNodeHistoryStepId: StudyWorkspace['selectedNodeHistoryStepId']
  readonly presentApplication: StudyWorkspace['presentApplication']
  readonly message: StudyWorkspace['message']
  readonly replayRefusal: StudyWorkspace['replayRefusal']
  readonly requestNodeHistoryEvent: StudyWorkspace['requestNodeHistoryEvent']
  readonly replayKind: StudyWorkspace['replayKind']
  readonly reportTestReplayFailure: StudyWorkspace['reportTestReplayFailure']
  readonly isLatestHistoryRequest: StudyWorkspace['isLatestHistoryRequest']
  readonly nodeHistoryStore: StudyWorkspace['nodeHistoryStore']
  readonly moments: StudyWorkspace['moments']
  readonly momentsReportsKeyboard: StudyWorkspace['momentsReportsKeyboard']
  replayLoadAwaitingReady: StudyWorkspace['replayLoadAwaitingReady']
  readonly retireNodeHistorySelection: StudyWorkspace['retireNodeHistorySelection']
  readonly giveSummaryItsDocument: StudyWorkspace['giveSummaryItsDocument']
  retiredBrowserReplayTabs: StudyWorkspace['retiredBrowserReplayTabs']
  pendingHistory: StudyWorkspace['pendingHistory']
  readonly activeArchive: StudyWorkspace['activeArchive']
  selectedArchive: StudyWorkspace['selectedArchive']
  readonly recordings: StudyWorkspace['recordings']
  readonly readSavedArchive: StudyWorkspace['readSavedArchive']
  readonly recordingRevealedByEntry: StudyWorkspace['recordingRevealedByEntry']
  readonly ensureReplayViewport: StudyWorkspace['ensureReplayViewport']
  readonly viewport: StudyWorkspace['viewport']
  readonly dropReplayViewport: StudyWorkspace['dropReplayViewport']
  readonly applicationHtml: StudyWorkspace['applicationHtml']
  replayViewport: StudyWorkspace['replayViewport']
  replayNeedsReveal: StudyWorkspace['replayNeedsReveal']
  readonly prepareApplicationGroup: StudyWorkspace['prepareApplicationGroup']
  readonly assertApplicationReveal: StudyWorkspace['assertApplicationReveal']
  readonly service: StudyWorkspace['service']
  playbackPending: StudyWorkspace['playbackPending']
  playbackPresentingReady: StudyWorkspace['playbackPresentingReady']
  readonly renderSelection: StudyWorkspace['renderSelection']
  readonly sourceReady: StudyWorkspace['sourceReady']
  readonly sourceUri: StudyWorkspace['sourceUri']
  replayUninspectedSnapshot: StudyWorkspace['replayUninspectedSnapshot']
  replayApplicationCovered: StudyWorkspace['replayApplicationCovered']
  lastRendered: StudyWorkspace['lastRendered']
  readonly summaryView: StudyWorkspace['summaryView']
  replayPaint: StudyWorkspace['replayPaint']
  readonly replayPaintWatchers: StudyWorkspace['replayPaintWatchers']
  readonly app: StudyWorkspace['app']
}

/**
 * Gives {@link ReplayOpening} live access to the workspace members it does not own.
 *
 * Called once by the workspace's field initialiser; reaches private members with bracket access, which the type checker allows. Never copies a value and never binds, so later changes and test replacements are seen.
 *
 * @param workspace - The workspace the part belongs to.
 * @returns A host whose members read, write and call the workspace's members by name.
 * @example
 * private readonly replayOpening = new ReplayOpening(createReplayOpeningHost(this))
 */
export function createReplayOpeningHost(
  workspace: StudyWorkspace,
): ReplayOpeningHost {
  return {
    get recordingActive() {
      return workspace['recordingActive']
    },
    set recordingActive(value) {
      workspace['recordingActive'] = value
    },
    get selection() {
      return workspace['selection']
    },
    set selection(value) {
      workspace['selection'] = value
    },
    get playback() {
      return workspace['playback']
    },
    browserReplayShown: (...args) => workspace['browserReplayShown'](...args),
    assertPresentationIdle: (...args): void =>
      workspace['assertPresentationIdle'](...args),
    assertStudyNotMoving: (...args): void =>
      workspace['assertStudyNotMoving'](...args),
    leavePlayback: (...args): void => workspace['leavePlayback'](...args),
    get recordingReloadStudyId() {
      return workspace['recordingReloadStudyId']
    },
    set recordingReloadStudyId(value) {
      workspace['recordingReloadStudyId'] = value
    },
    openRecording: (...args): Promise<void> =>
      workspace['openRecording'](...args),
    get lifetime() {
      return workspace['lifetime']
    },
    initialize: (...args): Promise<void> => workspace['initialize'](...args),
    assertLifetime: (...args): void => workspace['assertLifetime'](...args),
    get selectedNodeHistoryRequest() {
      return workspace['selectedNodeHistoryRequest']
    },
    set selectedNodeHistoryRequest(value) {
      workspace['selectedNodeHistoryRequest'] = value
    },
    get requestedNodeHistorySequence() {
      return workspace['requestedNodeHistorySequence']
    },
    set requestedNodeHistorySequence(value) {
      workspace['requestedNodeHistorySequence'] = value
    },
    get nodeHistoryLeftFor() {
      return workspace['nodeHistoryLeftFor']
    },
    set nodeHistoryLeftFor(value) {
      workspace['nodeHistoryLeftFor'] = value
    },
    get nodeHistoryPlaybackController() {
      return workspace['nodeHistoryPlaybackController']
    },
    set nodeHistoryPlaybackController(value) {
      workspace['nodeHistoryPlaybackController'] = value
    },
    get selectedNodeHistoryValuesUninspected() {
      return workspace['selectedNodeHistoryValuesUninspected']
    },
    set selectedNodeHistoryValuesUninspected(value) {
      workspace['selectedNodeHistoryValuesUninspected'] = value
    },
    get selectedNodeHistoryDebugAvailable() {
      return workspace['selectedNodeHistoryDebugAvailable']
    },
    set selectedNodeHistoryDebugAvailable(value) {
      workspace['selectedNodeHistoryDebugAvailable'] = value
    },
    get opened() {
      return workspace['opened']
    },
    get repositoryRecordingOpen() {
      return workspace['repositoryRecordingOpen']
    },
    set repositoryRecordingOpen(value) {
      workspace['repositoryRecordingOpen'] = value
    },
    get errors() {
      return workspace['errors']
    },
    publish: (...args): void => workspace['publish'](...args),
    openNodeHistoryFromHost: (...args): Promise<void> =>
      workspace['openNodeHistoryFromHost'](...args),
    get shownRecordingSelectionSaved() {
      return workspace['shownRecordingSelectionSaved']
    },
    openLearningReplay: (...args): Promise<void> =>
      workspace['openLearningReplay'](...args),
    get diagnostics() {
      return workspace['diagnostics']
    },
    privateRoots: (...args) => workspace['privateRoots'](...args),
    showTextDocumentNoted: (...args) =>
      workspace['showTextDocumentNoted'](...args),
    editorTabName: (...args) => workspace['editorTabName'](...args),
    executeEditorCommand: (...args) =>
      workspace['executeEditorCommand'](...args),
    get nodeHistoryCatalog() {
      return workspace['nodeHistoryCatalog']
    },
    get nodeServerHistoryCatalog() {
      return workspace['nodeServerHistoryCatalog']
    },
    get nodeScriptHistoryCatalog() {
      return workspace['nodeScriptHistoryCatalog']
    },
    get nodeExtensionHistoryCatalog() {
      return workspace['nodeExtensionHistoryCatalog']
    },
    recordOfStudy: (...args) => workspace['recordOfStudy'](...args),
    supersedeNodeHistoryEntries: (...args) =>
      workspace['supersedeNodeHistoryEntries'](...args),
    get nodeHistoryEntryCancellation() {
      return workspace['nodeHistoryEntryCancellation']
    },
    get controlRefusals() {
      return workspace['controlRefusals']
    },
    get nodeHistoryEntryRequest() {
      return workspace['nodeHistoryEntryRequest']
    },
    leaveEmptySummaryComposition: (...args): Promise<void> =>
      workspace['leaveEmptySummaryComposition'](...args),
    openNodeHistory: (...args) => workspace['openNodeHistory'](...args),
    get revision() {
      return workspace['revision']
    },
    dropChoiceRetiredErrors: (...args) =>
      workspace['dropChoiceRetiredErrors'](...args),
    moveSummaryBesideChatOnce: (...args): Promise<void> =>
      workspace['moveSummaryBesideChatOnce'](...args),
    get heldBackReplay() {
      return workspace['heldBackReplay']
    },
    set heldBackReplay(value) {
      workspace['heldBackReplay'] = value
    },
    isHeldBackSelection: (...args) => workspace['isHeldBackSelection'](...args),
    get closing() {
      return workspace['closing']
    },
    get disposed() {
      return workspace['disposed']
    },
    get lastPublished() {
      return workspace['lastPublished']
    },
    set lastPublished(value) {
      workspace['lastPublished'] = value
    },
    report: (...args): void => workspace['report'](...args),
    get studyAwaitingEditorArea() {
      return workspace['studyAwaitingEditorArea']
    },
    set studyAwaitingEditorArea(value) {
      workspace['studyAwaitingEditorArea'] = value
    },
    closeSlotTabsAwaitingArea: (...args): Promise<void> =>
      workspace['closeSlotTabsAwaitingArea'](...args),
    enterSummaryCompositionForReplay: (...args): Promise<void> =>
      workspace['enterSummaryCompositionForReplay'](...args),
    returnCurrentSelection: (...args): Promise<void> =>
      workspace['returnCurrentSelection'](...args),
    replayOpenDiagnosticIdentity: (...args) =>
      workspace['replayOpenDiagnosticIdentity'](...args),
    get summaryComposition() {
      return workspace['summaryComposition']
    },
    get liveComposition() {
      return workspace['liveComposition']
    },
    waitForRecordingWindow: (...args): Promise<void> =>
      workspace['waitForRecordingWindow'](...args),
    showLearningSummary: (...args): Promise<void> =>
      workspace['showLearningSummary'](...args),
    get hostOpeningTestReplay() {
      return workspace['hostOpeningTestReplay']
    },
    set hostOpeningTestReplay(value) {
      workspace['hostOpeningTestReplay'] = value
    },
    get selectedNodeHistory() {
      return workspace['selectedNodeHistory']
    },
    set selectedNodeHistory(value) {
      workspace['selectedNodeHistory'] = value
    },
    get nodeHistoryOpenToken() {
      return workspace['nodeHistoryOpenToken']
    },
    set nodeHistoryOpenToken(value) {
      workspace['nodeHistoryOpenToken'] = value
    },
    open: (...args): Promise<void> => workspace['open'](...args),
    standsInEmptySummaryComposition: (...args) =>
      workspace['standsInEmptySummaryComposition'](...args),
    forgetUnopenedComposition: (...args): void =>
      workspace['forgetUnopenedComposition'](...args),
    get presentationMode() {
      return workspace['presentationMode']
    },
    set presentationMode(value) {
      workspace['presentationMode'] = value
    },
    ensureContext: (...args): void => workspace['ensureContext'](...args),
    get historyRequest() {
      return workspace['historyRequest']
    },
    set historyRequest(value) {
      workspace['historyRequest'] = value
    },
    get studyChoices() {
      return workspace['studyChoices']
    },
    set studyChoices(value) {
      workspace['studyChoices'] = value
    },
    get pendingNodeHistory() {
      return workspace['pendingNodeHistory']
    },
    set pendingNodeHistory(value) {
      workspace['pendingNodeHistory'] = value
    },
    get pendingNodeHistoryStudyId() {
      return workspace['pendingNodeHistoryStudyId']
    },
    set pendingNodeHistoryStudyId(value) {
      workspace['pendingNodeHistoryStudyId'] = value
    },
    get loading() {
      return workspace['loading']
    },
    set loading(value) {
      workspace['loading'] = value
    },
    get replayDebuggers() {
      return workspace['replayDebuggers']
    },
    readNodeHistoryOpening: (...args) =>
      workspace['readNodeHistoryOpening'](...args),
    get nodeOutputReadings() {
      return workspace['nodeOutputReadings']
    },
    get selectedServerReplay() {
      return workspace['selectedServerReplay']
    },
    set selectedServerReplay(value) {
      workspace['selectedServerReplay'] = value
    },
    get selectedExtensionReplay() {
      return workspace['selectedExtensionReplay']
    },
    set selectedExtensionReplay(value) {
      workspace['selectedExtensionReplay'] = value
    },
    get extensionShownFrame() {
      return workspace['extensionShownFrame']
    },
    set extensionShownFrame(value) {
      workspace['extensionShownFrame'] = value
    },
    get extensionNativeShown() {
      return workspace['extensionNativeShown']
    },
    set extensionNativeShown(value) {
      workspace['extensionNativeShown'] = value
    },
    get extensionFrames() {
      return workspace['extensionFrames']
    },
    set extensionFrames(value) {
      workspace['extensionFrames'] = value
    },
    get nodeHistoryRepository() {
      return workspace['nodeHistoryRepository']
    },
    get nodeSourceSlotCloseFailure() {
      return workspace['nodeSourceSlotCloseFailure']
    },
    set nodeSourceSlotCloseFailure(value) {
      workspace['nodeSourceSlotCloseFailure'] = value
    },
    get repositoryObservation() {
      return workspace['repositoryObservation']
    },
    set repositoryObservation(value) {
      workspace['repositoryObservation'] = value
    },
    get selectedNodeHistoryLearningDecision() {
      return workspace['selectedNodeHistoryLearningDecision']
    },
    set selectedNodeHistoryLearningDecision(value) {
      workspace['selectedNodeHistoryLearningDecision'] = value
    },
    get selectedNodeHistoryLearningMaterial() {
      return workspace['selectedNodeHistoryLearningMaterial']
    },
    set selectedNodeHistoryLearningMaterial(value) {
      workspace['selectedNodeHistoryLearningMaterial'] = value
    },
    get selectedNodeHistoryPage() {
      return workspace['selectedNodeHistoryPage']
    },
    set selectedNodeHistoryPage(value) {
      workspace['selectedNodeHistoryPage'] = value
    },
    get selectedNodeHistorySequence() {
      return workspace['selectedNodeHistorySequence']
    },
    set selectedNodeHistorySequence(value) {
      workspace['selectedNodeHistorySequence'] = value
    },
    get nodeSurfacesSequence() {
      return workspace['nodeSurfacesSequence']
    },
    set nodeSurfacesSequence(value) {
      workspace['nodeSurfacesSequence'] = value
    },
    get selectedNodeHistoryStepId() {
      return workspace['selectedNodeHistoryStepId']
    },
    set selectedNodeHistoryStepId(value) {
      workspace['selectedNodeHistoryStepId'] = value
    },
    presentApplication: (...args): void =>
      workspace['presentApplication'](...args),
    message: (...args) => workspace['message'](...args),
    replayRefusal: (...args) => workspace['replayRefusal'](...args),
    requestNodeHistoryEvent: (...args): Promise<void> =>
      workspace['requestNodeHistoryEvent'](...args),
    replayKind: (...args) => workspace['replayKind'](...args),
    reportTestReplayFailure: (...args): void =>
      workspace['reportTestReplayFailure'](...args),
    isLatestHistoryRequest: (...args) =>
      workspace['isLatestHistoryRequest'](...args),
    get nodeHistoryStore() {
      return workspace['nodeHistoryStore']
    },
    get moments() {
      return workspace['moments']
    },
    get momentsReportsKeyboard() {
      return workspace['momentsReportsKeyboard']
    },
    get replayLoadAwaitingReady() {
      return workspace['replayLoadAwaitingReady']
    },
    set replayLoadAwaitingReady(value) {
      workspace['replayLoadAwaitingReady'] = value
    },
    retireNodeHistorySelection: (...args): Promise<void> =>
      workspace['retireNodeHistorySelection'](...args),
    giveSummaryItsDocument: (...args): void =>
      workspace['giveSummaryItsDocument'](...args),
    get retiredBrowserReplayTabs() {
      return workspace['retiredBrowserReplayTabs']
    },
    set retiredBrowserReplayTabs(value) {
      workspace['retiredBrowserReplayTabs'] = value
    },
    get pendingHistory() {
      return workspace['pendingHistory']
    },
    set pendingHistory(value) {
      workspace['pendingHistory'] = value
    },
    get activeArchive() {
      return workspace['activeArchive']
    },
    get selectedArchive() {
      return workspace['selectedArchive']
    },
    set selectedArchive(value) {
      workspace['selectedArchive'] = value
    },
    get recordings() {
      return workspace['recordings']
    },
    readSavedArchive: (...args) => workspace['readSavedArchive'](...args),
    get recordingRevealedByEntry() {
      return workspace['recordingRevealedByEntry']
    },
    ensureReplayViewport: (...args) =>
      workspace['ensureReplayViewport'](...args),
    get viewport() {
      return workspace['viewport']
    },
    dropReplayViewport: (...args): void =>
      workspace['dropReplayViewport'](...args),
    applicationHtml: (...args) => workspace['applicationHtml'](...args),
    get replayViewport() {
      return workspace['replayViewport']
    },
    set replayViewport(value) {
      workspace['replayViewport'] = value
    },
    get replayNeedsReveal() {
      return workspace['replayNeedsReveal']
    },
    set replayNeedsReveal(value) {
      workspace['replayNeedsReveal'] = value
    },
    prepareApplicationGroup: (...args) =>
      workspace['prepareApplicationGroup'](...args),
    assertApplicationReveal: (...args): void =>
      workspace['assertApplicationReveal'](...args),
    get service() {
      return workspace['service']
    },
    get playbackPending() {
      return workspace['playbackPending']
    },
    set playbackPending(value) {
      workspace['playbackPending'] = value
    },
    get playbackPresentingReady() {
      return workspace['playbackPresentingReady']
    },
    set playbackPresentingReady(value) {
      workspace['playbackPresentingReady'] = value
    },
    renderSelection: (...args): Promise<void> =>
      workspace['renderSelection'](...args),
    sourceReady: (...args) => workspace['sourceReady'](...args),
    get sourceUri() {
      return workspace['sourceUri']
    },
    get replayUninspectedSnapshot() {
      return workspace['replayUninspectedSnapshot']
    },
    set replayUninspectedSnapshot(value) {
      workspace['replayUninspectedSnapshot'] = value
    },
    get replayApplicationCovered() {
      return workspace['replayApplicationCovered']
    },
    set replayApplicationCovered(value) {
      workspace['replayApplicationCovered'] = value
    },
    get lastRendered() {
      return workspace['lastRendered']
    },
    set lastRendered(value) {
      workspace['lastRendered'] = value
    },
    get summaryView() {
      return workspace['summaryView']
    },
    get replayPaint() {
      return workspace['replayPaint']
    },
    set replayPaint(value) {
      workspace['replayPaint'] = value
    },
    get replayPaintWatchers() {
      return workspace['replayPaintWatchers']
    },
    get app() {
      return workspace['app']
    },
  }
}
