import { randomUUID } from 'node:crypto'

import { sha256 } from '../../runtimeSupport/utils/sha256'

import { createConfiguredStudy } from './createConfiguredStudy'

/** Creates isolated Node history identity and citations for durable reader behavior tests. @example const header = nodeTestHistoryHeader(workspaceKey) */
export function nodeTestHistoryHeader(workspaceKey: string) {
  const reference = createConfiguredStudy(),
    instanceId = randomUUID(),
    runId = randomUUID()
  const configuration = {
    version: 1 as const,
    adapter: 'vitest-node' as const,
    book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    testFile: 'src/theme.test.ts',
    testHash: sha256('test'),
    source: {
      path: 'src/theme.ts',
      hash: sha256('const nextTheme = "dark";\n'),
      line: 1,
      column: 1,
    },
    inspections: [
      { path: 'nextTheme', mode: 'value' as const, required: true },
    ],
  }
  return {
    profile: 'node-test' as const,
    workspaceKey,
    studyId: `${instanceId}_${runId}`,
    instanceId,
    runId,
    createdAt: '2026-09-28T00:00:00.000Z',
    configurationHash: sha256(JSON.stringify(configuration)),
    configuration,
    descriptor: reference.descriptor!,
    sourceBuild: {
      revision: 'test',
      dirty: true,
      sourceHash: sha256('extension'),
    },
  }
}
