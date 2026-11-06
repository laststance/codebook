import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pagesApiRouteOf } from '../utils/pagesApiRouteOf'

// Value: protects=a file under src/pages/api is an API route named by its path; fails_when=the extension stays in the route, the folder is not stripped or an other extension counts; no_claim=a custom pageExtensions source (out of scope)
test('a file under the pages api folder gives its route without the extension', () => {
  // Arrange
  const file = 'src/pages/api/projects.ts'
  // Act
  const result = pagesApiRouteOf(file, 'src/pages')
  // Assert
  assert.deepEqual(result, { route: '/api/projects' })
  assert.equal(pagesApiRouteOf('pages/api/projects.mjs', 'pages'), undefined)
})

// Value: protects=index files and api.<ext> are the folder itself (/api); fails_when=pages/api/index.ts reads /api/index or api.js is not an API route; no_claim=route precedence between api.ts and api/index.ts (Next decides)
test('api index files and api.js beside the pages folder are the /api route', () => {
  // Arrange
  const files = ['pages/api/index.tsx', 'pages/api.js']
  // Act
  const routes = files.map((file) => pagesApiRouteOf(file, 'pages')?.route)
  // Assert
  assert.deepEqual(routes, ['/api', '/api'])
})

// Value: protects=nested folders and every dynamic form stay in the pattern; fails_when=[id], [...slug] or [[...slug]] is dropped or index is removed from a nested folder wrongly; no_claim=request matching (routeHandlerPathMatches tests)
test('nested folders and dynamic segments stay in the route pattern', () => {
  // Arrange
  const files = [
    'src/pages/api/users/[id].js',
    'src/pages/api/files/[...slug].ts',
    'src/pages/api/docs/[[...slug]].jsx',
    'src/pages/api/users/index.ts',
  ]
  // Act
  const routes = files.map((file) => pagesApiRouteOf(file, 'src/pages')?.route)
  // Assert
  assert.deepEqual(routes, [
    '/api/users/[id]',
    '/api/files/[...slug]',
    '/api/docs/[[...slug]]',
    '/api/users',
  ])
})

// Value: protects=pages, _document and files of another folder are no API route; fails_when=any non-API file is armed as an API route (it would be armed and never paused); no_claim=a file below node_modules in the pages folder is refused elsewhere
test('pages, _document, files outside the pages api folder and node_modules are no API route', () => {
  // Arrange
  const files = [
    'src/pages/index.tsx',
    'src/pages/_document.tsx',
    'src/pages/apiary/list.ts',
    'src/lib/api/data.ts',
    'src/pages/api/node_modules/x/y.ts',
  ]
  // Act
  const routes = files.map((file) => pagesApiRouteOf(file, 'src/pages'))
  // Assert
  assert.deepEqual(routes, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})
