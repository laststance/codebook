import type { StudyWorkspace } from '../studyWorkspace'

/**
 * What {@link PresentationReceipts} reads, writes and calls on the workspace it was cut out of.
 *
 * Every member forwards to the live {@link StudyWorkspace} member at call time, so a test that replaces a workspace member is seen by the part. Built by {@link createPresentationReceiptsHost}.
 */
export interface PresentationReceiptsHost {
  readonly markerSetAt: StudyWorkspace['markerSetAt']
  presentationTransition: StudyWorkspace['presentationTransition']
  readonly closing: StudyWorkspace['closing']
  readonly returningCurrent: StudyWorkspace['returningCurrent']
  presentationOperation: StudyWorkspace['presentationOperation']
  readonly busy: StudyWorkspace['busy']
  readonly refreshing: StudyWorkspace['refreshing']
  readonly arranging: StudyWorkspace['arranging']
  readonly privateRoots: StudyWorkspace['privateRoots']
  readonly diagnostics: StudyWorkspace['diagnostics']
  readonly usesPreparedApplicationLayout: StudyWorkspace['usesPreparedApplicationLayout']
  presentationMode: StudyWorkspace['presentationMode']
  readonly app: StudyWorkspace['app']
  readonly applicationGroup: StudyWorkspace['applicationGroup']
  readonly liveComposition: StudyWorkspace['liveComposition']
  readonly summaryComposition: StudyWorkspace['summaryComposition']
  readonly editorGroupIdentities: StudyWorkspace['editorGroupIdentities']
  readonly studyPanePositions: StudyWorkspace['studyPanePositions']
  readonly testReplayHoldsComposition: StudyWorkspace['testReplayHoldsComposition']
  readonly layoutReceipt: StudyWorkspace['layoutReceipt']
  readonly sameStudyPanePositions: StudyWorkspace['sameStudyPanePositions']
  presentationConfirmed: StudyWorkspace['presentationConfirmed']
  presentationReason: StudyWorkspace['presentationReason']
  readonly opened: StudyWorkspace['opened']
  readonly playback: StudyWorkspace['playback']
  readonly browserReplayShown: StudyWorkspace['browserReplayShown']
  readonly presentationId: StudyWorkspace['presentationId']
  presentationControlRevision: StudyWorkspace['presentationControlRevision']
  readonly revision: StudyWorkspace['revision']
  readonly readerSelectionRevision: StudyWorkspace['readerSelectionRevision']
  readonly selection: StudyWorkspace['selection']
  readonly selectedNodeHistory: StudyWorkspace['selectedNodeHistory']
  requestedPresentation: StudyWorkspace['requestedPresentation']
  readonly recordingActive: StudyWorkspace['recordingActive']
  readonly presentationState: StudyWorkspace['presentationState']
  readonly readPassivePresentationLayout: StudyWorkspace['readPassivePresentationLayout']
  readonly sameEditorGroups: StudyWorkspace['sameEditorGroups']
  readonly publish: StudyWorkspace['publish']
  readonly errors: StudyWorkspace['errors']
  readonly restoresDisplacedCapturedSource: StudyWorkspace['restoresDisplacedCapturedSource']
  readonly returnDisplacedCapturedSourceThenAdmit: StudyWorkspace['returnDisplacedCapturedSourceThenAdmit']
  readonly admitPresentation: StudyWorkspace['admitPresentation']
  readonly retireRefusalLines: StudyWorkspace['retireRefusalLines']
  readonly coveredSourceCause: StudyWorkspace['coveredSourceCause']
  readonly lifetime: StudyWorkspace['lifetime']
  readonly readPresentationState: StudyWorkspace['readPresentationState']
  readonly assertLifetime: StudyWorkspace['assertLifetime']
  readonly changePresentation: StudyWorkspace['changePresentation']
  readonly retainForeignTabFocus: StudyWorkspace['retainForeignTabFocus']
  enlargedLayoutReceipt: StudyWorkspace['enlargedLayoutReceipt']
  readonly assertPresentationAdmission: StudyWorkspace['assertPresentationAdmission']
  readonly contextPanel: StudyWorkspace['contextPanel']
  readonly hasMainEditorFocus: StudyWorkspace['hasMainEditorFocus']
  readonly withLayout: StudyWorkspace['withLayout']
  readonly executeEditorCommand: StudyWorkspace['executeEditorCommand']
  groupSizesBeforeExpand: StudyWorkspace['groupSizesBeforeExpand']
  readonly savePresentationPreference: StudyWorkspace['savePresentationPreference']
  readonly context: StudyWorkspace['context']
  presentationWrite: StudyWorkspace['presentationWrite']
  readonly assertCompositionAllows: StudyWorkspace['assertCompositionAllows']
  readonly hostOpeningTestReplay: StudyWorkspace['hostOpeningTestReplay']
  readonly pendingNodeHistory: StudyWorkspace['pendingNodeHistory']
  readonly sourceReady: StudyWorkspace['sourceReady']
  readonly nodeSourceSlot: StudyWorkspace['nodeSourceSlot']
  readonly nodeSourceSlotHeld: StudyWorkspace['nodeSourceSlotHeld']
  readonly loading: StudyWorkspace['loading']
  readonly sourceEntryPending: StudyWorkspace['sourceEntryPending']
  readonly pendingSourceDisplay: StudyWorkspace['pendingSourceDisplay']
  readonly repositoryLayoutRestored: StudyWorkspace['repositoryLayoutRestored']
  readonly sourceUri: StudyWorkspace['sourceUri']
  readonly textTabUri: StudyWorkspace['textTabUri']
  readonly sourceGroup: StudyWorkspace['sourceGroup']
  readonly readMainEditorGrid: StudyWorkspace['readMainEditorGrid']
  readonly hasComposition: StudyWorkspace['hasComposition']
}

