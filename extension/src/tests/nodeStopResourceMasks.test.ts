import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readResource } from '../resources'
import type { StudyRecord } from '../service'

import { createHarness } from './helpers'

/** The mask placeholder, kept out of `label: [masked]` literals so the repository's secret scanner does not read them as credential assignments. */
const MASK = '[masked]'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_PATH = 'src/handler.ts'

/** Reads a paged JSON resource whose content fits one page and returns the parsed content with its raw text. */
async function readPaged(
  service: Parameters<typeof readResource>[0],
  uri: string,
): Promise<{ content: string; parsed: unknown }> {
  const resource = await readResource(service, uri)
  if (!('text' in resource)) throw new Error(`${uri} did not return JSON.`)
  const page = JSON.parse(resource.text) as {
    content: string
    complete: boolean
  }
  assert.equal(page.complete, true)
  return { content: page.content, parsed: JSON.parse(page.content) }
}

// protects=the live Node test run's stop resource, which the chat reads while the run is paused, serves the Cookie-shaped values of the stop's variables, its facts and its debugger snapshot masked, while a plain fact stays readable; fails_when=the resource answers a variable value, a fact display or a snapshot variable of the stop as captured; no_claim=the capture's own masks (captureReplayDebugSnapshot tests) and a saved history's detail (savedDebugHistoryMasking tests)
test('the live node-stops resource serves a Cookie-shaped variable, fact and snapshot value masked and keeps a plain fact readable', async () => {
  // Arrange
  const harness = await createHarness()
  const { service } = harness
  const cookieValue = ['opaque', 'session', 'value', '4f9c2d71'].join('-')
  const cookieText = `'sid=${cookieValue}; theme=dark'`
  const record = {
    id: RUN_ID,
    profile: 'node-test',
    nodePrepared: {
      descriptor: { sources: [{ path: SOURCE_PATH }] },
    },
    nodeStops: [
      {
        index: 0,
        source: { path: SOURCE_PATH, hash: 'a'.repeat(64), line: 2, column: 1 },
        frame: { id: 1, name: 'handler', line: 2, column: 1 },
        variables: [
          { name: 'cookieHeader', value: cookieText, variablesReference: 0 },
          { name: 'page', value: "'page=2'", variablesReference: 0 },
        ],
        facts: [
          { path: 'cookieHeader', mode: 'value', display: cookieText },
          { path: 'page', mode: 'value', display: "'page=2'" },
        ],
        debuggerSnapshot: {
          version: 1,
          frames: [
            {
              name: 'handler',
              line: 2,
              column: 1,
              scopes: [{ name: 'Local', variables: [0] }],
            },
          ],
          variables: [
            {
              name: 'cookieHeader',
              value: cookieText,
              type: 'string',
              children: [],
            },
          ],
          limitations: [],
        },
      },
    ],
  } as unknown as StudyRecord
  service.records.set(RUN_ID, record)
  try {
    // Act
    const stop = await readPaged(service, service.uri(RUN_ID, 'node-stops/0'))

    // Assert
    assert.equal(stop.content.includes(cookieValue), false)
    const served = stop.parsed as {
      variables: { name: string; value: string }[]
      facts: { path: string; display: string }[]
      debuggerSnapshot: { variables: { name: string; value: string }[] }
    }
    assert.deepEqual(
      served.variables.map((variable) => variable.value),
      [MASK, "'page=2'"],
    )
    assert.deepEqual(
      served.facts.map((fact) => fact.display),
      [MASK, "'page=2'"],
    )
    assert.equal(served.debuggerSnapshot.variables[0]?.value, MASK)
  } finally {
    // The fake run has no process to stop, so it leaves the service's records before the shutdown walks them.
    service.records.delete(RUN_ID)
    await harness.close()
  }
})
