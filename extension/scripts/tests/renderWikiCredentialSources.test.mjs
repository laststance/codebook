import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
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

const REFUSAL_TAIL =
  'Remove each from includedSources and list it under excludedPaths; a Wiki never indexes environment files, private keys or password files.'

// Value: protects=every credential file shape the refusal promises in the packaged README and the skill (environment files and folders, private keys, key stores and variables files, every SSH private key, the npm, netrc, PostgreSQL, PyPI, htpasswd, git and cloud credential files), whatever the letter case; fails_when=one of these names is indexed and published, or the refusal stops naming them in sorted code-unit order; why_new=Cycle 0116 (H1 E2 and the review round's name gaps); seam=none (the real renderer); no_claim=that a file with another name holds no credential
test('every credential-shaped file name or folder in the source index is refused, in any letter case', async () => {
  await inProject(async (root) => {
    // Arrange
    const shapes = [
      '.env',
      'server/.ENV.local',
      '.env-local',
      '.env_prod',
      '.env-example',
      'deploy/production.env',
      '.envrc',
      '.dev.vars',
      'config/.env/db.ts',
      'certs/site.pem',
      'certs/.pem',
      'certs/site.KEY',
      'store/release.p12',
      'store/app.pfx',
      'android/app.jks',
      'android/debug.keystore',
      'apple/AuthKey.p8',
      'putty/server.ppk',
      'infra/prod.tfvars',
      'deploy/id_rsa',
      'deploy/id_dsa',
      'deploy/id_ecdsa',
      'deploy/id_ed25519',
      'deploy/id_ed25519_sk',
      '.npmrc',
      '.netrc',
      '.pgpass',
      '.pypirc',
      '.htpasswd',
      '.git-credentials',
      '.aws/credentials',
      'gcp/credentials.json',
    ]
    const manifest = await manifestOf(
      root,
      Object.fromEntries([
        ['a.ts', CODE],
        ...shapes.map((path) => [path, 'value\n']),
      ]),
      ['a.ts'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      `The Wiki's source index holds 32 files that can hold credentials: .aws/credentials, .dev.vars, .env, .env-example, .env-local, .env_prod, .envrc, .git-credentials, .htpasswd, .netrc, .npmrc, .pgpass, .pypirc, android/app.jks, android/debug.keystore, apple/AuthKey.p8, certs/.pem, certs/site.KEY, certs/site.pem, config/.env/db.ts, deploy/id_dsa, deploy/id_ecdsa, deploy/id_ed25519, deploy/id_ed25519_sk, deploy/id_rsa, deploy/production.env, gcp/credentials.json, infra/prod.tfvars, putty/server.ppk, server/.ENV.local, store/app.pfx, store/release.p12. ${REFUSAL_TAIL}`,
    )
  })
})

// Value: protects=the refusal a chat reads when one environment file slipped into the index: the singular wording names the one file; fails_when=the refusal says "1 files" or names nothing; why_new=Cycle 0116 review round (the singular branch was untested); seam=none (the real renderer); no_claim=the wording of other refusals
test('a Wiki that indexes one environment file is refused in the singular, naming that file', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      { 'a.ts': CODE, '.env.test': ENVIRONMENT },
      ['a.ts'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      `The Wiki's source index holds 1 file that can hold credentials: .env.test. ${REFUSAL_TAIL}`,
    )
  })
})

// Value: protects=a readable refusal for a repository with many keys: the first 40 credential files are named in order and the rest are counted; fails_when=the refusal names all 43 files or drops the count of the 3 more; why_new=Cycle 0116 review round (the truncation clause was untested); seam=none (the real renderer); no_claim=which 40 files a chat fixes first
test('the credential refusal names the first 40 of 43 files and counts the 3 more', async () => {
  await inProject(async (root) => {
    // Arrange
    const keys = Array.from(
      { length: 43 },
      (_, index) => `keys/k${String(index + 1).padStart(2, '0')}.pem`,
    )
    const manifest = await manifestOf(
      root,
      Object.fromEntries([
        ['a.ts', CODE],
        ...keys.map((path) => [path, 'key\n']),
      ]),
      ['a.ts'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      `The Wiki's source index holds 43 files that can hold credentials: keys/k01.pem, keys/k02.pem, keys/k03.pem, keys/k04.pem, keys/k05.pem, keys/k06.pem, keys/k07.pem, keys/k08.pem, keys/k09.pem, keys/k10.pem, keys/k11.pem, keys/k12.pem, keys/k13.pem, keys/k14.pem, keys/k15.pem, keys/k16.pem, keys/k17.pem, keys/k18.pem, keys/k19.pem, keys/k20.pem, keys/k21.pem, keys/k22.pem, keys/k23.pem, keys/k24.pem, keys/k25.pem, keys/k26.pem, keys/k27.pem, keys/k28.pem, keys/k29.pem, keys/k30.pem, keys/k31.pem, keys/k32.pem, keys/k33.pem, keys/k34.pem, keys/k35.pem, keys/k36.pem, keys/k37.pem, keys/k38.pem, keys/k39.pem, keys/k40.pem, and 3 more. ${REFUSAL_TAIL}`,
    )
  })
})

// Value: protects=the published site: a page that cites an environment file is refused before any page is written; fails_when=a Wiki citing .env.test at a line renders, or the refusal leaves a .codebook/wiki folder behind; why_new=Cycle 0116 review round (a cited credential file was untested); seam=none (the real renderer and file system); no_claim=what the publisher does with an earlier published Wiki
test('a Wiki whose page cites an environment file is refused, and nothing is written', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      { 'a.ts': CODE, '.env.test': ENVIRONMENT },
      ['a.ts', '.env.test'],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)
    const written = await access(join(root, '.codebook/wiki')).then(
      () => 'written',
      () => 'absent',
    )

    // Assert
    assert.equal(
      outcome,
      `The Wiki's source index holds 1 file that can hold credentials: .env.test. ${REFUSAL_TAIL}`,
    )
    assert.equal(written, 'absent')
  })
})

