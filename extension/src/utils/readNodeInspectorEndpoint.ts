/** Reads a complete loopback announcement for {@link launchDevelopmentServer}; callers must separately verify process ownership. @example readNodeInspectorEndpoint('Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111\n') */
export function readNodeInspectorEndpoint(output: string): string | undefined {
  const endpoints = new Set<string>();
  // Incomplete lines cannot authorize a connection; process output may split any URL component.
  for (const match of output.matchAll(/(?:^|\n)Debugger listening on ([^\r\n]+)(?=\r?\n)/g)) {
    const endpoint = match[1]!;
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw new Error('Malformed server inspector announcement'); }
    if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1' || !parsed.port || Number(parsed.port) === 0 || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(parsed.pathname)) throw new Error('Server inspector must announce one loopback endpoint with an explicit port and identity');
    endpoints.add(parsed.href);
  }
  if (endpoints.size > 1) throw new Error('Ambiguous server inspector endpoints');
  return endpoints.values().next().value;
}
