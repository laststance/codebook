import { STUDY_PROFILES, type StudyItem, type StudyProfile } from 'codebook-cycle-0004/dist/profiles';
import type { ConfiguredStudy } from '../configuredStudySchemas';
import { CONFIGURED_CAPTURE_PHASES, REPOSITORY_BROWSER_ACTION, REPOSITORY_BROWSER_PROFILE } from '../constants';
import type { RetainedStudySelection } from '../retainedStudySchemas';
import type { RuntimeAction } from '../runtime';

export type StudyDescriptor = Pick<StudyProfile, 'title' | 'description' | 'requiredLinks' | 'capturePhases'> & {
  id: RetainedStudySelection['profile'];
  items: readonly (Pick<StudyItem, 'title' | 'overview' | 'participant' | 'capturePhase'> & { id: RetainedStudySelection['itemId'] })[];
  actions: readonly { id: RuntimeAction; title: string }[];
};
type DescriptorInput = { profile: StudyProfile['id'] } | Pick<ConfiguredStudy, 'profile' | 'configuration' | 'descriptor'> | Extract<RetainedStudySelection, { profile: typeof REPOSITORY_BROWSER_PROFILE }>;

/** Gives Study, history and replay one presentation identity, including failed configured preparation without invented evidence. @example describeStudy(study).items[0]?.id // 'repository/interface/theme' */
export function describeStudy(input: DescriptorInput): StudyDescriptor {
  if (input.profile !== REPOSITORY_BROWSER_PROFILE) return STUDY_PROFILES[input.profile];
  const configuration = 'configuration' in input ? input.configuration : undefined;
  const itemId = 'configuration' in input ? input.descriptor?.itemId ?? `repository/${input.configuration.book.bookId}/${input.configuration.book.nodeId}` : input.itemId;
  const title = configuration?.action.title ?? 'Repository browser action';
  return { id: REPOSITORY_BROWSER_PROFILE, title, description: 'One configured browser action in the selected repository article.',
    items: [{ id: itemId, title, participant: 'browser', capturePhase: 'paused-browser',
      overview: configuration ? `Read the article and its cited source at ${configuration.source.path}:${configuration.source.line}. Runtime values appear only after the configured action reaches its verified pause.` : 'The configured article remains selected. Recorded source and values are unavailable at this position.' }],
    actions: [{ id: REPOSITORY_BROWSER_ACTION, title }], capturePhases: CONFIGURED_CAPTURE_PHASES, requiredLinks: [] };
}
