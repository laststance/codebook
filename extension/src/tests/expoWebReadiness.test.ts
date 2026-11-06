import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { expoWebHelp } from '../expoWebHelp'
import { EXPO_WEB_GAPS } from '../utils/readExpoWebPackageReadiness'
import { readStatusAdapterReadiness } from '../utils/readStatusAdapterReadiness'

import {
  createExpoWebRepository,
  type ExpoWebFixtureOptions,
} from './utils/expoWebFixture'

const executeFile = promisify(execFile)
const SIGNAL = new AbortController().signal

/** Stages a fake Expo app in a Git repository whose `package.json` is tracked, as the status discovery lists only tracked manifests. */
async function trackedExpoRepository(
  context: TestContext,
  options: ExpoWebFixtureOptions = {},
) {
  const repository = await createExpoWebRepository(context, options)
  await executeFile('git', ['init', '--quiet', repository.root])
  await executeFile(
    'git',
    ['add', '--', `${repository.appFolder}/package.json`],
    { cwd: repository.root },
  )
  return repository
}

// Value: protects=DX-2 and DX-15: codebook_status lists the Expo app below the root under adapters["expo-web-dev"] with its packageRoot, installed, ready, version, empty missing, web script and declared port, and rootIsApp false; fails_when=the app is not listed, the fields are missing or the root counts as the app; why_new=Cycle 0089 readiness listing; seam=temporary Git repository, real files, one discovery pass; no_claim=the shared Node and Chrome prerequisites (environment test)
test('status lists the Expo app below the root with its readiness, script and port', async (context) => {
  // Arrange
  const repository = await trackedExpoRepository(context, {
    webScript: () =>
      'API_BASE=http://localhost:4100 expo start --web --port 4101',
  })
  // Act
  const readiness = (
    await readStatusAdapterReadiness(repository.root, process.execPath, SIGNAL)
  )['expo-web-dev']
  // Assert
  assert.equal(readiness.rootIsApp, false)
  assert.deepEqual(readiness.packages, [
    {
      packageRoot: 'apps/app',
      installed: true,
      ready: true,
      version: '57.0.25',
      missing: [],
      webScript: 'API_BASE=… expo start --web --port 4101',
      port: 4101,
    },
  ])
  assert.equal(readiness.packagesTruncated, false)
})

// Value: protects=DX-2: an Expo app that cannot start is listed, not hidden, with the same gap names a start refuses with and no script; fails_when=it is dropped or reads ready; why_new=readiness equals the start's judgement; seam=temporary Git repository; no_claim=the install command
test('status lists an Expo SDK 56 app as not ready with expo-sdk and its installed version', async (context) => {
  // Arrange
  const repository = await trackedExpoRepository(context, {
    expoVersion: '56.0.3',
  })
  // Act
  const readiness = (
    await readStatusAdapterReadiness(repository.root, process.execPath, SIGNAL)
  )['expo-web-dev']
  // Assert
  assert.deepEqual(
    readiness.packages?.map(({ packageRoot, ready, missing, version }) => ({
      packageRoot,
      ready,
      missing,
      version,
    })),
    [
      {
        packageRoot: 'apps/app',
        ready: false,
        missing: ['expo-sdk'],
        version: '56.0.3',
      },
    ],
  )
})

// Value: protects=DX-2: a root whose package.json declares expo is the app (rootIsApp true) and a hoisted node_modules/expo alone is not; fails_when=the root is the choice without declaring expo; why_new=selection rule; seam=temporary Git repository; no_claim=the selection rule text
test('status marks the root as the Expo app only when its package.json declares expo', async (context) => {
  // Arrange
  const rootApp = await trackedExpoRepository(context, { appFolder: '.' })
  const hoisted = await trackedExpoRepository(context)
  // Act
  const rootReadiness = (
    await readStatusAdapterReadiness(rootApp.root, process.execPath, SIGNAL)
  )['expo-web-dev']
  const hoistedReadiness = (
    await readStatusAdapterReadiness(hoisted.root, process.execPath, SIGNAL)
  )['expo-web-dev']
  // Assert
  assert.equal(rootReadiness.rootIsApp, true)
  assert.equal(rootReadiness.installed, true)
  assert.equal(hoistedReadiness.rootIsApp, false)
})

// Value: protects=DX-2: the gap names expoWebHelp() promises in its status text are exactly the names the reader can list, in the same order; fails_when=a name is added to one side only; why_new=hand-synced lists drift; seam=the help text and the reader's constant; no_claim=what each gap means
test('the missing values the help lists are exactly the values the readiness reader lists', () => {
  // Arrange
  const statusText = expoWebHelp().expoWebQuickStart.status.packages
  // Act
  const listed = /missing lists ([^.]+)\./.exec(statusText)?.[1]
  const names = (listed ?? '')
    .split(/,\s*|\s+or\s+/)
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
  // Assert
  assert.deepEqual(names, [...EXPO_WEB_GAPS])
})
