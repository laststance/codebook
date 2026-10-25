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

export type NodeTestFact = {
  path: string
  mode: RepositoryInspection['mode']
  display: string
  type?: string
}

/**
 * Reads only the declared debugger paths of a Node test stop through native DAP scopes, never evaluating an expression or retaining other local values; called by {@link OwnedNodeTestRun} at an owned source stop.
 * A path's root is the scope variable of that name, or, when none has it, the name a module exports to the stopped module: Vitest binds each imported module whole ({@link NODE_TEST_MODULE_BINDING_NAME}), a mocked one as a Proxy whose exports sit under {@link DEBUGGER_PROXY_TARGET_NAME}, an unmocked one as a namespace of getters that the debugger shows lazily. A lazy value on the path is expanded once, as the Variables view does (Cycle 0052 task 5).
 * @param session - Verified native debug session.
 * @param scopes - Scopes of its checked source frame.
 * @param inspections - Validated requested facts.
 * @param signal - Run cancellation.
 * @returns The facts read; the variables they came from; and, as `<mode>:<path>`, each required fact the debugger could not read (absent, ambiguous between two imported modules, empty or longer than {@link REPOSITORY_LITERAL_LIMIT_CHARS}), which the caller reports while the stop stays accepted. An unreadable optional fact is left out, as before.
 * @example
 * await inspectNodeTestVariables(session, scopes, [{ path: 'revalidatePath.mock.calls.length', mode: 'value', required: true }], signal)
 * // => { facts: [{ path: 'revalidatePath.mock.calls.length', mode: 'value', display: '1', type: 'number' }], variables: [...], unavailable: [] }
 */
export async function inspectNodeTestVariables(
  session: Pick<vscode.DebugSession, 'customRequest'>,
  scopes: DebugProtocol.Scope[],
  inspections: RepositoryInspection[],
  signal: AbortSignal,
): Promise<{
  facts: NodeTestFact[]
  variables: DebugProtocol.Variable[]
  unavailable: string[]
}> {
  const read = debuggerVariableReader(session, signal)
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
      inspection.path,
    )
    const display =
      inspection.mode === 'type' ? variable?.type : variable?.value
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
    selected.push(variable)
  }
  return { facts, variables: selected, unavailable }
}

/** Reads the children of one debugger variable reference, once per reference. */
type DebuggerVariableReader = (
  reference: number,
) => Promise<DebugProtocol.Variable[]>

/**
 * Makes the cached reader of debugger variable children that one inspection pass shares; called by {@link inspectNodeTestVariables}.
 * @param session - The native debug session.
 * @param signal - Run cancellation.
 * @returns A reader answering an invalid or empty reference with no children.
 * @example const read = debuggerVariableReader(session, signal); await read(7) // => [{ name: 'count', value: '3', ... }]
 */
function debuggerVariableReader(
  session: Pick<vscode.DebugSession, 'customRequest'>,
  signal: AbortSignal,
): DebuggerVariableReader {
  const cache = new Map<number, DebugProtocol.Variable[]>()
  return async (reference) => {
    if (!Number.isSafeInteger(reference) || reference <= 0) return []
    const cached = cache.get(reference)
    if (cached) return cached
    const response = (await awaitResponse(
      session.customRequest('variables', { variablesReference: reference }),
      'owned Node debugger variables',
      signal,
    )) as DebugProtocol.VariablesResponse['body']
    if (!Array.isArray(response?.variables))
      throw new Error('Native debugger supplied no variable list.')
    cache.set(reference, response.variables)
    return response.variables
  }
}

/**
 * Walks one declared path, `root.segment.segment`, to its variable; called by {@link inspectNodeTestVariables}.
 * @param read - The pass's variable reader.
 * @param scopes - The stop's lexical scopes.
 * @param path - The declared path.
 * @returns The variable at the end of the path, or `undefined` when a step is missing.
 * @example await readDeclaredPath(read, scopes, 'revalidatePath.mock.calls.length') // => { name: 'length', value: '1', ... }
 */
async function readDeclaredPath(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
  path: string,
): Promise<DebugProtocol.Variable | undefined> {
  const [root = '', ...segments] = path.split('.')
  let variable =
    (await scopeVariable(read, scopes, root)) ??
    (await importedName(read, scopes, root))
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
 * @returns The variable, or `undefined` when no scope has it.
 * @example await scopeVariable(read, scopes, 'set') // => { name: 'set', value: 'ƒ (...args)', ... }
 */
async function scopeVariable(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
  name: string,
): Promise<DebugProtocol.Variable | undefined> {
  for (const scope of scopes) {
    const variable = (await read(scope.variablesReference)).find(
      (candidate) => candidate.name === name,
    )
    if (variable) return settledLazy(read, variable)
  }
  return undefined
}

/**
 * Finds a name the stopped module imports: the export of that name in one of Vitest's module bindings ({@link NODE_TEST_MODULE_BINDING_NAME}) in the stop's scopes, read through a Proxy's {@link DEBUGGER_PROXY_TARGET_NAME} for a mocked module; called by {@link readDeclaredPath} when no scope variable has the name.
 * A name that two bindings export is left unread: without the source map's binding there is no telling which import the source means.
 * @param read - The pass's variable reader.
 * @param scopes - The stop's lexical scopes.
 * @param name - The root's name.
 * @returns The export's variable, or `undefined` when no binding, or more than one, exports it.
 * @example await importedName(read, scopes, 'revalidatePath') // => { name: 'revalidatePath', value: 'ƒ (...args)', ... }
 */
async function importedName(
  read: DebuggerVariableReader,
  scopes: DebugProtocol.Scope[],
  name: string,
): Promise<DebugProtocol.Variable | undefined> {
  const exports: DebugProtocol.Variable[] = []
  for (const scope of scopes)
    for (const binding of await read(scope.variablesReference)) {
      if (!NODE_TEST_MODULE_BINDING_NAME.test(binding.name)) continue
      const exported = await moduleExport(read, binding, name)
      if (exported) exports.push(exported)
    }
  // Only one module may answer for the name; two would make the fact a guess.
  return exports.length === 1 ? settledLazy(read, exports[0]) : undefined
}

/**
 * Reads one export of a module binding: a child of that name, or, for a mocked module's Proxy, the child of that name under its target; called by {@link importedName}.
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
 * @returns The resolved variable, or the given one.
 * @example await settledLazy(read, { name: 'ITEMS_PER_PAGE', value: '(...)', variablesReference: 50, presentationHint: { lazy: true } }) // => { name: 'ITEMS_PER_PAGE', value: '6', ... }
 */
async function settledLazy(
  read: DebuggerVariableReader,
  variable: DebugProtocol.Variable | undefined,
): Promise<DebugProtocol.Variable | undefined> {
  if (!variable?.presentationHint?.lazy) return variable
  const [value, ...others] = await read(variable.variablesReference)
  // The protocol answers a lazy value with exactly one variable; anything else is left as it is.
  return value && others.length === 0 ? value : variable
}
