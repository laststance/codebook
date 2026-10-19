import type { z } from 'zod'

import type {
  configuredStudySchema as studyArchiveSchema,
  configuredSelectionSchema as selectionSchema,
} from './configuredStudySchemas'
import type { LearnerProgress, SavedLearnerDecision } from './learnerSchemas'
import type { participantSchema, sourceSchema } from './legacyStudySchemas'
import type { RepositorySourceService } from './repositorySource'
import type {
  RetainedStudy,
  RetainedStudySelection,
} from './retainedStudySchemas'
import type { StudyService } from './service'
import type { citationContext } from './utils/citationContext'
import type { StudyDescriptor } from './utils/describeStudy'
import { projectConfiguredStudy } from './utils/projectConfiguredStudy'
export {
  participantSchema,
  studyIdSchema,
  sourceSchema,
} from './legacyStudySchemas'
export {
  configuredImageSchema as capturedImageSchema,
  configuredObservationSchema as observationSchema,
  configuredStudySchema as studyArchiveSchema,
  configuredSelectionSchema as selectionSchema,
} from './configuredStudySchemas'

export type StudyArchive = z.infer<typeof studyArchiveSchema>
export type StudySelection = z.infer<typeof selectionSchema>
export type { LearnerProgress, LearnerDecision } from './learnerSchemas'
export {
  progressV4Schema as progressSchema,
  learnerDecisionV3Schema as learnerDecisionSchema,
} from './learnerSchemas'
export type StudyParticipant = z.infer<typeof participantSchema>
export type SourceBaseline = z.infer<typeof sourceSchema> & { path: string }
export type SourceBaselines = Record<StudyParticipant, SourceBaseline>
export type LiveStudy = ReturnType<StudyService['state']>
export type CitationSourceStates = Awaited<
  ReturnType<RepositorySourceService['inspect']>
>
export type StudyProjectionInput = {
  selection: RetainedStudySelection
  /** Pins an admitted Wiki history visit to its exact observation; omitted for ordinary newest/following projection. */
  observationId?: RetainedStudy['observations'][number]['id']
  study?: RetainedStudy
  live?: Pick<LiveStudy, 'instanceId' | 'runId' | 'participants'>
  liveDescriptor?: StudyDescriptor
  /** The line the live run's first stop is expected to pause on while it has not paused yet ({@link plannedStopLine}); absent when the journal names none. */
  plannedStopLine?: number
  progress?: LearnerProgress
  baselines: SourceBaselines
  currentSourceAvailable?: boolean
  citationSources?: CitationSourceStates
}
export type StudyProjection = {
  selection: RetainedStudySelection
  selectedItem: StudyDescriptor['items'][number]
  observation?: RetainedStudy['observations'][number]
  source: z.infer<typeof sourceSchema>
  /** The line the agent declared for the shown observation's stop, present only when the debugger bound the stop on another line ({@link movedStopDeclaredLine}); the pane's source label then names both lines. */
  sourceDeclaredLine?: number
  currentSourceAvailable: boolean
  currentParticipant?: StudyParticipant
  currentItemId?: string
  currentItemTitle?: string
  currentSnapshotUri?: string
  matching: boolean
  continueArguments?: NonNullable<
    LiveStudy['participants']['browser']
  >['continueArguments']
  image?: RetainedStudy['captures'][number]
  sourceChanged: boolean
  selectedUnderstanding: ReturnType<typeof learningState> & {
    context?: ReturnType<typeof citationContext>
  }
  progressByItem: (StudyDescriptor['items'][number] &
    ReturnType<typeof learningState>)[]
  understoodCount: number
  reviewCount: number
  scenarioProgress?: {
    lastObservedTitle?: string
    missingImageTitles: string[]
    unverifiedLinkCount: number
  }
}

export const LEARNING_ITEMS: StudyDescriptor['items'] = []

/** Separates current-source understanding from retained historical decisions for {@link projectStudy}. @example learningState(progress, 'repository/interface/theme', hash).reviewNeeded */
export function learningState(
  progress: LearnerProgress | undefined,
  item: string,
  currentHash: string | undefined,
) {
  const latest = new Map<string, SavedLearnerDecision>()
  // A later uncheck supersedes only that source revision, never another historical decision.
  for (const decision of progress?.decisions ?? [])
    if (decision.item === item && decision.context.kind === 'source')
      latest.set(decision.sourceHash, decision)
  const current = currentHash ? latest.get(currentHash) : undefined
  return {
    known: Boolean(progress) && Boolean(currentHash),
    understood: current?.understood === true,
    at: current?.at,
    reviewNeeded:
      current?.understood !== true &&
      [...latest.values()].some(
        (decision) =>
          decision.sourceHash !== currentHash && decision.understood,
      ),
    history: [...latest.values()],
  }
}

/** Joins one selected observation without letting live control or old progress redefine its identity. @example projectStudy({selection, study, live, progress, baselines}).continueArguments */
export function projectStudy(input: StudyProjectionInput): StudyProjection {
  return projectConfiguredStudy(input)
}
