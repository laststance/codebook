import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appRouteSegmentsOf } from '../utils/appRouteSegmentsOf'

// Value: protects=an App key names its URL segments without its terminal page segment; fails_when=the page segment is kept or a segment is lost; why_new=Cycle 0066 task 18 (appRouteSegmentsOf contract); seam=none; no_claim=matching the segments (compareNextRouterMatches, resolveNextClientManifest tests)
test('an App page key names its URL segments without the terminal page segment', () => {
  // Arrange
  const key = '/blog/[slug]/page'
  // Act
  const segments = appRouteSegmentsOf(key)
  // Assert
  assert.deepEqual(segments, ['blog', '[slug]'])
})

// Value: protects=the root App page names the path / with no segments; fails_when=the root key gives an empty-string segment or undefined; why_new=Cycle 0066 task 18 (appRouteSegmentsOf contract); seam=none; no_claim=none
test('the root App page key names the path / with no segments', () => {
  // Arrange
  const key = '/page'
  // Act
  const segments = appRouteSegmentsOf(key)
  // Assert
  assert.deepEqual(segments, [])
})

// Value: protects=only a key with a terminal /page names a page, so a route handler key or a bare segment is never read as one; fails_when=a key without /page gives segments; why_new=Cycle 0066 task 18 (appRouteSegmentsOf contract); seam=none; no_claim=none
for (const key of ['/api/hello/route', '/blog/pages', '/blog', 'page'])
  test(`the App key ${key} without a terminal /page names no page`, () => {
    // Arrange / Act
    const segments = appRouteSegmentsOf(key)
    // Assert
    assert.equal(segments, undefined)
  })

// Value: protects=route groups name no URL segment, as Next drops them; fails_when=a group segment is kept; why_new=Cycle 0066 task 18 (appRouteSegmentsOf contract, groups as resolveNextClientManifest dropped them); seam=none; no_claim=none
test('route groups in an App key name no URL segment', () => {
  // Arrange
  const key = '/(shop)/(checkout)/cart/[id]/page'
  // Act
  const segments = appRouteSegmentsOf(key)
  // Assert
  assert.deepEqual(segments, ['cart', '[id]'])
})

// Value: protects=only the terminal /page is cut, so a page folder named page stays a URL segment; fails_when=every page segment is removed; why_new=Cycle 0066 task 18 (appRouteSegmentsOf contract); seam=none; no_claim=none
test('a folder named page inside an App key stays a URL segment', () => {
  // Arrange
  const key = '/docs/page/page'
  // Act
  const segments = appRouteSegmentsOf(key)
  // Assert
  assert.deepEqual(segments, ['docs', 'page'])
})

// Value: protects=a parallel route slot stays a segment, unchanged from the App matcher before the helper; fails_when=the @slot segment is dropped or changed; why_new=Cycle 0066 task 18 (appRouteSegmentsOf contract: @slot handling unchanged, not in scope); seam=none; no_claim=how Next serves a parallel route
test('a parallel route slot in an App key stays a segment as before', () => {
  // Arrange
  const key = '/dashboard/@team/page'
  // Act
  const segments = appRouteSegmentsOf(key)
  // Assert
  assert.deepEqual(segments, ['dashboard', '@team'])
})
