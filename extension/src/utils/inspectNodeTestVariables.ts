import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import {
  DEBUGGER_PROXY_TARGET_NAME,
  NODE_TEST_FACT_TYPE_LIMIT_CHARS,
  NODE_TEST_MODULE_BINDING_NAME,
  REPOSITORY_LITERAL_LIMIT_CHARS,
} from '../constants'
import type { RepositoryInspection } from '../repositoryConfigSchemas'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'

import { redactInspectedValue } from './redactInspectedValue'
import type {
  ModuleDeclarationBinding,
  SourceImports,
} from './sourceImportBindings'

export type NodeTestFact = {
  path: string
  mode: RepositoryInspection['mode']
  display: string
  type?: string
}

/**
 * Reads only the declared debugger paths of a Node test stop through native DAP scopes, never evaluating an expression or retaining other local values; called by {@link OwnedNodeTestRun} at an owned source stop.
 * A path's root is the scope variable of that name, or, when none has it, a name the stopped source imports, read as the export it stands for in its own declaration's module binding ({@link sourceImportBindings}, {@link importedName}): Vitest binds each imported module whole ({@link NODE_TEST_MODULE_BINDING_NAME}), a mocked one as a Proxy whose exports sit under {@link DEBUGGER_PROXY_TARGET_NAME}, an unmocked one as a namespace of getters that the debugger shows lazily. A lazy value on the path (a getter, such as a Vitest spy's `mock`) is expanded once, which runs that getter in the test process as the Variables view does when the learner expands it (Cycle 0052 task 5).
 * @param debugSession - Verified native debug session.
 * @param scopes - Scopes of its checked source frame.
 * @param inspections - Validated requested facts.
 * @param sourceImports - The stopped source's import declarations and imported names ({@link sourceImportBindings}).
 * @param signal - Run cancellation.
 * @returns The facts read; the variables they came from; and, as `<mode>:<path>`, each required fact the debugger could not read (absent, ambiguous between two imported modules, empty or longer than {@link REPOSITORY_LITERAL_LIMIT_CHARS}), which the caller reports while the stop stays accepted. An unreadable optional fact is left out, as before.
 * @example
 * await inspectNodeTestVariables(debugSession, scopes, [{ path: 'revalidatePath.mock.calls.length', mode: 'value', required: true }], sourceImportBindings("import { revalidatePath } from 'next/cache'"), signal)
 * // => { facts: [{ path: 'revalidatePath.mock.calls.length', mode: 'value', display: '1', type: 'number' }], variables: [...], unavailable: [] }
 */
export async function inspectNodeTestVariables(
  debugSession: Pick<vscode.DebugSession, 'customRequest'>,
  scopes: DebugProtocol.Scope[],
  inspections: RepositoryInspection[],
  sourceImports: SourceImports,
  signal: AbortSignal,
): Promise<{
  facts: NodeTestFact[]
  variables: DebugProtocol.Variable[]
  unavailable: string[]
}> {
  // A pass that fails ends the requests its other reads still have under way, so no binding read goes on asking a debugger whose stop has failed.
  const failedPass = new AbortController()
  const read = debuggerVariableReader(
    debugSession,
    AbortSignal.any([signal, failedPass.signal]),
  )
  // Only lexical runtime scopes can supply an operation fact; global state is unrelated to this stop.
  const lexicalScopes = scopes.filter(
    (scope) => !scope.name.toLowerCase().includes('global'),
  )
  const facts: NodeTestFact[] = [],
    selected: DebugProtocol.Variable[] = [],
    unavailable: string[] = []
  for (const inspection of inspections) {
    signal.throwIfAborted()
    const variable = await readDeclaredPath(
      read,
      lexicalScopes,
      sourceImports,
      inspection.path,
    ).catch((error: unknown) => {
      failedPass.abort()
      throw error
    })
    // Redaction contract: a value under a secret-named step, or one shaped like a credential, reads [masked]; a type name is never a value.
    const rawDisplay =
      inspection.mode === 'type' ? variable?.type : variable?.value
    const display =
      rawDisplay === undefined
        ? undefined
        : redactInspectedValue(inspection, rawDisplay)
    if (
      !variable ||
      !display ||
      display.length > REPOSITORY_LITERAL_LIMIT_CHARS
    ) {
      // A required fact is reported by name; the stop keeps the facts that could be read (Cycle 0052 task 5).
      if (inspection.required)
        unavailable.push(`${inspection.mode}:${inspection.path}`)
      continue
    }
    // An oversized debugger type name is supplementary; omit it instead of making the saved stop invalid.
    const type =
      variable.type !== undefined &&
      variable.type.length <= NODE_TEST_FACT_TYPE_LIMIT_CHARS
        ? variable.type
        : undefined
    facts.push({
      path: inspection.path,
      mode: inspection.mode,
      display,
      ...(type !== undefined && { type }),
    })
    // The kept debugger variable carries the masked value too, so nothing downstream sees the real one.
    // A type inspection shows the type, yet its kept variable still carries a value: mask that value as a value inspection of the same path would.
    selected.push({
      ...variable,
      value:
        inspection.mode === 'type'
          ? redactInspectedValue(
              { mode: 'value', path: inspection.path },
              variable.value,
            )
          : display,
    })
  }
  // A lazy value whose expansion failed reads as unavailable (settledLazy); a run cancelled meanwhile still ends the pass.
  signal.throwIfAborted()
  return { facts, variables: selected, unavailable }
}

