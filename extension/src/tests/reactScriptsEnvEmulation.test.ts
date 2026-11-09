import assert from 'node:assert/strict'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { assessReactScriptsWorkspace } from '../utils/assessReactScriptsWorkspace'
import { buildReactScriptsEnvironment } from '../utils/reactScriptsChildEnvironment'
import { resolveReactScriptsPackage } from '../utils/resolveReactScriptsPackage'

import { createReactScriptsRepository } from './utils/reactScriptsFixture'

/** Stages a root react-scripts app, writes the given env files and returns the environment react-scripts would settle. */
async function settledEnvironmentOf(
  context: TestContext,
  files: Record<string, string>,
): Promise<{ environment: Record<string, string>; port: number }> {
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
  })
  for (const [name, text] of Object.entries(files))
    await repository.write(name, text)
  const workspace = await assessReactScriptsWorkspace(
    await resolveReactScriptsPackage(repository.root, undefined),
    process.execPath,
    new AbortController().signal,
  )
  return { environment: workspace.environment, port: repository.port }
}

// Value: protects=a value reached through a chain of references is settled the way react-scripts inlines it, so the mask list holds it; fails_when=REACT_APP_TOKEN stays "$BASE" after one expansion pass; no_claim=values react-scripts reads from the learner's real shell
test('a chained .env reference settles to the final value react-scripts inlines', async (context) => {
  // Arrange
  const files = {
    '.env': 'REACT_APP_TOKEN=$ALIAS\nALIAS=$BASE\nBASE=synthetic-only-value\n',
  }
  // Act
  const { environment } = await settledEnvironmentOf(context, files)
  // Assert
  assert.equal(environment.REACT_APP_TOKEN, 'synthetic-only-value')
  assert.equal(environment.ALIAS, 'synthetic-only-value')
})

// Value: protects=the file order of react-scripts: .env.local beats .env for a name and a reference in .env resolves against what was loaded before it; fails_when=REACT_APP_X settles to env-value; no_claim=the order of other files
test('a value in .env.local wins over .env and a reference in .env resolves to it', async (context) => {
  // Arrange
  const files = {
    '.env.local': 'ALIAS=local-value\n',
    '.env': 'ALIAS=env-value\nREACT_APP_X=$ALIAS\n',
  }
  // Act
  const { environment } = await settledEnvironmentOf(context, files)
  // Assert
  assert.equal(environment.ALIAS, 'local-value')
  assert.equal(environment.REACT_APP_X, 'local-value')
})

// Value: protects=a reference to the child's own base environment resolves as in the child (PORT is the run's port); fails_when=REACT_APP_P settles to an empty string; no_claim=every inherited variable
test('a reference to the child environment resolves to the run port', async (context) => {
  // Arrange
  const files = { '.env': 'REACT_APP_P=$PORT@$HOST\n' }
  // Act
  const { environment, port } = await settledEnvironmentOf(context, files)
  // Assert
  assert.equal(environment.REACT_APP_P, `${port}@127.0.0.1`)
})

// Value: protects=a reference cycle (react-scripts itself overflows its stack on it) refuses the start instead of masking an unexpanded "$B"; fails_when=settling A=$B, B=$A hangs, throws something else or lets the run start; no_claim=what react-scripts prints for the cycle
test('a cyclic .env reference refuses the start before anything runs', async (context) => {
  // Arrange
  const files = { '.env': 'A=$B\nB=$A\nREACT_APP_OK=fine\n' }
  // Act
  const settling = settledEnvironmentOf(context, files)
  // Assert
  await assert.rejects(settling, {
    code: 'REACT_SCRIPTS_UNSUPPORTED',
    details: {
      reason: 'env-file-unreadable',
      file: '.env',
      sideEffects: 'none',
    },
  })
})

