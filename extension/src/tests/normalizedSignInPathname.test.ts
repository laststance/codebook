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

// protects=OCR 24 and OCR 1: a pathname is written as the browser reports location.pathname, and a leading // stays a path; fails_when=/ログイン keeps its raw characters (never equal to the page's pathname), an existing escape is changed, or //x/login loses its first segment to a host; no_claim=Chrome's own canonicalization beyond the URL parser
test('normalizedSignInPathname percent-encodes non-ASCII characters and keeps a leading double slash a path', () => {
  // Arrange
  const pathnames = [
    '/ログイン/',
    '/%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3',
    '//x/login',
  ]
  // Act
  const normalized = pathnames.map((pathname) =>
    normalizedSignInPathname(pathname),
  )
  // Assert
  assert.deepEqual(normalized, [
    '/%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3',
    '/%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3',
    '//x/login',
  ])
})
