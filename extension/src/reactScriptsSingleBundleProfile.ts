import { REACT_SCRIPTS_BUNDLE_PATH } from './constants'
import { StudyError } from './errors'
import {
  reactScriptsAmbiguousSourceRefusal,
  reactScriptsMapLimitRefusal,
  reactScriptsMapUnreadableRefusal,
  reactScriptsServedScriptRefusal,
  reactScriptsSealedNodeModulesRefusal,
  reactScriptsSealedOutsidePackageRefusal,
  reactScriptsUnmappedLineRefusal,
} from './reactScriptsRefusals'
import type { SingleBundleProfile } from './singleBundleProfile'
import { DEFAULT_SOURCE_MAP_LIMITS } from './sourceMapLimits'

/**
 * Builds the `SOURCE_CHANGED` refusal of a stop file that is no longer the text react-scripts compiled.
 * @param path - The stop's repository-relative path.
 * @returns The error to throw.
 * @example reactScriptsSourceChangedRefusal('app/src/App.js').code // => 'SOURCE_CHANGED'
 */
function reactScriptsSourceChangedRefusal(path: string): StudyError {
  return new StudyError(
    'SOURCE_CHANGED',
    `${path} differs from the text react-scripts compiled, so the bundle does not run the checked-out file. Save the file unchanged and start again.`,
  )
}

/**
 * The react-scripts adapter's single-bundle profile: its refusals and messages, today's limits, the first entry-page script that ends in the bundle path, and a map named by the bundle's `sourceMappingURL` on the owned origin.
 * Used by {@link readReactScriptsServedBundle} and {@link sealReactScriptsStop}; its behavior is pinned by the react-scripts suite.
 */
export const REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE: SingleBundleProfile =
  Object.freeze({
    refusals: {
      outsidePackage: reactScriptsSealedOutsidePackageRefusal,
      ambiguousSource: reactScriptsAmbiguousSourceRefusal,
      nodeModules: reactScriptsSealedNodeModulesRefusal,
      unmappedLine: reactScriptsUnmappedLineRefusal,
      // react-scripts words the value of each limit itself.
      mapLimit: (limit) => reactScriptsMapLimitRefusal(limit),
      mapUnreadable: reactScriptsMapUnreadableRefusal,
      sourceChanged: reactScriptsSourceChangedRefusal,
      // A map that names no file of the app is a map of another folder.
      notInEntryBundle: reactScriptsSealedOutsidePackageRefusal,
    },
    limits: DEFAULT_SOURCE_MAP_LIMITS,
    selectBundleScript(scripts) {
      for (const candidate of scripts)
        if (candidate.pathname.endsWith(REACT_SCRIPTS_BUNDLE_PATH))
          return candidate
      return undefined
    },
    resolveMapUrl(reference, bundleUrl, ownedOrigin) {
      const mapUrl = new URL(reference, bundleUrl)
      return mapUrl.origin === new URL(ownedOrigin).origin ? mapUrl : undefined
    },
    servedScripts: {
      tooLarge: (url) =>
        reactScriptsServedScriptRefusal('script-too-large', url),
      offOrigin: (url) =>
        reactScriptsServedScriptRefusal('script-off-origin', url),
    },
  })
