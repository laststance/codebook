import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { EXPO_WEB_DEV_ADAPTER } from '../expoWebDevAdapter'
import { assessExpoWebWorkspace } from '../utils/assessExpoWebWorkspace'
import { parseExpoWebScript } from '../utils/parseExpoWebScript'
import { readExpoWebPackageReadiness } from '../utils/readExpoWebPackageReadiness'
import { readReactScriptsEnvFile } from '../utils/readReactScriptsEnvFile'
import { resolveExpoWebPackage } from '../utils/resolveExpoWebPackage'

import {
  createExpoWebRepository,
  type ExpoWebFixtureOptions,
} from './utils/expoWebFixture'

const SIGNAL = new AbortController().signal

/** Runs the adapter's static workspace check on a staged app and returns the refusal it threw, or `undefined` when it passed. */
async function refusalOfWorkspace(
  context: TestContext,
  options: ExpoWebFixtureOptions = {},
): Promise<{ code: string; reason: unknown; details?: unknown } | undefined> {
  const repository = await createExpoWebRepository(context, options)
  const expoWebPackage = await resolveExpoWebPackage(
    repository.root,
    repository.appFolder === '.' ? undefined : repository.appFolder,
  )
  const error = await EXPO_WEB_DEV_ADAPTER.assertWorkspace(
    repository.appRoot,
    process.execPath,
    SIGNAL,
    undefined,
    undefined,
    undefined,
    expoWebPackage,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  if (error === undefined) return undefined
  assert.ok(error instanceof StudyError, String(error))
  return {
    code: error.code,
    reason: error.details?.reason,
    details: error.details,
  }
}

// Value: protects=AC 1: the shape of P08's app (Expo 57 installed, app.json with web.output single and no platforms, web script expo start --web --port 4101) passes the static check, and its readiness lists the script and port without a gap; fails_when=a gap is invented for P08's shape or the readiness loses the script, port or version; why_new=Cycle 0089 adds the Expo adapter; seam=temporary repository, real files, nothing executed; no_claim=that Metro serves the app (adapter tests)
test('the shape of P08 passes the static workspace check and reads ready with its script and port', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = {
    webScript: () => 'expo start --web --port 4101',
  }
  const repository = await createExpoWebRepository(context, options)
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  const judgement = await readExpoWebPackageReadiness(
    repository.root,
    'apps/app',
  )
  // Assert
  assert.equal(refusal, undefined)
  assert.deepEqual(judgement.readiness, {
    installed: true,
    ready: true,
    version: '57.0.25',
    missing: [],
    webScript: 'expo start --web --port 4101',
    port: 4101,
  })
})

// Value: protects=E-5: a folder whose manifest does not declare expo is refused as not-an-expo-app before anything else is read; fails_when=another reason wins or the folder starts; why_new=first refusal of the ordered list; seam=temporary repository; no_claim=the wording
test('a folder that does not declare expo is refused as not-an-expo-app', async (context) => {
  // Arrange
  const repository = await createExpoWebRepository(context)
  await repository.write(
    'package.json',
    JSON.stringify({ name: 'plain', dependencies: { react: '19.0.0' } }),
  )
  // Act
  const thrown = await resolveExpoWebPackage(repository.root, 'apps/app').catch(
    (error: unknown) => error,
  )
  // Assert
  assert.ok(thrown instanceof StudyError)
  assert.equal(thrown.code, 'EXPO_WEB_UNSUPPORTED')
  assert.equal(thrown.details?.reason, 'not-an-expo-app')
})

// Value: protects=DX-3: an app whose expo package is not installed is refused as not-installed with the lockfile's install command; fails_when=it starts, or the command is missing; why_new=install gap; seam=temporary repository; no_claim=running the command
test('an app without node_modules/expo is refused as not-installed with an install command', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = { omitExpo: true }
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  // Assert
  assert.equal(refusal?.code, 'EXPO_WEB_UNSUPPORTED')
  assert.equal(refusal?.reason, 'not-installed')
  assert.equal(
    typeof (refusal?.details as { installCommand: unknown }).installCommand,
    'string',
  )
})

