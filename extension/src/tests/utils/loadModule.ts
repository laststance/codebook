import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { createContext, runInContext } from 'node:vm'

/** The real `clearTimeout`, kept from before any test fakes timers, so a loaded module can still cancel a timer it armed before the clock was faked. */
const realClearTimeout = clearTimeout

/**
 * Injects only editor effects into compiled boundary modules while preserving actual Node/SDK code.
 *
 * @param path - The compiled module to evaluate in its own context.
 * @param dependencies - Stubs returned for the module's `require` of these names.
 * @param globals - Extra globals of the module's context.
 * @param sameContext - Dependency names mapped to compiled files that run in this module's own context, so their promises belong to the same realm as the module's own (the editor runs every module in one realm; an await on a promise of another realm takes extra microtask turns).
 * @example await loadModule<typeof import('../../environment')>(path, {vscode: stub})
 */
export async function loadModule<Module>(
  path: string,
  dependencies: Record<string, unknown>,
  globals: Record<string, unknown> = {},
  sameContext: Record<string, string> = {},
): Promise<Module> {
  const required = createRequire(path),
    module = { exports: {} }
  const sameContextExports = new Map<string, unknown>()
  const sameContextSources = new Map(
    await Promise.all(
      Object.entries(sameContext).map(
        async ([name, file]) => [name, await readFile(file, 'utf8')] as const,
      ),
    ),
  )
  const context = createContext({
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
    require: (name: string) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (!Object.hasOwn(sameContext, name)) return required(name)
      if (!sameContextExports.has(name)) {
        const file = sameContext[name]!,
          sibling = { exports: {} }
        // The sibling runs as a function of this context, with its own module object and its own relative requires.
        const evaluate = runInContext(
          `(function (module, exports, require, __dirname, __filename) {${sameContextSources.get(name)}\n})`,
          context,
          { filename: file },
        ) as (...values: unknown[]) => void
        const siblingRequire = createRequire(file)
        // The sibling resolves the stubbed dependencies first, as the module that requires it does.
        evaluate(
          sibling,
          sibling.exports,
          (request: string) =>
            Object.hasOwn(dependencies, request)
              ? dependencies[request]
              : siblingRequire(request),
          dirname(file),
          file,
        )
        sameContextExports.set(name, sibling.exports)
      }
      return sameContextExports.get(name)
    },
  })
  runInContext(await readFile(path, 'utf8'), context, { filename: path })
  // A dynamically evaluated CommonJS export has no static TypeScript type; callers supply the original module contract.
  return module.exports as Module
}
