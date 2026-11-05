import assert from 'node:assert/strict'
import { test } from 'node:test'

import { routeHandlerPathMatches } from '../utils/routeHandlerPathMatches'
import {
  isRouteFileInAppTree,
  routeHandlerRouteOf,
} from '../utils/routeHandlerRouteOf'

// Value: protects=E-T1 which files are route handlers: route.ts, route.js, route.tsx and route.jsx under app count; fails_when=an extension is missed so a route handler stop takes the server-action path and ends RUNTIME_FAILED; no_claim=that the file exports an HTTP method
test('route.ts, route.js, route.tsx and route.jsx under app are route handler files', () => {
  // Arrange
  const paths = [
    'app/api/todos/route.ts',
    'app/api/todos/route.js',
    'app/api/todos/route.tsx',
    'app/api/todos/route.jsx',
  ]
  // Act
  const routes = paths.map((path) => routeHandlerRouteOf(path))
  // Assert
  assert.deepEqual(routes, [
    { route: '/api/todos' },
    { route: '/api/todos' },
    { route: '/api/todos' },
    { route: '/api/todos' },
  ])
})

// Value: protects=E-T1 a file named route.ts outside the app tree is an ordinary server stop; fails_when=lib/route.ts or a Pages API file is refused or armed as a route handler; no_claim=Pages API routes (they keep NEXT_SERVER_ONLY_STOP)
test('a route.ts outside app, under a Pages folder or in a lib folder is no route handler', () => {
  // Arrange
  const paths = [
    'lib/route.ts',
    'src/lib/route.ts',
    'pages/api/route.ts',
    'src/pages/api/route.ts',
    'app/api/todos/route.mjs',
    'app/api/todos/routes.ts',
  ]
  // Act
  const routes = paths.map((path) => routeHandlerRouteOf(path))
  // Assert
  assert.deepEqual(routes, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

// Value: protects=E-T1 node_modules is never app source; fails_when=a route file below a node_modules folder counts as the app's own handler; no_claim=a node_modules folder above the package root
test('a route.ts below a node_modules folder is no route handler', () => {
  // Arrange
  const path = 'app/node_modules/pkg/api/route.ts'
  // Act
  const route = routeHandlerRouteOf(path)
  // Assert
  assert.equal(route, undefined)
})

// Value: protects=E-T1 the route pattern of src/app and app; fails_when=the pattern keeps the src/app prefix or loses the leading slash; no_claim=URL rewrites
test('the route pattern of a route file under app and src/app starts at the app folder', () => {
  // Arrange
  const paths = [
    'app/route.ts',
    'app/api/todos/route.ts',
    'src/app/api/wait/route.ts',
  ]
  // Act
  const routes = paths.map((path) => routeHandlerRouteOf(path)?.route)
  // Assert
  assert.deepEqual(routes, ['/', '/api/todos', '/api/wait'])
})

// Value: protects=E-T1 a route group is no URL segment; fails_when=the group name stays in the pattern so no browser request matches it; no_claim=parallel and intercepting routes
test('the route pattern drops route groups', () => {
  // Arrange
  const path = 'src/app/(shop)/(admin)/api/orders/route.ts'
  // Act
  const route = routeHandlerRouteOf(path)
  // Assert
  assert.deepEqual(route, { route: '/api/orders' })
})

// Value: protects=E-T1 dynamic and catch-all segments stay in the pattern; fails_when=they are dropped or rewritten so the pause names the wrong route; no_claim=the request's pathname (that is the browser's)
test('the route pattern keeps dynamic, catch-all and optional catch-all segments', () => {
  // Arrange
  const paths = [
    'app/api/boards/[id]/route.ts',
    'app/api/files/[...slug]/route.js',
    'app/api/docs/[[...slug]]/route.tsx',
  ]
  // Act
  const routes = paths.map((path) => routeHandlerRouteOf(path)?.route)
  // Assert
  assert.deepEqual(routes, [
    '/api/boards/[id]',
    '/api/files/[...slug]',
    '/api/docs/[[...slug]]',
  ])
})

// Value: protects=E-T1/R4 the request pathname is matched with the file's pattern; fails_when=a dynamic segment accepts a longer path or a static one accepts another name; no_claim=Next's full matcher (no rewrites, no locale)
test('a request pathname matches static, dynamic, catch-all and optional catch-all patterns', () => {
  // Arrange
  const cases = [
    ['/api/todos', '/api/todos'],
    ['/api/todos', '/api/todos/1'],
    ['/api/boards/[id]', '/api/boards/42'],
    ['/api/boards/[id]', '/api/boards'],
    ['/api/boards/[id]', '/api/boards/42/cards'],
    ['/api/files/[...slug]', '/api/files/a/b'],
    ['/api/files/[...slug]', '/api/files'],
    ['/api/docs/[[...slug]]', '/api/docs'],
  ] as const
  // Act
  const matches = cases.map(([route, pathname]) =>
    routeHandlerPathMatches(route, pathname),
  )
  // Assert
  assert.deepEqual(matches, [
    true,
    false,
    true,
    false,
    false,
    true,
    false,
    true,
  ])
})

// Value: protects=FX-B4 a private folder is not routed by Next, so its route.ts is an ordinary server stop; fails_when=app/_lib/route.ts is armed as /_lib; no_claim=private folders written as %5F
test('a route.ts under a private folder is no route handler', () => {
  // Arrange
  const paths = ['app/_lib/route.ts', 'app/api/_helpers/x/route.ts']
  // Act
  const routes = paths.map((path) => routeHandlerRouteOf(path))
  // Assert
  assert.deepEqual(routes, [undefined, undefined])
})

// Value: protects=FX-B5 a percent-encoded request segment matches the folder name it decodes to; fails_when=/caf%C3%A9 does not match the café folder, or a malformed escape matches; no_claim=encoded slashes
test('a percent-encoded request segment matches the decoded static folder', () => {
  // Arrange
  const cases = [
    ['/api/café', '/api/caf%C3%A9'],
    ['/api/café', '/api/caf%C3'],
    ['/api/boards/[id]', '/api/boards/%E0%A4%A'],
  ] as const
  // Act
  const matches = cases.map(([route, pathname]) =>
    routeHandlerPathMatches(route, pathname),
  )
  // Assert
  assert.deepEqual(matches, [true, false, true])
})

// Value: protects=R10/FX-B1 only a route file under an app tree inside a library counts as a route handler there; fails_when=packages/router/src/route.ts is refused, or a library app/api/x/route.ts is not; no_claim=whether the path is a library
test('a library helper named route.ts is no app route file but a library app route file is', () => {
  // Arrange
  const paths = [
    'packages/router/src/route.ts',
    'node_modules/pkg/lib/route.ts',
    'packages/ui/app/api/x/route.ts',
    'node_modules/pkg/src/app/api/x/route.ts',
  ]
  // Act
  const results = paths.map((path) => isRouteFileInAppTree(path))
  // Assert
  assert.deepEqual(results, [false, false, true, true])
})
