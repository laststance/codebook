import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { EXTENSION_SOURCE_MAP_LIMIT_BYTES } from '../constants'

import { isInsideFolder } from './isInsideFolder'
import {
  parseFlatSourceMap,
  type FlatSourceMap,
  type FlatSourceMapProblem,
} from './parseFlatSourceMap'

/** Why a chunk's map lists nothing. */
export type UnlistedMapKind = 'too-large' | 'unreadable' | FlatSourceMapProblem

/** What reading a chunk's map gave: no map named, a usable map, or a map that lists nothing with the reason. */
export type ChunkSourceMap =
  | { status: 'none' }
  | {
      status: 'map'
      map: FlatSourceMap
      /** The folder relative sources resolve against: the map file's folder, or the chunk's for a `data:` map. */
      folder: string
      /** The map file's absolute path, or the chunk's own for a `data:` map. */
      location: string
    }
  | {
      status: 'unlisted'
      kind: UnlistedMapKind
      reason: string
      location: string
    }

/** The `sourceMappingURL` comments of a script, in either comment style and the legacy `@` form. */
const SOURCE_MAP_COMMENT = /(?:\/\/|\/\*)[#@]\s*sourceMappingURL=([^\s*]+)/g

/** A `data:` JSON map: optional media parameters, then base64 or percent-encoded text. */
const DATA_MAP = /^data:application\/json((?:;[^,;]+)*?)(;base64)?,([\s\S]*)$/

/** A URL scheme at the start of a reference. */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/

/** The reference of the chunk's last `sourceMappingURL` comment, or `undefined` when it has none. */
function lastMapReference(chunkText: string): string | undefined {
  let reference: string | undefined
  for (const match of chunkText.matchAll(SOURCE_MAP_COMMENT))
    reference = match[1]
  return reference
}

/** Builds an `unlisted` answer. */
function unlisted(
  kind: UnlistedMapKind,
  reason: string,
  location: string,
): ChunkSourceMap {
  return { status: 'unlisted', kind, reason, location }
}

/** Turns the text of a map into the answer: the map, or why it lists nothing. */
function fromText(
  text: string,
  folder: string,
  location: string,
): ChunkSourceMap {
  const parsed = parseFlatSourceMap(text)
  if (parsed === 'indexed')
    return unlisted(
      'indexed',
      'it is an indexed source map, which this version does not read',
      location,
    )
  if (parsed === 'malformed')
    return unlisted(
      'malformed',
      'it is not a flat version 3 source map',
      location,
    )
  return { status: 'map', map: parsed, folder, location }
}

/** Reads an embedded `data:` map, checking its size before decoding. */
function readDataMap(
  match: RegExpExecArray,
  chunkPath: string,
  limitBytes: number,
): ChunkSourceMap {
  const base64 = match[2]
  const payload = match[3] ?? ''
  const approximateBytes = base64 ? payload.length * 0.75 : payload.length
  if (approximateBytes > limitBytes)
    return unlisted(
      'too-large',
      `its embedded map is over the ${limitBytes} byte limit`,
      chunkPath,
    )
  try {
    const text = base64
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload)
    return fromText(text, dirname(chunkPath), chunkPath)
  } catch {
    return unlisted(
      'malformed',
      'its embedded map cannot be decoded',
      chunkPath,
    )
  }
}

/** Reads a map file named relative to the chunk; it must lie inside the load root and within the size cap. */
async function readMapFile(
  reference: string,
  chunkPath: string,
  loadRoot: string,
  limitBytes: number,
): Promise<ChunkSourceMap> {
  let mapPath: string
  try {
    mapPath = resolve(dirname(chunkPath), decodeURIComponent(reference))
  } catch {
    return unlisted('unreadable', 'its map name is not valid', chunkPath)
  }
  const real = await realpath(mapPath).catch(() => undefined)
  if (real === undefined)
    return unlisted('unreadable', 'its map file does not exist', mapPath)
  if (!isInsideFolder(loadRoot, real))
    return unlisted(
      'unreadable',
      'its map file lies outside the build',
      mapPath,
    )
  const size = await stat(real).then(
    (stats) => (stats.isFile() ? stats.size : undefined),
    () => undefined,
  )
  if (size === undefined)
    return unlisted('unreadable', 'its map is not a readable file', mapPath)
  if (size > limitBytes)
    return unlisted(
      'too-large',
      `its map is ${size} bytes, over the ${limitBytes} byte limit`,
      mapPath,
    )
  const text = await readFile(real, 'utf8').catch(() => undefined)
  if (text === undefined)
    return unlisted('unreadable', 'its map file cannot be read', mapPath)
  return fromText(text, dirname(real), mapPath)
}

/**
 * Reads the source map a built chunk names in its last `sourceMappingURL` comment.
 * Why: a `wxt-build` run resolves stops through the maps of the chunks a context loads, and a map that is too large, unreadable or not a flat version 3 map must be named instead of guessed.
 * Called by {@link listMappedSources} once per statically loaded chunk.
 * @param chunkPath - The chunk's absolute real path inside the load root.
 * @param loadRoot - The build folder's real path; a map file outside it is not read.
 * @param limitBytes - The most bytes of one map to read.
 * @returns
 * - `none` when the chunk names no map
 * - `map` with the parsed map, the folder its sources resolve against and its location
 * - `unlisted` with the kind and a one-clause reason when the map lists nothing
 * @example
 * await readChunkSourceMap('/out/a.js', '/out', 1024)
 * // => { status: 'map', map: { sources: ['../src/a.ts'], … }, folder: '/out', location: '/out/a.js.map' }
 */
export async function readChunkSourceMap(
  chunkPath: string,
  loadRoot: string,
  limitBytes: number = EXTENSION_SOURCE_MAP_LIMIT_BYTES,
): Promise<ChunkSourceMap> {
  const chunkText = await readFile(chunkPath, 'utf8').catch(() => undefined)
  if (chunkText === undefined) return { status: 'none' }
  const reference = lastMapReference(chunkText)
  if (reference === undefined) return { status: 'none' }
  // An embedded map is read from the comment; a named one is read from the load root.
  const dataMatch = DATA_MAP.exec(reference)
  if (dataMatch) return readDataMap(dataMatch, chunkPath, limitBytes)
  if (URL_SCHEME.test(reference))
    return unlisted('unreadable', 'its map is not a local file', chunkPath)
  return readMapFile(reference, chunkPath, loadRoot, limitBytes)
}
