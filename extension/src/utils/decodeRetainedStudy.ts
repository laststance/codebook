import type { RetainedStudy } from '../retainedStudySchemas'

import { decodeConfiguredStudy } from './decodeConfiguredStudy'

/** Validates repository history on read; unsupported files remain untouched and unavailable in the catalog. @example decodeRetainedStudy(value, workspaceKey).version // 3 */
export function decodeRetainedStudy(
  value: unknown,
  workspaceKey: string,
): RetainedStudy {
  return decodeConfiguredStudy(value, workspaceKey)
}
