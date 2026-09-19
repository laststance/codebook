import { createReadStream } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { DISCOVERY_CANDIDATE_LIMIT, DISCOVERY_LIMIT_BYTES, DISCOVERY_TIMEOUT_MS, JAVASCRIPT_LIMIT_BYTES, SOURCE_LIMIT_BYTES, TARGET_SCRIPT_URL, TARGET_SOURCE_HASH, TARGET_SOURCE_PATH } from '../constants';
import { extractDevelopmentModule } from './extractDevelopmentModule';

const clientManifestSchema = z.object({ clientModules: z.record(z.string(), z.object({ chunks: z.array(z.string()) })) });

/** Reads only Next's declared application chunks for {@link RepositoryRun}; its streamed budget avoids product-specific evidence/storage coupling. @example await readDevelopmentBundle(isolatedTarget) */
export async function readDevelopmentBundle(target: string) {
  const started = performance.now(), deadline = started + DISCOVERY_TIMEOUT_MS;
  let readBytes = 0;
  // The product bounded-file reader throws StudyError; this acquisition also owns aggregate bytes and one deadline.
  const read = async (path: string, limit: number) => {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of createReadStream(path, { signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))) })) {
      bytes += chunk.length; readBytes += chunk.length;
      if (bytes > limit || readBytes > DISCOVERY_LIMIT_BYTES || performance.now() > deadline) throw new Error('Build discovery resource limit exceeded');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  const sourcePath = join(target, TARGET_SOURCE_PATH), source = await read(sourcePath, SOURCE_LIMIT_BYTES);
  if (sha256(source) !== TARGET_SOURCE_HASH) throw new Error('Target source differs from frozen revision');
  const manifest = await read(join(target, '.next/dev/server/app/page_client-reference-manifest.js'), JAVASCRIPT_LIMIT_BYTES);
  const marker = 'globalThis.__RSC_MANIFEST["/page"]=';
  if (manifest.split(marker).length !== 2) throw new Error('Unsupported root client manifest');
  const parsed = clientManifestSchema.parse(JSON.parse(manifest.split(marker)[1]!.trim().replace(/;$/, '')));
  const owner = parsed.clientModules[join(target, 'src/components/Header/index.tsx')];
  if (!owner) throw new Error('Declared Header client module is missing');
  const candidates = [...new Set(owner.chunks.filter(path => path.endsWith('.js')))];
  if (!candidates.length || candidates.length > DISCOVERY_CANDIDATE_LIMIT) throw new Error('Application chunk count exceeds contract');
  const bundles = [];
  // Limit candidates to this declared client entry; framework bootstrap size cannot widen our source contract.
  for (const candidate of candidates) {
    const buildRoot = resolve(target, '.next/dev'), chunkPath = resolve(buildRoot, candidate);
    if (!chunkPath.startsWith(`${buildRoot}${sep}`)) throw new Error('Declared chunk escapes the isolated build');
    const chunk = await read(chunkPath, JAVASCRIPT_LIMIT_BYTES);
    if (chunk.includes(TARGET_SCRIPT_URL)) bundles.push(extractDevelopmentModule(chunk, sourcePath, source, chunkPath, TARGET_SCRIPT_URL));
  }
  if (bundles.length !== 1) throw new Error('Missing or ambiguous application source chunk');
  return { bundle: bundles[0]!, discovery: { readBytes, durationMs: performance.now() - started, candidates, manifestHash: sha256(manifest) } };
}
