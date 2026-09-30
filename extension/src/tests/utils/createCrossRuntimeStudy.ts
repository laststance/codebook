import type { ConfiguredStudy } from '../../configuredStudySchemas'
import { crossRuntimeRepositoryConfigSchema } from '../../repositoryConfigSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { createConfiguredStudy } from './createConfiguredStudy'

/** Supplies inert browser/server/browser records for history tests, never an application or native verification. @example createCrossRuntimeStudy().observations[1]?.participant // 'server' */
export function createCrossRuntimeStudy(): ConfiguredStudy {
  const original = createConfiguredStudy(),
    browser = original.observations[0]!,
    serverSource = original.descriptor!.sources[1]!
  browser.debugger = {
    version: 1,
    frames: [
      {
        name: 'browserStep',
        line: 1,
        column: 1,
        source: {
          name: original.configuration.source.path,
          text: browser.source.text,
          hash: browser.source.hash,
          line: 1,
        },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'nextTheme', value: 'dark', children: [] }],
    limitations: [],
  }
  const configuration = crossRuntimeRepositoryConfigSchema.parse({
    ...original.configuration,
    version: 2,
    participant: 'browser',
    additionalStops: [
      {
        participant: 'server',
        source: {
          path: serverSource.path,
          hash: serverSource.hash,
          line: 1,
          column: 1,
        },
        anchorIndex: 1,
        inspections: [{ path: 'mode', mode: 'value', required: true }],
      },
      {
        participant: 'browser',
        source: original.configuration.source,
        anchorIndex: 0,
        inspections: original.configuration.inspections,
      },
    ],
  })
  const server: ConfiguredStudy['observations'][number] = {
    ...browser,
    id: 'server-session:1',
    participant: 'server',
    capturePhase: 'paused-server',
    pause: { sessionId: 'server-session', generation: 1, threadId: 1 },
    snapshotUri: `codebook://${original.instanceId}/runs/${original.runId}/snapshots/server-session%3A1`,
    elapsedMs: 4000,
    capturedAt: '2026-09-20T00:00:04.000Z',
    source: {
      ...browser.source,
      text: serverSource.text,
      hash: serverSource.hash,
      scriptId: '18',
      scriptUrl: 'webpack-internal:///(action-browser)/./src/mode.ts',
    },
    values: { 'value:mode': 'display' },
    unavailableValues: [],
    interpretations: [],
    debugger: {
      version: 1,
      frames: [
        {
          name: 'serverStep',
          line: 1,
          column: 1,
          source: {
            name: serverSource.path,
            text: serverSource.text,
            hash: serverSource.hash,
            line: 1,
          },
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'mode', value: 'display', children: [] }],
      limitations: [],
    },
  }
  const finalBrowser = {
    ...browser,
    id: 'browser-session:2',
    pause: { ...browser.pause, generation: 2 },
    elapsedMs: 6000,
    capturedAt: '2026-09-20T00:00:06.000Z',
    snapshotUri: `codebook://${original.instanceId}/runs/${original.runId}/snapshots/browser-session%3A2`,
    interpretations: [],
  }
  return {
    ...original,
    version: 4,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    operation: { ...original.operation!, continuedPause: finalBrowser.pause },
    observations: [browser, server, finalBrowser],
    captures: [
      original.captures[0]!,
      ...[browser, server, finalBrowser].map((observation) => ({
        ...original.captures[1]!,
        phase: observation.capturePhase,
        snapshotId: observation.id,
      })),
      original.captures[2]!,
    ],
  }
}
