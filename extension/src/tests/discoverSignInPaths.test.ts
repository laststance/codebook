import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { discoverSignInPaths } from '../utils/discoverSignInPaths'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'

/** Makes a temp repository holding the given files (paths relative, contents given). */
async function repository(
  context: TestContext,
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codebook-signin-paths-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), contents)
  }
  return root
}

const signal = new AbortController().signal

// protects=DX-14 (first setup offers the app's own route first); fails_when=an existing route is missed, a missing one is offered, or the candidate order changes; no_claim=custom pageExtensions, Next route manifests
test('a Next repository offers its own /login and /sign-in routes, App routes also under a route group, in the usual order', async (context) => {
  // Arrange
  const root = await repository(context, {
    'app/login/page.tsx': 'export default function Page() { return null }',
    'app/(auth)/sign-in/page.tsx':
      'export default function Page() { return null }',
    'app/dashboard/page.tsx': '',
  })
  // Act
  const paths = await discoverSignInPaths(root, 'next-dev-webpack', signal)
  // Assert
  assert.deepEqual(paths, ['/login', '/sign-in'])
})

// protects=DX-14 Pages Router; fails_when=pages/signin.tsx or pages/auth/signin/index.js is missed; no_claim=dynamic segments
test('a Next Pages Router repository offers /signin and /auth/signin from its page files', async (context) => {
  // Arrange
  const root = await repository(context, {
    'src/pages/signin.tsx': '',
    'src/pages/auth/signin/index.js': '',
  })
  // Act
  const paths = await discoverSignInPaths(root, 'next-dev-webpack', signal)
  // Assert
  assert.deepEqual(paths, ['/signin', '/auth/signin'])
})

// protects=no link is followed out of the workspace; fails_when=a symlinked login folder counts as a route; no_claim=Windows junctions
test('a linked login folder is not offered as a route', async (context) => {
  // Arrange
  const root = await repository(context, { 'elsewhere/login/page.tsx': '' })
  await mkdir(join(root, 'app'), { recursive: true })
  await symlink(join(root, 'elsewhere/login'), join(root, 'app/login'))
  // Act
  const paths = await discoverSignInPaths(root, 'next-dev-webpack', signal)
  // Assert
  assert.deepEqual(paths, [])
})

// protects=OCR 49 (discovery is only a hint, so Codebook: Set Up Saved Session… still reaches the path question); fails_when=a route group whose folder this user cannot read makes discovery reject instead of offering the routes it could read; no_claim=Windows ACLs, a root user (who reads every folder)
test(
  'a Next route group this user cannot read hides its routes and still offers the readable /login',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async (context) => {
    // Arrange
    const root = await repository(context, {
      'app/login/page.tsx': '',
      'app/(admin)/sign-in/page.tsx': '',
    })
    const lockedGroup = join(root, 'app/(admin)')
    await chmod(lockedGroup, 0o000)
    // Act
    const paths = await discoverSignInPaths(
      root,
      'next-dev-webpack',
      signal,
    ).finally(() => chmod(lockedGroup, 0o755))
    // Assert
    assert.deepEqual(paths, ['/login'])
  },
)

// protects=DX-14 Vite (no route files); fails_when=a quoted literal is missed or a literal in node_modules counts; no_claim=router-specific syntax
test('a Vite repository offers a sign-in path that src names as a quoted literal and ignores node_modules', async (context) => {
  // Arrange
  const root = await repository(context, {
    'src/routes.tsx':
      "export const routes = [{ path: '/signin', element: null }]",
    'src/node_modules/x/index.ts': "const p = '/login'",
  })
  // Act
  const paths = await discoverSignInPaths(root, 'vite-dev', signal)
  // Assert
  assert.deepEqual(paths, ['/signin'])
})

// protects=red-team native 7 (the Vite scan never reads files outside the repository); fails_when=a `src` that is a link to a folder outside the repository is walked and its quoted /login offered; no_claim=a link swapped in while the scan runs, Windows volume junctions (covered by isFolderOfItsOwn's own tests)
test('a Vite repository whose src is a link to a folder outside it offers no sign-in path from that folder', async (context) => {
  // Arrange
  const outside = await repository(context, {
    'routes.tsx': "export const routes = [{ path: '/login', element: null }]",
  })
  const root = await repository(context, { 'package.json': '{}' })
  if (!(await createLinkIfAllowed(outside, join(root, 'src'))))
    return context.skip(LINK_NOT_ALLOWED)
  // Act
  const paths = await discoverSignInPaths(root, 'vite-dev', signal)
  // Assert
  assert.deepEqual(paths, [])
})

// protects=the no-follow rule below a Vite src; fails_when=a linked folder inside src is walked and its quoted /login offered beside the real /signin; no_claim=Windows volume junctions
test('a Vite repository offers the sign-in path of its own src and none from a linked folder inside it', async (context) => {
  // Arrange
  const outside = await repository(context, {
    'routes.tsx': "export const routes = [{ path: '/login', element: null }]",
  })
  const root = await repository(context, {
    'src/routes.tsx':
      "export const routes = [{ path: '/signin', element: null }]",
  })
  if (!(await createLinkIfAllowed(outside, join(root, 'src/linked'))))
    return context.skip(LINK_NOT_ALLOWED)
  // Act
  const paths = await discoverSignInPaths(root, 'vite-dev', signal)
  // Assert
  assert.deepEqual(paths, ['/signin'])
})
