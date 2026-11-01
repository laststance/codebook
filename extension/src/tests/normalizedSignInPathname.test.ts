import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizedSignInPathname } from '../utils/normalizedSignInPathname'

// protects=/login/ and /login name one sign-in route while the root path is never emptied; fails_when=a trailing slash survives, or "/" becomes ""; no_claim=case or locale handling
test('normalizedSignInPathname removes one trailing slash and keeps the root', () => {
  // Arrange
  const pathnames = ['/login/', '/login', '/', '/a//']
  // Act
  const normalized = pathnames.map((pathname) =>
    normalizedSignInPathname(pathname),
  )
  // Assert
  assert.deepEqual(normalized, ['/login', '/login', '/', '/a/'])
})
