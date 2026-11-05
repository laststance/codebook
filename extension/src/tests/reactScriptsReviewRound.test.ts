import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { StudyError } from '../errors'
import { assessReactScriptsWorkspace } from '../utils/assessReactScriptsWorkspace'
import { parseReactScriptsStartScript } from '../utils/parseReactScriptsStartScript'
import { readRepositoryAdapterReadiness } from '../utils/readRepositoryAdapterReadiness'
import { resolveReactScriptsPackage } from '../utils/resolveReactScriptsPackage'
import { scanPackages } from '../utils/scanNextPackages'

import { createReactScriptsRepository } from './utils/reactScriptsFixture'

const executeFile = promisify(execFile)
const SIGNAL = new AbortController().signal
const SECRET = 'abc123-secret'

/** Makes a temporary Git repository (real path) that is removed when the test ends. */
async function makeRepository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-react-scripts-review-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await executeFile('git', ['init', '--quiet', root])
  return root
}

/** Writes a file below the root, creating its folders. */
async function put(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

// Value: protects=B1: a refused start script is described by structure, so an assignment value (a token) never reaches status or a refusal; fails_when=the script text or any assignment value appears in the refused descriptions; no_claim=that the structure text reads well in the refusal sentence
test('a refused start script never echoes an assignment value', () => {
  // Arrange
  const scripts = [
    `API_TOKEN=${SECRET} cross-env react-scripts start`,
    `API_TOKEN=${SECRET} react-scripts start --open`,
    `TOKEN=$(echo ${SECRET}) react-scripts start`,
    `A=1 node ${SECRET}.js`,
    `API_TOKEN=${SECRET} ${SECRET}-wrapper start`,
  ]
  // Act
  const readings = scripts.map((script) => parseReactScriptsStartScript(script))
  // Assert
  assert.equal(JSON.stringify(readings).includes(SECRET), false)
  assert.deepEqual(
    readings.map((reading) => reading.readiness),
    [
      { form: 'refused', refused: ['the command word cross-env'] },
      {
        form: 'refused',
        refused: ['extra words after react-scripts start'],
      },
      {
        form: 'refused',
        refused: [
          'the assignment TOKEN with a value with shell syntax ($ ()',
          'a word with shell syntax ())',
        ],
      },
      { form: 'refused', refused: ['the command word node'] },
      {
        form: 'refused',
        refused: [
          'the command word … (the script must start with react-scripts)',
        ],
      },
    ],
  )
})

// Value: protects=B1: status and the start refusal of a secret-bearing script contain no secret; fails_when=codebook_status JSON, the refusal message or its details hold the assignment value; no_claim=other fields of the refusal
test('status and the start refusal of a script with a secret assignment hold no secret', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
    startScript: () => `API_TOKEN=${SECRET} cross-env react-scripts start`,
  })
  const resolved = await resolveReactScriptsPackage(repository.root, undefined)
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    repository.root,
    process.execPath,
    SIGNAL,
  )
  const refusal = await assessReactScriptsWorkspace(resolved).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(refusal instanceof StudyError, true)
  assert.equal(
    JSON.stringify(readiness['react-scripts-dev']).includes(SECRET),
    false,
  )
  assert.equal(JSON.stringify(refusal).includes(SECRET), false)
  assert.equal((refusal as StudyError).message.includes(SECRET), false)
  assert.deepEqual(readiness['react-scripts-dev'].startScript, {
    form: 'refused',
    refused: ['the command word cross-env'],
  })
})

