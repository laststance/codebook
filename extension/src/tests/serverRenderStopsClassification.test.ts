import assert from 'node:assert/strict'
import { test } from 'node:test'

import { entryRoutePatternOf } from '../utils/entryRoutePatternOf'
import { isBrowserOnEntryRoute } from '../utils/isBrowserOnEntryRoute'
import { isReactServerCopyUrl } from '../utils/isReactServerCopyUrl'
import { serverExecutionOfScriptUrl } from '../utils/serverExecutionOfScriptUrl'
import {
  serverRenderHitVerdictOf,
  type ServerRenderHit,
} from '../utils/serverRenderHitVerdictOf'
import { serverStopSetOf } from '../utils/serverStopSetOf'

/** A hit in the entry route's first render; each test changes the field it is about. @example hitOf({ group: 1 }) */
function hitOf(change: Partial<ServerRenderHit>): ServerRenderHit {
  return {
    isReactCopyAtOwnedStop: false,
    stopAlreadyPaused: false,
    renderedRoute: { state: 'read', route: '/dashboard' },
    entryPattern: '/dashboard',
    browserOnEntryRoute: true,
    group: 0,
    ...change,
  }
}

// Value: protects=AC 17 route comparison: the manifest key of a page in a route group is compared in the work store's URL form; fails_when=the group segment stays in the pattern; no_claim=a real manifest (spike s07-cdg logged the store values /dashboard, /dashboard/invoices, /dashboard/invoices/[id]/edit and /)
test('the entry pattern of a page in a route group is the URL form without the group', () => {
  // Arrange, Act, Assert
  assert.equal(entryRoutePatternOf('/dashboard/(overview)/page'), '/dashboard')
  assert.equal(
    entryRoutePatternOf('/dashboard/invoices/[id]/edit/page'),
    '/dashboard/invoices/[id]/edit',
  )
  assert.equal(entryRoutePatternOf('/page'), '/')
  assert.equal(entryRoutePatternOf('/api/hello/route'), undefined)
})

// Value: protects=AC 17: a dynamic segment matches as a segment and a query never decides which route the browser is on; fails_when=a concrete id is compared as text or the query joins the path; no_claim=none beyond protects
test('the browser is on the entry route by Next precedence, never by query', () => {
  // Arrange
  const pattern = '/dashboard/invoices/[id]/edit'
  // Act, Assert
  assert.equal(
    isBrowserOnEntryRoute(
      'http://localhost:3000/dashboard/invoices/abc/edit?query=x',
      pattern,
    ),
    true,
  )
  assert.equal(
    isBrowserOnEntryRoute('http://localhost:3000/dashboard/invoices', pattern),
    false,
  )
  assert.equal(
    isBrowserOnEntryRoute(
      'http://localhost:3000/login?next=/dashboard',
      '/dashboard',
    ),
    false,
  )
  assert.equal(
    isBrowserOnEntryRoute(
      'http://localhost:3000/dashboard?query=de',
      '/dashboard',
    ),
    true,
  )
})

// Value: protects=AC 16/17 entry hit verdicts: the entry route's hit pauses with its attribution, group 0 as entry-load and group k as after-operation; fails_when=group 0 reads after-operation or the entry route's hit is resumed; no_claim=none beyond protects
test('an entry-route hit pauses with entry-load in group 0 and after-operation in a later group', () => {
  // Arrange, Act, Assert
  assert.deepEqual(serverRenderHitVerdictOf(hitOf({ group: 0 })), {
    action: 'pause',
    attribution: 'entry-load',
  })
  assert.deepEqual(serverRenderHitVerdictOf(hitOf({ group: 2 })), {
    action: 'pause',
    attribution: 'after-operation',
  })
})

