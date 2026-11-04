import { z } from 'zod'

import {
  REPOSITORY_DISCOVERY_CANDIDATE_LIMIT,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { resolveNextClientManifest } from './resolveNextClientManifest'

const clientManifestSchema = z.object({
  clientModules: z.record(
    z.string(),
    z.object({ chunks: z.array(z.string()) }),
  ),
})

/** Reads one bounded build file below the Next package root. */
export type BuildTextReader = (path: string, limit: number) => Promise<string>

/**
 * Reads the client chunks an App Router entry route's client reference manifest lists, without evaluating the manifest.
 *
 * Why it exists: the app's own browser stop ({@link readDevelopmentBundle}) and a browser stop in a workspace library ({@link sealAppLibraryStop}) search the same set, the `.js` chunks of `globalThis.__RSC_MANIFEST[<route key>]`. Called by both.
 * @param read - Reads a build file below the package root.
 * @param route - The route's manifest key and client reference manifest path ({@link resolveNextClientManifest}).
 * @returns The distinct `.js` chunk paths (relative to `.next/dev`) and the SHA-256 of the manifest text.
 * @throws `Unsupported selected-route client manifest` for a manifest without exactly one assignment of the route's key; `Application chunk count exceeds contract`; `No declared selected-route client chunks`; the reader's failures.
 * @example
 * await readAppClientChunks(read, { key: '/page', path: '.next/dev/server/app/page_client-reference-manifest.js' })
 * // => { candidates: ['static/chunks/app/page.js'], manifestHash: '9f2c…' }
 */
export async function readAppClientChunks(
  read: BuildTextReader,
  route: ReturnType<typeof resolveNextClientManifest>,
): Promise<{ candidates: string[]; manifestHash: string }> {
  const manifest = await read(route.path, REPOSITORY_JAVASCRIPT_LIMIT_BYTES),
    marker = `globalThis.__RSC_MANIFEST[${JSON.stringify(route.key)}]=`
  if (manifest.split(marker).length !== 2)
    throw new Error('Unsupported selected-route client manifest')
  const parsed = clientManifestSchema.parse(
      JSON.parse(manifest.split(marker)[1]!.trim().replace(/;$/, '')),
    ),
    candidates = new Set<string>()
  // The selected source may belong to any client entry; no repository component name chooses the search scope.
  for (const module of Object.values(parsed.clientModules))
    for (const chunk of module.chunks)
      if (chunk.endsWith('.js')) {
        candidates.add(chunk)
        if (candidates.size > REPOSITORY_DISCOVERY_CANDIDATE_LIMIT)
          throw new Error('Application chunk count exceeds contract')
      }
  if (!candidates.size)
    throw new Error('No declared selected-route client chunks')
  return { candidates: [...candidates], manifestHash: sha256(manifest) }
}
