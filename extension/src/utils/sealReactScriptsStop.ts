import { REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE } from '../reactScriptsSingleBundleProfile'

import {
  sealSingleBundleStop,
  type SingleBundleSealRequest,
} from './sealSingleBundleStop'

export { mapSourceNamesStop } from './sealSingleBundleStop'

/**
 * Seals one declared browser stop from the single bundle react-scripts serves, before the browser opens.
 *
 * Why it exists: the react-scripts adapter's `readBundle` seals each stop through the shared single-bundle module under react-scripts' profile (its refusals, today's limits, its bundle path), so its behavior and messages stay as they were. Called once per stop.
 * @param request - The app, the stop, the owned origin and the run's cache.
 * @returns The sealed bundle (served bytes unchanged) with the discovery measurements.
 * @throws `REACT_SCRIPTS_SEAL_FAILED` (`node-modules`, `outside-package` with `sideEffects: "partial"`, `ambiguous-source`, `unmapped-line`, `map-limit`, `map-unreadable`); `SOURCE_CHANGED` when the file differs from the accepted article or from the compiled text.
 * @example
 * const { bundle } = await sealReactScriptsStop({ appRoot, packageRootRelative: '.', packageRelativePath: 'src/App.js', source, citationEndLine: 12, ownedOrigin, signal, cache })
 */
export function sealReactScriptsStop(request: SingleBundleSealRequest) {
  return sealSingleBundleStop(request, REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE)
}