/**
 * Gives {@link PresentationReceipts} live access to the workspace members it does not own.
 *
 * Called once by the workspace's field initialiser; reaches private members with bracket access, which the type checker allows. Never copies a value and never binds, so later changes and test replacements are seen.
 *
 * @param workspace - The workspace the part belongs to.
 * @returns A host whose members read, write and call the workspace's members by name.
 * @example
 * private readonly presentationReceipts = new PresentationReceipts(createPresentationReceiptsHost(this))
 */
export function createPresentationReceiptsHost(
  workspace: StudyWorkspace,
): PresentationReceiptsHost {
  return {
    get markerSetAt() {
      return workspace['markerSetAt']
    },
    get presentationTransition() {
      return workspace['presentationTransition']
    },
    set presentationTransition(value) {
      workspace['presentationTransition'] = value
    },
    get closing() {
      return workspace['closing']
    },
    get returningCurrent() {
      return workspace['returningCurrent']
    },
    get presentationOperation() {
      return workspace['presentationOperation']
    },
    set presentationOperation(value) {
      workspace['presentationOperation'] = value
    },
    get busy() {
      return workspace['busy']
    },
    get refreshing() {
      return workspace['refreshing']
    },
    get arranging() {
      return workspace['arranging']
    },
    privateRoots: (...args) => workspace['privateRoots'](...args),
    get diagnostics() {
      return workspace['diagnostics']
    },
    usesPreparedApplicationLayout: (...args) =>
      workspace['usesPreparedApplicationLayout'](...args),
    get presentationMode() {
      return workspace['presentationMode']
    },
    set presentationMode(value) {
      workspace['presentationMode'] = value
    },
    get app() {
      return workspace['app']
    },
    get applicationGroup() {
      return workspace['applicationGroup']
    },
    get liveComposition() {
      return workspace['liveComposition']
    },
    get summaryComposition() {
      return workspace['summaryComposition']
    },
    get editorGroupIdentities() {
      return workspace['editorGroupIdentities']
    },
    studyPanePositions: (...args) => workspace['studyPanePositions'](...args),
    testReplayHoldsComposition: (...args) =>
      workspace['testReplayHoldsComposition'](...args),
    get layoutReceipt() {
      return workspace['layoutReceipt']
    },
    sameStudyPanePositions: (...args) =>
      workspace['sameStudyPanePositions'](...args),
    get presentationConfirmed() {
      return workspace['presentationConfirmed']
    },
    set presentationConfirmed(value) {
      workspace['presentationConfirmed'] = value
    },
    get presentationReason() {
      return workspace['presentationReason']
    },
    set presentationReason(value) {
      workspace['presentationReason'] = value
    },
    get opened() {
      return workspace['opened']
    },
    get playback() {
      return workspace['playback']
    },
    browserReplayShown: (...args) => workspace['browserReplayShown'](...args),
    get presentationId() {
      return workspace['presentationId']
    },
    get presentationControlRevision() {
      return workspace['presentationControlRevision']
    },
    set presentationControlRevision(value) {
      workspace['presentationControlRevision'] = value
    },
    get revision() {
      return workspace['revision']
    },
    get readerSelectionRevision() {
      return workspace['readerSelectionRevision']
    },
    get selection() {
      return workspace['selection']
    },
    get selectedNodeHistory() {
      return workspace['selectedNodeHistory']
    },
    get requestedPresentation() {
      return workspace['requestedPresentation']
    },
    set requestedPresentation(value) {
      workspace['requestedPresentation'] = value
    },
    get recordingActive() {
      return workspace['recordingActive']
    },
    presentationState: (...args) => workspace['presentationState'](...args),
    readPassivePresentationLayout: (...args) =>
      workspace['readPassivePresentationLayout'](...args),
    sameEditorGroups: (...args) => workspace['sameEditorGroups'](...args),
    publish: (...args): void => workspace['publish'](...args),
    get errors() {
      return workspace['errors']
    },
    restoresDisplacedCapturedSource: (...args) =>
      workspace['restoresDisplacedCapturedSource'](...args),
    returnDisplacedCapturedSourceThenAdmit: (...args) =>
      workspace['returnDisplacedCapturedSourceThenAdmit'](...args),
    admitPresentation: (...args) => workspace['admitPresentation'](...args),
    retireRefusalLines: (...args): void =>
      workspace['retireRefusalLines'](...args),
    coveredSourceCause: (...args) => workspace['coveredSourceCause'](...args),
    get lifetime() {
      return workspace['lifetime']
    },
    readPresentationState: (...args) =>
      workspace['readPresentationState'](...args),
    assertLifetime: (...args): void => workspace['assertLifetime'](...args),
    changePresentation: (...args) => workspace['changePresentation'](...args),
    retainForeignTabFocus: (...args) =>
      workspace['retainForeignTabFocus'](...args),
    get enlargedLayoutReceipt() {
      return workspace['enlargedLayoutReceipt']
    },
    set enlargedLayoutReceipt(value) {
      workspace['enlargedLayoutReceipt'] = value
    },
    assertPresentationAdmission: (...args) =>
      workspace['assertPresentationAdmission'](...args),
    get contextPanel() {
      return workspace['contextPanel']
    },
    hasMainEditorFocus: (...args) => workspace['hasMainEditorFocus'](...args),
    withLayout: (...args) => workspace['withLayout'](...args),
    executeEditorCommand: (...args) =>
      workspace['executeEditorCommand'](...args),
    get groupSizesBeforeExpand() {
      return workspace['groupSizesBeforeExpand']
    },
    set groupSizesBeforeExpand(value) {
      workspace['groupSizesBeforeExpand'] = value
    },
    savePresentationPreference: (...args): Promise<void> =>
      workspace['savePresentationPreference'](...args),
    get context() {
      return workspace['context']
    },
    get presentationWrite() {
      return workspace['presentationWrite']
    },
    set presentationWrite(value) {
      workspace['presentationWrite'] = value
    },
    assertCompositionAllows: (...args): void =>
      workspace['assertCompositionAllows'](...args),
    get hostOpeningTestReplay() {
      return workspace['hostOpeningTestReplay']
    },
    get pendingNodeHistory() {
      return workspace['pendingNodeHistory']
    },
    sourceReady: (...args) => workspace['sourceReady'](...args),
    get nodeSourceSlot() {
      return workspace['nodeSourceSlot']
    },
    get nodeSourceSlotHeld() {
      return workspace['nodeSourceSlotHeld']
    },
    get loading() {
      return workspace['loading']
    },
    get sourceEntryPending() {
      return workspace['sourceEntryPending']
    },
    get pendingSourceDisplay() {
      return workspace['pendingSourceDisplay']
    },
    get repositoryLayoutRestored() {
      return workspace['repositoryLayoutRestored']
    },
    get sourceUri() {
      return workspace['sourceUri']
    },
    textTabUri: (...args) => workspace['textTabUri'](...args),
    get sourceGroup() {
      return workspace['sourceGroup']
    },
    readMainEditorGrid: (...args) => workspace['readMainEditorGrid'](...args),
    hasComposition: (...args) => workspace['hasComposition'](...args),
  }
}
