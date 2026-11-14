import type * as vscode from 'vscode'

import type { StudyWorkspace } from '../studyWorkspace'

/**
 * What {@link PresentationGuards} reads, writes and calls on the workspace it was cut out of.
 *
 * Every member forwards to the live {@link StudyWorkspace} member at call time, so a test that replaces a workspace member is seen by the part. Built by {@link createPresentationGuardsHost}.
 */
export interface PresentationGuardsHost {
  readonly sampleKeyboardOutsideEditors: StudyWorkspace['sampleKeyboardOutsideEditors']
  readonly hasComposition: StudyWorkspace['hasComposition']
  readonly isLearnersEditor: StudyWorkspace['isLearnersEditor']
  readonly isActiveTextEditorInFrontOfGroup: StudyWorkspace['isActiveTextEditorInFrontOfGroup']
  readonly learnerTabKey: StudyWorkspace['learnerTabKey']
  readonly sourceUri: StudyWorkspace['sourceUri']
  readonly isCodebookPaneInput: StudyWorkspace['isCodebookPaneInput']
  readonly hasActiveStudyPane: StudyWorkspace['hasActiveStudyPane']
  readonly app: StudyWorkspace['app']
  readonly activeTextDocumentUri: StudyWorkspace['activeTextDocumentUri']
  readonly confirmedCompositionState: StudyWorkspace['confirmedCompositionState']
  readonly hasSameTabState: StudyWorkspace['hasSameTabState']
  readonly restoreRetainedLayout: StudyWorkspace['restoreRetainedLayout']
  presentationOperation: StudyWorkspace['presentationOperation']
  readonly deadPaneTabs: StudyWorkspace['deadPaneTabs']
  presentationTransition: StudyWorkspace['presentationTransition']
  readonly arranging: StudyWorkspace['arranging']
  readonly assertPresentationAdmission: StudyWorkspace['assertPresentationAdmission']
  readonly mainEditorFocusBorrows: StudyWorkspace['mainEditorFocusBorrows']
  readonly stopFileDestinationFocuses: StudyWorkspace['stopFileDestinationFocuses']
  readonly stopFileDestinationColumn: StudyWorkspace['stopFileDestinationColumn']
  readonly namesAnotherEditorPartsTab: StudyWorkspace['namesAnotherEditorPartsTab']
  readonly arrange: StudyWorkspace['arrange']
  readonly showTextDocumentNoted: StudyWorkspace['showTextDocumentNoted']
  readonly isCursorHost: StudyWorkspace['isCursorHost']
  readonly confirmCompositionByReceipt: StudyWorkspace['confirmCompositionByReceipt']
  readonly wasShownByItsStop: StudyWorkspace['wasShownByItsStop']
  readonly reportsKeyboard: StudyWorkspace['reportsKeyboard']
  readonly sourceReady: StudyWorkspace['sourceReady']
  readonly presentationId: StudyWorkspace['presentationId']
  readonly executeEditorCommand: StudyWorkspace['executeEditorCommand']
  readonly initialize: StudyWorkspace['initialize']
  readonly controls: StudyWorkspace['controls']
  readonly showSideBarsHiddenByRead: StudyWorkspace['showSideBarsHiddenByRead']
  readonly isTestReplayRestore: StudyWorkspace['isTestReplayRestore']
  readonly activeTextEditorWithKeyboard: StudyWorkspace['activeTextEditorWithKeyboard']
  readonly publish: StudyWorkspace['publish']
  readonly leftoverTabs: StudyWorkspace['leftoverTabs']
  readonly debuggerGaveEditorKeyboard: StudyWorkspace['debuggerGaveEditorKeyboard']
  readonly recordingActive: StudyWorkspace['recordingActive']
  readonly announcedStops: StudyWorkspace['announcedStops']
  readonly noteApplicationFrontAtStop: StudyWorkspace['noteApplicationFrontAtStop']
  readonly noteStopFileCoveringApplication: StudyWorkspace['noteStopFileCoveringApplication']
  readonly sessionsStoppedBehindApplication: StudyWorkspace['sessionsStoppedBehindApplication']
  readonly applicationGroupChange: StudyWorkspace['applicationGroupChange']
  readonly holdsDebuggersFileOfPause: StudyWorkspace['holdsDebuggersFileOfPause']
  readonly focusPresentationPanel: StudyWorkspace['focusPresentationPanel']
  readonly editorGroupIdentities: StudyWorkspace['editorGroupIdentities']
  requestedPresentation: StudyWorkspace['requestedPresentation']
  readonly hasKeyboardInEditors: StudyWorkspace['hasKeyboardInEditors']
  readonly disposables: StudyWorkspace['disposables']
  learnerMovedToSource: StudyWorkspace['learnerMovedToSource']
  readonly placeOfRememberedGroup: StudyWorkspace['placeOfRememberedGroup']
  readonly stopHandOver: StudyWorkspace['stopHandOver']
  readonly liveComposition: StudyWorkspace['liveComposition']
  presentationYieldedToLearner: StudyWorkspace['presentationYieldedToLearner']
  readonly knowsKeyboardPlaceAtAdmission: StudyWorkspace['knowsKeyboardPlaceAtAdmission']
  readonly coveredSourceCause: StudyWorkspace['coveredSourceCause']
  readonly chatFocusCommand: StudyWorkspace['chatFocusCommand']
  readonly studyPanePositions: StudyWorkspace['studyPanePositions']
  readonly assertLifetime: StudyWorkspace['assertLifetime']
  readonly loading: StudyWorkspace['loading']
  readonly replayApplicationCovered: StudyWorkspace['replayApplicationCovered']
  readonly hasStudyPaneColumns: StudyWorkspace['hasStudyPaneColumns']
  readonly confirmCompositionNoop: StudyWorkspace['confirmCompositionNoop']
  readonly savePresentationPreference: StudyWorkspace['savePresentationPreference']
  readonly repositoryNavigation: StudyWorkspace['repositoryNavigation']
  readonly textTabUri: StudyWorkspace['textTabUri']
  readonly refusePlacement: StudyWorkspace['refusePlacement']
  readonly readStudyPane: StudyWorkspace['readStudyPane']
  readonly firstGroupFrontAtBorrow: StudyWorkspace['firstGroupFrontAtBorrow']
  nodeSourceSlotTabsAwaitingArea: StudyWorkspace['nodeSourceSlotTabsAwaitingArea']
  readonly performPresentation: StudyWorkspace['performPresentation']
  readonly settleOwnedPlayback: StudyWorkspace['settleOwnedPlayback']
  readonly armPlacementReport: StudyWorkspace['armPlacementReport']
  readonly assertCompositionAllows: StudyWorkspace['assertCompositionAllows']
  readonly trackFocusedStudyPane: StudyWorkspace['trackFocusedStudyPane']
  readonly isCapturedSourceInput: StudyWorkspace['isCapturedSourceInput']
  readonly runFocusReturnCommand: StudyWorkspace['runFocusReturnCommand']
  readonly giveStopKeyboard: StudyWorkspace['giveStopKeyboard']
  retiredBrowserReplayTabs: StudyWorkspace['retiredBrowserReplayTabs']
  readonly hasLiveRun: StudyWorkspace['hasLiveRun']
  presentationReason: StudyWorkspace['presentationReason']
  readonly isStopHandOverDue: StudyWorkspace['isStopHandOverDue']
  readonly repositoryLayoutRestored: StudyWorkspace['repositoryLayoutRestored']
  presentationConfirmed: StudyWorkspace['presentationConfirmed']
  readonly closeLeftoverTabs: StudyWorkspace['closeLeftoverTabs']
  readonly errors: StudyWorkspace['errors']
  sourceDerivedGroup: StudyWorkspace['sourceDerivedGroup']
  readonly presentationState: StudyWorkspace['presentationState']
  readonly capturePresentationFocus: StudyWorkspace['capturePresentationFocus']
  readonly pendingSourceDisplay: StudyWorkspace['pendingSourceDisplay']
  readonly lifetime: StudyWorkspace['lifetime']
  readonly opened: StudyWorkspace['opened']
  readonly placingPresentation: StudyWorkspace['placingPresentation']
  readonly saving: StudyWorkspace['saving']
  frameCameWithStop: StudyWorkspace['frameCameWithStop']
  presentationControlRevision: StudyWorkspace['presentationControlRevision']
  readonly sessionsWentOnAtMs: StudyWorkspace['sessionsWentOnAtMs']
  readonly retainForeignTabFocus: StudyWorkspace['retainForeignTabFocus']
  readonly restoreTestReplayArrangement: StudyWorkspace['restoreTestReplayArrangement']
  readonly layoutReceipt: StudyWorkspace['layoutReceipt']
  readonly groupOfKeyboardEditor: StudyWorkspace['groupOfKeyboardEditor']
  readonly webviewCloseRevisions: StudyWorkspace['webviewCloseRevisions']
  readonly revealPane: StudyWorkspace['revealPane']
  readonly confirmPresentationNoop: StudyWorkspace['confirmPresentationNoop']
  readonly endPresentationTransition: StudyWorkspace['endPresentationTransition']
  keyboardOutsideEditors: StudyWorkspace['keyboardOutsideEditors']
  readonly followedSessions: StudyWorkspace['followedSessions']
  readonly service: StudyWorkspace['service']
  learnerChoseEditorAtFrame: StudyWorkspace['learnerChoseEditorAtFrame']
  readonly placementEffects: StudyWorkspace['placementEffects']
  readonly giveKeyboardBackAtPause: StudyWorkspace['giveKeyboardBackAtPause']
  readonly focusReturnCommand: StudyWorkspace['focusReturnCommand']
  learnerWorkedInEditorAtMs: StudyWorkspace['learnerWorkedInEditorAtMs']
  readonly describeActiveEditor: StudyWorkspace['describeActiveEditor']
  readonly focusBorrowCount: StudyWorkspace['focusBorrowCount']
  readonly editorTabName: StudyWorkspace['editorTabName']
  maximizedByRead: StudyWorkspace['maximizedByRead']
  readonly playback: StudyWorkspace['playback']
  readonly readingFocusOrigin: StudyWorkspace['readingFocusOrigin']
  readonly returningCurrent: StudyWorkspace['returningCurrent']
  readonly giveGroupSizesBackAfterExpand: StudyWorkspace['giveGroupSizesBackAfterExpand']
  readonly presentationEditorScope: StudyWorkspace['presentationEditorScope']
  readonly hasRetainedStudyTopology: StudyWorkspace['hasRetainedStudyTopology']
  readonly admitPresentation: StudyWorkspace['admitPresentation']
  readonly expandToEndMaximization: StudyWorkspace['expandToEndMaximization']
  readonly holdsKeyboardByPause: StudyWorkspace['holdsKeyboardByPause']
  sourceKeyboardPlacedAtMs: StudyWorkspace['sourceKeyboardPlacedAtMs']
  readonly contextPanel: StudyWorkspace['contextPanel']
  readonly returningPreparationFocus: StudyWorkspace['returningPreparationFocus']
  readonly placementEvents: StudyWorkspace['placementEvents']
  readonly pendingHistory: StudyWorkspace['pendingHistory']
  readonly assertPresentationIdle: StudyWorkspace['assertPresentationIdle']
  readonly tabIdentity: StudyWorkspace['tabIdentity']
  readonly isOwnPaneOrSourceTab: StudyWorkspace['isOwnPaneOrSourceTab']
  readonly returnsKeyboardToChatAtPause: StudyWorkspace['returnsKeyboardToChatAtPause']
  readonly busy: StudyWorkspace['busy']
  readonly leavePauseToLearner: StudyWorkspace['leavePauseToLearner']
  readonly summaryComposition: StudyWorkspace['summaryComposition']
  readonly learnersTabKeysOf: StudyWorkspace['learnersTabKeysOf']
}

