import { MILLISECONDS_PER_SECOND } from '../constants'
import {
  type NodeTestHistoryIndex,
  type NodeTestHistoryLearningDecision,
} from '../nodeTestHistorySchemas'
import { type ExtensionReplayPresentation } from '../utils/adaptExtensionReplay'
import type { ServerReplayPresentation } from '../utils/adaptServerReplay'
import { type NodeLearningMaterialOfHistory } from '../utils/projectNodeLearningSummary'

/** What opening a replay reads: its history (a server replay's in its test-shaped view), the sidecars and the server presentation when it is one; see {@link StudyWorkspace.readNodeHistoryOpening}. */
export type NodeHistoryOpening = {
  history: NodeTestHistoryIndex
  learningDecision?: NodeTestHistoryLearningDecision
  learningMaterial?: NodeLearningMaterialOfHistory
  savedSequence?: number
  positionError?: unknown
  serverReplay?: ServerReplayPresentation
  extensionReplay?: ExtensionReplayPresentation
}

/**
 * Words the phase line of a recorded frame in the Application pane; called by the playback's frame preview and by {@link StudyWorkspace}'s presentation of a moment, so both name the same time.
 * @param positionMs - The recorded moment in milliseconds.
 * @returns The phase text, for example `Recorded · 1.50 s`.
 * @example recordedFrameLabel(1500) // => 'Recorded · 1.50 s'
 */
export function recordedFrameLabel(positionMs: number): string {
  return `Recorded · ${(positionMs / MILLISECONDS_PER_SECOND).toFixed(2)} s`
}
