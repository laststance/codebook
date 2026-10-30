import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { resolveViteInstallation } from '../utils/resolveViteInstallation'

/** Creates a package root whose `node_modules/vite/package.json` holds the given manifest. */
async function workspaceWithVite(
  context: TestContext,
  manifest: Record<string, unknown> | string,
): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-vite-i-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'node_modules/vite'), { recursive: true })
  await writeFile(
    join(root, 'node_modules/vite/package.json'),
    typeof manifest === 'string'
      ? manifest
      : JSON.stringify({
          ...manifest,
          // Vite always exports its manifest; Node's resolution of `vite/package.json` needs it.
          ...(typeof manifest.exports === 'object'
            ? {
                exports: {
                  './package.json': './package.json',
                  ...manifest.exports,
                },
              }
            : {}),
        }),
  )
  return root
}

/** Reads the import entry the launcher would load, relative to the Vite folder. */
async function entryOf(
  context: TestContext,
  manifest: Record<string, unknown>,
): Promise<string> {
  const root = await workspaceWithVite(context, {
    version: '8.3.5',
    ...manifest,
  })
  const lookup = await resolveViteInstallation(root)
  assert.ok(lookup.found)
  return lookup.installation.entry.slice(
    join(root, 'node_modules/vite/').length,
  )
}

// Value: protects=the launcher imports the ESM entry of the app's own Vite whichever way its package.json names it (conditions, nested conditions, module, main); fails_when=the import condition is skipped for require/types, a nested condition object is read as a path, or the module/main fallback is lost; why_new=viteLauncher tests use one stub manifest shape; seam=none; no_claim=that the entry loads
test('finds the import entry of a Vite package from exports conditions, then module, then main', async (context) => {
  // Arrange / Act
  const entries = [
    await entryOf(context, {
      exports: {
        '.': { types: './t.d.ts', require: './c.cjs', import: './m.mjs' },
      },
    }),
    await entryOf(context, {
      exports: {
        '.': { import: { types: './t.d.ts', default: './deep.mjs' } },
      },
    }),
    await entryOf(context, {
      exports: { './package.json': './package.json', '.': { node: './n.mjs' } },
    }),
    await entryOf(context, { module: './legacy.mjs', main: './legacy.cjs' }),
    await entryOf(context, { main: './only-main.cjs' }),
  ]
  // Assert
  assert.deepEqual(entries, [
    'm.mjs',
    'deep.mjs',
    'n.mjs',
    'legacy.mjs',
    'only-main.cjs',
  ])
})

// Value: protects=a Vite package that names no importable entry or a manifest without a version stops the lookup with a message instead of launching a launcher that can never import; fails_when=the missing entry resolves to the package folder or the schema error is swallowed; why_new=no test fed the lookup a manifest without an entry or a version; seam=none; no_claim=how callers word the failure
test('a Vite package with no importable entry or a manifest without a version throws', async (context) => {
  // Arrange
  const noEntry = await workspaceWithVite(context, {
    version: '8.3.5',
    exports: { './x': './x.js' },
  })
  const broken = await workspaceWithVite(context, { name: 'vite' })
  // Act / Assert
  await assert.rejects(
    resolveViteInstallation(noEntry),
    /names no importable entry/,
  )
  await assert.rejects(resolveViteInstallation(broken))
})

// Value: protects=a Vite version the study schema would reject is refused at the start; fails_when=a non-semver or over-64-character version resolves; why_new=the version was unchecked; seam=none; no_claim=prerelease ordering
test('refuses a vite version that is not semver-like or longer than 64 characters', async (context) => {
  // Arrange
  const text = await workspaceWithVite(context, { version: 'latest' })
  const long = await workspaceWithVite(context, {
    version: `8.3.5-${'a'.repeat(64)}`,
  })
  const prerelease = await workspaceWithVite(context, {
    version: '8.0.0-beta.1',
    main: 'index.js',
  })
  // Act
  const textError = await resolveViteInstallation(text).catch((e: unknown) => e)
  const longError = await resolveViteInstallation(long).catch((e: unknown) => e)
  const accepted = await resolveViteInstallation(prerelease)
  // Assert
  assert.equal((textError as { code?: string }).code, 'VITE_UNSUPPORTED')
  assert.equal((longError as { code?: string }).code, 'VITE_UNSUPPORTED')
  assert.equal(accepted.found, true)
})
