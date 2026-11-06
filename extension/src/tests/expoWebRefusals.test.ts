import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EXPO_WEB_SUPPORTED_MAJOR } from '../constants'
import { ERROR_RECOVERY, type StudyError } from '../errors'
import {
  EXPO_WEB_REFUSAL_CODES,
  EXPO_WEB_REFUSAL_REASONS,
  expoWebAmbiguousSourceRefusal,
  expoWebBundleFailedRefusal,
  expoWebDependenciesRefusal,
  expoWebDynamicConfigRefusal,
  expoWebEnvFileRefusal,
  expoWebExitedRefusal,
  expoWebMapLimitRefusal,
  expoWebMapUnreadableRefusal,
  expoWebNoPlatformRefusal,
  expoWebNodeModulesRefusal,
  expoWebNotAppRefusal,
  expoWebNotInEntryBundleRefusal,
  expoWebNotInstalledRefusal,
  expoWebOutsidePackageRefusal,
  expoWebPortRefusal,
  expoWebPreScriptRefusal,
  expoWebScriptFormRefusal,
  expoWebSealedNodeModulesRefusal,
  expoWebSealedOutsidePackageRefusal,
  expoWebServerOutputRefusal,
  expoWebSetupDeadlineRefusal,
  expoWebSetupDeadlineText,
  expoWebUnmappedLineRefusal,
  expoWebVersionRefusal,
} from '../expoWebRefusals'
import { refusalFailureOf } from '../utils/refusalFailureOf'

/** Reads the recovery an agent would see from a refusal. */
function recoveryOf(error: StudyError): string {
  return error.describe().recovery
}

/** The refusals raised before any process starts, one per reason of `EXPO_WEB_UNSUPPORTED`. */
function unsupportedRefusals(): StudyError[] {
  return [
    expoWebNotInstalledRefusal(['pnpm-lock.yaml']),
    expoWebVersionRefusal('56.0.3'),
    expoWebDependenciesRefusal(['react-native-web']),
    expoWebNoPlatformRefusal(),
    expoWebNotAppRefusal('apps/api'),
    expoWebEnvFileRefusal('.env.local', 'it is not a regular file'),
    expoWebDynamicConfigRefusal('app.config.ts'),
    expoWebServerOutputRefusal(),
    expoWebScriptFormRefusal('the command word cross-env'),
    expoWebPreScriptRefusal('preweb'),
  ]
}

// Value: protects=every refusal before the start (EXPO_WEB_UNSUPPORTED) says Nothing started, carries its own reason and sideEffects none, and points at its help anchor; fails_when=a reason drops the sentence, reports partial side effects or loses the anchor; why_new=Expo's ten reasons are new; seam=none; no_claim=the wording of each fix line
test('each Expo unsupported-project reason says nothing started and points at its help anchor', () => {
  // Arrange
  const refusals = unsupportedRefusals()
  // Act
  const reasons = refusals.map((error) => error.details?.reason)
  // Assert
  assert.deepEqual(reasons, [...EXPO_WEB_REFUSAL_REASONS.EXPO_WEB_UNSUPPORTED])
  for (const error of refusals) {
    assert.equal(error.code, 'EXPO_WEB_UNSUPPORTED')
    assert.equal(error.details?.sideEffects, 'none')
    assert.ok(error.message.includes('Nothing started.'), error.message)
    assert.match(
      recoveryOf(error),
      /See codebook:\/\/help\/repository-browser#EXPO_WEB_UNSUPPORTED\.$/,
    )
  }
})

