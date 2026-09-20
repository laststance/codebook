import { CONFIGURED_STUDY_VERSION } from '../constants';
import type { RetainedStudy } from '../retainedStudySchemas';
import { decodeConfiguredStudy } from './decodeConfiguredStudy';
import { decodeStudyArchive } from './decodeStudyArchive';

/** Dispatches closed history formats for {@link LearningLibrary}; legacy normalization never admits configured evidence. @example decodeRetainedStudy(configured, workspaceKey).version // 3 */
export function decodeRetainedStudy(value: unknown, workspaceKey: string): RetainedStudy {
  if (value && typeof value === 'object' && 'version' in value && value.version === CONFIGURED_STUDY_VERSION) return decodeConfiguredStudy(value, workspaceKey);
  return decodeStudyArchive(value, workspaceKey);
}