// Value: protects=E-17: Expo SDK 57 only, judged from the installed package; fails_when=SDK 56 starts; why_new=version gate; seam=temporary repository; no_claim=other majors' behavior
test('an installed Expo SDK 56 is refused as expo-version with its version and the supported major', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = { expoVersion: '56.0.3' }
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  // Assert
  assert.equal(refusal?.reason, 'expo-version')
  assert.equal(
    (refusal?.details as { installedVersion: string }).installedVersion,
    '56.0.3',
  )
  assert.equal(
    (refusal?.details as { supportedMajor: number }).supportedMajor,
    57,
  )
})

// Value: protects=E-14: an app.config.js is refused as dynamic-config even when app.json beside it allows the web platform, and nothing is evaluated; fails_when=the app starts, or the dynamic file is read as configuration; why_new=no project code before the start; seam=temporary repository where the config file would throw if it ran; no_claim=app.config.ts/.mjs/.cjs (same list)
test('an app.config.js is refused as dynamic-config although app.json allows web, and it is never run', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = {
    files: { 'app.config.js': 'throw new Error("must never run")' },
  }
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  // Assert
  assert.equal(refusal?.reason, 'dynamic-config')
  assert.equal((refusal?.details as { file: string }).file, 'app.config.js')
})

// Value: protects=E-5: a platform list without web, or a bundler other than metro, is refused as no-web-platform; fails_when=either starts; why_new=static app.json check; seam=temporary repository; no_claim=an omitted platform list (accepted in the P08 test)
test('app.json without web in platforms, or with a webpack bundler, is refused as no-web-platform', async (context) => {
  // Arrange
  const withoutWeb: ExpoWebFixtureOptions = {
    appJson: { expo: { platforms: ['ios', 'android'] } },
  }
  const withWebpack: ExpoWebFixtureOptions = {
    appJson: { expo: { web: { bundler: 'webpack' } } },
  }
  // Act
  const first = await refusalOfWorkspace(context, withoutWeb)
  const second = await refusalOfWorkspace(context, withWebpack)
  // Assert
  assert.equal(first?.reason, 'no-web-platform')
  assert.equal(second?.reason, 'no-web-platform')
})

// Value: protects=E-5: expo.web.output server is refused as server-output; fails_when=server rendering starts; why_new=a server participant is out of scope; seam=temporary repository; no_claim=output static
test('app.json with web output server is refused as server-output', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = {
    appJson: { expo: { web: { output: 'server' } } },
  }
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  // Assert
  assert.equal(refusal?.reason, 'server-output')
})

// Value: protects=E-5: react-native-web or react-dom that does not resolve from the app is refused as web-dependencies naming the missing package; fails_when=the app starts without them or the name is lost; why_new=filesystem lookup, nothing executed; seam=temporary repository; no_claim=their versions
test('an app without react-native-web is refused as web-dependencies naming it', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = { omitPackages: ['react-native-web'] }
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  // Assert
  assert.equal(refusal?.reason, 'web-dependencies')
  assert.deepEqual((refusal?.details as { missing: string[] }).missing, [
    'react-native-web',
  ])
})

// Value: protects=E-13: a web script that is not exactly expo start --web (a wrapper, extra arguments) is refused as web-script-form and never echoes an assignment value; fails_when=cross-env starts, or the secret value reaches the refusal; why_new=the script's meaning; seam=temporary repository; no_claim=every refused form (parser test)
test('a cross-env web script is refused as web-script-form without its assignment value', async (context) => {
  // Arrange
  const options: ExpoWebFixtureOptions = {
    webScript: () => 'API_TOKEN=hunter2hunter2 cross-env expo start --web',
  }
  // Act
  const refusal = await refusalOfWorkspace(context, options)
  // Assert
  assert.equal(refusal?.reason, 'web-script-form')
  assert.equal(
    JSON.stringify(refusal?.details).includes('hunter2hunter2'),
    false,
  )
})

