import { join, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { REPOSITORY_DISCOVERY_CANDIDATE_LIMIT, REPOSITORY_DISCOVERY_LIMIT_BYTES, REPOSITORY_DISCOVERY_TIMEOUT_MS, REPOSITORY_JAVASCRIPT_LIMIT_BYTES, REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants';
import type { RepositoryConfiguration } from '../repositoryConfigSchemas';
import type { BundleSource } from '../repositoryBundle';
import { extractDevelopmentModule } from './extractDevelopmentModule';
import { readRepositoryBuildText } from './readRepositoryBuildText';

const clientManifestSchema = z.object({ clientModules: z.record(z.string(), z.object({ chunks: z.array(z.string()) })) });

/** Discovers a configured tracked source among all declared root-route client chunks before browser input. @example await readDevelopmentBundle(workspace, configuration.source, signal) */
export async function readDevelopmentBundle(workspace: string, selected: RepositoryConfiguration['source'], signal?: AbortSignal) {
  const started = performance.now(), deadline = started + REPOSITORY_DISCOVERY_TIMEOUT_MS, root = await realpath(workspace);
  let readBytes = 0;
  const read = async (path: string, limit: number) => {
    signal?.throwIfAborted();
    if (performance.now() >= deadline || readBytes >= REPOSITORY_DISCOVERY_LIMIT_BYTES) throw new Error('Build discovery resource limit exceeded');
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())));
    const text = await readRepositoryBuildText(root, path, Math.min(limit, REPOSITORY_DISCOVERY_LIMIT_BYTES - readBytes), signal ? AbortSignal.any([signal, timeout]) : timeout);
    readBytes += Buffer.byteLength(text); return text;
  };
  const sourcePath = join(root, selected.path), source = await read(sourcePath, REPOSITORY_SOURCE_LIMIT_BYTES);
  if (sha256(source) !== selected.hash) throw new Error('Selected source differs from the accepted article');
  const manifest = await read('.next/dev/server/app/page_client-reference-manifest.js', REPOSITORY_JAVASCRIPT_LIMIT_BYTES), marker = 'globalThis.__RSC_MANIFEST["/page"]=';
  if (manifest.split(marker).length !== 2) throw new Error('Unsupported root client manifest');
  const parsed = clientManifestSchema.parse(JSON.parse(manifest.split(marker)[1]!.trim().replace(/;$/, ''))), candidates = new Set<string>();
  // The selected source may belong to any client entry; no repository component name chooses the search scope.
  for (const module of Object.values(parsed.clientModules)) for (const chunk of module.chunks) if (chunk.endsWith('.js')) {
    candidates.add(chunk);
    if (candidates.size > REPOSITORY_DISCOVERY_CANDIDATE_LIMIT) throw new Error('Application chunk count exceeds contract');
  }
  if (!candidates.size) throw new Error('No declared root client chunks');
  const bundles: BundleSource[] = [], scriptUrl = `webpack-internal:///(app-pages-browser)/./${selected.path}`;
  for (const candidate of candidates) {
    const buildRoot = resolve(root, '.next/dev'), chunkPath = resolve(buildRoot, candidate);
    if (!chunkPath.startsWith(`${buildRoot}${sep}`)) throw new Error('Declared chunk escapes the selected build');
    const chunk = await read(chunkPath, REPOSITORY_JAVASCRIPT_LIMIT_BYTES), bundle = extractDevelopmentModule(chunk, sourcePath, source, chunkPath, scriptUrl, deadline);
    if (bundle) bundles.push(bundle);
    if (bundles.length > 1) throw new Error('Ambiguous application source chunk');
    // Yield between bounded chunks so state/stop remain responsive during preparation.
    await setImmediate(undefined, { signal });
  }
  if (performance.now() >= deadline) throw new Error('Build discovery resource limit exceeded');
  signal?.throwIfAborted();
  if (bundles.length !== 1) throw new Error('Missing application source chunk');
  return { bundle: bundles[0]!, discovery: { readBytes, durationMs: performance.now() - started, candidates: [...candidates], manifestHash: sha256(manifest) } };
}
