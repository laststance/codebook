import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/**
 * Writes the given files into a project folder and answers the Wiki manifest of one overview page that indexes all of them.
 * Called by every test of the renderer's credential-file check.
 * @param root - The project folder.
 * @param files - File text by relative path; every one is an included source.
 * @param citedPaths - The included files the overview page cites at line 1.
 * @returns The manifest, as an agent writes it into a candidate.
 * @example await manifestOf(root, { 'a.ts': 'export const a = 1;\n' }, ['a.ts'])
 */
async function manifestOf(root, files, citedPaths) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    generated: { revision: 'abcdef1', at: '2026-11-11' },
    includedSources: Object.entries(files).map(([path, text]) => ({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
    })),
    pages: [
      {
        path: 'index.html',
        title: 'Overview',
        section: 'Guide',
        contentHtml: '<h2 id="flow">Flow</h2><p>Text.</p>',
        sources: citedPaths.map((path) => ({ path, line: 1 })),
        outline: [{ id: 'flow', label: 'Flow' }],
      },
    ],
  }
}

/**
 * Renders a manifest and tells whether the renderer accepted it.
 * Called by the tests below to compare the accepted and the refused case.
 * @param manifest - The manifest to render.
 * @param root - The project folder.
 * @returns `rendered`, or the refusal's message.
 * @example await outcomeOf(manifest, root) // => 'rendered'
 */
async function outcomeOf(manifest, root) {
  return renderWikiPages(manifest, {
    projectRoot: root,
    outputDirectory: join(root, '.codebook/wiki'),
  }).then(
    () => 'rendered',
    (error) => error.message,
  )
}

/**
 * Runs a test body in a fresh real project folder and removes it afterwards.
 * Called by every test below.
 * @param body - The test body, given the folder.
 * @example await inProject(async (root) => {})
 */
async function inProject(body) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-credentials-')),
  )
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const CODE = 'export const a = 1;\n'
const ENVIRONMENT =
  'VITE_APP_TITLE=Readlist\nACCESS_TOKEN_SECRET=fixture-only\n'

// Value: protects=the owner of a repository whose tracked environment files hold credentials: in Cycle 0116 Cursor's agent excluded .env but indexed the tracked .env.e2e and .env.test of P07 nsx, so the published Wiki hashed them and could cite them; fails_when=the renderer publishes a Wiki whose includedSources names a tracked environment file, or the refusal does not name each file; why_new=Cycle 0116 (H1 E2, credential check); seam=none (the real renderer); no_claim=that the agent never read the file's values while it explored the repository
test('a Wiki whose source index holds tracked environment files is refused, and the refusal names each file', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        'a.ts': CODE,
        '.env.e2e': ENVIRONMENT,
        'browser-extension/.env.production': ENVIRONMENT,
      },
      ['a.ts'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      "The Wiki's source index holds 2 files that can hold credentials: .env.e2e, browser-extension/.env.production. Remove each from includedSources and list it under excludedPaths; a Wiki never indexes environment files, private keys or password files.",
    )
  })
})

// Value: protects=every credential file shape the refusal promises in the packaged README (environment files, private keys and key stores, SSH private keys, npm, netrc and PostgreSQL password files), whatever the letter case; fails_when=one of these names is indexed and published, or the refusal stops naming them in sorted order; why_new=Cycle 0116; seam=none (the real renderer); no_claim=that a file with another name holds no credential
test('every credential-shaped file name in the source index is refused, in any letter case', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        'a.ts': CODE,
        '.env': ENVIRONMENT,
        'server/.ENV.local': ENVIRONMENT,
        'certs/site.pem': 'certificate\n',
        'certs/site.KEY': 'key\n',
        'store/release.p12': 'store\n',
        'store/app.pfx': 'store\n',
        'android/app.jks': 'store\n',
        'android/debug.keystore': 'store\n',
        'deploy/id_ed25519': 'key\n',
        '.npmrc': 'registry token\n',
        '.netrc': 'machine login\n',
        '.pgpass': 'host:port:db:user:password\n',
      },
      ['a.ts'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      "The Wiki's source index holds 12 files that can hold credentials: .env, .netrc, .npmrc, .pgpass, android/app.jks, android/debug.keystore, certs/site.KEY, certs/site.pem, deploy/id_ed25519, server/.ENV.local, store/app.pfx, store/release.p12. Remove each from includedSources and list it under excludedPaths; a Wiki never indexes environment files, private keys or password files.",
    )
  })
})

// Value: protects=a learner whose repository holds code and documents named like configuration (P07 nsx has env.ts files that read the environment): they stay in the Wiki and are explained; fails_when=the credential check refuses a code file named env.ts, environment.ts or pem.ts, a document named keys.md, or an SSH public key; why_new=Cycle 0116; seam=none (the real renderer); no_claim=that these files hold no secret value
test('code and documents whose names only resemble credential files stay indexed, and the Wiki renders', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        'env.ts': CODE,
        'server/env.ts': CODE,
        'src/environment.ts': CODE,
        'src/pem.ts': CODE,
        'docs/keys.md': '# Keys\n',
        'deploy/id_ed25519.pub': 'ssh-ed25519 AAAA public\n',
      },
      ['env.ts', 'server/env.ts', 'src/environment.ts', 'src/pem.ts'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})