/** Reads the children of one debugger variable reference, once per reference. */
type DebuggerVariableReader = (
  reference: number,
) => Promise<DebugProtocol.Variable[]>

/**
 * Makes the cached reader of debugger variable children that one inspection pass shares; called by {@link inspectNodeTestVariables}.
 * @param debugSession - The native debug session.
 * @param signal - Run cancellation, or the end of a failed pass.
 * @returns A reader answering an invalid or empty reference with no children.
 * @example const read = debuggerVariableReader(debugSession, signal); await read(7) // => [{ name: 'count', value: '3', ... }]
 */
function debuggerVariableReader(
  debugSession: Pick<vscode.DebugSession, 'customRequest'>,
  signal: AbortSignal,
): DebuggerVariableReader {
  // The request of each reference, so bindings read together share one request for a reference they both reach.
  const cache = new Map<number, Promise<DebugProtocol.Variable[]>>()
  const request = async (
    reference: number,
  ): Promise<DebugProtocol.Variable[]> => {
    // A cancelled or failed pass sends the debugger no further request.
    signal.throwIfAborted()
    const response = (await awaitResponse(
      Promise.resolve(
        debugSession.customRequest('variables', {
          variablesReference: reference,
        }),
      ).catch((error: unknown) => {
        // The adapter answered with an error (a getter that threw, for example); a timeout or a cancellation is not this.
        throw new DebuggerRefusedVariables(error)
      }),
      'owned Node debugger variables',
      signal,
    )) as DebugProtocol.VariablesResponse['body']
    if (!Array.isArray(response?.variables))
      throw new Error('Native debugger supplied no variable list.')
    return response.variables
  }
  return (reference) => {
    if (!Number.isSafeInteger(reference) || reference <= 0)
      return Promise.resolve([])
    const cached = cache.get(reference)
    if (cached) return cached
    const reading = request(reference)
    cache.set(reference, reading)
    // A failed request is not kept: the reference may be asked again.
    reading.catch(() => cache.delete(reference))
    return reading
  }
}

/** The debug adapter's error answer to a `variables` request, as opposed to a timeout, a cancellation or a malformed answer; {@link settledLazy} reads it as an unreadable step. The adapter's error stays its `cause`. */
class DebuggerRefusedVariables extends Error {
  constructor(cause: unknown) {
    // The name stays `Error`, so a failure worded from it reads as other run failures do (withoutErrorName drops only `…Error: `); only `instanceof` tells it apart.
    super(`Native debugger refused the variables request: ${String(cause)}`, {
      cause,
    })
  }
}

/** What a stop's scopes hold under a path's root: its variable, `undefined` when its lazy value could not be read; the root then still shadows any import of that name. */
type ScopeRoot = { variable: DebugProtocol.Variable | undefined }

