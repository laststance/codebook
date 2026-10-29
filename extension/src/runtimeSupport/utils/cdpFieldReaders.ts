/**
 * Reads a string field of a CDP answer.
 * Called by the owned launch for ids the browser returns (extension id, target id, session id).
 * @param result - The answer's `result` object.
 * @param field - The field name.
 * @returns The string.
 * @throws When the field is absent or not a string.
 * @example
 * readCdpString({ id: 'abc' }, 'id') // => 'abc'
 */
export function readCdpString(
  result: Record<string, unknown>,
  field: string,
): string {
  const value = result[field]
  if (typeof value !== 'string')
    throw new Error(`CDP answer has no string "${field}"`)
  return value
}

/** One entry of `Target.getTargets`, reduced to what the owned launch reads. */
export type CdpTargetInfo = { targetId: string; type: string; url: string }

/**
 * Reads the target list of a `Target.getTargets` answer.
 * Called by the owned launch's polls for the initial tab, the service workers of the extension and the surface.
 * @param result - The answer's `result` object.
 * @returns Every entry that has a target id, a type and a url; others are skipped.
 * @example
 * readCdpTargets({ targetInfos: [{ targetId: 'T1', type: 'page', url: 'about:blank' }] }) // => [{ targetId: 'T1', type: 'page', url: 'about:blank' }]
 */
export function readCdpTargets(
  result: Record<string, unknown>,
): CdpTargetInfo[] {
  const infos = result.targetInfos
  if (!Array.isArray(infos)) return []
  const targets: CdpTargetInfo[] = []
  for (const info of infos) {
    if (typeof info !== 'object' || info === null) continue
    const { targetId, type, url } = info
    if (
      typeof targetId === 'string' &&
      typeof type === 'string' &&
      typeof url === 'string'
    )
      targets.push({ targetId, type, url })
  }
  return targets
}
