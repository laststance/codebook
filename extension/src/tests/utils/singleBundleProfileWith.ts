import { StudyError } from '../../errors'
import { EXPO_WEB_SINGLE_BUNDLE_PROFILE } from '../../expoWebSingleBundleProfile'
import type { SingleBundleProfile } from '../../singleBundleProfile'
import type { SourceMapLimits } from '../../sourceMapLimits'

/**
 * Builds a single-bundle profile shaped like the Expo one (its bundle selection and map rebasing) with the given limits and refusals that name the reason reached.
 *
 * Why it exists: the single-bundle capture and limits tests need a profile whose only difference between runs is the limits, and whose refusals can be told apart by `details.reason`. Called by those tests.
 * @param limits - The limits of every read of the bundle and map.
 * @returns A profile whose refusals are `REACT_SCRIPTS_SEAL_FAILED` errors with `details.reason` (`map-limit` also carries `limit` and `limitValue`; `map-unreadable` carries `problem`).
 * @example profileWith(EXPO_WEB_SOURCE_MAP_LIMITS).limits // => EXPO_WEB_SOURCE_MAP_LIMITS
 */
export function profileWith(limits: SourceMapLimits): SingleBundleProfile {
  const refuse = (reason: string, details: Record<string, unknown> = {}) =>
    new StudyError(
      'REACT_SCRIPTS_SEAL_FAILED',
      reason,
      reason,
      undefined,
      undefined,
      { reason, ...details },
    )
  return {
    limits,
    refusals: {
      outsidePackage: () => refuse('outside-package'),
      ambiguousSource: () => refuse('ambiguous-source'),
      nodeModules: () => refuse('node-modules'),
      unmappedLine: () => refuse('unmapped-line'),
      mapLimit: (limit, limitValue) =>
        refuse('map-limit', { limit, limitValue }),
      mapUnreadable: (problem) => refuse('map-unreadable', { problem }),
      sourceChanged: () => refuse('source-changed'),
      notInEntryBundle: () => refuse('not-in-entry-bundle'),
    },
    selectBundleScript: EXPO_WEB_SINGLE_BUNDLE_PROFILE.selectBundleScript,
    resolveMapUrl: EXPO_WEB_SINGLE_BUNDLE_PROFILE.resolveMapUrl,
  }
}
