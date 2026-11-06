import {
  EXPO_WEB_BUNDLE_LIMIT_BYTES,
  EXPO_WEB_MAP_LIMIT_BYTES,
  EXPO_WEB_MAPPED_POSITION_MAX_GENERATED_LINES,
  EXPO_WEB_MAPPED_POSITION_MAX_SCANNED_CHARS,
  EXPO_WEB_MAPPED_POSITION_SEGMENT_LIMIT,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
  REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES,
  REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS,
  REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT,
} from './constants'

/**
 * The size limits one adapter reads a sealed bundle and its source map under.
 *
 * Why it exists: the limits were fixed shared constants, which a Metro bundle (7.5 MB, a stop at generated line 190,118) exceeds. Every reader on a stop's path takes this object, defaulting to {@link DEFAULT_SOURCE_MAP_LIMITS}, so only an adapter that passes another profile reads larger maps. Read by the map walk, the mapped-position and generated-range scans, the bundle verifier, the bundle schema, the single-bundle read and seal, and the source resource of a run.
 */
export type SourceMapLimits = Readonly<{
  /** The most bytes the bundle's JavaScript may have. */
  bundleBytes: number
  /** The most bytes the source map (served, and again sealed) may have. */
  mapBytes: number
  /** The most generated lines a scan of the map's `mappings` begins. */
  mappedGeneratedLines: number
  /** The most segments a scan reads, empty ones included. */
  mappedSegments: number
  /** The most characters of `mappings` a scan reads. */
  mappedScannedChars: number
}>

/** Names a limit as a `map-limit` refusal's `details.limit` does. */
export type SourceMapLimitName =
  | 'map-bytes'
  | 'mapped-position-segments'
  | 'mapped-generated-lines'
  | 'mapped-scanned-chars'

/** The field of {@link SourceMapLimits} each {@link SourceMapLimitName} reads, so a refusal can name the value of the limit reached. */
export const SOURCE_MAP_LIMIT_FIELD = {
  'map-bytes': 'mapBytes',
  'mapped-position-segments': 'mappedSegments',
  'mapped-generated-lines': 'mappedGeneratedLines',
  'mapped-scanned-chars': 'mappedScannedChars',
} as const satisfies Record<SourceMapLimitName, keyof SourceMapLimits>

/** Today's limits, used by every adapter that passes no profile. */
export const DEFAULT_SOURCE_MAP_LIMITS: SourceMapLimits = Object.freeze({
  bundleBytes: REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  mapBytes: REPOSITORY_MAP_LIMIT_BYTES,
  mappedGeneratedLines: REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES,
  mappedSegments: REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT,
  mappedScannedChars: REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS,
})

/** The limits of the `expo-web-dev` adapter: 4 to 5 times what Metro's bundle of P08 measured. */
export const EXPO_WEB_SOURCE_MAP_LIMITS: SourceMapLimits = Object.freeze({
  bundleBytes: EXPO_WEB_BUNDLE_LIMIT_BYTES,
  mapBytes: EXPO_WEB_MAP_LIMIT_BYTES,
  mappedGeneratedLines: EXPO_WEB_MAPPED_POSITION_MAX_GENERATED_LINES,
  mappedSegments: EXPO_WEB_MAPPED_POSITION_SEGMENT_LIMIT,
  mappedScannedChars: EXPO_WEB_MAPPED_POSITION_MAX_SCANNED_CHARS,
})