// Value: protects=a finite reference chain deeper than Codebook follows refuses the start, so the value react-scripts resolves is never left out of the masks; fails_when=REACT_APP_TOKEN settles to "$A65" and the run starts with the real value unmasked; no_claim=chains up to the depth bound (the chained-value test covers those)
test('a reference chain deeper than 64 refuses the start instead of masking an unexpanded name', async (context) => {
  // Arrange
  const chain = Array.from(
    { length: 69 },
    (_, index) => `A${index}=$A${index + 1}`,
  )
  const files = {
    '.env': `REACT_APP_TOKEN=$A0\n${chain.join('\n')}\nA69=synthetic-private-value\n`,
  }
  // Act
  const settling = settledEnvironmentOf(context, files)
  // Assert
  await assert.rejects(settling, {
    code: 'REACT_SCRIPTS_UNSUPPORTED',
    details: {
      reason: 'env-file-unreadable',
      file: '.env',
      sideEffects: 'none',
    },
  })
})

// Value: protects=spending the substitution budget on names that are not masked cannot leave a later REACT_APP_* value unexpanded and unmasked; fails_when=REACT_APP_TOKEN settles to "$BASE" and the run starts; no_claim=the exact budget size
test('exhausting the substitution budget refuses the start instead of leaving a later value unexpanded', async (context) => {
  // Arrange
  const files = {
    '.env': `A=x\nB=${'$A'.repeat(10_001)}\nREACT_APP_TOKEN=$BASE\nBASE=synthetic-private-value\n`,
  }
  // Act
  const settling = settledEnvironmentOf(context, files)
  // Assert
  await assert.rejects(settling, {
    code: 'REACT_SCRIPTS_UNSUPPORTED',
    details: {
      reason: 'env-file-unreadable',
      file: '.env',
      sideEffects: 'none',
    },
  })
})

// Value: protects=repeated references to a long value cannot grow a value without bound and block the extension host; fails_when=B is built to tens of megabytes (O(n^2) copying, a hang or a RangeError) instead of a refusal; no_claim=the exact character bounds
test('repeated references that would grow a value past its bound refuse the start', async (context) => {
  // Arrange
  const files = {
    '.env': `A=${'x'.repeat(30_000)}\nB=${'${A}'.repeat(1_100)}\n`,
  }
  // Act
  const settling = settledEnvironmentOf(context, files)
  // Assert
  await assert.rejects(settling, {
    code: 'REACT_SCRIPTS_UNSUPPORTED',
    details: {
      reason: 'env-file-unreadable',
      file: '.env',
      sideEffects: 'none',
    },
  })
})

// Value: protects=escaped dollars rebuild a long value too, so their copying counts against the same bound and cannot block the extension host; fails_when=hundreds of \$ escapes after a long reference each copy the whole value and the start goes ahead; no_claim=the exact copied-characters bound
test('many escaped dollars after a long reference refuse the start instead of copying without bound', async (context) => {
  // Arrange
  const files = {
    '.env': `A=${'x'.repeat(30_000)}\nB=\${A}${'\\$Z'.repeat(600)}\n`,
  }
  // Act
  const settling = settledEnvironmentOf(context, files)
  // Assert
  await assert.rejects(settling, {
    code: 'REACT_SCRIPTS_UNSUPPORTED',
    details: {
      reason: 'env-file-unreadable',
      file: '.env',
      sideEffects: 'none',
    },
  })
})

// Value: protects=NODE_ENV and BABEL_ENV settle to development as react-scripts' start.js sets them before reading .env, so PUBLIC_URL and inlined values match the bundle; fails_when=${NODE_ENV} expands to an empty string; no_claim=other variables start.js sets
test('a reference to NODE_ENV or BABEL_ENV settles to development as in react-scripts start', async (context) => {
  // Arrange
  const files = {
    '.env': 'PUBLIC_URL=/preview/${NODE_ENV}\nREACT_APP_MODE=$BABEL_ENV-mode\n',
  }
  // Act
  const { environment } = await settledEnvironmentOf(context, files)
  // Assert
  assert.equal(environment.PUBLIC_URL, '/preview/development')
  assert.equal(environment.REACT_APP_MODE, 'development-mode')
})

// Value: protects=an escaped dollar stays a literal dollar like dotenv-expand; fails_when=\$BASE is expanded; no_claim=other escapes
test('an escaped dollar stays a literal dollar', async (context) => {
  // Arrange
  const files = { '.env': 'BASE=x\nREACT_APP_PRICE=\\$BASE\n' }
  // Act
  const { environment } = await settledEnvironmentOf(context, files)
  // Assert
  assert.equal(environment.REACT_APP_PRICE, '$BASE')
})