/**
 * Gives {@link PresentationGuards} live access to the workspace members it does not own.
 *
 * Called once by the workspace's field initialiser; reaches private members with bracket access, which the type checker allows. Never copies a value and never binds, so later changes and test replacements are seen.
 *
 * @param workspace - The workspace the part belongs to.
 * @returns A host whose members read, write and call the workspace's members by name.
 * @example
 * private readonly presentationGuards = new PresentationGuards(createPresentationGuardsHost(this))
 */
export function createPresentationGuardsHost(
  workspace: StudyWorkspace,
): PresentationGuardsHost {
  return {
    sampleKeyboardOutsideEditors: (...args): void =>
      workspace['sampleKeyboardOutsideEditors'](...args),
    hasComposition: (...args) => workspace['hasComposition'](...args),
    isLearnersEditor: (...args) => workspace['isLearnersEditor'](...args),
    isActiveTextEditorInFrontOfGroup: (...args) =>
      workspace['isActiveTextEditorInFrontOfGroup'](...args),
    learnerTabKey: (...args) => workspace['learnerTabKey'](...args),
    get sourceUri() {
      return workspace['sourceUri']
    },
    isCodebookPaneInput: (...args) => workspace['isCodebookPaneInput'](...args),
    hasActiveStudyPane: (...args) => workspace['hasActiveStudyPane'](...args),
    get app() {
      return workspace['app']
    },
    activeTextDocumentUri: (...args) =>
      workspace['activeTextDocumentUri'](...args),
    confirmedCompositionState: (...args) =>
      workspace['confirmedCompositionState'](...args),
    hasSameTabState: (...args) => workspace['hasSameTabState'](...args),
    restoreRetainedLayout: (...args) =>
      workspace['restoreRetainedLayout'](...args),
    get presentationOperation() {
      return workspace['presentationOperation']
    },
    set presentationOperation(value) {
      workspace['presentationOperation'] = value
    },
    deadPaneTabs: (...args) => workspace['deadPaneTabs'](...args),
    get presentationTransition() {
      return workspace['presentationTransition']
    },
    set presentationTransition(value) {
      workspace['presentationTransition'] = value
    },
    get arranging() {
      return workspace['arranging']
    },
    assertPresentationAdmission: (...args) =>
      workspace['assertPresentationAdmission'](...args),
    get mainEditorFocusBorrows() {
      return workspace['mainEditorFocusBorrows']
    },
    get stopFileDestinationFocuses() {
      return workspace['stopFileDestinationFocuses']
    },
    stopFileDestinationColumn: (...args) =>
      workspace['stopFileDestinationColumn'](...args),
    namesAnotherEditorPartsTab: (...args) =>
      workspace['namesAnotherEditorPartsTab'](...args),
    arrange: (...args): Promise<void> => workspace['arrange'](...args),
    showTextDocumentNoted: (...args) =>
      workspace['showTextDocumentNoted'](...args),
    isCursorHost: (...args) => workspace['isCursorHost'](...args),
    confirmCompositionByReceipt: (...args): void =>
      workspace['confirmCompositionByReceipt'](...args),
    wasShownByItsStop: (...args) => workspace['wasShownByItsStop'](...args),
    reportsKeyboard: (...args) => workspace['reportsKeyboard'](...args),
    sourceReady: (...args) => workspace['sourceReady'](...args),
    get presentationId() {
      return workspace['presentationId']
    },
    executeEditorCommand: (...args) =>
      workspace['executeEditorCommand'](...args),
    initialize: (...args): Promise<void> => workspace['initialize'](...args),
    get controls() {
      return workspace['controls']
    },
    showSideBarsHiddenByRead: (...args) =>
      workspace['showSideBarsHiddenByRead'](...args),
    isTestReplayRestore: (...args) => workspace['isTestReplayRestore'](...args),
    activeTextEditorWithKeyboard: (...args) =>
      workspace['activeTextEditorWithKeyboard'](...args),
    publish: (...args): void => workspace['publish'](...args),
    leftoverTabs: (...args) => workspace['leftoverTabs'](...args),
    debuggerGaveEditorKeyboard: (...args) =>
      workspace['debuggerGaveEditorKeyboard'](...args),
    get recordingActive() {
      return workspace['recordingActive']
    },
    get announcedStops() {
      return workspace['announcedStops']
    },
    noteApplicationFrontAtStop: (...args): void =>
      workspace['noteApplicationFrontAtStop'](...args),
    noteStopFileCoveringApplication: (...args): void =>
      workspace['noteStopFileCoveringApplication'](...args),
    get sessionsStoppedBehindApplication() {
      return workspace['sessionsStoppedBehindApplication']
    },
    get applicationGroupChange() {
      return workspace['applicationGroupChange']
    },
    holdsDebuggersFileOfPause: (...args) =>
      workspace['holdsDebuggersFileOfPause'](...args),
    focusPresentationPanel: (...args): Promise<void> =>
      workspace['focusPresentationPanel'](...args),
    get editorGroupIdentities() {
      return workspace['editorGroupIdentities']
    },
    get requestedPresentation() {
      return workspace['requestedPresentation']
    },
    set requestedPresentation(value) {
      workspace['requestedPresentation'] = value
    },
    hasKeyboardInEditors: (...args) =>
      workspace['hasKeyboardInEditors'](...args),
    get disposables() {
      return workspace['disposables']
    },
    get learnerMovedToSource() {
      return workspace['learnerMovedToSource']
    },
    set learnerMovedToSource(value) {
      workspace['learnerMovedToSource'] = value
    },
    placeOfRememberedGroup: (...args) =>
      workspace['placeOfRememberedGroup'](...args),
    get stopHandOver() {
      return workspace['stopHandOver']
    },
    get liveComposition() {
      return workspace['liveComposition']
    },
    get presentationYieldedToLearner() {
      return workspace['presentationYieldedToLearner']
    },
    set presentationYieldedToLearner(value) {
      workspace['presentationYieldedToLearner'] = value
    },
    knowsKeyboardPlaceAtAdmission: (...args) =>
      workspace['knowsKeyboardPlaceAtAdmission'](...args),
    coveredSourceCause: (...args) => workspace['coveredSourceCause'](...args),
    chatFocusCommand: (...args) => workspace['chatFocusCommand'](...args),
    studyPanePositions: (...args) => workspace['studyPanePositions'](...args),
    assertLifetime: (...args): void => workspace['assertLifetime'](...args),
    get loading() {
      return workspace['loading']
    },
    get replayApplicationCovered() {
      return workspace['replayApplicationCovered']
    },
    hasStudyPaneColumns: (...args) => workspace['hasStudyPaneColumns'](...args),
    confirmCompositionNoop: (...args) =>
      workspace['confirmCompositionNoop'](...args),
    savePresentationPreference: (...args): Promise<void> =>
      workspace['savePresentationPreference'](...args),
    get repositoryNavigation() {
      return workspace['repositoryNavigation']
    },
    textTabUri: (...args) => workspace['textTabUri'](...args),
    refusePlacement: (...args) => workspace['refusePlacement'](...args),
    readStudyPane: (...args): Promise<void> =>
      workspace['readStudyPane'](...args),
    get firstGroupFrontAtBorrow() {
      return workspace['firstGroupFrontAtBorrow']
    },
    get nodeSourceSlotTabsAwaitingArea() {
      return workspace['nodeSourceSlotTabsAwaitingArea']
    },
    set nodeSourceSlotTabsAwaitingArea(value) {
      workspace['nodeSourceSlotTabsAwaitingArea'] = value
    },
    performPresentation: (...args) => workspace['performPresentation'](...args),
    settleOwnedPlayback: (...args): Promise<void> =>
      workspace['settleOwnedPlayback'](...args),
    armPlacementReport: (...args) => workspace['armPlacementReport'](...args),
    assertCompositionAllows: (...args): void =>
      workspace['assertCompositionAllows'](...args),
    trackFocusedStudyPane: (...args) =>
      workspace['trackFocusedStudyPane'](...args),
    isCapturedSourceInput: (input: unknown): input is vscode.TabInputText =>
      workspace['isCapturedSourceInput'](input),
    runFocusReturnCommand: (...args) =>
      workspace['runFocusReturnCommand'](...args),
    giveStopKeyboard: (...args): void => workspace['giveStopKeyboard'](...args),
    get retiredBrowserReplayTabs() {
      return workspace['retiredBrowserReplayTabs']
    },
    set retiredBrowserReplayTabs(value) {
      workspace['retiredBrowserReplayTabs'] = value
    },
    hasLiveRun: (...args) => workspace['hasLiveRun'](...args),
    get presentationReason() {
      return workspace['presentationReason']
    },
    set presentationReason(value) {
      workspace['presentationReason'] = value
    },
    isStopHandOverDue: (...args) => workspace['isStopHandOverDue'](...args),
    get repositoryLayoutRestored() {
      return workspace['repositoryLayoutRestored']
    },
    get presentationConfirmed() {
      return workspace['presentationConfirmed']
    },
    set presentationConfirmed(value) {
      workspace['presentationConfirmed'] = value
    },
    closeLeftoverTabs: (...args) => workspace['closeLeftoverTabs'](...args),
    get errors() {
      return workspace['errors']
    },
    get sourceDerivedGroup() {
      return workspace['sourceDerivedGroup']
    },
    set sourceDerivedGroup(value) {
      workspace['sourceDerivedGroup'] = value
    },
    presentationState: (...args) => workspace['presentationState'](...args),
    capturePresentationFocus: (...args) =>
      workspace['capturePresentationFocus'](...args),
    get pendingSourceDisplay() {
      return workspace['pendingSourceDisplay']
    },
    get lifetime() {
      return workspace['lifetime']
    },
    get opened() {
      return workspace['opened']
    },
    get placingPresentation() {
      return workspace['placingPresentation']
    },
    get saving() {
      return workspace['saving']
    },
    get frameCameWithStop() {
      return workspace['frameCameWithStop']
    },
    set frameCameWithStop(value) {
      workspace['frameCameWithStop'] = value
    },
    get presentationControlRevision() {
      return workspace['presentationControlRevision']
    },
    set presentationControlRevision(value) {
      workspace['presentationControlRevision'] = value
    },
    get sessionsWentOnAtMs() {
      return workspace['sessionsWentOnAtMs']
    },
    retainForeignTabFocus: (...args) =>
      workspace['retainForeignTabFocus'](...args),
    restoreTestReplayArrangement: (...args) =>
      workspace['restoreTestReplayArrangement'](...args),
    get layoutReceipt() {
      return workspace['layoutReceipt']
    },
    groupOfKeyboardEditor: (...args) =>
      workspace['groupOfKeyboardEditor'](...args),
    get webviewCloseRevisions() {
      return workspace['webviewCloseRevisions']
    },
    revealPane: (...args): void => workspace['revealPane'](...args),
    confirmPresentationNoop: (...args) =>
      workspace['confirmPresentationNoop'](...args),
    endPresentationTransition: (...args): void =>
      workspace['endPresentationTransition'](...args),
    get keyboardOutsideEditors() {
      return workspace['keyboardOutsideEditors']
    },
    set keyboardOutsideEditors(value) {
      workspace['keyboardOutsideEditors'] = value
    },
    get followedSessions() {
      return workspace['followedSessions']
    },
    get service() {
      return workspace['service']
    },
    get learnerChoseEditorAtFrame() {
      return workspace['learnerChoseEditorAtFrame']
    },
    set learnerChoseEditorAtFrame(value) {
      workspace['learnerChoseEditorAtFrame'] = value
    },
    get placementEffects() {
      return workspace['placementEffects']
    },
    giveKeyboardBackAtPause: (...args) =>
      workspace['giveKeyboardBackAtPause'](...args),
    focusReturnCommand: (...args) => workspace['focusReturnCommand'](...args),
    get learnerWorkedInEditorAtMs() {
      return workspace['learnerWorkedInEditorAtMs']
    },
    set learnerWorkedInEditorAtMs(value) {
      workspace['learnerWorkedInEditorAtMs'] = value
    },
    describeActiveEditor: (...args) =>
      workspace['describeActiveEditor'](...args),
    focusBorrowCount: (...args) => workspace['focusBorrowCount'](...args),
    editorTabName: (...args) => workspace['editorTabName'](...args),
    get maximizedByRead() {
      return workspace['maximizedByRead']
    },
    set maximizedByRead(value) {
      workspace['maximizedByRead'] = value
    },
    get playback() {
      return workspace['playback']
    },
    readingFocusOrigin: (...args) => workspace['readingFocusOrigin'](...args),
    get returningCurrent() {
      return workspace['returningCurrent']
    },
    giveGroupSizesBackAfterExpand: (...args): Promise<void> =>
      workspace['giveGroupSizesBackAfterExpand'](...args),
    get presentationEditorScope() {
      return workspace['presentationEditorScope']
    },
    hasRetainedStudyTopology: (...args) =>
      workspace['hasRetainedStudyTopology'](...args),
    admitPresentation: (...args) => workspace['admitPresentation'](...args),
    expandToEndMaximization: (...args): Promise<void> =>
      workspace['expandToEndMaximization'](...args),
    holdsKeyboardByPause: (...args) =>
      workspace['holdsKeyboardByPause'](...args),
    get sourceKeyboardPlacedAtMs() {
      return workspace['sourceKeyboardPlacedAtMs']
    },
    set sourceKeyboardPlacedAtMs(value) {
      workspace['sourceKeyboardPlacedAtMs'] = value
    },
    get contextPanel() {
      return workspace['contextPanel']
    },
    get returningPreparationFocus() {
      return workspace['returningPreparationFocus']
    },
    get placementEvents() {
      return workspace['placementEvents']
    },
    get pendingHistory() {
      return workspace['pendingHistory']
    },
    assertPresentationIdle: (...args): void =>
      workspace['assertPresentationIdle'](...args),
    tabIdentity: (...args) => workspace['tabIdentity'](...args),
    isOwnPaneOrSourceTab: (...args) =>
      workspace['isOwnPaneOrSourceTab'](...args),
    returnsKeyboardToChatAtPause: (...args) =>
      workspace['returnsKeyboardToChatAtPause'](...args),
    get busy() {
      return workspace['busy']
    },
    leavePauseToLearner: (...args): void =>
      workspace['leavePauseToLearner'](...args),
    get summaryComposition() {
      return workspace['summaryComposition']
    },
    learnersTabKeysOf: (...args) => workspace['learnersTabKeysOf'](...args),
  }
}
