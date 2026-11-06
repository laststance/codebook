import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { API_ROUTE_MINIMUM_API, API_VERSION } from '../constants'
import { ERROR_RECOVERY } from '../errors'
import { nextHelp } from '../nextHelp'
import { routeHandlerStopRefusal } from '../nextRefusals'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { API_ROUTE_CONFIGURATION, serverRenderHelp } from '../serverRenderHelp'
import { pagesServerStopRefusal } from '../utils/pagesServerStopRefusal'

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below `extension/`.
 * @returns The file text.
 * @example await readPackaged('skills', 'codebook', 'SKILL.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// Value: protects=the API-route configuration example is a complete version 3 configuration whose one server stop sits in src/pages/api/data.ts with afterOperation 1 and one required inspection, so a chat that copies it is not refused for afterOperation 0; fails_when=the example drifts from the operations schema or its afterOperation returns to 0; no_claim=that the placeholders name real files
test('the API-route configuration example parses and stops after operation 1 in a placeholder API file', () => {
  // Arrange
  const example = JSON.parse(JSON.stringify(API_ROUTE_CONFIGURATION))
  // Act
  const result = operationsRepositoryConfigSchema.safeParse(example)
  // Assert
  assert.equal(result.success, true)
  assert.equal(example.adapter, 'next-dev-webpack')
  assert.equal(example.entryPath, '/')
  assert.equal(example.participant, 'server')
  assert.equal(example.afterOperation, 1)
  assert.equal(example.source.path, 'src/pages/api/data.ts')
  assert.equal(example.operations.length, 1)
  assert.equal(example.operations[0].kind, 'click')
  assert.equal(example.inspections.length, 1)
  assert.equal(example.inspections[0].required, true)
})

// Value: protects=the help tells the chat the API-route rule, fields, identity limit, readable request properties, refusals, not-reached possibilities and saved format; fails_when=a block or phrase leaves apiRouteStops; no_claim=that the run behaves as the help says (the run tests)
test('the help states the API-route rule, identity limit, values guidance, refusals, not-reached possibilities and format 14', () => {
  // Arrange
  const { apiRouteStops } = serverRenderHelp()
  // Act
  const text = JSON.stringify(apiRouteStops)
  // Assert
  assert.equal(API_ROUTE_MINIMUM_API, '1.29')
  assert.equal(
    apiRouteStops.anchor,
    'codebook://help/repository-browser#api-route-stops',
  )
  for (const phrase of [
    'API 1.29 or later, Pages Router run',
    'afterOperation of 1 or more',
    'execution \\"api-route\\"',
    'apiRoute { method, route, path }',
    'After operation 1 · API route GET /api/data · src/pages/api/data.ts:17',
    "an earlier request with the same method and URL that reaches the line after the operation, or the server's own fetch of the same URL, can be the one that is attributed",
    'req.method, req.url and req.query are plain properties',
    "a local declared on the stop's own line has no value yet",
    'a destructured parameter',
    'api-route-before-operation',
    'api-route-edge-runtime',
    'A line outside the handler (module scope) never pauses for a request',
    "unclassified hits mean Codebook did not recognise Next's apiResolver as the caller",
    'details.apiRoute is { route }',
    'format 14 (.study.v14.json)',
    'Codebook 0.2.87 and older list it as saved by a newer Codebook',
  ])
    assert.ok(text.includes(phrase), phrase)
  assert.ok(text.includes('"afterOperation":1'))
  assert.equal(text.includes('"afterOperation":0'), false)
})

// Value: protects=the two API-route refusal reasons carry the recovery texts the plan fixed, word for word, with sideEffects none and no process started; fails_when=a reason is rejected by the builder or its recovery text changes; no_claim=that the run raises them (the run tests)
test('the API-route refusals say what to set and that nothing was started', () => {
  // Arrange
  const closing =
    'Nothing was started: no server, no browser and no input (details.sideEffects is none). See codebook://help/repository-browser#NEXT_STOP_NOT_SEALED.'
  // Act
  const beforeOperation = routeHandlerStopRefusal(
    'api-route-before-operation',
    'src/pages/api/data.ts:17',
    0,
  )
  const edgeRuntime = routeHandlerStopRefusal(
    'api-route-edge-runtime',
    'src/pages/api/data.ts:17',
    0,
  )
  // Assert
  assert.equal(beforeOperation.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(beforeOperation.details?.reason, 'api-route-before-operation')
  assert.equal(beforeOperation.details?.sideEffects, 'none')
  assert.equal(
    beforeOperation.recoveryOverride,
    `Set the stop's afterOperation to the operation after which the page sends the request (1 or more; afterOperation exists only in a version 3 configuration with operations, so a version 2 configuration moves to version 3): an API-route stop pauses only for a request the page sends after an operation, never for one sent while the page loads. When the page sends that request only while it loads, no afterOperation reaches it: explain the handler from its source and say so. Otherwise recovery: fix the configuration, then one new start. ${closing}`,
  )
  assert.equal(edgeRuntime.details?.reason, 'api-route-edge-runtime')
  assert.equal(
    edgeRuntime.recoveryOverride,
    `The API route declares the edge runtime in its exported config, which Codebook cannot pause in, and no configuration change fixes that: explain the handler from its source and say it cannot be paused. ${closing}`,
  )
})

// Value: protects=the static recovery of NEXT_STOP_NOT_SEALED, which an agent reads at the help anchor, names both API-route reasons beside the route-handler ones, with the on-load escape, and says the five refusals started nothing; fails_when=the help entry still covers only the three route-handler reasons, so an agent at the anchor finds no word on api-route-before-operation or api-route-edge-runtime; no_claim=the per-refusal recovery (the refusal test above)
test('the NEXT_STOP_NOT_SEALED help entry names both API-route reasons and that the five refusals started nothing', () => {
  // Arrange
  const recovery = ERROR_RECOVERY.NEXT_STOP_NOT_SEALED
  // Act / Assert
  for (const phrase of [
    'When details.reason is api-route-before-operation, the stop is in a Pages API route with afterOperation 0 or in a version 2 configuration',
    'a request the page sends only while it loads is reached by no afterOperation, so explain the handler from source and say so',
    'When details.reason is api-route-edge-runtime, the API route declares the edge runtime in its exported config: no fix exists',
    'These five refusals started nothing (details.sideEffects is none).',
  ])
    assert.ok(recovery.includes(phrase), phrase)
})

// Value: protects=the lexical Pages refusal names only _document and no longer says API routes are unsupported; fails_when=the API-route sentence returns to the _document refusal or its recovery; no_claim=the run's raising of it
test('the _document refusal no longer calls API routes unsupported', () => {
  // Arrange
  const refusal = pagesServerStopRefusal({
    kind: 'lexical',
    place: 'src/pages/_document.tsx:3',
    reason: 'document',
    pagesRun: true,
  })
  // Act
  const text = `${refusal.message} ${refusal.recoveryOverride ?? ''}`
  // Assert
  assert.equal(refusal.code, 'NEXT_SERVER_ONLY_STOP')
  assert.equal(
    refusal.message,
    'Declared stop src/pages/_document.tsx:3 is a server stop in the Pages _document file. _document is not supported in this version.',
  )
  assert.equal(text.includes('API route'), false)
})

// Value: protects=the migration table lists the format 14 row and neither the limits nor the Next help list Pages API routes as unsupported; fails_when=the row leaves the table or Pages API routes return to a not-supported list; no_claim=that every limit is complete
test('the migration table lists the API-route study and no help limit calls Pages API routes unsupported', () => {
  // Arrange
  const help = serverRenderHelp()
  const notStoppable = JSON.stringify(nextHelp().nextSupport.notStoppable)
  // Act
  const row = help.serverRenderMigration.table.find(
    (entry) =>
      entry.item === 'saved study of a Pages API-route pause (API 1.29)',
  )
  const limit = help.serverRenderQuickStart.limits[0] ?? ''
  // Assert
  assert.ok(row?.change.startsWith('format 14 (.study.v14.json)'))
  assert.equal(limit.includes('Pages API routes, middleware or proxy'), false)
  assert.equal(notStoppable.includes('API routes (pages/api)'), false)
  assert.equal(API_VERSION, '1.30')
})

// Value: protects=the README documents API-route stops beside Route handlers (fields, identity limit, values, refusals, not-reached, configuration pointer), the format 14 sentence, skill 1.0.78 and API 1.29, names Pages API routes beside route handlers as the exception to the entry-route rule, and no longer lists Pages API routes as unsupported; fails_when=a sentence leaves the README or the entry-route limits still call every other route's server code unsupported; no_claim=the behavior itself
test('the README documents API-route stops under API 1.29 and no longer lists Pages API routes as unsupported', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  assert.ok(readme.includes('with **MCP API 1.30**'))
  assert.ok(
    readme.includes('API 1.29 is additive: it adds Pages API-route stops'),
  )
  assert.ok(readme.includes('- **API routes (MCP API 1.29).**'))
  assert.ok(
    // pregate-literal: API_VERSION=1.28 the Route handlers bullet names the API that introduced route handlers
    readme.indexOf('- **Route handlers (MCP API 1.28).**') <
      readme.indexOf('- **API routes (MCP API 1.29).**'),
  )
  for (const phrase of [
    '`execution: "api-route"` with `apiRoute`',
    'an earlier request with the same method and URL that reaches the line after the operation, or a request the server sends to its own API with the same URL, can be the one that pauses',
    '`req.method`, `req.url` and `req.query` are plain properties',
    '`api-route-before-operation` or `api-route-edge-runtime`',
    '`SERVER_STOP_NOT_REACHED`',
    '`apiRouteStops.configuration`',
    'is saved as format 14 (`.study.v14.json`), which also keeps the fields of format 13; Codebook 0.2.87 and older list it as saved by a newer Codebook',
    'updates to **1.0.79**',
    '- **Not supported.** Stops in `_document` (see `NEXT_SERVER_ONLY_STOP` below)',
    'and a Pages API route from MCP API 1.29, see **API routes** below)',
    '(except an App Router route handler and a Pages API route, see **Route handlers** and **API routes** above)',
  ])
    assert.ok(readme.includes(phrase), phrase)
  assert.equal(readme.includes('Stops in a Pages API route'), false)
})

// Value: protects=the bundled skill gives Pages API routes their minimum API 1.29 and afterOperation rule, tells the chat to offer the partial replay and never start again after an API route was not reached, and no longer lists them as unsupported; fails_when=the gate, the rule, the no-restart line or the version leaves the skill; no_claim=chat behavior
test('the bundled skill gates Pages API-route stops by API 1.29 and afterOperation 1 or more', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.79"\n'))
  assert.ok(
    skill.includes(
      'A Pages API route (`pages/api` or `src/pages/api`) takes a `participant: "server"` stop only when `codebook_status` reports API 1.29 or later',
    ),
  )
  assert.ok(
    skill.includes('`api-route-before-operation` or `api-route-edge-runtime`'),
  )
  assert.ok(
    skill.includes(
      'for `SERVER_STOP_NOT_REACHED` give `details.apiRoute` and the possibilities, never one as the cause; the inputs were already sent, so offer the partial replay and never start again unasked',
    ),
  )
  assert.equal(skill.includes('Pages API routes and `_document`'), false)
})
