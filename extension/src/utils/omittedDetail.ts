import { sha256 } from '../runtimeSupport/utils/sha256';
/** Fingerprints oversized event detail when {@link readResource} creates a bounded page. @example omittedDetail({large:'value'}).truncated // true */
export function omittedDetail(detail: unknown) { const text = JSON.stringify(detail); return { truncated: true, bytes: Buffer.byteLength(text), sha256: sha256(text) }; }