/**
 * Walks one declared path, `root.segment.segment`, to its variable; called by {@link inspectNodeTestVariables}.
 * @param read - The pass's variable reader.
 * @param scopes - The stop's lexical scopes.
 * @param sourceImports - The stopped source's import declarations and imported names.
 * @param path - The declared path.
 * @returns The variable at the end of the path, or `undefined` when a step is missing.
 * @example await readDeclaredPath(read, scopes, sourceImportBindings("import { revalidatePath } from 'next/cache'"), 'revalidatePath.mock.calls.length') // => { name: 'length', value: '1', ... }
 */
async function readDeclaredPath(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
  sourceImports: SourceImports,
  path: string,
): Promise<DebugProtocol.Variable | undefined> {
  const [root = '', ...segments] = path.split('.')
  const local = await scopeVariable(read, scopes, root)
  let variable = local
    ? local.variable
    : await importedName(read, scopes, sourceImports, root)
  for (const segment of segments)
    variable =
      variable &&
      (await settledLazy(
        read,
        (await read(variable.variablesReference)).find(
          (candidate) => candidate.name === segment,
        ),
      ))
  return variable
}

/**
 * Finds the scope variable of a path's root, the first scope that has it winning, as JavaScript scoping does; called by {@link readDeclaredPath}.
 * @param read - The pass's variable reader.
 * @param scopes - The stop's lexical scopes, innermost first.
 * @param name - The root's name.
 * @returns The {@link ScopeRoot} of the first scope that has the name; `undefined` when no scope has it.
 * @example await scopeVariable(read, scopes, 'set') // => { variable: { name: 'set', value: 'ƒ (...args)', ... } }
 */
async function scopeVariable(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
  name: string,
): Promise<ScopeRoot | undefined> {
  for (const scope of scopes) {
    const variable = (await read(scope.variablesReference)).find(
      (candidate) => candidate.name === name,
    )
    // A scope variable of the name shadows any import, also when its lazy value cannot be read.
    if (variable) return { variable: await settledLazy(read, variable) }
  }
  return undefined
}

/**
 * Reads a name the stopped module imports, as the export its import declaration names in that declaration's own module binding: the variable Vite or Vitest binds that module to ({@link ModuleDeclarationBinding}; Vitest's numbering when the stop's scopes hold any `__vi_import_<n>__`), read through a Proxy's {@link DEBUGGER_PROXY_TARGET_NAME} for a mocked module; called by {@link readDeclaredPath} when no scope variable has the root's name.
 * No other module binding ever answers for the name (Cycle 0052 task 96). A name the source does not import, a namespace import, a binding the stop's scopes do not hold and an export that binding lacks leave the name unread, and so does any earlier declaration whose binding the scopes hold without the exports it names: the compiler dropped an import used only as a type, which shifts the numbering. A binding listed by two scopes counts once.
 * @param read - The pass's variable reader.
 * @param scopes - The stop's lexical scopes.
 * @param sourceImports - The stopped source's import declarations and imported names ({@link sourceImportBindings}).
 * @param name - The root's name.
 * @returns The export's variable, or `undefined` when the name cannot be read from its own module binding.
 * @example await importedName(read, scopes, sourceImportBindings("import { revalidatePath } from 'next/cache'"), 'revalidatePath') // => { name: 'revalidatePath', value: 'ƒ (...args)', ... }
 */
async function importedName(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
  sourceImports: SourceImports,
  name: string,
): Promise<DebugProtocol.Variable | undefined> {
  const imported = sourceImports.names.get(name)
  // Only a name the source imports from one module's export is read (Cycle 0052 task 70).
  if (!imported || imported.exported === '*') return undefined
  const bindings = await moduleBindingsInScope(read, scopes)
  const isHoisted = [...bindings.keys()].some((binding) =>
    binding.startsWith('__vi_import_'),
  )
  const bindingOf = (
    declaration: ModuleDeclarationBinding | undefined,
  ): DebugProtocol.Variable | undefined =>
    declaration &&
    bindings.get(isHoisted ? declaration.hoisted : declaration.plain)
  const declarations = sourceImports.declarations.slice(
    0,
    imported.declaration + 1,
  )
  // Each declaration up to this one must find its own exports in its binding: a dropped import would shift the numbering. The bindings are independent requests, read together.
  const hasEveryExport = await Promise.all(
    declarations.map(async (declaration) => {
      const binding = bindingOf(declaration)
      if (!binding) return true
      for (const exported of declaration.exports)
        if (!(await moduleExport(read, binding, exported))) return false
      return true
    }),
  )
  const binding = bindingOf(declarations.at(-1))
  if (!binding || hasEveryExport.includes(false)) return undefined
  return settledLazy(read, await moduleExport(read, binding, imported.exported))
}

