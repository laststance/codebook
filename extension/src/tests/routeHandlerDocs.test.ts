import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { ERROR_RECOVERY } from '../errors'
import { nextHelp } from '../nextHelp'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import {
  ROUTE_HANDLER_CONFIGURATION,
  serverRenderHelp,
} from '../serverRenderHelp'

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below `extension/`.
 * @returns The file text.
 * @example await readPackaged('skills', 'codebook', 'SKILL.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// Value: protects=the route-handler quick start is a complete version 3 configuration with a server stop after operation 2 in app/api/items/route.ts, so a chat that copies it is not refused for its shape or for afterOperation 0; fails_when=the example drifts from the operations schema, loses a server stop with afterOperation >= 1, or names a target's file; no_claim=that the placeholders name real files
test('the route-handler quick start parses with the operations schema and stops after operation 2 in a placeholder route file', () => {
  // Arrange
  const example = JSON.parse(JSON.stringify(ROUTE_HANDLER_CONFIGURATION))
  // Act
  const result = operationsRepositoryConfigSchema.safeParse(example)
  // Assert
  assert.equal(result.success, true)
  assert.equal(example.participant, 'server')
  assert.equal(example.afterOperation, 2)
  assert.equal(example.source.path, 'app/api/items/route.ts')
  assert.deepEqual(
    example.operations.map(
      (operation: { selector: string }) => operation.selector,
    ),
    ['input[name=title]', 'form button[type=submit]'],
  )
})

// Value: protects=the help tells the chat the route-handler rule, fields, identity rule, values guidance, the three refusals and the not-reached possibilities; fails_when=a block or phrase leaves routeHandlerStops or the quick start; no_claim=that the run behaves as the help says (the run tests)
test('the help states the route-handler rule, identity rule, values guidance, refusals and not-reached possibilities', () => {
  // Arrange
  const help = serverRenderHelp()
  // Act
  const text = JSON.stringify([
    help.routeHandlerQuickStart,
    help.routeHandlerStops,
  ])
  // Assert
  for (const phrase of [
    'API 1.28 or later',
    'execution \\"route-handler\\"',
    'routeHandler { method, route, path }',
    "Only the browser's own request after the operation pauses",
    'the first qualifying request',
    'no-browser-request',
    'request.json() consumes it',
    'a header that carries a credential (cookie, authorization) is never a required inspection',
    'route-handler-before-operation',
    'route-handler-edge-runtime',
    'route-handler-not-app-source',
    'never the established cause',
    'never start again unasked',
    'afterOperation 2',
  ])
    assert.ok(text.includes(phrase), phrase)
})

// Value: protects=route handlers are no longer listed as unsupported in the help limits or in the Next help's notStoppable list, while middleware and proxy stay; fails_when="route handlers (route.ts)" returns as unsupported or middleware leaves the lists; no_claim=the run refusing a Pages API route
test('the help limits and notStoppable no longer list route handlers as unsupported but keep middleware and proxy', () => {
  // Arrange
  const { limits } = serverRenderHelp().serverRenderQuickStart
  const notStoppable = JSON.stringify(nextHelp().nextSupport.notStoppable)
  // Act
  const limit = limits[0] ?? ''
  // Assert
  assert.equal(limit.includes('route handlers (route.ts)'), false)
  assert.ok(limit.includes('middleware or proxy'))
  assert.equal(notStoppable.includes('route handlers (route.ts)'), false)
  assert.ok(notStoppable.includes('middleware or proxy'))
})

// Value: protects=the error texts a chat reads cover the route-handler refusal reasons and the not-reached possibilities; fails_when=a reason or the details.routeHandler wording leaves ERROR_RECOVERY; no_claim=that the run raises them
test('the error recovery texts name the three route-handler refusals and the route-handler not-reached possibilities', () => {
  // Arrange
  const sealed = ERROR_RECOVERY.NEXT_STOP_NOT_SEALED
  const notReached = ERROR_RECOVERY.SERVER_STOP_NOT_REACHED
  // Act / Assert
  for (const reason of [
    'route-handler-before-operation',
    'route-handler-edge-runtime',
    'route-handler-not-app-source',
  ])
    assert.ok(sealed.includes(reason), reason)
  assert.ok(notReached.includes('details.routeHandler is { route, method }'))
  assert.ok(notReached.includes('other-method, other-path'))
})

// Value: protects=the bundled skill allows route handlers only on API 1.28 or later with afterOperation >= 1 and keeps middleware and proxy unsupported; fails_when=the gate, the afterOperation rule or the remaining limits leave line 44; no_claim=chat behavior
test('the bundled skill gates route-handler stops by API 1.28 and afterOperation 1 or more', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.82"\n'))
  assert.ok(
    skill.includes(
      'A route handler (`route.ts` under `app/`) takes a `participant: "server"` stop only when `codebook_status` reports API 1.28 or later',
    ),
  )
  assert.ok(skill.includes('`afterOperation` of 1 or more'))
  assert.ok(
    skill.includes(
      '`_document`, other routes, middleware or proxy and Turbopack are not supported',
    ),
  )
})

