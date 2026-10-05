import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { runInNewContext } from 'node:vm'

/** The real `clearTimeout`, kept from before any test fakes timers, so a loaded module can still cancel a timer it armed before the clock was faked. */
const realClearTimeout = clearTimeout

/** Injects only editor effects into compiled boundary modules while preserving actual Node/SDK code. @example await loadModule<typeof environmentModule>(path, {vscode: stub}) */
export async function loadModule<Module>(
  path: string,
  dependencies: Record<string, unknown>,
  globals: Record<string, unknown> = {},
): Promise<Module> {
  const required = createRequire(path),
    module = { exports: {} }
  runInNewContext(
    await readFile(path, 'utf8'),
    {
      module,
      exports: module.exports,
      __dirname: dirname(path),
      __filename: path,
      Buffer,
      process,
      console,
      performance,
      queueMicrotask,
      setInterval,
      clearInterval,
      // Resolved at call time, so a test that fakes timers after loading the module also fakes them inside it.
      setTimeout: (
        handler: (...values: unknown[]) => void,
        delayMs?: number,
        ...values: unknown[]
      ) => globalThis.setTimeout(handler, delayMs, ...values),
      // Both are called: the handle is a faked timer or a real one armed before the clock was faked, and each clearTimeout ignores a handle it does not know.
      clearTimeout: (timer?: Parameters<typeof clearTimeout>[0]) => {
        globalThis.clearTimeout(timer)
        realClearTimeout(timer)
      },
      AbortController,
      AbortSignal,
      ...globals,
      require: (name: string) =>
        Object.hasOwn(dependencies, name) ? dependencies[name] : required(name),
    },
    { filename: path },
  )
  // A dynamically evaluated CommonJS export has no static TypeScript type; callers supply the original module contract.
  return module.exports as Module
}
