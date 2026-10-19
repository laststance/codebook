import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isPageStubOfSource } from '../utils/isPageStubOfSource'

// Cycle 0046 (row 209): the page's stub of a server module is known by its script URL, in both forms a development build was seen to announce it; red if either form were missed, so that the stub's pause kept the short bound of a pause nobody owns.
test('a page script whose URL names a source file’s repository path right after the build’s root marker is that file’s stub, with or without the build’s leading "./" and with a query', () => {
  // Arrange: the URL as the native journal of check f21a holds it, as the test harness announces it, and with a query. The server stop's module is app/lib/actions.ts.
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

// Cycle 0046 (rows 209 and 272): the longer bound must not reach other scripts; red if another folder's file whose path ends like the source's, a folder whose name only ends like the source's first folder, a file whose name only ends like the source's, a script of no development build or a script without a URL were taken for the stub. Before row 272 the first and the sixth were: any script whose path ended with the source's path was the stub.
test('a page script of another folder whose path only ends like the source’s, of another file, of no development build and a script without a URL are not the stub', () => {
  // Arrange: the server stop's module is app/lib/actions.ts; every script is asked with that path.
  const urls = [
    'webpack-internal:///(app-pages-browser)/./vendor/app/lib/actions.ts',
    'webpack-internal:///(app-pages-browser)/./myapp/lib/actions.ts',
    'webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts',
    'webpack-internal:///(app-pages-browser)/./app/ui/login-form.tsx',
    'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts.map',
    'http://127.0.0.1:3000/app/lib/actions.ts',
    undefined,
  ]
  // Act
  const answers = urls.map((url) =>
    isPageStubOfSource(url, 'app/lib/actions.ts'),
  )
  // Assert
  assert.deepEqual(answers, [false, false, false, false, false, false, false])
})
