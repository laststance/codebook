import type { RuntimeSnapshot } from '../runtime';
import { REPOSITORY_BROWSER_ACTION } from '../constants';

/** Reads source hashes from the declared runtime variant for shared MCP capture and resources. @example snapshotSourceHashes(snapshot).typescript */
export function snapshotSourceHashes(snapshot: RuntimeSnapshot) {
  return snapshot.actionId === REPOSITORY_BROWSER_ACTION
    ? { typescript: snapshot.source.hash, javascript: snapshot.source.javascriptHash, sourceMap: snapshot.source.mapHash }
    : { typescript: snapshot.source.typescriptHash, javascript: snapshot.source.javascriptHash, sourceMap: snapshot.source.sourceMapHash };
}
