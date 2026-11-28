// Preloaded by Bun for a `loader: "bun"` node-server run (`bun --no-install --preload <this file> <entry>`, launched by `launchNodeServer`).
// It must stay free of extension imports: Bun loads it into the learner's server process before the server's own entry.
import * as inspector from 'node:inspector'
import { basename } from 'node:path'

/** The environment variable that names the one process this bootstrap opened an inspector in; children inherit it and so recognise they are not that process. */
const INSPECTOR_OWNER_ENV = 'CODEBOOK_BUN_INSPECTOR_PID'

/** The file name this bootstrap is bundled as; its own `--preload`-style entries are found by it. */
const BOOTSTRAP_FILE_NAME = 'bunInspectorBootstrap.js'

/** The execArgv flags that load a module before the entry; each takes the module as its next argument or after `=`. */
const PRELOAD_FLAGS = new Set(['--preload', '--require', '-r', '--import'])

/**
 * Removes this bootstrap's own preload entries from `process.execArgv`, so a default `child_process.fork()` does not hand the bootstrap on to a child.
 *
 * Why it exists: Bun 1.4.5 passes the parent's `--preload` to a forked child; the child would open another inspector and wait for a debugger nobody answers.
 * When it runs: once, in the launched process, after the bootstrap has run.
 * What calls it: {@link openInspectorAndWait}.
 *
 * @example
 * ```ts
 * // execArgv ['--preload', '/x/bunInspectorBootstrap.js'] becomes []
 * ```
 */
function forgetOwnPreloadEntries(): void {
  const kept: string[] = []
  const argv = process.execArgv
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const [flag, inlineValue] = arg.split(/=(.*)/s, 2)
    const isPreloadFlag = PRELOAD_FLAGS.has(flag!)
    // `--preload=<file>` form carries the module inline; the spaced form carries it in the next argument.
    const value = inlineValue ?? (isPreloadFlag ? argv[index + 1] : undefined)
    if (isPreloadFlag && value && basename(value) === BOOTSTRAP_FILE_NAME) {
      if (inlineValue === undefined) index += 1
      continue
    }
    kept.push(arg)
  }
  argv.splice(0, argv.length, ...kept)
}

/**
 * Opens Bun's Node-compatible inspector on a free loopback port, announces it in Node's words and holds the program until the native JavaScript debugger attaches.
 *
 * Why it exists: Bun's own `--inspect` speaks the WebKit inspector protocol, which VS Code's JavaScript debugger does not; only `node:inspector`'s `open()` serves the Chrome DevTools Protocol endpoint the debugger attaches to (Cycle 0152 probes E1-M1 and M2).
 * When it runs: once, at preload, before Bun loads the server's entry, and only in the launched process: a process that inherited {@link INSPECTOR_OWNER_ENV} naming another pid (a forked helper) does nothing, because no debugger is attached to it. The debugger's `Runtime.runIfWaitingForDebugger` releases the wait; Bun offers no paused entry like Node's `--inspect-brk`, so the run arms its stops once the server listens.
 * What reads it: the run reads the announcement with `readNodeInspectorEndpoint`; Bun may print the same line itself, and the reader accepts the repeat.
 *
 * @example
 * ```ts
 * // bun --no-install --preload dist/bunInspectorBootstrap.js src/index.ts
 * // stderr: Debugger listening on ws://127.0.0.1:52817/0f3c…
 * ```
 */
function openInspectorAndWait(): void {
  // A marker naming another process means this is a child of the launched server: stay out of its way.
  const owner = process.env[INSPECTOR_OWNER_ENV]
  if (owner !== undefined && owner !== String(process.pid)) return
  process.env[INSPECTOR_OWNER_ENV] = String(process.pid)
  forgetOwnPreloadEntries()
  inspector.open(0, '127.0.0.1', false)
  const url = inspector.url()
  // Without an endpoint there is nothing to announce: the run then times out waiting for the announcement and names that failure.
  if (url) process.stderr.write(`Debugger listening on ${url}\n`)
  inspector.waitForDebugger()
}

openInspectorAndWait()
