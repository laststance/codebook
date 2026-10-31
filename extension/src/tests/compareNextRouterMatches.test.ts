import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareNextRouterMatches } from '../utils/compareNextRouterMatches'

// Value: protects=an App key without a terminal /page (a route handler) is never cut by five characters into a page path that wins the router contest; fails_when=/blog/route is read as the page /blog and beats the Pages catch-all; why_new=Cycle 0066 task 18 (compareNextRouterMatches sliced /page from any key); seam=none; no_claim=which keys the App resolver passes to the contest (resolveNextClientManifest accepts only /page keys)
test('an App route handler key is no page, so it never wins the router contest over a Pages catch-all', () => {
  // Arrange
  const appKey = '/blog/route'
  const pagesRoute = '/[...slug]'
  // Act
  const winner = compareNextRouterMatches(appKey, pagesRoute, '/blog')
  // Assert
  assert.equal(winner, 'equal')
})