// Value: protects=E-13: a preweb script, or a prestart script when start is the script used, is refused as pre-script; fails_when=a skipped pre-script starts silently; why_new=no project script besides the CLI runs; seam=temporary repository; no_claim=postweb
test('a preweb script, and a prestart script beside start, are refused as pre-script', async (context) => {
  // Arrange
  const withPreweb: ExpoWebFixtureOptions = {
    extraScripts: { preweb: 'echo hi' },
  }
  const startUsed = await createExpoWebRepository(context, {
    extraScripts: { prestart: 'echo hi' },
  })
  await startUsed.write(
    'package.json',
    JSON.stringify({
      dependencies: { expo: '~57.0.0', 'react-dom': '19.0.0' },
      scripts: { start: 'expo start --web --port 4102', prestart: 'echo hi' },
    }),
  )
  // Act
  const first = await refusalOfWorkspace(context, withPreweb)
  const second = await readExpoWebPackageReadiness(startUsed.root, 'apps/app')
  // Assert
  assert.equal(first?.reason, 'pre-script')
  assert.deepEqual(second.readiness.missing, ['pre-script'])
  assert.equal(second.readiness.port, 4102)
})

// Value: protects=E-16: an existing .env file that cannot be read safely is refused as env-file-unreadable, while a missing one is none; fails_when=a directory named .env is read as no file, or a missing .env refuses; why_new=Expo's failure policy parameter; seam=temporary repository; no_claim=react-scripts' policy, whose tests run unedited
test('a .env that is a directory is refused as env-file-unreadable and a missing .env is none', async (context) => {
  // Arrange
  const unreadable = await createExpoWebRepository(context)
  await mkdir(join(unreadable.appRoot, '.env'))
  // Act
  const withoutEnvFile = await refusalOfWorkspace(context, {})
  const unreadableError = await EXPO_WEB_DEV_ADAPTER.assertWorkspace(
    unreadable.appRoot,
    process.execPath,
    SIGNAL,
    undefined,
    undefined,
    undefined,
    await resolveExpoWebPackage(unreadable.root, 'apps/app'),
  ).catch((error: unknown) => error)
  // Assert
  assert.equal(withoutEnvFile, undefined)
  assert.ok(unreadableError instanceof StudyError)
  assert.equal(unreadableError.details?.reason, 'env-file-unreadable')
})

// Value: protects=E-16: the shared .env reader keeps react-scripts' dotenv behavior by default (a directory is no file) and refuses under the Expo policy; fails_when=the default changes; why_new=failure-policy parameter; seam=temporary directory; no_claim=reading a FIFO
test('the shared env reader reads a directory as no file by default and refuses it under a refusing policy', async (context) => {
  // Arrange
  const repository = await createExpoWebRepository(context)
  await mkdir(join(repository.appRoot, '.env.local'))
  // Act
  const byDefault = await readReactScriptsEnvFile(
    repository.appRoot,
    '.env.local',
  )
  const refusing = await readReactScriptsEnvFile(
    repository.appRoot,
    '.env.local',
    {
      refuseUnreadable: true,
      refusal: (name, reason) =>
        new StudyError('INVALID_CONFIGURATION', `${name}: ${reason}`),
    },
  ).catch((error: unknown) => error)
  // Assert
  assert.equal(byDefault, undefined)
  assert.ok(refusing instanceof StudyError)
  assert.equal(refusing.message, '.env.local: it is not a regular file')
})

// Value: protects=E-13: the web script grammar accepts expo start --web with --port or -p in either order and NAME=value assignments, and refuses every other shape by structure; fails_when=a wrapper, a bare start, a missing port number or a differently cased owned name is accepted; why_new=Expo grammar over the shared assignment reader; seam=pure parser; no_claim=what Expo does with the flags
test('the web script grammar accepts the declared forms and refuses the others', () => {
  // Arrange
  const accepted = [
    'expo start --web',
    'expo start --web --port 4101',
    'expo start --port 4101 --web',
    'expo start -p 4101 --web',
    'API_BASE=http://localhost:4100 expo start --web -p 4101',
    'CI=0 expo start --web',
  ]
  const refused = [
    'expo start',
    'expo start --web --port',
    'expo start --web --port abc',
    'expo start --web --clear',
    'expo start --web --web',
    'expo export --platform web',
    'npx expo start --web',
    'ci=0 expo start --web',
    'FOO=$(whoami) expo start --web',
  ]
  // Act
  const acceptedForms = accepted.map(
    (script) => parseExpoWebScript(script).readiness.form,
  )
  const refusedForms = refused.map(
    (script) => parseExpoWebScript(script).readiness.form,
  )
  // Assert
  assert.deepEqual(
    acceptedForms,
    accepted.map(() => 'accepted'),
  )
  assert.deepEqual(
    refusedForms,
    refused.map(() => 'refused'),
  )
  assert.equal(parseExpoWebScript('expo start -p 4101 --web').port, 4101)
  assert.deepEqual(
    { ...parseExpoWebScript('A=1 expo start --web').assignments },
    { A: '1' },
  )
})