// Value: protects=AC 5/17: another route's hit is resumed and journaled with that route; fails_when=the hit pauses or the route is lost; no_claim=none beyond protects
test("another route's hit is resumed and names the route", () => {
  // Arrange, Act
  const verdict = serverRenderHitVerdictOf(
    hitOf({ renderedRoute: { state: 'read', route: '/dashboard/invoices' } }),
  )
  // Assert
  assert.deepEqual(verdict, {
    action: 'resume',
    event: 'breakpoint.other-route',
    route: '/dashboard/invoices',
  })
})

// Value: protects=D18: an unreadable route pauses unconfirmed only while the browser is on the entry route; fails_when=it pauses elsewhere or is resumed on the entry route; no_claim=none beyond protects
test('an unreadable route pauses unconfirmed on the entry route and is resumed elsewhere', () => {
  // Arrange
  const unreadable = { state: 'unreadable' } as const
  // Act, Assert
  assert.deepEqual(
    serverRenderHitVerdictOf(hitOf({ renderedRoute: unreadable })),
    { action: 'pause', attribution: 'unconfirmed' },
  )
  assert.deepEqual(
    serverRenderHitVerdictOf(
      hitOf({ renderedRoute: unreadable, browserOnEntryRoute: false }),
    ),
    { action: 'resume', event: 'breakpoint.unattributed-resumed' },
  )
})

// Value: protects=F1 and AC 16: a React copy hit at an owned position and a later hit of a stop that paused are resumed before any route is considered; fails_when=they pause; no_claim=none beyond protects
test('a React copy hit and a repeat hit are resumed whatever the route says', () => {
  // Arrange, Act, Assert
  assert.deepEqual(
    serverRenderHitVerdictOf(hitOf({ isReactCopyAtOwnedStop: true })),
    { action: 'resume', event: 'breakpoint.react-copy' },
  )
  assert.deepEqual(
    serverRenderHitVerdictOf(hitOf({ stopAlreadyPaused: true })),
    { action: 'resume', event: 'breakpoint.repeat-hit' },
  )
})

// Value: protects=F1: only the fabricated copies carry the React prefix; fails_when=the real module script is taken for a copy; no_claim=none beyond protects
test('only about://React/Server scripts are React copies', () => {
  // Arrange, Act, Assert
  assert.equal(
    isReactServerCopyUrl(
      'about://React/Server/webpack-internal:///(rsc)/./app/ui/invoices/table.tsx?107',
    ),
    true,
  )
  assert.equal(
    isReactServerCopyUrl(
      'webpack-internal:///(rsc)/./app/ui/invoices/table.tsx',
    ),
    false,
  )
  assert.equal(isReactServerCopyUrl(undefined), false)
})

// Value: protects=AC 8/X2: an (rsc) instance reads server-render and any other server layer server-action; fails_when=a shared-layer stop paused in (rsc) reads server-action; no_claim=none beyond protects
test('the execution label follows the layer of the paused script', () => {
  // Arrange, Act, Assert
  assert.equal(
    serverExecutionOfScriptUrl('webpack-internal:///(rsc)/./app/lib/data.ts'),
    'server-render',
  )
  assert.equal(
    serverExecutionOfScriptUrl(
      'webpack-internal:///(action-browser)/./app/lib/actions.ts',
    ),
    'server-action',
  )
})

// Value: protects=D15: consecutive server stops of one group are armed as one set, a group change or a browser stop ends it; fails_when=a set spans two groups or swallows a browser stop; no_claim=none beyond protects
test('consecutive server stops of one group form one set', () => {
  // Arrange
  const stops = [
    { participant: 'server', group: 1 },
    { participant: 'server', group: 1 },
    { participant: 'browser', group: 1 },
    { participant: 'server', group: 2 },
  ] as const
  // Act, Assert
  assert.deepEqual(serverStopSetOf(stops, 0), [0, 1])
  assert.deepEqual(serverStopSetOf(stops, 2), [2])
  assert.deepEqual(serverStopSetOf(stops, 3), [3])
  assert.deepEqual(serverStopSetOf(stops, 4), [])
})
