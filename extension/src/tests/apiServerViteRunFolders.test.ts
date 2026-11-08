import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

import { StudyError } from '../errors'

import {
  API_STOP_FILE,
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import {
  ADD,
  publishedPause,
  sendOperation,
} from './utils/routeHandlerRunHarness'

/** A browser stop's file in the app folder, which the alias test turns into a link to an API file. */
const APP_STOP_FILE = 'apps/web/src/linked.ts'
/** A server stop's file in the API folder, which the alias test turns into a link to an app file. */
const API_LINK_FILE = 'apps/api/src/linked.ts'
/** The app folder of the nested Vite app in these tests. */
const APP_FOLDER = 'apps/web'

/**
 * Prepares a run and returns what it threw, when it is a refusal.
 * Called by the refusal tests of this file.
 * @param harness - The run's harness.
 * @returns The thrown {@link StudyError}, or `undefined` when preparation succeeded.
 * @example const error = await prepareError(harness)
 */
async function prepareError(
  harness: ApiServerRunHarness,
): Promise<StudyError | undefined> {
  const thrown = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  return thrown instanceof StudyError ? thrown : undefined
}

/**
 * Tells whether this platform can create symbolic links, and skips the test with a reason when it cannot.
 * Called first by the alias tests of this file.
 * @param context - The test, skipped when links cannot be created.
 * @returns `true` when links work.
 * @example if (!(await canLink(context))) return
 */
async function canLink(context: TestContext): Promise<boolean> {
  const scratch = await mkdtemp(join(tmpdir(), 'codebook-link-probe-'))
  try {
    await symlink(scratch, join(scratch, 'probe'))
    return true
  } catch {
    context.skip('This platform cannot create symbolic links.')
    return false
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * Replaces a repository file with a symbolic link to another repository file, copying the file's text to the target first.
 * Why it exists: the run refuses a symbolic source path when it reads the sources, so an alias can only appear after that read; the tests call this from the workspace-assertion hook, which runs between the source read and the `apiServer` checks.
 * Called by the alias tests of this file.
 * @param directory - The repository root.
 * @param linkPath - The repository-relative path that becomes the link.
 * @param targetPath - The repository-relative path the link points at.
 * @example await linkFile('/repo', 'apps/web/src/linked.ts', 'apps/api/src/rpc/switches.ts')
 */
async function linkFile(
  directory: string,
  linkPath: string,
  targetPath: string,
): Promise<void> {
  const text = await readFile(join(directory, linkPath), 'utf8')
  await mkdir(dirname(join(directory, targetPath)), { recursive: true })
  await writeFile(join(directory, targetPath), text)
  await rm(join(directory, linkPath))
  await symlink(join(directory, targetPath), join(directory, linkPath))
}

/**
 * Builds a one-stop declaration of the given participant in `sourcePath` for the harness' `extra` options.
 * Called by the alias tests of this file.
 * @param participant - The participant the stop declares.
 * @param sourcePath - The stop's repository-relative file.
 * @example stopIn('browser', 'apps/web/src/linked.ts').participant // => 'browser'
 */
function stopIn(participant: 'browser' | 'server', sourcePath: string) {
  return {
    participant,
    sourcePath,
    operations: {
      operations: [ADD],
      stopOperations: [1],
      stopParticipants: [participant],
    },
  }
}

/** Reads the fields an agent sees from a stop-ownership refusal. */
function refusalFieldsOf(error: StudyError | undefined) {
  return {
    code: error?.code,
    reason: error?.details?.reason,
    participant: error?.details?.participant,
    file: error?.details?.file,
    sideEffects: error?.details?.sideEffects,
  }
}

// Value: protects=test 41a (D45) nested app with a sibling API: a vite-dev app in apps/web with the API in apps/api starts, and the API stop (outside the app by design) is not refused outside-package; fails_when=VITE_SEAL_FAILED outside-package refuses the API stop; no_claim=real Vite or a real API
test('a nested vite-dev app with a sibling API folder starts and is not refused outside-package', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    extra: { packageRoot: APP_FOLDER },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      failures: [...harness.run.view().failures],
      events: harness.fake.events,
    },
    {
      code: undefined,
      failures: [],
      events: [
        'check',
        'launch',
        'inspector-endpoint',
        'verify',
        'listen',
        'metro-start',
      ],
    },
  )
})

