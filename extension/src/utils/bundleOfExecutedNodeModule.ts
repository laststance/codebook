import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPOSITORY_JAVASCRIPT_LIMIT_BYTES } from '../constants'
import { mapSchema, type BundleSource } from '../repositoryBundle'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { inlineSourceMapOf } from './extractDevelopmentModule'

/** What {@link bundleOfExecutedNodeModule} seals: one executed (tsx-transpiled) Node module. */
export interface ExecutedNodeModule {
  /** The script text (`Debugger.getScriptSource`). */
  scriptSource: string
  /** The script's announced `file://` URL. */
  scriptUrl: string
  /** The stop file's real path. */
  stopPath: string
  /** The declared `source.hash` (SHA-256 of the stop file's text). */
  declaredHash: string
}

/** The outcome of {@link bundleOfExecutedNodeModule}. */
export type ExecutedNodeModuleSeal =
  | { kind: 'bundle'; bundle: BundleSource }
  | {
      kind: 'refused'
      reason: 'source-unverifiable' | 'source-drift'
      detail: string
    }

const unverifiable = (detail: string): ExecutedNodeModuleSeal => ({
  kind: 'refused',
  reason: 'source-unverifiable',
  detail,
})

/**
 * Seals the module a server pause executed as a bundle {@link createBundleVerifier} accepts, or refuses it (D18, D25).
 *
 * Why it exists: an API stop is sealed by what ran, not by a disk re-read (OV-4). Only an inline map whose `sources` are absolute paths with no `sourceRoot` (tsx's form, E1) ties the script to the declared file; every other map is `source-unverifiable`. Called by the API server participant when the stop file's script is announced.
 * @param module - The executed script, its address, and the declared stop file.
 * @returns A bundle, or a refusal: `source-unverifiable` when no map can tie the script to the file, `source-drift` when the map's retained original is not the declared text.
 * @example
 * ```ts
 * const seal = bundleOfExecutedNodeModule({ scriptSource, scriptUrl: 'file:///repo/src/a.ts', stopPath: '/repo/src/a.ts', declaredHash })
 * if (seal.kind === 'bundle') createBundleVerifier(seal.bundle)
 * ```
 */
export function bundleOfExecutedNodeModule(
  module: ExecutedNodeModule,
): ExecutedNodeModuleSeal {
  const { scriptSource, scriptUrl, stopPath, declaredHash } = module
  if (Buffer.byteLength(scriptSource) > REPOSITORY_JAVASCRIPT_LIMIT_BYTES)
    return unverifiable('Script exceeds byte limit')
  let sourceMap: string
  try {
    sourceMap = inlineSourceMapOf(scriptSource)
  } catch (error) {
    // No inline map, several, or a malformed one: an external map is never read.
    return unverifiable(error instanceof Error ? error.message : 'Bad map')
  }
  let raw: unknown
  try {
    raw = JSON.parse(sourceMap)
  } catch {
    return unverifiable('Map is not JSON')
  }
  // Decide before the zod parse: a sourceRoot or a relative source is never rewritten.
  const shape = asRecord(raw)
  if (!shape) return unverifiable('Map is not an object')
  if (shape.sourceRoot !== undefined && shape.sourceRoot !== '')
    return unverifiable('Map has a sourceRoot')
  if (
    !Array.isArray(shape.sources) ||
    !shape.sources.every(
      (source) => typeof source === 'string' && isAbsolute(source),
    )
  )
    return unverifiable('Map sources are not all absolute paths')
  const parsed = mapSchema.safeParse(raw)
  if (
    !parsed.success ||
    parsed.data.sources.length !== parsed.data.sourcesContent.length
  )
    return unverifiable('Map is not a flat V3 map with sourcesContent')
  const matches = parsed.data.sources.flatMap((source, index) =>
    resolve(source) === resolve(stopPath) ? [index] : [],
  )
  if (matches.length !== 1)
    return unverifiable('Map does not name the stop file exactly once')
  const original = parsed.data.sourcesContent[matches[0]!]!
  if (sha256(original) !== declaredHash)
    return {
      kind: 'refused',
      reason: 'source-drift',
      detail: 'Executed source differs from the declared source',
    }
  return {
    kind: 'bundle',
    bundle: {
      sourcePath: stopPath,
      source: original,
      sourceMap,
      javascript: scriptSource,
      mapSource: stopPath,
      scriptUrl,
      chunkPath: scriptUrl.startsWith('file://')
        ? fileURLToPath(scriptUrl)
        : scriptUrl,
      chunkHash: sha256(scriptSource),
    },
  }
}

/** Narrows parsed JSON to a plain object for {@link bundleOfExecutedNodeModule}. @example asRecord({ a: 1 }) // { a: 1 } */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}
