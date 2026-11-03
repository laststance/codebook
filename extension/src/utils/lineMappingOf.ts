import type { BundleSource } from '../repositoryBundle'

import { createBundleVerifier } from './createBundleVerifier'

/**
 * Says whether a sealed module's map maps a source line.
 *
 * Why it exists: whether a Pages line runs in the browser, on the server or in both is read from the two compiles' maps. Called by {@link readNextServerOnlyReason} for the browser and the server module of a browser stop, and by {@link sealPagesServerStop} for the browser module of an entry-page server stop.
 * @param bundle - The sealed module.
 * @param line - The one-based source line.
 * @returns `mapped` when the map places code on the line; `unmapped` only when the map was read whole and does not; `unknown` when the scan stopped at a size limit first.
 * @throws When the map's original differs from the module's frozen source ({@link createBundleVerifier}).
 * @example
 * lineMappingOf(bundle, 3) // => 'unmapped'
 */
export function lineMappingOf(
  bundle: BundleSource,
  line: number,
): 'mapped' | 'unmapped' | 'unknown' {
  const scan = createBundleVerifier(bundle).mappedPositions(line, line)
  if (scan.positions.length) return 'mapped'
  return scan.complete ? 'unmapped' : 'unknown'
}
