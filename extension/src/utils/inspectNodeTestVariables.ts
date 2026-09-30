import type * as vscode from 'vscode'
import type { DebugProtocol } from '@vscode/debugprotocol'
import {
  NODE_TEST_FACT_TYPE_LIMIT_CHARS,
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

/** Reads only declared debugger paths through native DAP scopes; never evaluates an expression or retains other local values. Called at an owned source stop. @param session - Verified native debug session. @param scopes - Scopes of its checked source frame. @param inspections - Validated requested facts. @param signal - Run cancellation. @example await inspectNodeTestVariables(session, scopes, [{path:'listener',mode:'value',required:true}], signal) */
export async function inspectNodeTestVariables(
  session: Pick<vscode.DebugSession, 'customRequest'>,
  scopes: DebugProtocol.Scope[],
  inspections: RepositoryInspection[],
  signal: AbortSignal,
): Promise<{ facts: NodeTestFact[]; variables: DebugProtocol.Variable[] }> {
  const cache = new Map<number, DebugProtocol.Variable[]>()
  const readVariables = async (
    reference: number,
  ): Promise<DebugProtocol.Variable[]> => {
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
  const facts: NodeTestFact[] = [],
    selected: DebugProtocol.Variable[] = []
  for (const inspection of inspections) {
    signal.throwIfAborted()
    const [root, ...segments] = inspection.path.split('.')
    let variable: DebugProtocol.Variable | undefined
    for (const scope of scopes) {
      // Only lexical runtime scopes can supply an operation fact; global state is unrelated to this stop.
      if (scope.name.toLowerCase().includes('global')) continue
      variable = (await readVariables(scope.variablesReference)).find(
        (candidate) => candidate.name === root,
      )
      if (variable) break
    }
    for (const segment of segments)
      variable = (await readVariables(variable?.variablesReference ?? 0)).find(
        (candidate) => candidate.name === segment,
      )
    const display =
      inspection.mode === 'type' ? variable?.type : variable?.value
    if (
      !variable ||
      !display ||
      display.length > REPOSITORY_LITERAL_LIMIT_CHARS
    ) {
      if (inspection.required)
        throw new Error(
          `Required Node debugger fact is unavailable or too large: ${inspection.mode}:${inspection.path}`,
        )
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
  return { facts, variables: selected }
}