// Value: protects=B2: a differently cased HOST, PORT, BROWSER, CI or HTTPS assignment is refused while exactly PORT stays the declared port; fails_when=Host=0.0.0.0 or port=4000 reads accepted, or PORT is refused; no_claim=the launcher's environment
test('start script assignments that shadow Codebook environment names are refused', () => {
  // Arrange
  const scripts = [
    'Host=0.0.0.0 react-scripts start',
    'port=4000 react-scripts start',
    'Browser=chrome react-scripts start',
    'ci=false react-scripts start',
    'HTTPS=true react-scripts start',
    'PORT=4000 BROWSER=none react-scripts start',
  ]
  // Act
  const forms = scripts.map(
    (script) => parseReactScriptsStartScript(script).readiness,
  )
  // Assert
  assert.deepEqual(forms, [
    {
      form: 'refused',
      refused: ['the assignment Host, which Codebook sets itself'],
    },
    {
      form: 'refused',
      refused: ['the assignment port, which Codebook sets itself'],
    },
    {
      form: 'refused',
      refused: ['the assignment Browser, which Codebook sets itself'],
    },
    {
      form: 'refused',
      refused: ['the assignment ci, which Codebook sets itself'],
    },
    {
      form: 'refused',
      refused: ['the assignment HTTPS, which Codebook sets itself'],
    },
    { form: 'accepted' },
  ])
})

// Value: protects=B2: a __proto__ assignment is an ordinary key, never a prototype write; fails_when=the assignments object has a prototype or __proto__ changes it; no_claim=what react-scripts does with such a variable
test('a __proto__ assignment does not change the assignments prototype', () => {
  // Arrange
  const script = '__proto__=polluted PORT=4000 react-scripts start'
  // Act
  const { assignments } = parseReactScriptsStartScript(script)
  // Assert
  assert.equal(Object.getPrototypeOf(assignments), null)
  assert.deepEqual(Object.keys(assignments), ['__proto__', 'PORT'])
  assert.equal(assignments.PORT, '4000')
})

// Value: protects=B4: an unreadable react-scripts version leaves details.installedVersion unset instead of a phrase; fails_when=installedVersion holds words such as "of an unreadable version"; no_claim=the message wording
test('an unreadable react-scripts version is refused without a phrase as installedVersion', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
    version: 'not-a-version',
  })
  const resolved = await resolveReactScriptsPackage(repository.root, undefined)
  // Act
  const refusal = await assessReactScriptsWorkspace(resolved).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(refusal instanceof StudyError, true)
  assert.equal((refusal as StudyError).details?.reason, 'react-scripts-version')
  assert.equal((refusal as StudyError).details?.installedVersion, undefined)
})

// Value: protects=B3: once Next and Vite are full the scan stops reading manifests even though no react-scripts app exists, and the cut-short react-scripts list says limit; fails_when=a later Next app is still visited, or the react-scripts list claims to be complete; no_claim=timing
test('a full Next and Vite list ends the scan although no react-scripts app was found', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const next = JSON.stringify({ name: 'n', dependencies: { next: '16.4.3' } })
  const vite = JSON.stringify({
    name: 'v',
    devDependencies: { vite: '8.3.5' },
    scripts: { dev: 'vite' },
  })
  await put(root, 'apps/a/package.json', next)
  await put(root, 'apps/b/package.json', vite)
  await put(root, 'apps/c/package.json', next)
  await put(root, 'apps/d/package.json', vite)
  await put(root, 'apps/e/package.json', next)
  await executeFile('git', ['add', '--', 'apps'], { cwd: root })
  const visitedNext: string[] = []
  // Act
  const scan = await scanPackages(
    root,
    {
      next: async (app) => {
        visitedNext.push(app.packageRoot)
        return app.packageRoot
      },
      vite: async (app) => app.packageRoot,
      reactScripts: async (app) => app.packageRoot,
    },
    { limits: { apps: 1, concurrency: 1 } },
  )
  // Assert
  assert.deepEqual(visitedNext, ['apps/a', 'apps/c'])
  assert.deepEqual(scan.reactScripts, { items: [], truncation: 'limit' })
})

// Value: protects=B6: a root package.json that cannot be read as a file yields a not-ready react-scripts report instead of a rejection of codebook_status; fails_when=readRepositoryAdapterReadiness rejects; no_claim=the wording of the gap
test('a root package.json that is a folder reports react-scripts not ready without throwing', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await mkdir(join(root, 'package.json'))
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['react-scripts-dev'].ready, false)
  assert.equal(readiness['react-scripts-dev'].installed, false)
})