// Value: protects=the not-installed refusal names the app's own install command per lockfile and the version refusal names the installed version and the supported major; fails_when=a lockfile maps to another package manager, or the major is not 57; why_new=Expo reuses react-scripts' lockfile table through an export; seam=none; no_claim=that the command runs
test('the Expo not-installed refusal names the lockfile command and the version refusal names installed and supported majors', () => {
  // Arrange
  const lockfiles: Array<[string[], string]> = [
    [['package-lock.json'], 'npm ci'],
    [['yarn.lock'], 'yarn install --frozen-lockfile'],
    [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
    [['package.json'], 'npm install'],
  ]
  // Act
  const installCommands = lockfiles.map(
    ([files]) => expoWebNotInstalledRefusal(files).details?.installCommand,
  )
  const version = expoWebVersionRefusal('56.0.3')
  const unreadable = expoWebVersionRefusal(undefined)
  // Assert
  assert.deepEqual(installCommands, [
    'npm ci',
    'yarn install --frozen-lockfile',
    'pnpm install --frozen-lockfile',
    'npm install',
  ])
  assert.equal(EXPO_WEB_SUPPORTED_MAJOR, 57)
  assert.deepEqual(version.details, {
    reason: 'expo-version',
    installedVersion: '56.0.3',
    supportedMajor: 57,
    sideEffects: 'none',
  })
  assert.equal('installedVersion' in (unreadable.details ?? {}), false)
})

// Value: protects=a web script form and a pre script are described by words and names, and the recovery never interpolates a script value; fails_when=the recovery quotes the script text or the pre-script name is dropped; why_new=E-13 scripts are new; seam=none; no_claim=the caller's description builder
test('the Expo web-script form refusal carries the structural description and the pre-script refusal names the script', () => {
  // Arrange
  const description = 'the command word cross-env; extra words after expo start'
  // Act
  const form = expoWebScriptFormRefusal(description)
  const pre = expoWebPreScriptRefusal('prestart')
  // Assert
  assert.equal(form.details?.script, description)
  assert.ok(!recoveryOf(form).includes('cross-env'))
  assert.deepEqual(pre.details, {
    reason: 'pre-script',
    script: 'prestart',
    sideEffects: 'none',
  })
})

// Value: protects=a dynamic app.config and an env file name their file in details and the dynamic-config fix line says only app.json is read; fails_when=the file is lost or the fix line promises more than app.json; why_new=E-14 and E-16 are new; seam=none; no_claim=how the file is detected
test('the Expo dynamic-config refusal names its file and says this version reads only app.json', () => {
  // Arrange
  const file = 'app.config.js'
  // Act
  const dynamic = expoWebDynamicConfigRefusal(file)
  const env = expoWebEnvFileRefusal('.env.development', 'it is unreadable')
  // Assert
  assert.equal(dynamic.details?.file, 'app.config.js')
  assert.ok(recoveryOf(dynamic).includes('reads only app.json'))
  assert.equal(env.details?.file, '.env.development')
})

// Value: protects=the launcher, port and deadline refusals report partial side effects once the server ran and the stop sentence, and the pre-start port check reports none; fails_when=a port found before the start says the server was stopped, or an exit loses its code and signal; why_new=Expo's launcher codes are new; seam=none; no_claim=Metro's own wording
test('Expo launcher, port and deadline refusals tell what started and what was sent', () => {
  // Arrange
  const stopped = 'The owned server was stopped and no input was sent.'
  // Act
  const bundle = expoWebBundleFailedRefusal('Unable to resolve module ./x')
  const exited = expoWebExitedRefusal({ exitCode: null, signal: 'SIGKILL' })
  const before = expoWebPortRefusal(4101, 'pre-start-check')
  const after = expoWebPortRefusal(4101, 'expo-exit')
  const early = expoWebSetupDeadlineRefusal('starting the Expo CLI', 'none')
  const late = expoWebSetupDeadlineRefusal('bundling the app', 'partial')
  // Assert
  assert.equal(bundle.details?.bundlerLine, 'Unable to resolve module ./x')
  assert.ok(recoveryOf(bundle).includes(stopped))
  assert.deepEqual(exited.details, {
    reason: 'exited',
    exitCode: null,
    signal: 'SIGKILL',
    sideEffects: 'partial',
  })
  assert.equal(before.details?.sideEffects, 'none')
  assert.ok(recoveryOf(before).includes('Nothing started.'))
  assert.equal(after.details?.sideEffects, 'partial')
  assert.ok(recoveryOf(after).includes(stopped))
  assert.equal(early.details?.sideEffects, 'none')
  assert.ok(recoveryOf(early).includes('Nothing started.'))
  assert.equal(late.details?.step, 'bundling the app')
  assert.ok(recoveryOf(late).includes(stopped))
  // The message follows the side effects and the step reached
  assert.ok(early.message.includes('Nothing started and no input was sent'))
  assert.equal(early.message.includes('owned server was stopped'), false)
  assert.equal(early.message.includes('first Metro bundle'), false)
  assert.ok(
    late.message.includes(
      'The first Metro bundle of an Expo app can take long.',
    ),
  )
  assert.ok(
    late.message.includes('The owned server was stopped and no input was sent'),
  )
})

// Value: protects=every seal refusal after the start reports partial side effects and the stop sentence, the not-in-entry-bundle one says this version seals only files the entry bundle includes, and the before-start twins say nothing started; fails_when=a seal refusal after the start claims nothing started; why_new=Expo's seven seal reasons are new; seam=none; no_claim=the seal that raises them
test('Expo seal refusals report partial side effects after the start and name the entry-bundle limit', () => {
  // Arrange
  const stopped = 'The owned server was stopped and no input was sent.'
  const sealed = [
    expoWebSealedOutsidePackageRefusal('apps/app', ['lib/a.ts']),
    expoWebAmbiguousSourceRefusal('src/app/index.tsx'),
    expoWebSealedNodeModulesRefusal(['apps/app/node_modules/x/index.js']),
    expoWebUnmappedLineRefusal('src/app/index.tsx', 12, 14),
    expoWebMapLimitRefusal('mapped-generated-lines', 1_000_000),
    expoWebMapUnreadableRefusal('the bundle names no source map'),
    expoWebNotInEntryBundleRefusal('src/app/lazy.tsx'),
  ]
  // Act
  const reasons = sealed.map((error) => error.details?.reason)
  const before = [
    expoWebOutsidePackageRefusal('apps/app', ['lib/a.ts']),
    expoWebNodeModulesRefusal(['apps/app/node_modules/x/index.js']),
  ]
  // Assert
  assert.deepEqual(reasons, [
    'outside-package',
    'ambiguous-source',
    'node-modules',
    'unmapped-line',
    'map-limit',
    'map-unreadable',
    'not-in-entry-bundle',
  ])
  for (const error of sealed) {
    assert.equal(error.code, 'EXPO_WEB_SEAL_FAILED')
    assert.equal(error.details?.sideEffects, 'partial')
    assert.ok(recoveryOf(error).includes(stopped), error.message)
  }
  for (const error of before) {
    assert.equal(error.details?.sideEffects, 'none')
    assert.ok(recoveryOf(error).includes('Nothing started.'))
  }
  assert.ok(
    recoveryOf(sealed[6]!).includes(
      'seals only files the entry bundle includes',
    ),
  )
  assert.equal(sealed[4]?.details?.limitValue, 1_000_000)
})

// Value: protects=a setup deadline raised by a timer reaches the service as text and is restored with its code, step and partial side effects, and a text without the sentence restores the code alone; fails_when=the text lead or the step reader drifts from the sentence; why_new=the restorer now serves two codes; seam=none; no_claim=the timer that raises it
test('an Expo setup-deadline text restores its code, step and side effects through refusalFailureOf', () => {
  // Arrange
  const text = expoWebSetupDeadlineText('bundling the app')
  // Act
  const restored = refusalFailureOf(text)
  const early = refusalFailureOf(
    expoWebSetupDeadlineText('starting the Expo CLI'),
  )
  const bare = refusalFailureOf('EXPO_WEB_SETUP_DEADLINE: Setup took too long.')
  // Assert
  assert.equal(restored?.code, 'EXPO_WEB_SETUP_DEADLINE')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'setup-deadline',
    step: 'bundling the app',
    sideEffects: 'partial',
  })
  assert.deepEqual(early?.libraryDetails, {
    reason: 'setup-deadline',
    step: 'starting the Expo CLI',
    sideEffects: 'partial',
  })
  assert.deepEqual(bare, {
    code: 'EXPO_WEB_SETUP_DEADLINE',
    message: 'Setup took too long.',
  })
})

