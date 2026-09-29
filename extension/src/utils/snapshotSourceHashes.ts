import type { RuntimeSnapshot } from '../runtime';

/** Supplies sealed repository source hashes to MCP resources and capture writers. @example snapshotSourceHashes(snapshot).typescript */
export function snapshotSourceHashes(snapshot: RuntimeSnapshot) {
  return { typescript: snapshot.source.hash, javascript: snapshot.source.javascriptHash, sourceMap: snapshot.source.mapHash };
}
