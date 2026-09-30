import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  CONFIGURED_CAPTURE_PHASES,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
} from '../constants'
import type { RetainedStudySelection } from '../retainedStudySchemas'
import type { RuntimeAction } from '../runtime'

import { configuredStops } from './configuredStops'

export type StudyDescriptor = {
  title: string
  description: string
  requiredLinks: readonly string[]
  capturePhases: readonly (
    'before' | 'paused-browser' | 'paused-server' | 'after'
  )[]
} & {
  id: RetainedStudySelection['profile']
  items: readonly ({
    title: string
    overview: string
    participant: 'browser' | 'server'
    capturePhase: 'paused-browser' | 'paused-server'
  } & { id: RetainedStudySelection['itemId'] })[]
  actions: readonly { id: RuntimeAction; title: string }[]
}
type DescriptorInput =
  | Pick<ConfiguredStudy, 'profile' | 'configuration' | 'descriptor'>
  | Extract<
      RetainedStudySelection,
      { profile: typeof REPOSITORY_BROWSER_PROFILE }
    >

/** Gives Study, history and replay one presentation identity, including failed configured preparation without invented evidence. @example describeStudy(study).items[0]?.id // 'repository/interface/theme' */
export function describeStudy(input: DescriptorInput): StudyDescriptor {
  const configuration =
    'configuration' in input ? input.configuration : undefined
  const itemId =
    'configuration' in input
      ? (input.descriptor?.itemId ??
        `repository/${input.configuration.book.bookId}/${input.configuration.book.nodeId}`)
      : input.itemId
  const descriptor = 'descriptor' in input ? input.descriptor : undefined
  const participant =
    configuration?.version === 2 ? configuration.participant : 'browser'
  const capturePhase =
    participant === 'server' ? 'paused-server' : 'paused-browser'
  const capturePhases: StudyDescriptor['capturePhases'] =
    configuration?.version === 2
      ? [
          'before',
          ...new Set(
            configuredStops(configuration).map((stop) =>
              stop.participant === 'server'
                ? ('paused-server' as const)
                : ('paused-browser' as const),
            ),
          ),
          'after',
        ]
      : CONFIGURED_CAPTURE_PHASES
  return {
    id: REPOSITORY_BROWSER_PROFILE,
    title: descriptor?.bookTitle ?? 'Repository browser study',
    description:
      'One configured browser action in the selected repository article.',
    items: [
      {
        id: itemId,
        title: descriptor?.nodeTitle ?? 'Repository article',
        participant,
        capturePhase,
        overview: configuration
          ? `Read the article and its cited source at ${configuration.source.path}:${configuration.source.line}. Runtime values appear only after the configured action reaches its verified pause.`
          : 'The configured article remains selected. Recorded source and values are unavailable at this position.',
      },
    ],
    actions: [
      {
        id: REPOSITORY_BROWSER_ACTION,
        title: configuration?.action.title ?? 'Repository browser action',
      },
    ],
    capturePhases,
    requiredLinks: [],
  }
}
