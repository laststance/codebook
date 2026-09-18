interface PageTarget { id: string; type: string; url: string }

/** Resolves only one exact fixture URL for browser attachment; readiness polling may accept absence, never ambiguity. @example selectPageTarget([{ id: 'page', type: 'page', url: 'http://local/run' }], 'http://local/run')?.id // 'page' */
export function selectPageTarget(targets: unknown, url: string): PageTarget | undefined {
  if (!Array.isArray(targets)) throw new Error('Invalid browser target list');
  const matches: PageTarget[] = [];
  // Decode only the target identity fields used by the isolated browser adapter.
  for (const target of targets) {
    if (!target || typeof target !== 'object' || typeof target.id !== 'string' || typeof target.type !== 'string' || typeof target.url !== 'string') throw new Error('Invalid browser target identity');
    if ((target.type === 'page' || target.type === 'webview') && target.url === url) matches.push({ id: target.id, type: target.type, url: target.url });
  }
  if (matches.length > 1) throw new Error('Ambiguous fixture browser targets');
  return matches[0];
}
