import type { SingleBundleProfile } from './singleBundleProfile'
import { DEFAULT_SOURCE_MAP_LIMITS } from './sourceMapLimits'
import {
  staticPageAmbiguousSourceRefusal,
  staticPageMapLimitRefusal,
  staticPageMapUnreadableRefusal,
  staticPageNodeModulesRefusal,
  staticPageOutsidePackageRefusal,
  staticPageSourceChangedRefusal,
  staticPageUnmappedLineRefusal,
} from './staticPageRefusals'

/**
 * The `static-page` adapter's single-bundle profile: its refusals and today's limits, for the library stop seal that reads the packed build through {@link sealSingleBundleStop}.
 * The page's own scripts are sealed by {@link sealStaticPageScript}; this profile serves only the served packed files, so it has no bundle selection and no map address of its own (the reader passes the served files and their inline maps).
 */
export const STATIC_PAGE_SINGLE_BUNDLE_PROFILE: SingleBundleProfile =
  Object.freeze({
    refusals: {
      outsidePackage: (packageRoot, files) =>
        staticPageOutsidePackageRefusal(packageRoot, files, 'partial'),
      ambiguousSource: staticPageAmbiguousSourceRefusal,
      nodeModules: (files) => staticPageNodeModulesRefusal(files, 'partial'),
      unmappedLine: staticPageUnmappedLineRefusal,
      mapLimit: (limit, limitValue) =>
        staticPageMapLimitRefusal(limit, limitValue),
      mapUnreadable: staticPageMapUnreadableRefusal,
      sourceChanged: staticPageSourceChangedRefusal,
      // A map that names no file of the library is a map of another folder.
      notInEntryBundle: (packageRoot, files) =>
        staticPageOutsidePackageRefusal(packageRoot, files, 'partial'),
    },
    limits: DEFAULT_SOURCE_MAP_LIMITS,
    selectBundleScript: () => undefined,
    resolveMapUrl: () => undefined,
  })