/** Settles the environment of a staged Expo app whose `.env` holds the given text. */
async function environmentOfEnvFile(
  context: TestContext,
  envText: string,
): Promise<Record<string, string>> {
  const repository = await createExpoWebRepository(context, {
    files: { '.env': envText },
  })
  const expoPackage = await resolveExpoWebPackage(repository.root, 'apps/app')
  return (await assessExpoWebWorkspace(expoPackage)).environment
}

// Value: protects=E-9/DX-5 masking parity: every EXPO_PUBLIC value Expo (dotenv 16) loads from .env reaches the settled environment the mask list is built from, for export prefixes, inline comments, all three quotes and multi-line double quotes; fails_when=the react-scripts (dotenv 10) parser reads the file, so an exported name is lost or a comment stays in the value; why_new=Cycle 0089 review round; seam=temporary repository, real files, nothing executed; no_claim=that Metro inlines them
test('the Expo environment holds the EXPO_PUBLIC values exactly as Expo loads them from .env', async (context) => {
  // Arrange
  const envText = [
    'export EXPO_PUBLIC_EXPORTED=abc',
    'EXPO_PUBLIC_COMMENTED=abc # note',
    "EXPO_PUBLIC_SINGLE='single # kept'",
    'EXPO_PUBLIC_DOUBLE="double # kept"',
    'EXPO_PUBLIC_BACKTICK=`tick # kept`',
    'EXPO_PUBLIC_MULTI="first',
    'second"',
    'EXPO_PUBLIC_ESCAPED="a\\nb"',
    'EXPO_PUBLIC_COLON: colon',
  ].join('\n')
  // Act
  const environment = await environmentOfEnvFile(context, envText)
  // Assert
  assert.equal(environment.EXPO_PUBLIC_EXPORTED, 'abc')
  assert.equal(environment.EXPO_PUBLIC_COMMENTED, 'abc')
  assert.equal(environment.EXPO_PUBLIC_SINGLE, 'single # kept')
  assert.equal(environment.EXPO_PUBLIC_DOUBLE, 'double # kept')
  assert.equal(environment.EXPO_PUBLIC_BACKTICK, 'tick # kept')
  assert.equal(environment.EXPO_PUBLIC_MULTI, 'first\nsecond')
  assert.equal(environment.EXPO_PUBLIC_ESCAPED, 'a\nb')
  assert.equal(environment.EXPO_PUBLIC_COLON, 'colon')
})

// Value: protects=DX-3 nested-app install command: a nested app without a lockfile of its own, in a repository with a pnpm lockfile at its root, is told to install with pnpm; fails_when=the refusal names npm install because only the app folder is read; why_new=Cycle 0089 review round; seam=temporary repository; no_claim=running the command
test('a nested app without its own lockfile is told the install command of the repository root lockfile', async (context) => {
  // Arrange
  const repository = await createExpoWebRepository(context, { omitExpo: true })
  await writeFile(
    join(repository.root, 'pnpm-lock.yaml'),
    'lockfileVersion: 9\n',
  )
  const expoPackage = await resolveExpoWebPackage(repository.root, 'apps/app')
  // Act
  const thrown = await assessExpoWebWorkspace(expoPackage).catch(
    (error: unknown) => error,
  )
  // Assert
  assert.ok(thrown instanceof StudyError)
  assert.equal(thrown.details?.reason, 'not-installed')
  assert.equal(thrown.details?.installCommand, 'pnpm install --frozen-lockfile')
})
