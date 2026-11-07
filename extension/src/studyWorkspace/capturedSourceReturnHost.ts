import type { StudyWorkspace } from '../studyWorkspace'

/**
 * What {@link CapturedSourceReturn} reads, writes and calls on the workspace it was cut out of.
 *
 * Every member forwards to the live {@link StudyWorkspace} member at call time, so a test that replaces a workspace member is seen by the part. Built by {@link createCapturedSourceReturnHost}.
 */
export interface CapturedSourceReturnHost {
  readonly admitPresentation: StudyWorkspace['admitPresentation']
  readonly assertLifetime: StudyWorkspace['assertLifetime']
  readonly assertPresentationAdmission: StudyWorkspace['assertPresentationAdmission']
  readonly busy: StudyWorkspace['busy']
  readonly closing: StudyWorkspace['closing']
  readonly diagnostics: StudyWorkspace['diagnostics']
  readonly enlargedLayoutReceipt: StudyWorkspace['enlargedLayoutReceipt']
  readonly errors: StudyWorkspace['errors']
  readonly executeEditorCommand: StudyWorkspace['executeEditorCommand']
  readonly hasStudyPaneColumns: StudyWorkspace['hasStudyPaneColumns']
  readonly highlight: StudyWorkspace['highlight']
  readonly isCodebookPaneInput: StudyWorkspace['isCodebookPaneInput']
  readonly isOwnPaneOrSourceTab: StudyWorkspace['isOwnPaneOrSourceTab']
  readonly isPresentationAdmissionOpen: StudyWorkspace['isPresentationAdmissionOpen']
  layoutReceipt: StudyWorkspace['layoutReceipt']
  readonly lifetime: StudyWorkspace['lifetime']
  readonly liveComposition: StudyWorkspace['liveComposition']
  readonly message: StudyWorkspace['message']
  readonly ownsCapturedSourceTab: StudyWorkspace['ownsCapturedSourceTab']
  readonly placeOfRememberedGroup: StudyWorkspace['placeOfRememberedGroup']
  presentationConfirmed: StudyWorkspace['presentationConfirmed']
  presentationControlRevision: StudyWorkspace['presentationControlRevision']
  readonly presentationId: StudyWorkspace['presentationId']
  readonly presentationOperation: StudyWorkspace['presentationOperation']
  presentationReason: StudyWorkspace['presentationReason']
  readonly presentationState: StudyWorkspace['presentationState']
  presentationTransition: StudyWorkspace['presentationTransition']
  readonly publish: StudyWorkspace['publish']
  readonly readPassivePresentationLayout: StudyWorkspace['readPassivePresentationLayout']
  readonly recordingActive: StudyWorkspace['recordingActive']
  requestedPresentation: StudyWorkspace['requestedPresentation']
  readonly retainForeignTabFocus: StudyWorkspace['retainForeignTabFocus']
  readonly returningCurrent: StudyWorkspace['returningCurrent']
  readonly savePresentationPreference: StudyWorkspace['savePresentationPreference']
  readonly selectedStudy: StudyWorkspace['selectedStudy']
  readonly showTextDocumentNoted: StudyWorkspace['showTextDocumentNoted']
  sourceGroup: StudyWorkspace['sourceGroup']
  readonly sourceIdentity: StudyWorkspace['sourceIdentity']
  readonly sourceIdentityDecoration: StudyWorkspace['sourceIdentityDecoration']
  readonly sourceUri: StudyWorkspace['sourceUri']
  readonly studyPanePositions: StudyWorkspace['studyPanePositions']
  readonly summaryComposition: StudyWorkspace['summaryComposition']
  readonly testReplayHoldsComposition: StudyWorkspace['testReplayHoldsComposition']
  readonly textTabUri: StudyWorkspace['textTabUri']
  readonly watchLearnersChoice: StudyWorkspace['watchLearnersChoice']
  readonly yieldFocusToLearner: StudyWorkspace['yieldFocusToLearner']
}

/**
 * Gives {@link CapturedSourceReturn} live access to the workspace members it does not own.
 *
 * Called once by the workspace's field initialiser; reaches private members with bracket access, which the type checker allows. Never copies a value and never binds, so later changes and test replacements are seen.
 *
 * @param workspace - The workspace the part belongs to.
 * @returns A host whose members read, write and call the workspace's members by name.
 * @example
 * private readonly capturedSourceReturn = new CapturedSourceReturn(createCapturedSourceReturnHost(this))
 */
