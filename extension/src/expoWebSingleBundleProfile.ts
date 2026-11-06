import { StudyError } from './errors'
import {
  expoWebAmbiguousSourceRefusal,
  expoWebMapLimitRefusal,
  expoWebMapUnreadableRefusal,
  expoWebNotInEntryBundleRefusal,
  expoWebSealedNodeModulesRefusal,
  expoWebSealedOutsidePackageRefusal,
  expoWebUnmappedLineRefusal,
} from './expoWebRefusals'
import type { SingleBundleProfile } from './singleBundleProfile'
import { EXPO_WEB_SOURCE_MAP_LIMITS } from './sourceMapLimits'

/** The query value that names Metro's web bundle among the entry page's scripts. */
const WEB_PLATFORM = 'web'

/**
 * Builds the `SOURCE_CHANGED` refusal of a stop file that is no longer the text Metro compiled.
 * @param path - The stop's repository-relative path.
 * @returns The error to throw.
 * @example expoWebSourceChangedRefusal('apps/app/src/app/index.tsx').code // => 'SOURCE_CHANGED'
 */
function expoWebSourceChangedRefusal(path: string): StudyError {
  return new StudyError(
    'SOURCE_CHANGED',
    `${path} differs from the text Metro compiled, so the bundle does not run the checked-out file. Save the file unchanged and start again.`,
  )
}

/**
 * The `expo-web-dev` adapter's single-bundle profile: Expo's refusals and messages, the larger Expo limits, the one `.bundle` script of the web platform, and a map whose address is rebased onto the owned origin.
 * Used by {@link readSingleServedBundle} and {@link sealSingleBundleStop} through {@link EXPO_WEB_DEV_ADAPTER}; its behavior is pinned by the Expo suite.
 */
export const EXPO_WEB_SINGLE_BUNDLE_PROFILE: SingleBundleProfile =
  Object.freeze({
    refusals: {
      outsidePackage: expoWebSealedOutsidePackageRefusal,
      ambiguousSource: expoWebAmbiguousSourceRefusal,
      nodeModules: expoWebSealedNodeModulesRefusal,
      unmappedLine: expoWebUnmappedLineRefusal,
      mapLimit: expoWebMapLimitRefusal,
      mapUnreadable: expoWebMapUnreadableRefusal,
      sourceChanged: expoWebSourceChangedRefusal,
      // A map that does not name the stop file is the entry bundle of another set of files (an async route, or a file the entry never imports).
      notInEntryBundle: (_packageRootRelative, files) =>
        expoWebNotInEntryBundleRefusal(files[0] ?? ''),
    },
    limits: EXPO_WEB_SOURCE_MAP_LIMITS,
    selectBundleScript(scripts) {
      const bundles = new Map<string, URL>()
      // The page must name exactly one web bundle: Metro's other platforms or a second bundle make the choice ambiguous.
      for (const candidate of scripts)
        if (
          candidate.pathname.endsWith('.bundle') &&
          candidate.searchParams.get('platform') === WEB_PLATFORM
        )
          bundles.set(candidate.href, candidate)
      return bundles.size === 1 ? [...bundles.values()][0] : undefined
    },
    resolveMapUrl(reference, bundleUrl, ownedOrigin) {
      // Metro writes its own host name (`localhost`) while Codebook reaches it at the owned origin: only the path and query are kept, so only the owned origin is ever fetched.
      const named = new URL(reference, bundleUrl)
      return new URL(`${named.pathname}${named.search}`, ownedOrigin)
    },
  })