// Value: protects=the README documents route-handler stops, the request-identity rule and the refusals, moves the current preview to API 1.28 and no longer calls route handlers unsupported; fails_when=a sentence leaves the README or the old unsupported wording returns; no_claim=the behavior itself
test('the README documents route-handler stops under API 1.28 and no longer lists route handlers as unsupported', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  assert.ok(readme.includes('**MCP API 1.33**'))
  assert.ok(
    readme.includes('API 1.28 is additive: it adds route-handler stops'),
  )
  assert.ok(readme.includes('- **Route handlers (MCP API 1.28).**'))
  assert.ok(
    readme.includes(
      "Only the browser's own request after the operation pauses, the first one for the stop's route and method to reach the line",
    ),
  )
  assert.ok(readme.includes('`route-handler-before-operation`'))
  assert.ok(
    readme.includes(
      'a run whose only stops are route handlers has a manifest before input with the source hash and `sealedAtPause: "route-handler"` and no JavaScript or map hash',
    ),
  )
  assert.equal(readme.includes('route handlers (`route.ts`)'), false)
})

// Value: protects=the chat-facing texts state the identity contract's limits (a server fetch of its own route, a late request from before the operation, the earliest unclaimed request among several), keep a route handler out of the "other routes" limit and list format 13 in the migration table; fails_when=the help or README promises that only the page's own request can pause, calls every non-entry route unsupported, or omits format 13; no_claim=that the limits are the only ones
test('the help and README state the route-handler identity limits, except route handlers from the other-routes limit and list format 13', async () => {
  // Arrange
  const help = serverRenderHelp()
  const readme = await readPackaged('README.md')
  // Act
  const identityRule = help.routeHandlerStops.identityRule
  const limit = help.serverRenderQuickStart.limits[0] ?? ''
  const migrationRows = help.serverRenderMigration.table.map((row) => row.item)
  // Assert
  assert.ok(
    identityRule.includes(
      "Limits: Codebook matches a pause to the browser's request by route, method and operation window, not by the request itself",
    ),
  )
  assert.ok(
    limit.includes(
      'other routes than the entry route (except an App Router route handler with afterOperation 1 or more from API 1.28, routeHandlerStops, and a Pages API route with afterOperation 1 or more from API 1.29, apiRouteStops)',
    ),
  )
  assert.ok(
    migrationRows.includes(
      'saved study of an App Router route-handler pause (API 1.28)',
    ),
  )
  assert.ok(
    help.routeHandlerStops.savedStudy.startsWith(
      'A study with a route-handler pause is saved as format 13 (.study.v13.json)',
    ),
  )
  assert.ok(
    readme.includes(
      "Codebook matches a pause to the browser's request by route, method and operation, not by the request itself",
    ),
  )
  assert.ok(
    readme.includes(
      'in the server code of any route other than the entry route (an App Router route handler is the exception from MCP API 1.28, see **Route handlers** below, and a Pages API route from MCP API 1.29, see **API routes** below)',
    ),
  )
})

// Value: protects=native C87-1 (a required request.method inspection ended the run at its pause): the help, the README and the skill tell the chat that request.method, request.url and headers are getters Codebook refuses and that routeHandler names the method and path; fails_when=a text again calls request.method readable, so a chat declares it and the run stops before its outcome; no_claim=chat behaviour
test('the help, README and skill say the request getters are never inspections and routeHandler names the method', async () => {
  // Arrange
  const values = serverRenderHelp().routeHandlerStops.values
  const readme = await readPackaged('README.md')
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act
  const texts = [values, readme, skill]
  // Assert
  assert.ok(
    values.includes(
      "request.method, request.url and request.headers are getters of the Request object, which Codebook's side-effect-free inspection refuses",
    ),
  )
  assert.ok(
    readme.includes(
      "`request.method`, `request.url` and the headers are getters that Codebook's side-effect-free inspection refuses, so never declare them as inspections",
    ),
  )
  assert.ok(
    skill.includes(
      'never declare `request.method`, `request.url` or a header as an inspection',
    ),
  )
  assert.deepEqual(
    texts.map((text) =>
      /request\.method`? (and|,) `?request\.url`? are readable/.test(text),
    ),
    [false, false, false],
  )
})