// Value: protects=the owner's secrets when a code-looking path is a link to an environment file: the file a cited path resolves to is checked, not only the path's name; fails_when=a page that cites config/prod.ts, a link to .env.test, renders and quotes the environment file; why_new=Cycle 0116 review round (OCR renderer lens: a symlink bypass); seam=none (the real renderer and a real symbolic link); no_claim=links outside the repository, which the source reader refuses on its own
test('a cited code path that is a link to an environment file is refused by the file it resolves to', async () => {
  await inProject(async (root) => {
    // Arrange
    await writeFile(join(root, '.env.test'), ENVIRONMENT)
    await mkdir(join(root, 'config'), { recursive: true })
    await symlink('../.env.test', join(root, 'config/prod.ts'))
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.includedSources.push({
      path: 'config/prod.ts',
      sha256: createHash('sha256').update(ENVIRONMENT).digest('hex'),
    })
    manifest.pages[0].sources.push({ path: 'config/prod.ts', line: 1 })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      `The Wiki's source index holds 1 file that can hold credentials: config/prod.ts (it resolves to .env.test). ${REFUSAL_TAIL}`,
    )
  })
})

// Value: protects=the owner's secrets when an indexed path that no page cites is a link to an environment file: Wiki answers read every indexed file, so the file it resolves to is checked too; fails_when=config/runtime.json, a link to .env.test, is indexed but uncited and the Wiki renders; why_new=Cycle 0116 /ship outside voice (High); seam=none (the real renderer and a real symbolic link); no_claim=links to files with other names
test('an indexed path that no page cites but that links to an environment file is refused', async () => {
  await inProject(async (root) => {
    // Arrange
    await writeFile(join(root, '.env.test'), ENVIRONMENT)
    await mkdir(join(root, 'config'), { recursive: true })
    await symlink('../.env.test', join(root, 'config/runtime.json'))
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.includedSources.push({
      path: 'config/runtime.json',
      sha256: createHash('sha256').update(ENVIRONMENT).digest('hex'),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      `The Wiki's source index holds 1 file that can hold credentials: config/runtime.json (it resolves to .env.test). ${REFUSAL_TAIL}`,
    )
  })
})

// Value: protects=an update of a Wiki whose index still names a file deleted from the checkout: the credential check that resolves every indexed path skips a path that names no file instead of failing the render; fails_when=the missing index entry makes the renderer throw ENOENT; why_new=Cycle 0116 /ship pass 1 fix (every indexed path is resolved); seam=none (the real renderer); no_claim=how the Wiki's freshness shows the deleted file
test('an indexed file that no longer exists in the checkout does not trip the credential check', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.includedSources.push({
      path: 'docs/removed.md',
      sha256: createHash('sha256').update('# Removed\n').digest('hex'),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the owner's secrets when an update moves an environment file to excludedPaths but a page's text still links to it: the link would publish its path and hash; fails_when=a page keeps an editor link to the excluded .env.test and the Wiki renders; why_new=Cycle 0116 /ship outside voice and Codex structured review, reproduced by QA probe 004; seam=none (the real renderer); no_claim=links to files with other names
test('a page whose text links to an excluded environment file is refused, naming the page and the file', async () => {
  await inProject(async (root) => {
    // Arrange
    await writeFile(join(root, '.env.test'), ENVIRONMENT)
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.excludedPaths = ['.env.test']
    manifest.pages[0].contentHtml +=
      '<p>Settings come from <a href="vscode://laststance.codebook/source?path=.env.test&amp;line=1">the test environment</a>.</p>'

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'A page links to 1 file that can hold credentials: index.html → .env.test. Remove each link; a Wiki never cites environment files, private keys or password files.',
    )
  })
})

// Value: protects=the owner's secrets when a page spells its link to an environment file so that its last name is not the file's: the editor's source handler opens realpath(join(root, path)), so .env.test/x/.. opens .env.test; fails_when=a page links to .env.test/x/.. and the Wiki renders; why_new=Cycle 0116 /ship pass 2 Red Team (unnormalized link spellings); seam=none (the real renderer); no_claim=spellings the editor's handler does not open, such as a trailing slash after a file
test('a page link spelled to end in a parent folder step that opens an environment file is refused, naming the file it opens', async () => {
  await inProject(async (root) => {
    // Arrange
    await writeFile(join(root, '.env.test'), ENVIRONMENT)
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.excludedPaths = ['.env.test']
    manifest.pages[0].contentHtml +=
      '<p>Settings come from <a href="vscode://laststance.codebook/source?path=.env.test/x/..&amp;line=1">the test environment</a>.</p>'

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'A page links to 1 file that can hold credentials: index.html → .env.test/x/.. (it resolves to .env.test). Remove each link; a Wiki never cites environment files, private keys or password files.',
    )
  })
})

// Value: protects=the owner's secrets when a page links to a code-looking path that is not indexed but is a link to an environment file: the editor would open the environment file from the published page; fails_when=a page links to config/runtime.json, an unindexed link to .env.test, and the Wiki renders; why_new=Cycle 0116 /ship pass 2 security specialist (unindexed page links were not resolved); seam=none (the real renderer and a real symbolic link); no_claim=links to files with other names
test('a page link to an unindexed path that is a link to an environment file is refused, naming the file it reaches', async () => {
  await inProject(async (root) => {
    // Arrange
    await writeFile(join(root, '.env.test'), ENVIRONMENT)
    await mkdir(join(root, 'config'), { recursive: true })
    await symlink('../.env.test', join(root, 'config/runtime.json'))
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.pages[0].contentHtml +=
      '<p>Runtime settings live in <a href="vscode://laststance.codebook/source?path=config/runtime.json&amp;line=1">the runtime file</a>.</p>'

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'A page links to 1 file that can hold credentials: index.html → config/runtime.json (it resolves to .env.test). Remove each link; a Wiki never cites environment files, private keys or password files.',
    )
  })
})

// Value: protects=an update of a Wiki whose index names a symbolic link that loops back on itself: such a path opens no file in the editor or in the Wiki's answers, so the credential check skips it instead of failing the render with the system's ELOOP error; fails_when=the looping index entry makes the renderer throw; why_new=Cycle 0116 /ship pass 2 API-contract specialist (raw fs errors from the credential pre-pass); seam=none (the real renderer and a real symbolic link); no_claim=how the Wiki's freshness shows the broken entry
test('an indexed path that is a link looping back on itself does not stop the render', async () => {
  await inProject(async (root) => {
    // Arrange
    await mkdir(join(root, 'docs'), { recursive: true })
    await symlink('loop.md', join(root, 'docs/loop.md'))
    const manifest = await manifestOf(root, { 'a.ts': CODE }, ['a.ts'])
    manifest.includedSources.push({
      path: 'docs/loop.md',
      sha256: createHash('sha256').update('# Loop\n').digest('hex'),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a learner whose repository holds code and documents named like configuration (P07 nsx has env.ts files that read the environment): they stay in the Wiki and are explained; fails_when=the credential check refuses a code file named env.ts, environment.ts, envelope.ts, pem.ts, key.ts, credentialsForm.tsx or vite-env.d.ts, a document named keys.md, a dotfile named .envelope, or an SSH public key; why_new=Cycle 0116; seam=none (the real renderer); no_claim=that these files hold no secret value
test('code and documents whose names only resemble credential files stay indexed, and the Wiki renders', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        'env.ts': CODE,
        'server/env.ts': CODE,
        'src/environment.ts': CODE,
        'src/envelope.ts': CODE,
        'src/pem.ts': CODE,
        'src/key.ts': CODE,
        'src/credentialsForm.tsx': CODE,
        'src/vite-env.d.ts': CODE,
        'docs/keys.md': '# Keys\n',
        '.envelope': 'notes\n',
        'deploy/id_rsa.pub': 'ssh-rsa AAAA public\n',
        'deploy/id_ed25519.pub': 'ssh-ed25519 AAAA public\n',
      },
      [
        'env.ts',
        'server/env.ts',
        'src/environment.ts',
        'src/envelope.ts',
        'src/pem.ts',
        'src/key.ts',
        'src/credentialsForm.tsx',
        'src/vite-env.d.ts',
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})