// Value: protects=an .env file react-scripts cannot read (dotenv catches the error) is ignored, as react-scripts ignores it; fails_when=an unreadable file refuses the start or its values are used; no_claim=files unreadable for other reasons
test('an unreadable .env file is ignored like react-scripts ignores it', async (context) => {
  // Arrange
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    context.skip('file modes do not stop a read here')
    return
  }
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
  })
  await repository.write('.env', 'REACT_APP_HIDDEN=never-read\n')
  await repository.write('.env.development', 'REACT_APP_SHOWN=read\n')
  await chmod(join(repository.root, '.env'), 0o000)
  // Act
  const { environment } = await assessReactScriptsWorkspace(
    await resolveReactScriptsPackage(repository.root, undefined),
    process.execPath,
    new AbortController().signal,
  )
  // Assert
  assert.equal(environment.REACT_APP_HIDDEN, undefined)
  assert.equal(environment.REACT_APP_SHOWN, 'read')
})

// Value: protects=react-scripts 4 on Node 17 or later gets the OpenSSL legacy provider after the learner's own NODE_OPTIONS, once; fails_when=webpack 4 starts without the flag (ERR_OSSL_EVP_UNSUPPORTED), the learner's options are replaced, or the flag is doubled; no_claim=that the flag reaches a real child (native check)
test('react-scripts 4 on Node 24 gets the OpenSSL legacy provider after the learner NODE_OPTIONS and never twice', () => {
  // Arrange
  const runtime = { reactScriptsMajor: 4, nodeMajor: 24 }
  // Act
  const none = buildReactScriptsEnvironment({}, 3000, runtime, {})
  const withOwn = buildReactScriptsEnvironment(
    { NODE_OPTIONS: '--max-old-space-size=4096' },
    3000,
    runtime,
    {},
  )
  const alreadyThere = buildReactScriptsEnvironment(
    { NODE_OPTIONS: '--openssl-legacy-provider --max-old-space-size=4096' },
    3000,
    runtime,
    {},
  )
  // Assert
  assert.equal(none.NODE_OPTIONS, '--openssl-legacy-provider')
  assert.equal(
    withOwn.NODE_OPTIONS,
    '--max-old-space-size=4096 --openssl-legacy-provider',
  )
  assert.equal(
    alreadyThere.NODE_OPTIONS,
    '--openssl-legacy-provider --max-old-space-size=4096',
  )
})

// Value: protects=Node 16 or older (which refuses the option) and react-scripts 5 (which needs none) get no flag; fails_when=either child starts with --openssl-legacy-provider; no_claim=other Node options
test('react-scripts 4 on Node 16 and react-scripts 5 on Node 24 get no OpenSSL option', () => {
  // Arrange
  const host = { NODE_OPTIONS: '--max-old-space-size=2048' }
  // Act
  const oldNode = buildReactScriptsEnvironment(
    {},
    3000,
    { reactScriptsMajor: 4, nodeMajor: 16 },
    host,
  )
  const newMajor = buildReactScriptsEnvironment(
    {},
    3000,
    { reactScriptsMajor: 5, nodeMajor: 24 },
    host,
  )
  // Assert
  assert.equal(oldNode.NODE_OPTIONS, undefined)
  assert.equal(newMajor.NODE_OPTIONS, undefined)
})

// Value: protects=the learner's value is the start script's NODE_OPTIONS when it has one, else the editor's; fails_when=the editor's options are added over the script's or are lost when the script has none; no_claim=other variables
test('the start script NODE_OPTIONS takes precedence over the editor NODE_OPTIONS for react-scripts 4', () => {
  // Arrange
  const runtime = { reactScriptsMajor: 4, nodeMajor: 24 }
  const host = { NODE_OPTIONS: '--editor-option' }
  // Act
  const fromScript = buildReactScriptsEnvironment(
    { NODE_OPTIONS: '--script-option' },
    3000,
    runtime,
    host,
  )
  const fromEditor = buildReactScriptsEnvironment({}, 3000, runtime, host)
  // Assert
  assert.equal(
    fromScript.NODE_OPTIONS,
    '--script-option --openssl-legacy-provider',
  )
  assert.equal(
    fromEditor.NODE_OPTIONS,
    '--editor-option --openssl-legacy-provider',
  )
})