export function createCapturedSourceReturnHost(
  workspace: StudyWorkspace,
): CapturedSourceReturnHost {
  return {
    admitPresentation: (...args) => workspace['admitPresentation'](...args),
    assertLifetime: (...args): void => workspace['assertLifetime'](...args),
    assertPresentationAdmission: (...args) =>
      workspace['assertPresentationAdmission'](...args),
    get busy() {
      return workspace['busy']
    },
    get closing() {
      return workspace['closing']
    },
    get diagnostics() {
      return workspace['diagnostics']
    },
    get enlargedLayoutReceipt() {
      return workspace['enlargedLayoutReceipt']
    },
    get errors() {
      return workspace['errors']
    },
    executeEditorCommand: (...args) =>
      workspace['executeEditorCommand'](...args),
    hasStudyPaneColumns: (...args) => workspace['hasStudyPaneColumns'](...args),
    get highlight() {
      return workspace['highlight']
    },
    isCodebookPaneInput: (...args) => workspace['isCodebookPaneInput'](...args),
    isOwnPaneOrSourceTab: (...args) =>
      workspace['isOwnPaneOrSourceTab'](...args),
    isPresentationAdmissionOpen: (...args) =>
      workspace['isPresentationAdmissionOpen'](...args),
    get layoutReceipt() {
      return workspace['layoutReceipt']
    },
    set layoutReceipt(value) {
      workspace['layoutReceipt'] = value
    },
    get lifetime() {
      return workspace['lifetime']
    },
    get liveComposition() {
      return workspace['liveComposition']
    },
    message: (...args) => workspace['message'](...args),
    ownsCapturedSourceTab: (...args) =>
      workspace['ownsCapturedSourceTab'](...args),
    placeOfRememberedGroup: (...args) =>
      workspace['placeOfRememberedGroup'](...args),
    get presentationConfirmed() {
      return workspace['presentationConfirmed']
    },
    set presentationConfirmed(value) {
      workspace['presentationConfirmed'] = value
    },
    get presentationControlRevision() {
      return workspace['presentationControlRevision']
    },
    set presentationControlRevision(value) {
      workspace['presentationControlRevision'] = value
    },
    get presentationId() {
      return workspace['presentationId']
    },
    get presentationOperation() {
      return workspace['presentationOperation']
    },
    get presentationReason() {
      return workspace['presentationReason']
    },
    set presentationReason(value) {
      workspace['presentationReason'] = value
    },
    presentationState: (...args) => workspace['presentationState'](...args),
    get presentationTransition() {
      return workspace['presentationTransition']
    },
    set presentationTransition(value) {
      workspace['presentationTransition'] = value
    },
    publish: (...args): void => workspace['publish'](...args),
    readPassivePresentationLayout: (...args) =>
      workspace['readPassivePresentationLayout'](...args),
    get recordingActive() {
      return workspace['recordingActive']
    },
    get requestedPresentation() {
      return workspace['requestedPresentation']
    },
    set requestedPresentation(value) {
      workspace['requestedPresentation'] = value
    },
    retainForeignTabFocus: (...args) =>
      workspace['retainForeignTabFocus'](...args),
    get returningCurrent() {
      return workspace['returningCurrent']
    },
    savePresentationPreference: (...args): Promise<void> =>
      workspace['savePresentationPreference'](...args),
    selectedStudy: (...args) => workspace['selectedStudy'](...args),
    showTextDocumentNoted: (...args) =>
      workspace['showTextDocumentNoted'](...args),
    get sourceGroup() {
      return workspace['sourceGroup']
    },
    set sourceGroup(value) {
      workspace['sourceGroup'] = value
    },
    get sourceIdentity() {
      return workspace['sourceIdentity']
    },
    sourceIdentityDecoration: (...args) =>
      workspace['sourceIdentityDecoration'](...args),
    get sourceUri() {
      return workspace['sourceUri']
    },
    studyPanePositions: (...args) => workspace['studyPanePositions'](...args),
    get summaryComposition() {
      return workspace['summaryComposition']
    },
    testReplayHoldsComposition: (...args) =>
      workspace['testReplayHoldsComposition'](...args),
    textTabUri: (...args) => workspace['textTabUri'](...args),
    watchLearnersChoice: (...args) => workspace['watchLearnersChoice'](...args),
    yieldFocusToLearner: (...args): void =>
      workspace['yieldFocusToLearner'](...args),
  }
}
