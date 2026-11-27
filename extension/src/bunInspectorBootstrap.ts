// Preloaded by Bun for a `loader: "bun"` node-server run (`bun --preload <this file> <entry>`, launched by `launchNodeServer`).
// It must stay free of extension imports: Bun loads it into the learner's server process before the server's own entry.
import * as inspector from 'node:inspector'

/**
 * Opens Bun's Node-compatible inspector on a free loopback port, announces it in Node's words and holds the program until the native JavaScript debugger attaches.
 *
 * Why it exists: Bun's own `--inspect` speaks the WebKit inspector protocol, which VS Code's JavaScript debugger does not; only `node:inspector`'s `open()` serves the Chrome DevTools Protocol endpoint the debugger attaches to (Cycle 0152 probes E1-M1 and M2).
 * When it runs: once, at preload, before Bun loads the server's entry. The debugger's `Runtime.runIfWaitingForDebugger` releases the wait; Bun offers no paused entry like Node's `--inspect-brk`, so the run arms its stops once the server listens.
 * What reads it: the run reads the announcement with `readNodeInspectorEndpoint`; Bun may print the same line itself, and the reader accepts the repeat.
 *
 * @example
 * ```ts
 * // bun --preload dist/bunInspectorBootstrap.js src/index.ts
 * // stderr: Debugger listening on ws://127.0.0.1:52817/0f3c…
 * ```
 */
function openInspectorAndWait(): void {
  inspector.open(0, '127.0.0.1', false)
  const url = inspector.url()
  // Without an endpoint there is nothing to announce: the run then times out waiting for the announcement and names that failure.
  if (url) process.stderr.write(`Debugger listening on ${url}\n`)
  inspector.waitForDebugger()
}

openInspectorAndWait()
