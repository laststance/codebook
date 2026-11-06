import { StudyError } from './errors'
import {
  expoWebAmbiguousSourceRefusal,
  expoWebBundleFailedRefusal,
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
 * Picks the distinct web bundles among an entry page's scripts.
 * @param scripts - Each script address on the owned origin.
 * @returns The scripts that end in `.bundle` and name `platform=web`, once per address.
 * @example webBundleScripts([new URL('http://h:1/a.bundle?platform=web')]).length // => 1
 */
function webBundleScripts(scripts: Iterable<URL>): URL[] {
  const bundles = new Map<string, URL>()
  for (const candidate of scripts)
    if (
      candidate.pathname.endsWith('.bundle') &&
      candidate.searchParams.get('platform') === WEB_PLATFORM
    )
      bundles.set(candidate.href, candidate)
  return [...bundles.values()]
}

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
    // Metro's error answer is quoted (masked, capped) in the bundle-failed refusal.
    quoteErrorBody: true,
    unclearEntryPage: {
      count: (scripts) => webBundleScripts(scripts).length,
      refusal: (count) =>
        expoWebBundleFailedRefusal(
          `The entry page names ${count} web bundles, so the bundle to seal is unknown.`,
        ),
    },
    selectBundleScript(scripts) {
      // The page must name exactly one web bundle: Metro's other platforms or a second bundle make the choice ambiguous.
      const bundles = webBundleScripts(scripts)
      return bundles.length === 1 ? bundles[0] : undefined
    },
    resolveMapUrl(reference, bundleUrl, ownedOrigin) {
      // A protocol-relative reference would name another host; refuse it before any rebasing.
      if (reference.startsWith('//')) return undefined
      // Metro writes its own host name (`localhost`) while Codebook reaches it at the owned origin: only the path and query are kept, so only the owned origin is ever fetched.
      const named = new URL(reference, bundleUrl)
      if (named.protocol !== 'http:' && named.protocol !== 'https:')
        return undefined
      // A path that starts with `//` reads as another host to a relative-URL parser; it is refused, never joined.
      if (named.pathname.startsWith('//')) return undefined
      // Assigning onto the owned origin's URL cannot change its host.
      const rebased = new URL(ownedOrigin)
      rebased.pathname = named.pathname
      rebased.search = named.search
      return rebased.origin === new URL(ownedOrigin).origin
        ? rebased
        : undefined
    },
  })
