import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pagesApiTargetOf } from '../utils/pagesApiTargetOf'

// Value: protects=review round: a req.url that starts with // keeps // in its pathname, as the browser tracker does, so the pause's target matches its request; fails_when=the url is resolved as protocol-relative (host api, pathname /data) and the hit is resumed as other-path; no_claim=absolute-form request targets
test('a request path starting with two slashes keeps them in its pathname and target', () => {
  // Arrange
  const urls = ['/api/data?clear=1', '//api/data?x=1']
  // Act
  const targets = urls.map(pagesApiTargetOf)
  // Assert
  assert.deepEqual(targets, [
    { pathname: '/api/data', target: '/api/data?clear=1' },
    { pathname: '//api/data', target: '//api/data?x=1' },
  ])
})
