import assert from 'node:assert/strict'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { assessReactScriptsWorkspace } from '../utils/assessReactScriptsWorkspace'
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
  )
  // Assert
  assert.equal(environment.REACT_APP_HIDDEN, undefined)
  assert.equal(environment.REACT_APP_SHOWN, 'read')
})