/**
 * Lists the module bindings ({@link NODE_TEST_MODULE_BINDING_NAME}) a stop's scopes hold, by variable name; called by {@link importedName}.
 * @returns Each binding once, the innermost scope's when two scopes list it.
 * @example await moduleBindingsInScope(read, scopes) // => Map { '__vi_import_0__' => { name: '__vi_import_0__', value: 'Proxy(Object)', … } }
 */
async function moduleBindingsInScope(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
): Promise<Map<string, DebugProtocol.Variable>> {
  const bindings = new Map<string, DebugProtocol.Variable>()
  for (const scope of scopes)
    for (const binding of await read(scope.variablesReference))
      if (
        NODE_TEST_MODULE_BINDING_NAME.test(binding.name) &&
        !bindings.has(binding.name)
      )
        bindings.set(binding.name, binding)
  return bindings
}

/**
 * Reads one export of a module binding: a child of that name, or, for a mocked module's Proxy, the child of that name under its target; called by {@link importedName} for the name and for the checks of each declaration's exports.
 * @param read - The pass's variable reader.
 * @param binding - The module binding.
 * @param name - The export's name.
 * @returns The export's variable, or `undefined`.
 * @example await moduleExport(read, { name: '__vi_import_1__', value: 'Proxy(Object)', variablesReference: 4 }, 'revalidatePath')
 */
async function moduleExport(
  read: DebuggerVariableReader,
  binding: DebugProtocol.Variable,
  name: string,
): Promise<DebugProtocol.Variable | undefined> {
  const children = await read(binding.variablesReference)
  const direct = children.find((child) => child.name === name)
  if (direct) return direct
  const target = children.find(
    (child) => child.name === DEBUGGER_PROXY_TARGET_NAME,
  )
  return target
    ? (await read(target.variablesReference)).find(
        (child) => child.name === name,
      )
    : undefined
}

/**
 * Expands a lazy debugger value (a getter the debugger shows as `(...)`) to the one value it stands for, as the Variables view does when the learner opens it; any other variable is returned as it is; called for every step of a declared path.
 * @param read - The pass's variable reader.
 * @param variable - The step's variable, if any.
 * @returns The resolved variable, or `undefined` when the adapter refused the expansion or answered with no single value, so its `(...)` placeholder never stands for a value.
 * @throws What the reader threw for a timeout, a cancellation or a malformed answer.
 * @example await settledLazy(read, { name: 'ITEMS_PER_PAGE', value: '(...)', variablesReference: 50, presentationHint: { lazy: true } }) // => { name: 'ITEMS_PER_PAGE', value: '6', ... }
 */
async function settledLazy(
  read: DebuggerVariableReader,
  variable: DebugProtocol.Variable | undefined,
): Promise<DebugProtocol.Variable | undefined> {
  if (!variable?.presentationHint?.lazy) return variable
  // Expanding a lazy value runs its getter in the test process: the adapter's error answer (a getter that threw) leaves the step unreadable instead of failing the stop; a timeout, a cancellation or a malformed answer still fails it.
  const children = await read(variable.variablesReference).catch(
    (error: unknown) => {
      if (error instanceof DebuggerRefusedVariables) return undefined
      throw error
    },
  )
  const [value, ...others] = children ?? []
  // The protocol answers a lazy value with exactly one variable; any other answer leaves the step unreadable (Cycle 0052 task 71).
  return others.length === 0 ? value : undefined
}