// Value: protects=react-scripts 4 with a Node whose version cannot be read is refused node-version-unreadable before anything starts; fails_when=the run starts and guesses the flag; no_claim=the Node gate of other adapters
test('a react-scripts 4 app with an unreadable Node version is refused node-version-unreadable', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
    version: '4.0.3',
  })
  const resolved = await resolveReactScriptsPackage(repository.root, undefined)
  // Act
  const refusal = await assessReactScriptsWorkspace(
    resolved,
    join(repository.root, 'no-such-node'),
    new AbortController().signal,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(refusal instanceof StudyError, true)
  assert.equal((refusal as StudyError).code, 'REACT_SCRIPTS_UNSUPPORTED')
  assert.equal(
    (refusal as StudyError).details?.reason,
    'node-version-unreadable',
  )
})

/** Writes an executable that prints the given Node version and returns its unique path. */
async function fakeNodePrinting(
  directory: string,
  name: string,
  version: string,
): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, `#!/bin/sh\necho ${version}\n`)
  await chmod(path, 0o755)
  return path
}

// Value: protects=the Node major read from the executable reaches workspace.runtime and Node 16 gets no OpenSSL flag; fails_when=nodeMajor is lost or misparsed, or the flag is added for Node 16; no_claim=the flag reaching a real child
test('a react-scripts 4 app on a Node 16 executable gets nodeMajor 16 and no OpenSSL option', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
    version: '4.0.3',
  })
  const node = await fakeNodePrinting(
    repository.root,
    'fake-node-16',
    'v16.20.0',
  )
  // Act
  const { runtime } = await assessReactScriptsWorkspace(
    await resolveReactScriptsPackage(repository.root, undefined),
    node,
    new AbortController().signal,
  )
  const child = buildReactScriptsEnvironment({}, 3000, runtime, {})
  // Assert
  assert.deepEqual(runtime, { reactScriptsMajor: 4, nodeMajor: 16 })
  assert.equal(child.NODE_OPTIONS, undefined)
})

// Value: protects=Node 17 is the first major that gets the OpenSSL legacy provider for react-scripts 4; fails_when=Node 17 gets no flag; no_claim=Node 18 or later
test('a react-scripts 4 app on a Node 17 executable gets nodeMajor 17 and the OpenSSL option', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
    version: '4.0.3',
  })
  const node = await fakeNodePrinting(
    repository.root,
    'fake-node-17',
    'v17.0.0',
  )
  // Act
  const { runtime } = await assessReactScriptsWorkspace(
    await resolveReactScriptsPackage(repository.root, undefined),
    node,
    new AbortController().signal,
  )
  const child = buildReactScriptsEnvironment({}, 3000, runtime, {})
  // Assert
  assert.deepEqual(runtime, { reactScriptsMajor: 4, nodeMajor: 17 })
  assert.equal(child.NODE_OPTIONS, '--openssl-legacy-provider')
})

// Value: protects=react-scripts 5 never reads the Node version, so an unusable Node path does not refuse it; fails_when=a react-scripts 5 app is refused node-version-unreadable; no_claim=react-scripts 4
test('a react-scripts 5 app still assesses when the Node executable does not exist', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
  })
  // Act
  const { runtime } = await assessReactScriptsWorkspace(
    await resolveReactScriptsPackage(repository.root, undefined),
    join(repository.root, 'no-such-node'),
    new AbortController().signal,
  )
  // Assert
  assert.deepEqual(runtime, { reactScriptsMajor: 5 })
})

// Value: protects=a cancelled run is reported as the cancellation; fails_when=an aborted signal during the Node version read is reported as node-version-unreadable; no_claim=cancellation of other steps
test('a cancelled react-scripts 4 assessment is not reported as node-version-unreadable', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, {
    appFolder: '.',
    version: '4.0.3',
  })
  const resolved = await resolveReactScriptsPackage(repository.root, undefined)
  const controller = new AbortController()
  controller.abort()
  // Act
  const failure = await assessReactScriptsWorkspace(
    resolved,
    join(repository.root, 'never-run-node'),
    controller.signal,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(failure instanceof StudyError, false)
  assert.equal((failure as Error).name, 'AbortError')
})
