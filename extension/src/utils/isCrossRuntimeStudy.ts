import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  CROSS_RUNTIME_CONFIG_VERSION,
  OPERATIONS_CONFIG_VERSION,
} from '../constants'

/**
 * Tells whether a saved study was sealed from a cross-runtime (version 2) configuration: browser and server stops in one history.
 * The study format cannot answer this, because a `vite-dev` study is format 5 whichever configuration version it holds, so every cross-runtime rule asks the sealed configuration instead.
 * Called by {@link decodeConfiguredStudy}, {@link validateConfiguredStudyEvidence}, {@link buildRecordingContext} and {@link validateRecordingContext}.
 * @param study - A study, or any value holding its sealed configuration.
 * @returns True when the sealed configuration is the cross-runtime version (2) or the operations version (3), which both name a participant per stop.
 * @example
 * isCrossRuntimeStudy({ configuration: { version: 2 } }) // => true
 */
export function isCrossRuntimeStudy(study: {
  configuration: Pick<ConfiguredStudy['configuration'], 'version'>
}): boolean {
  // Version 3 names a participant for every stop, as version 2 does.
  return (
    study.configuration.version === CROSS_RUNTIME_CONFIG_VERSION ||
    study.configuration.version === OPERATIONS_CONFIG_VERSION
  )
}
