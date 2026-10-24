import type { NodeTestConfiguration } from '../../nodeTestConfigSchemas'
import type { NodeTestSourceStop } from '../../ownedNodeTestRun'
import type { NodeTestRuntime } from '../../runtime'
import { sha256 } from '../../runtimeSupport/utils/sha256'

/**
 * Builds a fake owned Node run with two declared stops and a passing result, as a live test run the workspace's Save acts on.
 * @param source - The cited source of both stops.
 * @param sourceText - The cited source's text, which each stop's debugger snapshot holds so the stop verifies.
 * @returns The run, which pauses at its first stop and reaches the second one when it advances.
 * @example const run = twoStopOwnedRun(configuration.source, sourceText)
 */
export function twoStopOwnedRun(
  source: NodeTestConfiguration['source'],
  sourceText: string,
): NodeTestRuntime {
  const stops = [0, 1].map(
    (index) =>
      ({
        index,
        runId: 'node-run',
        sessionId: 'owned-session',
        threadId: 7,
        elapsedMs: 10 + index * 10,
        worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
        source,
        frame: {
          id: 10 + index,
          name: 'schedule',
          line: source.line,
          column: source.column,
        },
        variables: [{ name: 'delayMs', value: '5000', variablesReference: 0 }],
        facts: [
          { path: 'delayMs', mode: 'value', display: '5000', type: 'number' },
        ],
        debuggerSnapshot: {
          version: 1,
          frames: [
            {
              name: 'schedule',
              line: source.line,
              column: source.column,
              source: {
                name: source.path,
                text: sourceText,
                hash: sha256(sourceText),
                line: source.line,
              },
              scopes: [{ name: 'Local', variables: [0] }],
            },
          ],
          variables: [
            { name: 'delayMs', value: '5000', type: 'number', children: [] },
          ],
          limitations: [],
        },
      }) satisfies NodeTestSourceStop,
  )
  let cursor = 0
  return {
    id: 'node-run',
    async prepare() {
      return stops[cursor]!
    },
    hasNextStop() {
      return cursor < stops.length - 1
    },
    async advance() {
      return stops[++cursor]!
    },
    async complete() {
      return {
        exitCode: 0,
        signal: null,
        output: 'Tests 1 passed',
        elapsedMs: 40,
      }
    },
    async stop(): Promise<void> {},
  }
}
