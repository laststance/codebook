import type { ConfiguredStudy } from '../../configuredStudySchemas'
import {
  repositoryConfigSchema,
  type RepositoryConfiguration,
} from '../../repositoryConfigSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { citationContext } from '../../utils/citationContext'

/**
 * Supplies immutable configured history for decoder/storage tests without pretending to run an app or debugger.
 * @param source - Text of the cited browser source `src/theme.ts`; its default has the statement on line 1 and an empty line 2.
 * @param citationEndLine - Last line of that source's citation; the default cites line 1 only, so a test of a stop the debugger moves to a later line widens it.
 * @returns A demonstrated one-stop study declared and observed at 1:1.
 * @example
 * createConfiguredStudy().observations[0]?.values['value:nextTheme'] // 'dark'
 * createConfiguredStudy(undefined, 2).descriptor?.anchors[0]?.endLine // 2
 */
export function createConfiguredStudy(
  source = 'const nextTheme = "dark";\n',
  citationEndLine = 1,
): ConfiguredStudy & { version: 3; configuration: RepositoryConfiguration } {
  const instanceId = '11111111-1111-4111-8111-111111111111',
    runId = '22222222-2222-4222-8222-222222222222'
  const secondary = 'export const mode = "display";\n'
  const anchors = [
    {
      path: 'src/theme.ts',
      hash: sha256(source),
      startLine: 1,
      endLine: citationEndLine,
    },
    { path: 'src/mode.ts', hash: sha256(secondary), startLine: 1, endLine: 1 },
  ]
  const configuration = repositoryConfigSchema.parse({
    version: 1,
    adapter: 'next-dev-webpack',
    book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    source: { path: 'src/theme.ts', hash: sha256(source), line: 1, column: 1 },
    action: {
      title: 'Change theme',
      selector: 'button',
      before: [{ kind: 'visible', selector: 'button' }],
      after: [{ kind: 'text', selector: 'label', equals: 'Dark' }],
    },
    inspections: [
      { path: 'nextTheme', mode: 'value', required: true },
      { path: 'setTheme', mode: 'type', required: true },
      { path: 'enabled', mode: 'value', required: false },
      { path: 'selection', mode: 'value', required: false },
      { path: 'renderLocal', mode: 'value', required: false },
    ],
  })
  const pause = { sessionId: 'browser-session', threadId: 1, generation: 1 }
  return {
    version: 3,
    workspaceKey: '0'.repeat(64),
    id: `${instanceId}_${runId}`,
    instanceId,
    runId,
    profile: 'repository-browser',
    createdAt: '2026-09-20T00:00:00.000Z',
    savedAt: '2026-09-20T00:00:10.000Z',
    state: 'stopped',
    terminal: true,
    finalOutcome: 'demonstrated',
    materialSignature: sha256('material'),
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    descriptor: {
      itemId: 'repository/interface/theme',
      bookTitle: 'Interface',
      nodeTitle: 'Theme',
      anchors,
      citationContext: citationContext(anchors),
      sources: [
        {
          path: 'src/theme.ts',
          hash: sha256(source),
          text: source,
          lineCount: source.split(/\r\n?|\n/).length,
        },
        {
          path: 'src/mode.ts',
          hash: sha256(secondary),
          text: secondary,
          lineCount: 2,
        },
      ],
    },
    operation: {
      id: '33333333-3333-4333-8333-333333333333',
      key: 'change-theme',
      inputDispatched: true,
      inputAcknowledged: true,
      continuedPause: pause,
      afterVerified: true,
    },
    observations: [
      {
        id: 'browser-session:1',
        itemId: 'repository/interface/theme',
        actionId: 'repository-click',
        capturePhase: 'paused-browser',
        snapshotUri: `codebook://${instanceId}/runs/${runId}/snapshots/browser-session%3A1`,
        participant: 'browser',
        capturedAt: '2026-09-20T00:00:02.000Z',
        elapsedMs: 2_000,
        pause,
        source: {
          text: source,
          hash: sha256(source),
          line: 1,
          column: 1,
          javascriptHash: sha256('emitted javascript'),
          mapHash: sha256('emitted source map'),
          scriptId: '17',
          scriptUrl: 'webpack-internal:///(app-pages-browser)/src/theme.ts',
          generated: { line: 8, column: 2 },
        },
        values: {
          'value:nextTheme': 'dark',
          'type:setTheme': 'function',
          'value:enabled': false,
          'value:selection': null,
        },
        unavailableValues: [
          { path: 'value:renderLocal', reason: 'Optimized out at this frame.' },
        ],
        interpretations: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            text: 'This stop captures the selected dark theme before it is applied.',
            createdAt: '2026-09-20T00:00:03.000Z',
            facts: [{ path: 'value:nextTheme', value: 'dark' }],
          },
        ],
      },
    ],
    captures: [
      {
        phase: 'before',
        status: 'captured',
        base64: Buffer.from('light').toString('base64'),
        hash: sha256('light'),
      },
      {
        phase: 'paused-browser',
        status: 'captured',
        base64: Buffer.from('paused').toString('base64'),
        hash: sha256('paused'),
      },
      {
        phase: 'after',
        status: 'captured',
        base64: Buffer.from('dark').toString('base64'),
        hash: sha256('dark'),
      },
    ],
    links: [],
  }
}