// Value: protects=each Expo code has a general recovery in the error table that points at its own anchor, and every factory reason is listed in the reason table the help keys by; fails_when=a code lacks a recovery or the reason table and the factories drift; why_new=new codes need registration; seam=none; no_claim=the help text
test('each Expo refusal code has a recovery that points at its own help anchor', () => {
  // Arrange
  const codes = [...EXPO_WEB_REFUSAL_CODES]
  // Act
  const recoveries = codes.map((code) => ERROR_RECOVERY[code])
  // Assert
  assert.deepEqual(codes, [
    'EXPO_WEB_UNSUPPORTED',
    'EXPO_WEB_LAUNCHER_FAILED',
    'EXPO_WEB_PORT_UNAVAILABLE',
    'EXPO_WEB_SETUP_DEADLINE',
    'EXPO_WEB_SEAL_FAILED',
  ])
  // The port and seal recoveries say what started
  assert.ok(
    ERROR_RECOVERY.EXPO_WEB_PORT_UNAVAILABLE.includes(
      'details.sideEffects tells what started',
    ),
  )
  assert.ok(
    ERROR_RECOVERY.EXPO_WEB_SEAL_FAILED.includes(
      'details.sideEffects tells what started',
    ),
  )
  recoveries.forEach((recovery, index) =>
    assert.ok(
      recovery.endsWith(
        `See codebook://help/repository-browser#${codes[index]}.`,
      ),
      codes[index],
    ),
  )
})