// Value: protects=test 41b (D47) browser side: a browser stop whose file in the app folder is a symbolic link to an API file is refused as stop-participant-folder naming the browser participant, before anything starts; fails_when=the stop is sealed as a browser stop of an API file; no_claim=a link that exists when the sources are read (the source reader refuses those first)
test('a symbolic link in the app folder to an API file is refused as a browser stop', async (context) => {
  // Arrange
  if (!(await canLink(context))) return
  let directory = ''
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    extra: {
      packageRoot: APP_FOLDER,
      ...stopIn('browser', APP_STOP_FILE),
      onWorkspaceAsserted: () =>
        linkFile(directory, APP_STOP_FILE, API_STOP_FILE),
    },
  })
  directory = harness.directory
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    { ...refusalFieldsOf(error), events: harness.fake.events },
    {
      code: 'INVALID_CONFIGURATION',
      reason: 'stop-participant-folder',
      participant: 'browser',
      file: APP_STOP_FILE,
      sideEffects: 'none',
      events: [],
    },
  )
})

// Value: protects=test 41b (D47) server side: a server stop whose file in the API folder is a symbolic link to an app file is refused as stop-participant-folder naming the server participant, before anything starts; fails_when=the stop is armed as an API stop of an app file; no_claim=a link that exists when the sources are read (the source reader refuses those first)
test('a symbolic link in the API folder to an app file is refused as a server stop', async (context) => {
  // Arrange
  if (!(await canLink(context))) return
  let directory = ''
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    extra: {
      packageRoot: APP_FOLDER,
      ...stopIn('server', API_LINK_FILE),
      onWorkspaceAsserted: () =>
        linkFile(directory, API_LINK_FILE, `${APP_FOLDER}/src/theme.ts`),
    },
  })
  directory = harness.directory
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    { ...refusalFieldsOf(error), events: harness.fake.events },
    {
      code: 'INVALID_CONFIGURATION',
      reason: 'stop-participant-folder',
      participant: 'server',
      file: API_LINK_FILE,
      sideEffects: 'none',
      events: [],
    },
  )
})

// Value: protects=test 41b (D36) real-path nesting: an apiServer.packageRoot that resolves around the app folder through a symbolic link is refused api-folder-nesting on vite-dev before anything starts; fails_when=the lexical schema is the only check and the run starts with the API folder containing the app folder; no_claim=a link that exists when the sources are read (the source reader refuses those first)
test('an API folder that resolves around the app folder through a symbolic link is refused api-folder-nesting on vite-dev', async (context) => {
  // Arrange
  if (!(await canLink(context))) return
  let directory = ''
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    extra: {
      packageRoot: APP_FOLDER,
      onWorkspaceAsserted: async () => {
        // The API folder becomes a link to the repository root, which contains the app folder.
        await rm(join(directory, 'apps/api'), { recursive: true })
        await symlink(directory, join(directory, 'apps/api'))
      },
    },
  })
  directory = harness.directory
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      reason: error?.details?.reason,
      field: error?.details?.field,
      sideEffects: error?.details?.sideEffects,
      events: harness.fake.events,
    },
    {
      code: 'INVALID_CONFIGURATION',
      reason: 'api-folder-nesting',
      field: 'apiServer.packageRoot',
      sideEffects: 'none',
      events: [],
    },
  )
})

/**
 * Gives a minified single-line CommonJS-shaped module and the inline map that retains the stop file's exact text, as tsx emits a CommonJS module.
 * Called by the CommonJS test of this file.
 * @param stopPath - The stop file's real path.
 * @param original - The text the map retains.
 * @returns The script text `Debugger.getScriptSource` answers.
 * @example commonJsScriptText('/repo/apps/api/src/a.ts', 'export {}\n') // '"use strict";…//# sourceMappingURL=data:…'
 */
function commonJsScriptText(stopPath: string, original: string): string {
  const generated =
    '"use strict";Object.defineProperty(exports,"__esModule",{value:!0});exports.switchTo=void 0;const switchTo=async()=>1;exports.switchTo=switchTo;'
  const map = {
    version: 3,
    sources: [stopPath],
    sourcesContent: [original],
    names: [],
    mappings: 'AAAA',
  }
  return `${generated}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`
}

// Value: protects=test 41c (D46) CommonJS identity: a minified single-line CommonJS-shaped API module announced at pathToFileURL(real path) is admitted as the stop's hit, sealed and published without a failure; fails_when=hit admission, the seal or publication refuses the single-line module; no_claim=tsx's real CommonJS output (the native check)
test('a CommonJS-shaped single-line API module is admitted as the stop hit, sealed and published', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  const stopPath = harness.server!.sealedUrl.replace('file://', '')
  const original = await readFile(stopPath, 'utf8')
  // Act
  await apiServerHit(harness, {
    scriptText: commonJsScriptText(stopPath, original),
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      announced: harness.server!.sealedUrl === pathToFileURL(stopPath).href,
      sourceLine: snapshot.source?.line,
      frameFile: snapshot.debugger?.frames[0]?.source?.name,
      execution: snapshot.execution,
      status: harness.run.view().status,
      failures: [...harness.run.view().failures],
    },
    {
      announced: true,
      sourceLine: 1,
      frameFile: API_STOP_FILE,
      execution: 'server-action',
      status: 'paused-server',
      failures: [],
    },
  )
})
