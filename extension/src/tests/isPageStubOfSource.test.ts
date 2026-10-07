import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isPageStubOfSource } from '../utils/isPageStubOfSource'

// Cycle 0046 (row 209): the page's stub of a server module is known by its script URL, in both forms a development build was seen to announce it; red if either form were missed, so that the stub's pause kept the short bound of a pause nobody owns.
test('a page script whose URL ends with a source file’s repository path is that file’s stub, with or without the build’s leading "./" and with a query', () => {
  // Arrange: the URL as the native journal of check f21a holds it, as the test harness announces it, and with a query.
  const urls = [
    'webpack-internal:///(app-pages-browser)/app/lib/actions.ts',
    'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts',
    'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts?1a2b',
  ]
  // Act
  const answers = urls.map((url) =>
    isPageStubOfSource(url, 'app/lib/actions.ts'),
  )
  // Assert
  assert.deepEqual(answers, [true, true, true])
})

// Cycle 0046 (row 209): the longer bound must not reach other scripts; red if a file whose name only ends like the source's, another folder's file of that name, or a script without a URL were taken for the stub.
test('a page script of another file, also one whose name only ends like the source’s, and a script without a URL are not the stub', () => {
  // Arrange: the server stop's module is app/lib/actions.ts.
  const urls = [
    'webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts',
    'webpack-internal:///(app-pages-browser)/./app/ui/login-form.tsx',
    'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts.map',
    undefined,
  ]
  // Act
  const answers = [
    isPageStubOfSource(urls[0], 'actions.ts'),
    isPageStubOfSource(urls[1], 'app/lib/actions.ts'),
    isPageStubOfSource(urls[2], 'app/lib/actions.ts'),
    isPageStubOfSource(urls[3], 'app/lib/actions.ts'),
  ]
  // Assert
  assert.deepEqual(answers, [false, false, false, false])
})
