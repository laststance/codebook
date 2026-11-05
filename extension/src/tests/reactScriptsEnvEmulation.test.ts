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

// Value: protects=a reference cycle neither hangs nor throws in the extension host; fails_when=settling A=$B, B=$A overflows the stack or never returns; no_claim=what react-scripts itself does with a cycle (it overflows its own stack)
test('a cyclic .env reference settles without hanging or throwing', async (context) => {
  // Arrange
  const files = { '.env': 'A=$B\nB=$A\nREACT_APP_OK=fine\n' }
  // Act
  const { environment } = await settledEnvironmentOf(context, files)
  // Assert
  assert.equal(typeof environment.A, 'string')
  assert.equal(environment.REACT_APP_OK, 'fine')
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
